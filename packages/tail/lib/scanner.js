import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { readdir } from 'fs/promises';

function globToRegex(pattern) {
  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end !== -1) {
        const choices = pattern.slice(i + 1, end).split(',');
        const joined = choices.map(c => globToRegex(c)).join('|');
        regex += `(?:${joined})`;
        i = end + 1;
        continue;
      }
    }

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
        continue;
      }
      regex += '[^/]*';
    } else if (ch === '.') {
      regex += '\\.';
    } else if (ch === '?') {
      regex += '.';
    } else {
      regex += ch;
    }
    i++;
  }

  return regex;
}

async function globRecursive(dir, pattern, exclude = []) {
  const results = [];
  const fileRegex = new RegExp(`^${globToRegex(pattern)}$`);
  const excludeRegexes = exclude.map(e => new RegExp(globToRegex(e)));

  async function walk(directory) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        const relPath = relative(dir, fullPath).replace(/\\/g, '/');

        if (excludeRegexes.some(er => er.test(relPath))) continue;

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && fileRegex.test(relPath)) {
          results.push(fullPath);
        }
      }
    } catch {
      // permission errors, skip
    }
  }

  await walk(dir);
  return results;
}

const FILE_PATTERNS = [
  ['**/*.{html,htm}', 'html'],
  ['**/*.{css,scss,less,sass}', 'css'],
  ['**/*.{js,jsx}', 'js'],
  ['**/*.{ts,tsx}', 'ts'],
  ['**/*.vue', 'vue'],
  ['**/*.svelte', 'svelte'],
];

export class Scanner {
  constructor(targetDir, config) {
    this.targetDir = targetDir;
    this.config = config;
  }

  async scan() {
    let allFiles = [];

    for (const [pattern, type] of FILE_PATTERNS) {
      const files = await globRecursive(this.targetDir, pattern, this.config.exclude);
      allFiles.push(...files.map(f => ({ path: f, type })));
    }

    const seen = new Set();
    allFiles = allFiles.filter(f => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });

    return allFiles;
  }

  readFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      return { content, lines };
    } catch {
      return null;
    }
  }
}
