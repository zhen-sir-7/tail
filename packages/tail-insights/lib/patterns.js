import { readFileSync, existsSync } from 'fs';

export function listPatterns(filePath) {
  if (!existsSync(filePath)) {
    console.log('尚未爬取数据。运行: insights crawl owner/repo');
    return;
  }
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  console.log(`\n  模式库: ${data.patterns.length} 个模式 · 来自 ${data.repos.length} 个仓库 · ${data.repos.reduce((a,r) => a + r.totalIssues, 0)} 个 issue`);
  console.log(`  最后更新: ${data.crawledAt}\n`);

  for (const p of data.patterns) {
    const evidence = p.evidence.map(e => `${e.repo}(${e.count})`).join(', ');
    console.log(`  [${p.severity}] ${p.title} (${p.checkId})`);
    console.log(`     影响度: ${p.impact} | 出现 ${p.occurrence} 次 | ${p.frequency}%`);
    console.log(`     检测: ${p.detectHint}`);
    if (evidence) console.log(`     来源: ${evidence}`);
    console.log();
  }
}

export function showStats(filePath) {
  if (!existsSync(filePath)) {
    console.log('尚无数据。先运行: insights crawl owner/repo');
    return;
  }
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const totalRepos = data.repos.length;
  const totalIssues = data.repos.reduce((a, r) => a + r.totalIssues, 0);
  const totalPatterns = data.patterns.length;

  console.log(`\n  tail-insights 数据统计`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  仓库数:     ${totalRepos}`);
  console.log(`  Issue 数:   ${totalIssues}`);
  console.log(`  模式数:     ${totalPatterns}`);
  console.log(`  最后更新:   ${data.crawledAt}`);
  console.log();

  console.log(`  严重度分布:`);
  const bySeverity = {};
  for (const p of data.patterns) {
    bySeverity[p.severity] = (bySeverity[p.severity] || 0) + 1;
  }
  for (const [s, n] of Object.entries(bySeverity)) {
    console.log(`    ${s}: ${n}`);
  }
  console.log();

  const top5 = data.patterns.slice(0, 5);
  console.log(`  最高频 5 个模式:`);
  for (const p of top5) {
    console.log(`    ${p.checkId}: ${p.occurrence} 次 (${p.frequency}%)`);
  }
}
