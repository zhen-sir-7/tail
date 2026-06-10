import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PATTERNS = {
  'loading|spinner|skeleton|placeholder|isLoading|isFetching': {
    checkId: 'missing-loading-states', category: 'ui-ux', severity: 'high', impact: 85,
    title: '组件缺少加载状态',
    detectHint: '检测 async 操作但无 loading 变量的组件',
  },
  'empty|no data|no results|blank screen|nothing shows': {
    checkId: 'missing-empty-states', category: 'ui-ux', severity: 'medium', impact: 80,
    title: '列表缺少空状态',
    detectHint: '检测 .map() / v-for 渲染但无空数据条件判断',
  },
  'error|crash|white screen|panic|segfault|ICE': {
    checkId: 'silent-failure', category: 'code-quality', severity: 'high', impact: 95,
    title: '静默错误',
    detectHint: '检测空 catch 块、无 .catch() 的 Promise 链',
  },
  'timeout|hang|freeze|stuck|infinite|never resolve|挂起|卡死': {
    checkId: 'infinite-loading', category: 'workflow', severity: 'high', impact: 90,
    title: '无限加载/无超时',
    detectHint: '检测 async 操作无 AbortController 或超时机制',
  },
  'json|parse|stringify|schema|corrupt|drift|类型转换|数据损坏': {
    checkId: 'data-corruption', category: 'code-quality', severity: 'high', impact: 85,
    title: '数据完整性风险',
    detectHint: '检测 JSON.parse/stringify 无 try-catch',
  },
  'validate|validation|input|sanitize|zod|yup|schema': {
    checkId: 'missing-input-validation', category: 'workflow', severity: 'high', impact: 90,
    title: '缺少输入验证',
    detectHint: '检测外部输入但无 schema 验证',
  },
  'api[_-]?key|secret|token|password|sk-[^ ]|credential|凭证|密钥': {
    checkId: 'credential-exposure', category: 'code-quality', severity: 'critical', impact: 100,
    title: '凭证泄露风险',
    detectHint: '检测源码中的硬编码密钥',
  },
  'save|persist|store|localStorage|writeFile|保存|持久化': {
    checkId: 'state-persistence', category: 'code-quality', severity: 'medium', impact: 75,
    title: '状态持久化风险',
    detectHint: '检测持久化操作无数据校验',
  },
  'platform|os|mac|windows|linux|darwin|win32|兼容|平台': {
    checkId: 'platform-assumptions', category: 'code-quality', severity: 'medium', impact: 70,
    title: '平台兼容性',
    detectHint: '检测硬编码路径或平台特定代码',
  },
  'responsive|mobile|phone|screen|overflow|layout|响应式|适配': {
    checkId: 'responsive-issues', category: 'ui-ux', severity: 'high', impact: 85,
    title: '响应式布局问题',
    detectHint: '检测固定宽高值、缺少媒体查询',
  },
  'auth|login|permission|unauthorized|forbidden|403|401|认证|权限': {
    checkId: 'auth-issues', category: 'workflow', severity: 'critical', impact: 100,
    title: '认证/权限问题',
    detectHint: '检测 API 调用无鉴权检查',
  },
  'confirm|accident|undo|不小心|误删|recover|二次确认': {
    checkId: 'destructive-confirm', category: 'workflow', severity: 'high', impact: 75,
    title: '危险操作缺少确认',
    detectHint: '检测 delete/remove 操作无确认弹窗',
  },
  'refresh|reload|stale|out of sync|not updating|同步|刷新': {
    checkId: 'stale-data', category: 'workflow', severity: 'high', impact: 90,
    title: '数据同步问题',
    detectHint: '检测数据变更后无刷新机制',
  },
  'not implemented|todo|placeholder|stub|fake|mock|未实现|待实现': {
    checkId: 'missing-implementation', category: 'workflow', severity: 'high', impact: 90,
    title: '未实现的功能',
    detectHint: '检测 TODO/placeholder 残留',
  },
};

function analyzeIssue(title, body) {
  const text = `${title} ${body || ''}`.toLowerCase();
  const findings = [];
  for (const [pattern, check] of Object.entries(PATTERNS)) {
    if (new RegExp(pattern, 'i').test(text)) {
      findings.push(check);
    }
  }
  return findings;
}

