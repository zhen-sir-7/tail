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
    enrich            爬取 issue 评论/PR，提取解决方案字典
    generate <path>   生成 data-checks.js (默认输出到 ../tail/lib/)
    list              列出已学习的模式
    stats             查看数据统计
    --help            显示帮助

  示例:
    insights crawl owner/repo1 owner/repo2   # 爬取并分析模式
    insights enrich                           # 提取解决方案
    insights generate                         # 生成检查规则
    insights list                             # 查看已学习模式
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
    case 'generate': {
      const target = args[1] || join(ROOT, '..', 'tail', 'lib', 'data-checks.js');
      const { generate } = await import('../lib/generator.js');
      generate(LEARNED_FILE, target);
      break;
    }
    case 'export': {
      const target = args[1];
      if (!target) { console.log('请指定目标路径: insights export <path/to/engine.js>'); return; }
      const { exportChecks } = await import('../lib/exporter.js');
      exportChecks(LEARNED_FILE, target);
      break;
    }
    case 'enrich': {
      const { enrich } = await import('../lib/enricher.js');
      await enrich(LEARNED_FILE, DATA_DIR);
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
