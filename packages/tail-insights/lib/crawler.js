import { writeFileSync } from 'fs';
import { join } from 'path';

// ─── Pattern definitions with detection keywords ───
const PATTERN_DB = [
  { checkId: 'silent-failure',      title: '静默错误/空 catch',        category: 'code-quality', severity: 'high', impact: 95,
    keywords: ['error','crash','white screen','panic','segfault','ice','uncaught','exception','broken','does not work','不工作','崩溃','报错'],
    detectHint: '空 catch 块、无 .catch() 的 Promise、未捕获的异常' },
  { checkId: 'infinite-loading',     title: '无限加载/无超时',          category: 'workflow', severity: 'high', impact: 90,
    keywords: ['loading','spinner','stuck','hang','freeze','timeout','never resolve','infinite','卡住','转圈','超时'],
    detectHint: '异步操作缺少 AbortController 或超时机制' },
  { checkId: 'missing-input-validation', title: '缺少输入验证',         category: 'workflow', severity: 'high', impact: 90,
    keywords: ['input','validate','sanitize','schema','crash when','malformed','invalid input','注入','非法输入'],
    detectHint: '用户输入/API 参数缺少 schema 验证' },
  { checkId: 'data-corruption',     title: '数据完整性风险',            category: 'code-quality', severity: 'high', impact: 85,
    keywords: ['json parse','stringify','schema corrupt','data loss','数据丢失','格式错误','解析失败'],
    detectHint: 'JSON.parse/stringify 无 try-catch，类型未校验' },
  { checkId: 'credential-exposure', title: '凭证泄露风险',              category: 'code-quality', severity: 'critical', impact: 100,
    keywords: ['api key','secret','token','password','credential','密钥','凭证','泄露'],
    detectHint: '源码中存在硬编码的 API Key/Token/密码' },
  { checkId: 'state-persistence',   title: '状态持久化问题',            category: 'code-quality', severity: 'medium', impact: 75,
    keywords: ['save','persist','store','localstorage','writesync','配置保存','设置不生效'],
    detectHint: '读写持久化状态时未验证数据完整性' },
  { checkId: 'auth-issues',         title: '认证/权限问题',             category: 'workflow', severity: 'critical', impact: 100,
    keywords: ['auth','login','permission','unauthorized','forbidden','403','401','认证','登录','权限'],
    detectHint: 'API 调用缺少鉴权，或认证流程有缺陷' },
  { checkId: 'destructive-confirm', title: '危险操作缺少确认',          category: 'workflow', severity: 'high', impact: 75,
    keywords: ['accident','undo','不小心','误删','recover','二次确认','确认删除'],
    detectHint: 'delete/remove 操作无确认弹窗' },
  { checkId: 'stale-data',          title: '数据同步/刷新问题',          category: 'workflow', severity: 'high', impact: 90,
    keywords: ['refresh','reload','stale','out of sync','not updating','同步','刷新','缓存'],
    detectHint: '数据变更后无刷新机制，用户看到过期数据' },
  { checkId: 'missing-loading-states', title: '缺少加载状态',           category: 'ui-ux', severity: 'high', impact: 85,
    keywords: ['loading','spinner','skeleton','placeholder','isloading','没有加载','看不到状态'],
    detectHint: '异步操作期间无加载反馈' },
  { checkId: 'missing-empty-states',   title: '缺少空状态',             category: 'ui-ux', severity: 'medium', impact: 80,
    keywords: ['empty','no data','no results','blank screen','nothing shows','空白','没有数据'],
    detectHint: '列表/搜索结果为空时无提示' },
  { checkId: 'platform-compat',     title: '平台兼容性问题',            category: 'code-quality', severity: 'medium', impact: 70,
    keywords: ['windows','mac','linux','platform','os compatibility','兼容','跨平台','darwin','win32'],
    detectHint: '硬编码路径或平台特定 API，缺少兼容层' },
  { checkId: 'missing-implementation', title: '未实现的功能',           category: 'workflow', severity: 'high', impact: 90,
    keywords: ['not implemented','todo','placeholder','stub','fake','mock','待实现','未完成','todo'],
    detectHint: '存在 TODO/placeholder/stub 残留' },
];

function analyzeIssue(issue) {
  const text = `${issue.title} ${issue.body || ''}`.toLowerCase();
  const findings = [];

  for (const pattern of PATTERN_DB) {
    let score = 0;
    for (const kw of pattern.keywords) {
      if (text.includes(kw.toLowerCase())) score++;
    }
    if (score > 0) {
      // Weight by engagement
      const reactions = issue.reactions ? 
        (issue.reactions.total_count || 0) : 0;
      const comments = issue.comments || 0;
      const engagement = 1 + Math.log2(reactions + comments + 1);

      findings.push({
        checkId: pattern.checkId,
        title: pattern.title,
        category: pattern.category,
        severity: pattern.severity,
        impact: pattern.impact,
        confidence: score / pattern.keywords.length,
        engagement,
        keywordHits: score,
      });
    }
  }
  return findings;
}

