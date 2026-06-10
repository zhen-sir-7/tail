import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readdir } from 'fs/promises';

export class Profile {
  constructor(targetDir) {
    this.targetDir = targetDir;
    this._data = null;
  }

  async _hasExt(ext) {
    try {
      const entries = await readdir(join(this.targetDir, 'src'), { withFileTypes: true }).catch(() => []);
      const files = await this._walkDir(join(this.targetDir, 'src'), 2);
      return files.some(f => f.endsWith(ext));
    } catch { return false; }
  }

  async _walkDir(dir, depth) {
    if (depth <= 0) return [];
    const results = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) {
          results.push(...await this._walkDir(full, depth - 1));
        } else if (e.isFile()) {
          results.push(full);
        }
      }
    } catch {}
    return results;
  }

  async build() {
    const pkg = this._readJson('package.json');
    const hasTs = this._exists('tsconfig.json');
    const srcFiles = await this._walkDir(join(this.targetDir, 'src'), 3);
    const hasJsx = srcFiles.some(f => f.endsWith('.jsx') || f.endsWith('.tsx'));
    const hasVue = srcFiles.some(f => f.endsWith('.vue'));
    const hasSvelte = srcFiles.some(f => f.endsWith('.svelte'));
    const hasHtml = srcFiles.some(f => f.endsWith('.html') || this._exists('index.html') || this._exists('public/index.html'));
    const entryFiles = await this._findEntryFiles(pkg);

    this._data = {
      type: this._detectType(pkg, hasHtml, hasJsx, hasVue, hasSvelte),
      framework: this._detectFramework(pkg, hasJsx, hasVue, hasSvelte),
      lang: hasTs ? 'typescript' : 'javascript',
      styling: this._detectStyling(pkg),
      stateManagement: this._detectStateManagement(pkg),
      hasRouter: this._hasDep(pkg, 'react-router') || this._hasDep(pkg, 'vue-router') || this._hasDep(pkg, '@angular/router'),
      hasAsync: this._hasDep(pkg, 'react-query') || this._hasDep(pkg, '@tanstack/react-query') || this._hasDep(pkg, 'swr') || this._hasDep(pkg, 'axios'),
      hasFormLib: this._hasDep(pkg, 'formik') || this._hasDep(pkg, 'react-hook-form') || this._hasDep(pkg, 'vee-validate'),
      hasToast: this._hasDep(pkg, 'react-hot-toast') || this._hasDep(pkg, 'sonner') || this._hasDep(pkg, 'vue-toastification') || this._hasDep(pkg, 'notistack'),
      entryFiles,
      pkg,
      patterns: await this._extractPatterns(),
    };

    return this._data;
  }

  get data() { return this._data; }

  _readJson(file) {
    try {
      const path = join(this.targetDir, file);
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { return null; }
  }

  _exists(file) {
    return existsSync(join(this.targetDir, file));
  }

  async _globHas(pattern) {
    const { globSync } = await import('glob');
    try {
      const matches = globSync(pattern, { cwd: this.targetDir, ignore: ['**/node_modules/**'] });
      return matches.length > 0;
    } catch {
      return false;
    }
  }

  _hasDep(pkg, name) {
    if (!pkg) return false;
    return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  }

  _detectType(pkg, hasHtml, hasJsx, hasVue, hasSvelte) {
    if (hasVue) return 'frontend-vue';
    if (hasSvelte) return 'frontend-svelte';
    if (hasJsx || hasHtml) return 'frontend-react';
    // Check if it's a CLI tool
    if (pkg?.bin) return 'cli';
    if (pkg?.scripts?.start?.includes('next') || pkg?.scripts?.dev?.includes('next')) return 'frontend-react';
    if (pkg?.scripts?.build?.includes('vue')) return 'frontend-vue';
    return 'library';
  }

  _detectFramework(pkg, hasJsx, hasVue, hasSvelte) {
    if (hasVue) return 'vue';
    if (hasSvelte) return 'svelte';
    if (pkg?.dependencies?.react || pkg?.dependencies?.['react-dom']) return 'react';
    if (pkg?.dependencies?.next) return 'next';
    if (pkg?.dependencies?.gatsby) return 'gatsby';
    if (pkg?.dependencies?.['@angular/core']) return 'angular';
    if (hasJsx) return 'react';
    return null;
  }

  _detectStyling(pkg) {
    if (this._hasDep(pkg, 'tailwindcss')) return 'tailwind';
    if (this._hasDep(pkg, 'styled-components')) return 'styled-components';
    if (this._hasDep(pkg, '@emotion/react')) return 'emotion';
    if (this._hasDep(pkg, 'sass') || this._hasDep(pkg, 'node-sass')) return 'scss';
    if (this._hasDep(pkg, 'less')) return 'less';
    return 'css';
  }

  _detectStateManagement(pkg) {
    if (this._hasDep(pkg, 'zustand')) return 'zustand';
    if (this._hasDep(pkg, 'redux') || this._hasDep(pkg, '@reduxjs/toolkit')) return 'redux';
    if (this._hasDep(pkg, 'pinia')) return 'pinia';
    if (this._hasDep(pkg, 'vuex')) return 'vuex';
    if (this._hasDep(pkg, 'mobx')) return 'mobx';
    if (this._hasDep(pkg, 'jotai')) return 'jotai';
    if (this._hasDep(pkg, 'valtio')) return 'valtio';
    return 'built-in';
  }

  async _findEntryFiles(pkg) {
    const entries = [];

    // Try main field from package.json
    if (pkg?.main) {
      entries.push(join(this.targetDir, pkg.main));
    }

    // Common entry points
    const common = ['src/main.js', 'src/main.ts', 'src/index.js', 'src/index.ts',
                    'src/App.js', 'src/App.tsx', 'src/app.js', 'src/app.ts',
                    'index.js', 'index.ts', 'app.js', 'app.tsx',
                    'pages/index.js', 'pages/index.tsx',
                    'src/pages/index.tsx', 'src/pages/index.js'];

    for (const entry of common) {
      const full = join(this.targetDir, entry);
      if (existsSync(full)) entries.push(full);
    }

    return entries;
  }

  async _extractPatterns() {
    const patterns = {
      hasLoadingStates: false,
      hasErrorBoundaries: false,
      hasEmptyStates: false,
      hasToasts: false,
      hasConfirmDialogs: false,
      usesCssVariables: false,
      componentStyle: null, // 'function' | 'class' | 'arrow'
      hasTypeScript: false,
    };

    // Scan a sample of source files to detect actual patterns used
    try {
      const allFiles = await this._walkDir(join(this.targetDir, 'src'), 3);
      const files = allFiles
        .filter(f => /\.(js|jsx|ts|tsx|vue|svelte)$/.test(f))
        .slice(0, 5);

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          if (/loading|isLoading|isFetching|pending|skeleton/i.test(content)) patterns.hasLoadingStates = true;
          if (/ErrorBoundary|errorElement|errorCaptured|onError/i.test(content)) patterns.hasErrorBoundaries = true;
          if (/empty|noData|noResults|isEmpty/i.test(content) || /\.length\s*(===|<=)\s*0/.test(content)) patterns.hasEmptyStates = true;
          if (/toast|notification|snackbar|message\.(success|error|info)/i.test(content)) patterns.hasToasts = true;
          if (/confirm|confirmDialog|Modal\.confirm|window\.confirm/i.test(content)) patterns.hasConfirmDialogs = true;
          if (/var\(--/.test(content)) patterns.usesCssVariables = true;

          if (!patterns.componentStyle) {
            if (/export\s+default\s+function/.test(content) || /export\s+function\s+\w+\(/.test(content)) {
              patterns.componentStyle = 'function';
            } else if (/export\s+default\s+class/.test(content) || /class\s+\w+\s+extends/.test(content)) {
              patterns.componentStyle = 'class';
            } else if (/const\s+\w+\s*=\s*\(/.test(content)) {
              patterns.componentStyle = 'arrow';
            }
          }
        } catch {}
      }
    } catch {}

    return patterns;
  }

  async guessProjectType() {
    const p = await this.build();
    if (p.type === 'cli') return 'cli';
    if (p.type.startsWith('frontend')) return 'frontend';
    if (p.framework === 'next' || p.framework === 'gatsby') return 'frontend';
    if (p.type === 'library') return 'backend';
    return 'frontend';
  }
}
