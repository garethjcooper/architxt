import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const ddlPath = path.join(rootDir, 'sql', 'architxt_db_schema_ddl.sql');
const ensureSchemaPath = path.join(rootDir, 'src', 'db', 'ensure-schema.js');

function extractDdlTables(ddl) {
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\);/gis;
  const tables = {};
  for (const m of ddl.matchAll(tableRe)) {
    tables[m[1]] = true;
  }
  return tables;
}

function extractEnsureTables(code) {
  // Match objects inside tablesToCreate array that have a name and ddl.
  const blockRe = /const\s+tablesToCreate\s*=\s*\[([\s\S]*?)\];/;
  const match = code.match(blockRe);
  assert.ok(match, 'tablesToCreate array not found in ensure-schema.js');
  const entryRe = /\{\s*name:\s*'([^']+)'\s*,\s*ddl:\s*`/g;
  const tables = {};
  for (const m of match[1].matchAll(entryRe)) {
    tables[m[1]] = true;
  }
  return tables;
}

function extractEnsureColumnMigrations(code) {
  // Find all { table: '...', columns: [...] } blocks inside ensureMissingColumns.
  const migrations = [];
  const tableBlockRe = /\{\s*table:\s*'([^']+)'\s*,\s*columns:\s*\[([\s\S]*?)\]\s*\}/g;
  for (const block of code.matchAll(tableBlockRe)) {
    const table = block[1];
    const columnsBlock = block[2];
    const colRe = /\{\s*name:\s*'([^']+)'\s*,\s*ddl:/g;
    for (const cm of columnsBlock.matchAll(colRe)) {
      migrations.push({ table, column: cm[1] });
    }
  }
  return migrations;
}

function extractDdlColumns(ddl) {
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\);/gis;
  const result = {};
  for (const m of ddl.matchAll(tableRe)) {
    const table = m[1];
    const body = m[2];
    // Simple column extraction: skip lines that are table constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
    const colRe = /^\s*(\w+)\s+/gm;
    const cols = [];
    for (const cm of body.matchAll(colRe)) {
      const col = cm[1];
      if (['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT'].includes(col.toUpperCase())) continue;
      cols.push(col);
    }
    result[table] = new Set(cols);
  }
  return result;
}

describe('DDL is the source of truth', () => {
  const ddl = readFileSync(ddlPath, 'utf8');
  const ensureCode = readFileSync(ensureSchemaPath, 'utf8');

  it('every table added by ensureMissingTables exists in the DDL', () => {
    const ddlTables = extractDdlTables(ddl);
    const ensureTables = extractEnsureTables(ensureCode);
    const missing = Object.keys(ensureTables).filter((t) => !ddlTables[t]);
    assert.deepStrictEqual(missing, [], `tables missing from DDL: ${missing.join(', ')}`);
  });

  it('every column added by ensureMissingColumns exists in the DDL', () => {
    const ddlColumns = extractDdlColumns(ddl);
    const migrations = extractEnsureColumnMigrations(ensureCode);
    const missing = migrations.filter(({ table, column }) => {
      const cols = ddlColumns[table];
      return !cols || !cols.has(column);
    });
    assert.deepStrictEqual(
      missing,
      [],
      `columns missing from DDL: ${missing.map((m) => `${m.table}.${m.column}`).join(', ')}`
    );
  });
});
