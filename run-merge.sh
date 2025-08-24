#!/bin/bash

git switch main

echo ""
echo "--- Step 1: Creating the base file with v1 content ---"

cp files/v1.md files/files-merged.md
git add files/files-merged.md
git commit -m "feat: Add initial version of the merged file"

echo ""
echo "--- Step 2: Creating a new branch and updating with v2 content ---"

git switch -c add-v2-content
cp files/v2.md files/files-merged.md
git add files/files-merged.md
git commit -m "feat: Update merged file with v2 content"


echo ""
echo "--- Step 3: Switching back to main and merging the branches ---"

git switch main
git merge add-v2-content


echo ""
echo "--- Step 4: Formatting and deduplicating the merged file ---"

npm run fmt