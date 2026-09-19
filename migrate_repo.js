/**
 * LeetCode -> GitHub Sync Migration Script
 * 
 * Usage:
 * 1. Clone your solutions repository (e.g., `git clone https://github.com/omhari66/leetcode-solutions`)
 * 2. Copy this script (`migrate_repo.js`) into the root of that cloned repository.
 * 3. Run it using Node.js: `node migrate_repo.js`
 * 4. Commit and push the changes: `git add . && git commit -m "chore: migrate flat folders to Uncategorized pattern folder" && git push`
 */

const fs = require('fs');
const path = require('path');

const repoPath = process.cwd();

console.log("Scanning repository for flat problem folders...");

// Find all folders that look like LeetCode problem slugs (e.g. 0042-trapping-rain-water)
// and are located in the root of the repo.
const folders = fs.readdirSync(repoPath).filter(f => {
  return fs.statSync(path.join(repoPath, f)).isDirectory() && /^\d{4}-/.test(f);
});

if (folders.length === 0) {
  console.log("No flat problem folders found! Your repo is already clean.");
  process.exit(0);
}

// Create the fallback pattern folder
const patternFolder = "Uncategorized";
const patternPath = path.join(repoPath, patternFolder);
if (!fs.existsSync(patternPath)) {
  fs.mkdirSync(patternPath);
}

// Move each folder
let count = 0;
folders.forEach(f => {
  const oldPath = path.join(repoPath, f);
  const newPath = path.join(patternPath, f);
  fs.renameSync(oldPath, newPath);
  console.log(`Moved: ${f} -> ${patternFolder}/${f}`);
  count++;
});

// Update the master README.md table links
const readmePath = path.join(repoPath, 'README.md');
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  
  folders.forEach(f => {
    // 1. Update the link path: ](./0042-...) -> ](./Uncategorized/0042-...)
    readme = readme.replace(new RegExp(`\\]\\(\\.\\/${f}\\)`, 'g'), `](./${patternFolder}/${f})`);
    
    // 2. Update the folder name display: `0042-...` -> `Uncategorized/0042-...`
    readme = readme.replace(new RegExp(`\\\`\\b${f}\\b\\\``, 'g'), `\`${patternFolder}/${f}\``);
  });

  fs.writeFileSync(readmePath, readme);
  console.log("Updated links in the master README.md.");
}

console.log(`\nSuccess! Migrated ${count} folders.`);
console.log("You can now review the changes and run:");
console.log("git add .");
console.log("git commit -m \"chore: migrate to pattern-based folders\"");
console.log("git push");
