#!/bin/bash

MERGED_FILE="files/files-merged.md"

# --- Step 1: Create the base file with v1 content ---
echo "--- Step 1: Creating base file with v1 content ---"
cp files/v1.md "${MERGED_FILE}"
git add "${MERGED_FILE}"
git commit -m "feat: Add initial version of merged file"

# --- Step 2: Create a new branch with v2 content ---
echo ""
echo "--- Step 2: Creating new branch with v2 content ---"
git switch -c add-v2-content
cp files/v2.md "${MERGED_FILE}"
git add "${MERGED_FILE}"
git commit -m "feat: Update merged file with v2 content"

# --- Step 3: Switch back and merge the branches ---
echo ""
echo "--- Step 3: Switching back and merging branches ---"
git switch main
git merge add-v2-content

# --- Step 4: Formatting and Deduplicating ONLY the Merged File ---
echo ""
echo "--- Step 4: Cleaning up ${MERGED_FILE} ---"
npx prettier --write "${MERGED_FILE}" # <-- Fixed
node scripts/md-format-sql-fences.js "${MERGED_FILE}"
node scripts/md-dedupe-fences.js "${MERGED_FILE}"
npx markdownlint -q "${MERGED_FILE}" # <-- Fixed

# --- Step 5: Finalize the Merge Commit ---
echo ""
echo "--- Step 5: Finalizing the merge ---"
git add "${MERGED_FILE}"
git commit --no-edit

echo ""
echo "✅ Merge and cleanup complete."