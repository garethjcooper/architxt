const fs = require('fs');
const path = require('path');

const DOCS_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(DOCS_ROOT, 'docs');
const STATIC_DIR = path.join(DOCS_ROOT, 'static');
const SIDEBARS_PATH = path.join(DOCS_ROOT, 'sidebars.ts');
const SITE_URL = 'https://architxtlabs.com';

function readText(file) {
  return fs.readFileSync(file, { encoding: 'utf8' });
}

function stripFrontmatter(text) {
  return text.replace(/^---\s*\n([\s\S]*?)\n---/, '').trim();
}

function cleanMdx(text) {
  // Remove import/export statements
  text = text.replace(/^\s*import\s+.*?$/gm, '');
  text = text.replace(/^\s*export\s+.*?$/gm, '');
  // Remove JSX component tags (self-closing and block)
  text = text.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, '');
  text = text.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*>[\s\S]*?<\/[A-Z][A-Za-z0-9]*>/g, '');
  // Remove JSX expressions
  text = text.replace(/\{[^}]*\}/g, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  return text;
}

function extractTitle(text) {
  const body = stripFrontmatter(text);
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function extractSlug(text) {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const slugMatch = fm[1].match(/slug:\s*(\S+)/);
  return slugMatch ? slugMatch[1] : null;
}

function docIdFromFile(file) {
  const rel = path.relative(DOCS_DIR, file);
  const parts = rel.split(path.sep);
  const base = path.basename(parts[parts.length - 1], path.extname(parts[parts.length - 1]));
  parts[parts.length - 1] = base;
  return parts.join('/');
}

function urlPathFromFile(file) {
  const slug = extractSlug(readText(file));
  if (slug) return slug.startsWith('/') ? slug : '/' + slug;
  return '/' + docIdFromFile(file);
}

function parseSidebars(sidebarsText) {
  const pages = [];
  const categoryRe = /type:\s*'category',\s*label:\s*'([^']+)',[\s\S]*?items:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = categoryRe.exec(sidebarsText)) !== null) {
    const label = m[1];
    const block = m[2];
    const items = [...block.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    pages.push({ label, items });
  }
  return pages;
}

function findDocFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mdx|md)$/.test(entry.name)) files.push(full);
    }
  }
  walk(DOCS_DIR);
  return files.sort();
}

function buildLlmsIndex(sidebarPages) {
  const lines = [
    '# architxt documentation',
    '',
    'Documentation for architxt, a knowledge workbench that turns documents into contextual graphs.',
    '',
    `Base URL: ${SITE_URL}/`,
    `Full plain-text dump: ${SITE_URL}/llms-full.txt`,
    '',
  ];

  // Add intro link if not already present in sidebars
  const introFile = path.join(DOCS_DIR, 'intro.mdx');
  if (fs.existsSync(introFile)) {
    lines.push('## Getting started');
    lines.push(`- Introduction: ${SITE_URL}/`);
    lines.push('');
  }

  for (const { label, items } of sidebarPages) {
    lines.push(`## ${label}`);
    for (const item of items) {
      const candidates = [
        path.join(DOCS_DIR, `${item}.mdx`),
        path.join(DOCS_DIR, `${item}.md`),
      ];
      const file = candidates.find((f) => fs.existsSync(f));
      if (!file) continue;
      const title = extractTitle(readText(file));
      const urlPath = urlPathFromFile(file);
      lines.push(`- ${title}: ${SITE_URL}${urlPath}`);
    }
    lines.push('');
  }

  lines.push(
    '## Notes for agents',
    '',
    '- Product name is lowercase: architxt.',
    '- Docs are written from the user/UI perspective.',
    '- For implementation details, pair these docs with the architxt repository source.',
    '- Use /llms-full.txt for a single-file concatenation of all pages.',
    ''
  );

  return lines.join('\n');
}

function buildLlmsFull(sidebarPages, allFiles) {
  const ordered = [];
  const introFile = path.join(DOCS_DIR, 'intro.mdx');
  if (fs.existsSync(introFile)) ordered.push(introFile);

  for (const { items } of sidebarPages) {
    for (const item of items) {
      const candidates = [
        path.join(DOCS_DIR, `${item}.mdx`),
        path.join(DOCS_DIR, `${item}.md`),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c) && !ordered.includes(c)) {
          ordered.push(c);
          break;
        }
      }
    }
  }

  for (const f of allFiles) {
    if (!ordered.includes(f)) ordered.push(f);
  }

  const out = [
    '# architxt documentation — full text',
    '',
    `Source: ${SITE_URL}/llms-full.txt`,
    `Individual pages and index: ${SITE_URL}/llms.txt`,
    '',
    '---',
    '',
  ];

  for (const file of ordered) {
    const text = readText(file);
    const title = extractTitle(text);
    const urlPath = urlPathFromFile(file);
    const body = cleanMdx(stripFrontmatter(text));
    out.push(`# ${title}`);
    out.push(`URL: ${SITE_URL}${urlPath}`);
    out.push(body);
    out.push('---');
    out.push('');
  }

  return out.join('\n');
}

function main() {
  const sidebarsText = readText(SIDEBARS_PATH);
  const sidebarPages = parseSidebars(sidebarsText);
  const allFiles = findDocFiles();

  const index = buildLlmsIndex(sidebarPages);
  const full = buildLlmsFull(sidebarPages, allFiles);

  if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATIC_DIR, 'llms.txt'), index);
  fs.writeFileSync(path.join(STATIC_DIR, 'llms-full.txt'), full);

  const indexLines = index.split('\n').length;
  const fullLines = full.split('\n').length;
  console.log(`Generated llms.txt (${indexLines} lines)`);
  console.log(`Generated llms-full.txt (${fullLines} lines)`);
}

main();
