import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fork, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { createLogger } from './utils/logger.js';
import { db, closeDatabase } from './db/connection.js';
import documentsRoute from './routes/documents.js';
import contextsRoute from './routes/contexts.js';
import tagsRoute from './routes/tags.js';
import serversRoute from './routes/servers.js';
import metadataRoute from './routes/metadata.js';
import hindsightRoute from './routes/hindsight.js';
import entitiesRoute from './routes/entities.js';
import configRoute from './routes/config.js';
import swaggerSpecs, { swaggerUi } from './swagger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('server');

// Resolve version and commit for startup banner
let pkgVersion = '0.0.0';
let commitHash = 'unknown';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* ignore */ }
try {
  commitHash = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..', '..'), encoding: 'utf-8' }).trim();
} catch { /* ignore */ }

// Daemon state
let daemon = null;
let hindsightPollDaemon = null;
let daemonRestartTimer = null;
let hindsightPollRestartTimer = null;
const DAEMON_RESTART_DELAY_MS = 5000;


/**
 * Spawn the extract daemon as a child process
 * Controlled by SPAWN_EXTRACT_DAEMON env var (default: true)
 */
function spawnDaemon() {
  if (!config.daemon.spawnExtract) {
    logger.info('Daemon spawning disabled via SPAWN_EXTRACT_DAEMON=false');
    return null;
  }

  const daemonPath = path.join(__dirname, 'daemons', 'extract-daemon.js');
  const child = fork(daemonPath, [], {
    stdio: 'inherit',
    env: process.env
  });

  logger.info('Daemon spawned', { pid: child.pid, path: daemonPath });

  child.on('exit', (code, signal) => {
    logger.warn('Daemon exited', { code, signal, pid: child.pid });

    // Clear reference if this was the current daemon
    if (daemon === child) {
      daemon = null;
    }

    // Restart unless we're shutting down
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      logger.info(`Daemon restart scheduled in ${DAEMON_RESTART_DELAY_MS}ms`);
      daemonRestartTimer = setTimeout(() => {
        daemon = spawnDaemon();
      }, DAEMON_RESTART_DELAY_MS);
    }
  });

  child.on('error', (err) => {
    logger.error('Daemon error', { error: err.message, pid: child.pid });
  });

  return child;
}

/**
 * Spawn the Hindsight poll daemon as a child process
 * Controlled by SPAWN_HINDSIGHT_POLL_DAEMON env var (default: true)
 */
function spawnHindsightPollDaemon() {
  if (!config.daemon.spawnHindsightPoll) {
    logger.info('Hindsight poll daemon spawning disabled via SPAWN_HINDSIGHT_POLL_DAEMON=false');
    return null;
  }

  const daemonPath = path.join(__dirname, 'daemons', 'hindsight-poll', 'poll-daemon.js');
  const child = fork(daemonPath, [], {
    stdio: 'inherit',
    env: process.env,
  });

  logger.info('Hindsight poll daemon spawned', { pid: child.pid, path: daemonPath });

  child.on('exit', (code, signal) => {
    logger.warn('Hindsight poll daemon exited', { code, signal, pid: child.pid });

    if (hindsightPollDaemon === child) {
      hindsightPollDaemon = null;
    }

    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      logger.info(`Hindsight poll daemon restart scheduled in ${DAEMON_RESTART_DELAY_MS}ms`);
      hindsightPollRestartTimer = setTimeout(() => {
        hindsightPollDaemon = spawnHindsightPollDaemon();
      }, DAEMON_RESTART_DELAY_MS);
    }
  });

  child.on('error', (err) => {
    logger.error('Hindsight poll daemon error', { error: err.message, pid: child.pid });
  });

  return child;
}

/**
 * Stop a specific daemon by child process ref
 */
function stopChildDaemon(child, name, signal = 'SIGTERM') {
  if (!child) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn(`${name} did not exit cleanly, forcing`);
      child.kill('SIGKILL');
    }, 10000);

    child.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill(signal);
  });
}

/**
 * Gracefully stop all daemons
 */
function stopDaemon(signal = 'SIGTERM') {
  // Clear pending restart timers so daemons don't respawn during shutdown
  if (daemonRestartTimer) {
    clearTimeout(daemonRestartTimer);
    daemonRestartTimer = null;
  }
  if (hindsightPollRestartTimer) {
    clearTimeout(hindsightPollRestartTimer);
    hindsightPollRestartTimer = null;
  }
  const promises = [
    stopChildDaemon(daemon, 'Extract daemon', signal),
    stopChildDaemon(hindsightPollDaemon, 'Hindsight poll daemon', signal),
  ];
  return Promise.all(promises);
}

// Make config available to routes
const app = express();
app.locals.config = config;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/v1/documents', documentsRoute);
app.use('/api/v1/contexts', contextsRoute);
app.use('/api/v1/tags', tagsRoute);
app.use('/api/v1/servers', serversRoute);
app.use('/api/v1/metadata', metadataRoute);
app.use('/api/v1/hindsight', hindsightRoute);
app.use('/api/v1/entities', entitiesRoute);
app.use('/api/v1/config', configRoute);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Serve static UI files (production build output from ui/dist/)
const uiDistPath = path.join(__dirname, '../../ui/dist');

// Pre-empt express.static for extensionless UI routes.
// Next.js static export creates flat .html files (documents.html, tags.html, …).
// express.static sees the matching directory (documents/) and redirects to /documents/,
// which then 404s because there's no index.html inside. We serve the .html file directly.
app.get('/:page', (req, res, next) => {
  const htmlPath = path.join(uiDistPath, `${req.params.page}.html`);
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath);
  }
  next();
});

app.use(express.static(uiDistPath));

// SPA fallback: serve index.html for any non-API route that didn't match above
app.get('*', (req, res) => {
  res.sendFile(path.join(uiDistPath, 'index.html'));
});

// Start server
const server = app.listen(config.server.port, config.server.host, () => {
  const baseUrl = `http://${config.server.host}:${config.server.port}`;
  const uiAvailable = fs.existsSync(uiDistPath);
  logger.info(`architxt server running at ${baseUrl}`);
  logger.info(`API docs (Swagger): ${baseUrl}/api-docs`);
  logger.info(`Version: ${pkgVersion} (commit: ${commitHash})`);
  if (uiAvailable) {
    logger.info(`UI serving from: ui/dist/ → ${baseUrl}`);
  } else {
    logger.warn(`UI not found: ui/dist/ missing`);
  }
});

// Spawn daemons after server starts
daemon = spawnDaemon();
hindsightPollDaemon = spawnHindsightPollDaemon();

// Graceful shutdown
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, stopping daemons first...`);

  // Stop daemons before closing server
  await stopDaemon(signal);

  // If server never started (e.g. startup error), just exit
  if (!server || !server.listening) {
    logger.info('Server was not listening, closing DB and exiting');
    closeDatabase();
    process.exit(1);
  }

  logger.info('Daemon stopped, closing HTTP server...');

  server.close((err) => {
    if (err) {
      logger.error('Error closing server:', err);
      process.exit(1);
    }

    logger.info('HTTP server closed');

    // Close database connection
    closeDatabase();
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled errors to prevent hard crashes that orphan daemon children
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason?.message ?? reason, stack: reason?.stack });
  gracefulShutdown('SIGTERM');
});

export default app;