async function fetchJSON(url) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  const token = process.env.GH_TOKEN;
  if (token) headers['Authorization'] = `token ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

function parseRepo(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/) || url.match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function aggregateResults(repoResults) {
  // Merge patterns across repos, weighted by engagement and repo count
  const merged = {};
  const repoCounts = {};
  const totalEngagement = {};

  for (const r of repoResults) {
    for (const f of r.findings) {
      if (!merged[f.checkId]) {
        merged[f.checkId] = { ...f, occurrences: 0, totalEngagementScore: 0, repoEvidence: [] };
      }
      merged[f.checkId].occurrences += f.keywordHits;
      merged[f.checkId].totalEngagementScore += f.engagement;
      repoCounts[f.checkId] = (repoCounts[f.checkId] || 0) + 1;
      if (!merged[f.checkId].repoEvidence.find(e => e.repo === r.repo)) {
        merged[f.checkId].repoEvidence.push({ repo: r.repo, count: f.keywordHits, issueCount: r.issueCount });
      }
    }
  }

  return Object.values(merged).map(p => ({
    checkId: p.checkId,
    title: p.title,
    category: p.category,
    severity: p.severity,
    impact: p.impact,
    occurrences: p.occurrences,
    frequency: Math.round(p.occurrences / repoResults.reduce((a, r) => a + r.issueCount, 0) * 100),
    breadth: repoCounts[p.checkId],
    confidence: Math.min(100, Math.round(
      (repoCounts[p.checkId] / repoResults.length) * 50  // more repos = more confident
      + Math.log2(p.totalEngagementScore + 1) * 5        // more engagement = more important
    )),
    detectHint: p.detectHint,
    evidence: p.repoEvidence,
  })).sort((a, b) => b.occurrences - a.occurrences);
}

export async function crawl(urls, dataDir) {
  const repoResults = [];
  let totalIssues = 0;
  let skippedRepos = 0;

  for (const raw of urls) {
    const parsed = parseRepo(raw);
    if (!parsed) { console.log(`  ✗ 无法解析: ${raw}`); skippedRepos++; continue; }
    const { owner, repo } = parsed;

    console.log(`\n  📦 ${owner}/${repo}:`);
    let repoInfo;
    try {
      repoInfo = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`);
      console.log(`     🌟 ${repoInfo.stargazers_count} stars · ${repoInfo.language || '未知'} · ${repoInfo.open_issues_count} open issues`);
    } catch (e) {
      console.log(`     ✗ ${e.message}`); skippedRepos++; continue;
    }

    // Crawl issues with pagination
    const issues = [];
    let page = 1;
    while (true) {
      try {
        const items = await fetchJSON(
          `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=50&page=${page}&sort=created`
        );
        if (items.length === 0) break;
        issues.push(...items.filter(i => !i.pull_request));
        if (items.length < 50) break;
        page++;
      } catch (e) {
        console.log(`     ⚠ 翻页中断于第 ${page} 页: ${e.message}`);
        break;
      }
    }

    console.log(`     📋 ${issues.length} issues`);

    // Analyze
    const findings = [];
    const patternHits = {};
    for (const issue of issues) {
      const hits = analyzeIssue(issue);
      for (const h of hits) {
        findings.push(h);
        patternHits[h.checkId] = (patternHits[h.checkId] || 0) + 1;
      }
    }

    // Print per-repo summary
    const sorted = Object.entries(patternHits).sort((a, b) => b[1] - a[1]);
    for (const [id, count] of sorted) {
      const info = PATTERN_DB.find(p => p.checkId === id);
      const pct = Math.round(count / issues.length * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(Math.max(0, 20 - Math.round(pct / 5)));
      console.log(`     ${bar} ${info?.title || id}: ${count}/${issues.length} (${pct}%)`);
    }

    repoResults.push({ repo: `${owner}/${repo}`, issueCount: issues.length, findings });
    totalIssues += issues.length;
  }

  // ─── Aggregate across repos ───
  const aggregated = aggregateResults(repoResults);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  爬取完成: ${repoResults.length} 仓库 · ${totalIssues} issues · 跳过 ${skippedRepos}`);
  console.log(`  识别 ${aggregated.length} 个高频模式\n`);

  for (const p of aggregated) {
    const bar = '█'.repeat(Math.round(p.confidence / 5)) + '░'.repeat(Math.max(0, 20 - Math.round(p.confidence / 5)));
    const evidence = p.evidence.map(e => `${e.repo}(${e.count})`).join(' ');
    console.log(`  ${bar} ${p.title}`);
    console.log(`     [${p.severity}] 影响 ${p.impact} · 出现 ${p.occurrences} 次 · ${p.breadth}/${repoResults.length} 仓库 · 置信度 ${p.confidence}%`);
    console.log(`     ${p.detectHint}`);
    console.log(`     来源: ${evidence}`);
    console.log();
  }

  // Save
  const payload = {
    crawledAt: new Date().toISOString(),
    repoCount: repoResults.length,
    totalIssues,
    repos: repoResults.map(r => ({
      repo: r.repo, language: repoResults.find(x => x.repo === r.repo)?.language || '?',
      issueCount: r.issueCount,
    })),
    patterns: aggregated,
    rawPatterns: PATTERN_DB,
  };
  const savePath = join(dataDir, 'learned-patterns.json');
  writeFileSync(savePath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`  💾 已保存: ${savePath}`);
}
