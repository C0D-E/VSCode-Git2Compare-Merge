#!/usr/bin/env node
// Removes duplicate fenced code blocks inside Markdown files.
// Default: dedupe only *adjacent* duplicate fences (safer).
// --aggressive : dedupe duplicates anywhere in the file.
// --check      : exit 1 if any duplicates would be removed.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { glob } from 'glob';
import { format as sqlFormat } from 'sql-formatter';
import { format } from 'prettier';

const SQL_TAGS = ['sql', 'postgres', 'postgresql', 'psql'];
const JS_TAGS = ['js', 'javascript'];

// Captures: 1) language, 2) body (greedy, multiline)
const FENCE_RE = /```([a-zA-Z0-9_-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

const CHECK_MODE = process.argv.includes('--check');
const AGGRESSIVE = process.argv.includes('--aggressive');

function canon(lang, body) {
  const l = (lang || '').toLowerCase();
  const trimmed = (body || '').trim();

  try {
    if (JS_TAGS.includes(l)) {
      // Canonicalize JS with Prettier (ES6+)
      return format(trimmed, { parser: 'babel' }).trim();
    }
    if (SQL_TAGS.includes(l)) {
      // Canonicalize SQL for PostgreSQL
      return sqlFormat(trimmed, { language: 'postgresql' }).trim();
    }
  } catch {
    // If formatter fails, fall back to raw trimmed text
  }
  return trimmed;
}

(async () => {
  const fileArgs = process.argv.slice(2);
  const files = fileArgs.length > 0 ? fileArgs : await glob('files/**/*.md');

  let anyChangedGlobal = false;

  for (const file of files) {
    const full = resolve(file);
    const src = readFileSync(full, 'utf8');

    let out = '';
    let idx = 0;
    let m;

    // For adjacent-only detection
    let prevFenceKey = null;

    // For aggressive global-in-file duplicates
    const seen = new Set();

    let fileChanged = false;

    while ((m = FENCE_RE.exec(src)) !== null) {
      const before = src.slice(idx, m.index);
      out += before;

      const lang = m[1] || '';
      const body = m[2] || '';

      const key = lang.toLowerCase() + '::' + canon(lang, body);

      let isDup = false;

      if (AGGRESSIVE) {
        if (seen.has(key)) isDup = true;
      } else {
        // Adjacent-only: only whitespace/newlines allowed between fences
        const onlyWsBetween = /^\s*$/.test(before);
        if (onlyWsBetween && prevFenceKey === key) {
          isDup = true;
        }
      }

      if (!isDup) {
        // Normalize trailing whitespace inside the fence when writing back
        out += '```' + lang + '\n' + body.replace(/\s+$/, '') + '\n```';
        prevFenceKey = key;
        seen.add(key);
      } else {
        fileChanged = true;
        anyChangedGlobal = true;
        // Skip writing this duplicate fence
        // Reset prevFenceKey so triples of the same fence don't accidentally chain
        prevFenceKey = key;
      }

      // Move cursor to after the current fence
      idx = m.index + m[0].length;
    }

    // Append remainder after the last fence
    out += src.slice(idx);

    if (fileChanged && !CHECK_MODE) {
      writeFileSync(full, out, 'utf8');
    }
  }

  if (CHECK_MODE && anyChangedGlobal) {
    console.error('Duplicate code fences detected (would be removed).');
    process.exit(1);
  }
})();
