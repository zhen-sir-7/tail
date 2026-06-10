import { readFileSync, existsSync, writeFileSync } from 'fs';

export function exportChecks(learnedPath, targetPath) {
  if (!existsSync(learnedPath)) {
    console.log('尚无数据。先运行: insights crawl owner/repo');
    return;
  }

  const data = JSON.parse(readFileSync(learnedPath, 'utf-8'));
  const patterns = data.patterns;

  if (!existsSync(targetPath)) {
    console.log(`目标文件不存在: ${targetPath}`);
    return;
  }

  // Generate check code snippets
  let output = `// ═══════════════════════════════════════════════
// 自动生成: tail-insights crawl
// 来源: ${data.repos.length} 个仓库 · ${data.repos.reduce((a,r) => a + r.totalIssues, 0)} 个 issue
// 生成时间: ${data.crawledAt}
// ═══════════════════════════════════════════════

`;

  for (const p of patterns) {
    output += `// ${p.checkId} — ${p.title}
// 出现 ${p.occurrence} 次 · 影响度 ${p.impact} · ${p.frequency}% 的 issue 涉及此模式
// 检测: ${p.detectHint}
// 证据: ${p.evidence.map(e => e.repo).join(', ')}
{
  id: '${p.checkId}',
  title: '${p.title}',
  category: '${p.category}',
  severity: '${p.severity}',
  impact: ${p.impact},
  detect: (ctx) => {
    // TODO: 实现检测逻辑
    return [];
  }
},

`;
  }

  // Write to a .suggestions.js file next to the target
  const outPath = targetPath.replace(/\.js$/, '.suggestions.js');
  writeFileSync(outPath, output, 'utf-8');
  console.log(`  ✓ 导出完成: ${outPath}`);
  console.log(`  ℹ 将上述 check 对象添加到 engine.js 的 _getChecksForProfile() 中`);
}
