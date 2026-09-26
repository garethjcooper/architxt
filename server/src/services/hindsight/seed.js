import { createLogger } from '../../utils/logger.js';
import { listServers, createServer } from '../../db/crud/servers.js';

const logger = createLogger('hindsight-seed');

/**
 * Create a default memory bank in Hindsight.
 *
 * Uses the Hindsight bank API: PUT /v1/default/banks/{bankId}
 * A 200/201/204 response or a 409 conflict means the bank exists.
 */
async function ensureDefaultBank(serviceUrl, bankId) {
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}`;
  const payload = JSON.stringify({});
  const maxAttempts = 60;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: payload,
      });

      const responseText = await response.text();

      if (response.ok || response.status === 409) {
        logger.info('Ensured default Hindsight bank', {
          bankId,
          serviceUrl,
          status: response.status,
        });
        return { success: true };
      }

      logger.warn('Hindsight bank creation failed', {
        bankId,
        serviceUrl,
        status: response.status,
        response: responseText,
        attempt,
      });
      return { success: false, status: response.status, response: responseText };
    } catch (err) {
      if (attempt < maxAttempts) {
        logger.debug('Hindsight not reachable for bank creation, retrying', {
          bankId,
          serviceUrl,
          attempt,
          error: err.message,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        logger.warn('Could not reach Hindsight to create default bank', {
          bankId,
          serviceUrl,
          attempts: maxAttempts,
          error: err.message,
        });
        return { success: false, error: err.message };
      }
    }
  }

  return { success: false, error: 'Exhausted retries' };
}

/**
 * Auto-register a default Hindsight server on startup if requested.
 *
 * When ARCHITXT_HINDSIGHT_DEFAULT_URL is set (e.g. http://hindsight:8888
 * inside Docker Compose), this inserts a server row with that base URL
 * if no server with the same URL already exists.
 *
 * If ARCHITXT_HINDSIGHT_DEFAULT_BANK is also set, it ensures a bank with
 * that ID exists in Hindsight via the bank API.
 *
 * This keeps the Docker full-stack path to one command: the user only needs
 * to add the Hindsight LLM credentials to server/.env; the server and bank
 * are created automatically on first boot.
 */
export async function ensureDefaultHindsightServer(db) {
  const defaultUrl = process.env.ARCHITXT_HINDSIGHT_DEFAULT_URL;
  const defaultBank = process.env.ARCHITXT_HINDSIGHT_DEFAULT_BANK;

  if (!defaultUrl) {
    logger.debug('ARCHITXT_HINDSIGHT_DEFAULT_URL not set — skipping default Hindsight seed');
    return { seeded: false };
  }

  let serverId = null;

  try {
    const existing = listServers(db);
    if (!existing.success) {
      logger.warn('Could not list servers for Hindsight seed check', { error: existing.error });
      return { seeded: false, error: existing.error };
    }

    const existingServer = existing.data.find(
      (server) => server.svr_base_url === defaultUrl
    );

    if (existingServer) {
      logger.debug('Default Hindsight server already exists', { url: defaultUrl });
      serverId = existingServer.svr_id;
    } else {
      const createResult = createServer(db, {
        svr_name: 'Hindsight (auto)',
        svr_base_url: defaultUrl,
        svr_api_key: null,
        svr_api_version: null,
      });

      if (!createResult.success) {
        logger.warn('Failed to create default Hindsight server', {
          url: defaultUrl,
          error: createResult.error,
        });
        return { seeded: false, error: createResult.error };
      }

      serverId = createResult.data;
      logger.info('Created default Hindsight server from ARCHITXT_HINDSIGHT_DEFAULT_URL', {
        id: serverId,
        url: defaultUrl,
      });
    }
  } catch (err) {
    logger.error('Failed to seed default Hindsight server', {
      url: defaultUrl,
      error: err.message,
    });
    return { seeded: false, error: err.message };
  }

  if (defaultBank) {
    const bankResult = await ensureDefaultBank(defaultUrl, defaultBank);
    return {
      seeded: true,
      id: serverId,
      bank: bankResult.success ? defaultBank : null,
      bankError: bankResult.success ? null : (bankResult.error || bankResult.response),
    };
  }

  return { seeded: true, id: serverId };
}
