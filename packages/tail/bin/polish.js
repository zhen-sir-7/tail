#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

import { Engine } from '../lib/engine.js';
import { State } from '../lib/state.js';

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       tail v${pkg.version.padEnd(6)}                    ║
  ║   轻量级项目打磨工具 · 持续优化，不断完善  ║
  ╚══════════════════════════════════════════╝

  用法: tail <command> [options]

  命令:
    init             初始化 tail 配置
    scan             扫描项目，发现可优化项
    list             列出当前所有待处理问题
    fix [id|--all]   自动修复指定问题或全部
    status           查看打磨进度与评分
    loop             进入交互式打磨循环

  选项:
    --target <path>  指定目标项目路径 (默认: 当前目录)
    --preset <type>  项目类型: frontend | backend | cli
    --auto           自动模式，loop 无需手动确认
    --silent         静默模式，只输出 JSON
    --help           显示帮助
    --version        显示版本

  示例:
    tail init                            初始化配置
    tail scan                            扫描当前项目
    tail fix --all                       自动修复所有可修复问题
    tail loop --auto                     全自动打磨循环
    tail scan --preset cli               以 CLI 模式扫描
  `);
}

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log(pkg.version);
    return;
  }

  const targetIdx = args.indexOf('--target');
  const target = targetIdx !== -1 ? args[targetIdx + 1] : process.cwd();
  const silent = args.includes('--silent');
  const auto = args.includes('--auto');
  const presetIdx = args.indexOf('--preset');
  const preset = presetIdx !== -1 ? args[presetIdx + 1] : null;

  const state = new State(target);
  const engine = new Engine(target, state, { silent, preset, auto });

  try {
    switch (cmd) {
      case 'init':
        await engine.init();
        break;
      case 'scan':
        await engine.scan();
        break;
      case 'list':
        await engine.list();
        break;
      case 'fix': {
        const fixTarget = args[1];
        if (fixTarget === '--all') {
          await engine.fixAll();
        } else if (fixTarget && !fixTarget.startsWith('--')) {
          await engine.fixOne(fixTarget);
        } else {
          console.log('请指定修复目标: polish fix <id> 或 polish fix --all');
        }
        break;
      }
      case 'status':
        await engine.status();
        break;
      case 'loop':
        await engine.loop();
        break;
      default:
        printHelp();
    }
  } catch (err) {
    console.error(`\n  ✗ 错误: ${err.message}`);
    process.exit(1);
  }
}

main();
