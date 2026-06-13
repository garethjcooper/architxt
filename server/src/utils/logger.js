import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

const { combine, timestamp, printf, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

export const createLogger = (serviceName) => {
  const logDir = config.logging?.dir;
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return winston.createLogger({
    level: config.logging?.level || 'info',
    defaultMeta: { service: serviceName },
    format: combine(
      timestamp(),
      errors({ stack: true }),
      logFormat
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error'
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log')
      })
    ]
  });
};

/**
 * Log response details for route handlers
 * Always logs at info level so responses are visible
 */
export const logResponse = (logger, {
  method,
  path,
  statusCode,
  success,
  error,
  code,
  durationMs,
  extra = {}
}) => {
  const level = success ? 'info' : 'error';
  const message = success 
    ? `${method} ${path} ${statusCode}`
    : `${method} ${path} ${statusCode} - ${error}`;
  
  logger.log(level, message, {
    method,
    path,
    statusCode,
    success,
    error: error || undefined,
    code: code || undefined,
    durationMs,
    ...extra
  });
};