async function fetchJSON(url) {
  const resp = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

function parseRepo(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/) || url.match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

export async function crawl(urls, dataDir) {
  const results = [];
  let totalIssues = 0;
  const globalCounts = {};

  for (const raw of urls) {
    const parsed = parseRepo(raw);
    if (!parsed) { console.log(`  ✗ 无法解析: ${raw}`); continue; }
    const { owner, repo } = parsed;

    console.log(`\n  📦 ${owner}/${repo}: 正在爬取...`);
    let repoInfo;
    try {
      repoInfo = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`);
      console.log(`     🌟 ${repoInfo.stargazers_count} stars · ${repoInfo.language || '未知'} · ${repoInfo.open_issues_count} open issues`);
    } catch (e) {
      console.log(`     ✗ 获取仓库信息失败: ${e.message}`);
      continue;
    }

    // Crawl all issues
    const allIssues = [];
    let page = 1;
    while (true) {
      try {
        const items = await fetchJSON(
          `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=50&page=${page}&sort=created`
        );
        if (items.length === 0) break;
        allIssues.push(...items.filter(i => !i.pull_request));
        if (items.length < 50) break;
        page++;
      } catch (e) {
        console.log(`     ✗ 翻页失败: ${e.message}`);
        break;
      }
    }

    console.log(`     📋 ${allIssues.length} 个 issue`);

    // Analyze
    const repoPatterns = {};
    for (const issue of allIssues) {
      const findings = analyzeIssue(issue.title, issue.body);
      for (const f of findings) {
        repoPatterns[f.checkId] = (repoPatterns[f.checkId] || 0) + 1;
        globalCounts[f.checkId] = (globalCounts[f.checkId] || 0) + 1;
      }
    }

    results.push({
      repo: `${owner}/${repo}`,
      language: repoInfo.language,
      stars: repoInfo.stargazers_count,
      totalIssues: allIssues.length,
      patterns: repoPatterns,
    });

    // Print patterns for this repo
    const sorted = Object.entries(repoPatterns).sort((a, b) => b[1] - a[1]);
    for (const [id, count] of sorted) {
      const info = Object.values(PATTERNS).find(p => p.checkId === id);
      console.log(`       ${info?.title || id}: ${count}/${allIssues.length} (${Math.round(count/allIssues.length*100)}%)`);
    }
    totalIssues += allIssues.length;
  }

  // ─── Aggregate results ───
  const sortedGlobal = Object.entries(globalCounts)
    .map(([checkId, count]) => {
      const info = Object.values(PATTERNS).find(p => p.checkId === checkId);
      return {
        checkId,
        title: info?.title || checkId,
        category: info?.category || 'unknown',
        severity: info?.severity || 'medium',
        impact: info?.impact || 50,
        occurrence: count,
        frequency: Math.round(count / totalIssues * 100),
        detectHint: info?.detectHint || '',
        evidence: results
          .filter(r => r.patterns[checkId])
          .map(r => ({ repo: r.repo, count: r.patterns[checkId] })),
      };
    })
    .sort((a, b) => b.occurrence - a.occurrence);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  爬取完成: ${results.length} 仓库 · ${totalIssues} issues`);
  console.log(`  识别 ${sortedGlobal.length} 个模式\n`);

  for (const p of sortedGlobal) {
    console.log(`  #${p.checkId}  ${p.title}`);
    console.log(`     影响度: ${p.impact} · 出现 ${p.occurrence} 次 (${p.frequency}%)`);
    console.log(`     ${p.detectHint}`);
    console.log();
  }

  // Save
  const payload = {
    crawledAt: new Date().toISOString(),
    repos: results.map(r => ({ repo: r.repo, language: r.language, stars: r.stars, totalIssues: r.totalIssues })),
    patterns: sortedGlobal,
    rawPatterns: PATTERNS,
  };
  const savePath = join(dataDir, 'learned-patterns.json');
  writeFileSync(savePath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`  💾 已保存: ${savePath}`);
}
