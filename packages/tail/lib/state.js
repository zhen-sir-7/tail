import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const STATE_DIR = '.polishing-loop';
const STATE_FILE = 'state.json';
const CONFIG_FILE = '.polishrc.json';

export class State {
  constructor(targetDir) {
    this.targetDir = targetDir;
    this.stateDir = join(targetDir, STATE_DIR);
    this.statePath = join(this.stateDir, STATE_FILE);
    this.configPath = join(targetDir, CONFIG_FILE);
    this._data = this._load();
  }

  _load() {
    if (existsSync(this.statePath)) {
      try {
        return JSON.parse(readFileSync(this.statePath, 'utf-8'));
      } catch {
        // corrupted state, reset
      }
    }
    return this._default();
  }

  _default() {
    return {
      score: 0,
      totalIssues: 0,
      fixedIssues: 0,
      currentLoop: 0,
      issues: [],
      history: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  _save() {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
    this._data.updatedAt = new Date().toISOString();
    writeFileSync(this.statePath, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  get data() { return this._data; }

  setIssues(issues) {
    this._data.issues = issues;
    this._data.totalIssues = issues.length;
    this._data.fixedIssues = issues.filter(i => i.fixed).length;
    this._data.score = this._calcScore(issues);
    this._save();
  }

  markFixed(issueId) {
    const issue = this._data.issues.find(i => i.id === issueId);
    if (issue) {
      issue.fixed = true;
      issue.fixedAt = new Date().toISOString();
      this._data.fixedIssues = this._data.issues.filter(i => i.fixed).length;
      this._data.score = this._calcScore(this._data.issues);
      this._save();
      return true;
    }
    return false;
  }

  nextLoop() {
    this._data.currentLoop++;
    this._data.history.push({
      loop: this._data.currentLoop,
      score: this._data.score,
      totalIssues: this._data.totalIssues,
      fixedIssues: this._data.fixedIssues,
      timestamp: new Date().toISOString(),
    });
    this._save();
  }

  _calcScore(issues) {
    if (issues.length === 0) return 100;
    const fixed = issues.filter(i => i.fixed).length;
    return Math.round((fixed / issues.length) * 100);
  }

  reset() {
    this._data = this._default();
    this._save();
  }

  loadConfig() {
    const defaults = {
      projectType: 'frontend',
      suppress: [],
      include: ['**/*.{html,css,js,jsx,ts,tsx,vue,svelte}'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.min.*'],
      checks: {
        'ui-ux': true,
        'code-quality': true,
        'workflow': true,
      },
      threshold: 80,
      maxLoops: 10,
    };
    if (existsSync(this.configPath)) {
      try {
        const userConfig = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        return { ...defaults, ...userConfig };
      } catch {
        return defaults;
      }
    }
    return defaults;
  }
}
