import multer from 'multer';
import { config } from '../config.js';
import { mapErrorToStatus } from '../utils/db-helpers.js';

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage?.max_file_size || 100 * 1024 * 1024
  }
});

const mapMulterError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      code: 'FILE_TOO_LARGE',
      message: `File size exceeds ${(config.storage?.max_file_size || 100 * 1024 * 1024) / (1024 * 1024)}MB limit`
    };
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return { code: 'TOO_MANY_FILES', message: 'Too many files uploaded' };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return { code: 'UNEXPECTED_FIELD', message: 'Unexpected file field' };
  }
  return { code: 'FILE_UPLOAD_ERROR', message: err.message };
};

export const createUploadMiddleware = (fieldName) => {
  const upload = multerUpload.single(fieldName);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        const { code, message } = mapMulterError(err);
        return res.status(mapErrorToStatus(code)).json({
          error: message,
          code
        });
      }
      next();
    });
  };
};
