This document outlines a complete playbook for managing and merging Markdown files that
contain JavaScript and SQL code blocks, designed to automate cleanup and minimize manual
conflict resolution.

---

### Core Concept

The playbook's main goal is to solve the problem of tedious manual merges in
documentation. It uses a **"Union, Format, and Deduplicate"** strategy to automatically
combine, clean, and consolidate Markdown files after a Git merge.

### How It Works: The Three-Step Process

1.  **Union Merge**: By configuring Git's `.gitattributes`, the playbook uses a
    `merge=union` strategy for Markdown files. Instead of creating a conflict, this
    strategy simply includes the content from **both** branches, preventing any work
    from being lost.

2.  **Auto-Formatting**: After the merge, an `npm` script is run. This script uses
    **Prettier** to format the Markdown text and any JavaScript code blocks. A custom
    Node.js script is used to format the **PostgreSQL** code blocks, ensuring all
    content is stylistically consistent.

3.  **Automatic Deduplication**: The key innovation is a second custom Node.js script
    that intelligently removes duplicate code blocks created by the union merge. It
    creates a "canonical" version of each JS and SQL block (ignoring whitespace and
    formatting differences) and removes any duplicates it finds. By default, it only
    removes adjacent duplicates for safety, but an "aggressive" mode can remove
    duplicates anywhere in the file.

---

### Daily Workflow

- **Clone/fork this repo**: Cloen or fork this repo and put your content in `v1.md`
  (first markdown content) and `v2.md` (second markdown content you want to merge with
  `v1.md`). Out put will be `files-merged.md` under the `files` folder.

- **Automation**: The entire cleanup process is packaged into a single command,
  `npm run fmt`, which is automatically triggered on every commit using a **Git
  pre-commit hook**.

---

# Here is a step-by-step process to add a new language, using **Python** as the example.

### Step 1: Choose and Install a Formatter

First, you need a command-line tool that can format your new language's code. For
Python, a popular choice is `black`. We can install a Node.js wrapper for it as a
development dependency.

1.  **Install the npm package:**
    ```bash
    npm i -D black-node
    ```

---

### Step 2: Create a New Formatting Script

Create a new script specifically for formatting Python code blocks inside your Markdown
files. This keeps the logic clean and separate from the SQL formatter.

1.  **Create the file `scripts/md-format-python-fences.js`:**

    ````js
    #!/usr/bin/env node
    // Formats fenced Python blocks inside Markdown files.

    import { readFileSync, writeFileSync } from 'fs';
    import { resolve } from 'path';
    import { glob } from 'glob';
    import { format as blackFormat } from 'black-node';

    const PYTHON_TAGS = ['python', 'py'];
    const FENCE_RE = /```([a-zA-Z0-9_-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
    const CHECK_MODE = process.argv.includes('--check');

    (async () => {
      const files = await glob('**/*.md', { ignore: ['**/node_modules/**'] });
      let changedAny = false;

      for (const file of files) {
        const full = resolve(file);
        const src = readFileSync(full, 'utf8');
        let changed = false;

        const out = src.replace(FENCE_RE, (match, lang, body) => {
          const l = (lang || '').toLowerCase();
          if (!PYTHON_TAGS.includes(l)) return match;

          try {
            const formatted = blackFormat(body).trimEnd();
            if (formatted !== body.trimEnd()) changed = true;
            return '```' + lang + '\n' + formatted + '\n```';
          } catch {
            return match; // If formatting fails, keep original
          }
        });

        if (changed) {
          changedAny = true;
          if (!CHECK_MODE) writeFileSync(full, out, 'utf8');
        }
      }

      if (CHECK_MODE && changedAny) {
        console.error('Python fences need formatting.');
        process.exit(1);
      }
    })();
    ````

---

### Step 3: Update `package.json` to Run the New Script

Now, add your new Python formatting script to the `fmt` and `fmt:check` commands in your
`package.json` file.

```json{6-7,10-11}
{
  "scripts": {
    "prepare": "simple-git-hooks",
    "fmt": "prettier --write \"**/*.md\" && node scripts/md-format-sql-fences.js && node scripts/md-format-python-fences.js && node scripts/md-dedupe-fences.js && prettier --write . && markdownlint -q \"**/*.md\" || true",
    "fmt:check": "prettier --check \"**/*.md\" && node scripts/md-format-sql-fences.js --check && node scripts/md-format-python-fences.js --check && node scripts/md-dedupe-fences.js --check && markdownlint \"**/*.md\"",
    "lint": "eslint . --fix"
  },
  "simple-git-hooks": {
    "pre-commit": "npm run fmt && npm run lint"
  }
}
```

---

### Step 4: Update the Deduplication Script

Finally, teach the main deduplication script, `md-dedupe-fences.js`, how to handle and
"canonicalize" Python code.

1.  **Modify `scripts/md-dedupe-fences.js`:**

    ```js{10, 13, 27-31}
    #!/usr/bin/env node
    // ... (rest of the file header)

    import { readFileSync, writeFileSync } from 'fs';
    import { resolve } from 'path';
    import { glob } from 'glob';
    import { format as sqlFormat } from 'sql-formatter';
    import { format as prettierFormat } from 'prettier';
    import { format as blackFormat } from 'black-node'; // 1. Import Python formatter

    const SQL_TAGS = ['sql', 'postgres', 'postgresql', 'psql'];
    const JS_TAGS = ['js', 'javascript'];
    const PY_TAGS = ['python', 'py']; // 2. Add Python tags

    // ... (FENCE_RE and argument checks remain the same) ...

    function canon(lang, body) {
      const l = (lang || '').toLowerCase();
      const trimmed = (body || '').trim();

      try {
        if (JS_TAGS.includes(l)) {
          return prettierFormat(trimmed, { parser: 'babel' }).trim();
        }
        if (SQL_TAGS.includes(l)) {
          return sqlFormat(trimmed, { language: 'postgresql' }).trim();
        }
        if (PY_TAGS.includes(l)) {
          // 3. Add canonicalization logic for Python
          return blackFormat(trimmed).trim();
        }
      } catch {
        // If formatter fails, fall back to raw trimmed text
      }
      return trimmed;
    }

    // ... (The rest of the async function remains exactly the same) ...
    ```

You have now fully integrated Python support into your automated formatting and
deduplication pipeline. You can follow this same pattern to add support for any other
language that has an accessible command-line formatter.
