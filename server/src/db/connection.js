import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { ensureSchema } from './ensure-schema.js';
import { ensureSeedData } from './ensure-seed.js';

const logger = createLogger('database');

/**
 * Initialize database connection
 * @returns {Database} Better-sqlite3 database instance
 */
const initializeDatabase = () => {
  const dbPath = config.database.path;
  
  try {
    // Ensure directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info(`Created data directory: ${dataDir}`);
    }
    
    // Open database
    const db = new Database(dbPath, {
      timeout: config.database.timeout_ms
    });
    
    // Enable WAL mode for concurrency
    if (config.database.wal_mode !== false) {
      db.pragma('journal_mode = WAL');
      logger.debug('WAL mode enabled');
    }
    
    // Enable foreign key enforcement
    db.pragma('foreign_keys = ON');
    logger.debug('Foreign key enforcement enabled');
    
    // Auto-create schema on first run
    ensureSchema(db);
    
    // Auto-populate seed data after schema is guaranteed present
    ensureSeedData(db);
    
    logger.info(`Database initialized at ${dbPath}`);
    
    return db;
    
  } catch (err) {
    logger.error('Failed to initialize database', {
      error: err.message,
      path: dbPath
    });
    throw err;
  }
};

/**
 * Singleton database instance
 * Imported by routes and services
 */
export const db = initializeDatabase();

/**
 * Close database connection
 * For graceful shutdown
 */
export const closeDatabase = () => {
  if (db) {
    db.close();
    logger.info('Database connection closed');
  }
};
