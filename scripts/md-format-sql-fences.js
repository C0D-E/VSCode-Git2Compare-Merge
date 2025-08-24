#!/usr/bin/env node
// Formats fenced SQL blocks inside Markdown files.
// Supports ```sql / ```postgres / ```postgresql / ```psql fences.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { glob } from 'glob';
import { format as sqlFormat } from 'sql-formatter';

const SQL_TAGS = ['sql', 'postgres', 'postgresql', 'psql'];
const FENCE_RE = /```([a-zA-Z0-9_-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

const CHECK_MODE = process.argv.includes('--check');

(async () => {
  const fileArgs = process.argv.slice(2);
  const files = fileArgs.length > 0 ? fileArgs : await glob('files/**/*.md');

  let changedAny = false;

  for (const file of files) {
    const full = resolve(file);
    const src = readFileSync(full, 'utf8');
    let changed = false;

    const out = src.replace(FENCE_RE, (match, lang, body) => {
      const l = (lang || '').toLowerCase();
      if (!SQL_TAGS.includes(l)) return match;

      try {
        const formatted = sqlFormat(body, { language: 'postgresql' }).trimEnd();
        if (formatted !== body.trimEnd()) changed = true;
        return '```' + lang + '\n' + formatted + '\n```';
      } catch {
        // If formatting fails, keep original block
        return match;
      }
    });

    if (changed) {
      changedAny = true;
      if (!CHECK_MODE) writeFileSync(full, out, 'utf8');
    }
  }

  if (CHECK_MODE && changedAny) {
    console.error('SQL fences need formatting.');
    process.exit(1);
  }
})();
