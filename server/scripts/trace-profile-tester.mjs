import { createParserForProfile } from '../src/services/trace/parser-registry.js';
import { readFileSync } from 'fs';

const configPath = process.argv[2];
const samplePath = process.argv[3];

if (!configPath || !samplePath) {
  console.error('Usage: node trace-profile-tester.mjs <profile.json> <sample.txt|csv>');
  process.exit(1);
}

const profileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
const sample = readFileSync(samplePath, 'utf-8');

const parser = createParserForProfile({ tfp_config: profileConfig });
const spans = await parser.parseFile('sample', sample);

const total = spans.length;
const matched = spans.filter((s) => !s.unparsed).length;
const unmatched = total - matched;
const coverage = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

console.log({ total, matched, unmatched, coverage });
console.log('--- first 3 spans ---');
spans.slice(0, 3).forEach((s) => console.log(JSON.stringify(s, null, 2)));
console.log('--- unparsed ---');
spans.filter((s) => s.unparsed).forEach((s) => console.log(s.raw?.slice(0, 200)));
