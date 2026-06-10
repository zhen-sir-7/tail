#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const LEARNED_FILE = join(DATA_DIR, 'learned-patterns.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       tail-insights                      ║
  ║   从 AI 项目 issue 学习模式 → 改进 tail  ║
  ╚══════════════════════════════════════════╝

  命令:
    crawl <repo...>   爬取 GitHub 项目的 issue 并分析
    list              列出已学习的模式
    export <path>     导出检查规则到 tail 项目
    stats             查看数据统计
    --help            显示帮助

  示例:
    insights crawl owner/repo1 owner/repo2
    insights export ../tail/lib/engine.js
    insights list
  `);
}

async function main() {
  if (!cmd || cmd === '--help') { printHelp(); return; }

  switch (cmd) {
    case 'crawl': {
      const { crawl } = await import('../lib/crawler.js');
      await crawl(args.slice(1), DATA_DIR);
      break;
    }
    case 'list': {
      const { listPatterns } = await import('../lib/patterns.js');
      listPatterns(LEARNED_FILE);
      break;
    }
    case 'export': {
      const target = args[1];
      if (!target) { console.log('请指定目标路径: insights export <path/to/engine.js>'); return; }
      const { exportChecks } = await import('../lib/exporter.js');
      exportChecks(LEARNED_FILE, target);
      break;
    }
    case 'stats': {
      const { showStats } = await import('../lib/patterns.js');
      showStats(LEARNED_FILE);
      break;
    }
    default:
      printHelp();
  }
}

main().catch(e => console.error(e));
