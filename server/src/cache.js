// Statement cache - single source for prepared statements
const cache = new Map();

export const stmt = (db, sql) => {
  if (!cache.has(sql)) {
    cache.set(sql, db.prepare(sql));
  }
  return cache.get(sql);
};

export const clearCache = () => cache.clear();
