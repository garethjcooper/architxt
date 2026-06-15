/**
 * Structured logging utility for frontend
 * 
 * Usage:
 * const logger = createLogger('ComponentName');
 * logger.info('Message', { data: true });
 * logger.error('Failed to load', { error: err });
 * logger.warn('Deprecated pattern used');
 */

export function createLogger(name: string) {
  return {
    info: (msg: string, data?: any) => {
      if (data) {
        console.log(`[${name}] ${msg}`, data);
      } else {
        console.log(`[${name}] ${msg}`);
      }
    },
    error: (msg: string, data?: any) => {
      if (data) {
        console.error(`[${name}] ${msg}`, data);
      } else {
        console.error(`[${name}] ${msg}`);
      }
    },
    warn: (msg: string, data?: any) => {
      if (data) {
        console.warn(`[${name}] ${msg}`, data);
      } else {
        console.warn(`[${name}] ${msg}`);
      }
    },
  };
}
