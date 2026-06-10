import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const GITHUB_API = 'https://api.github.com';

async function fetchJSON(url) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  const token = process.env.GH_TOKEN;
  if (token) headers['Authorization'] = `token ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

// ─── Solution patterns — what to look for in comments and PRs ───
const SOLUTION_KEYWORDS = {
  'silent-failure': [
    { pattern: /catch\s*\(/, label: '添加错误处理', code: 'catch (err) { console.error(err); }' },
    { pattern: /try\s*\{/, label: '异常捕获', code: 'try { ... } catch (err) { handleError(err); }' },
    { pattern: /error.*boundary/i, label: '错误边界', code: '<ErrorBoundary fallback={<Fallback />}>' },
    { pattern: /error.*handling/i, label: '错误处理' },
  ],
  'infinite-loading': [
    { pattern: /abort|AbortController|signal/i, label: '添加 AbortController', code: 'const controller = new AbortController(); setTimeout(() => controller.abort(), 10000);' },
    { pattern: /timeout/i, label: '设置超时', code: 'Promise.race([fetch(url), timeout(10000)])' },
    { pattern: /loading|spinner|skeleton/i, label: '添加加载指示器', code: '{isLoading ? <Spinner /> : <Content />}' },
    { pattern: /retry/i, label: '重试机制' },
  ],
  'missing-input-validation': [
    { pattern: /zod/i, label: '使用 Zod schema', code: 'const schema = z.object({ name: z.string().min(1) });' },
    { pattern: /yup/i, label: '使用 Yup schema' },
    { pattern: /validate/i, label: '添加验证函数', code: 'if (!input || input.trim() === "") throw new Error("Invalid input");' },
    { pattern: /sanitize/i, label: '输入清理', code: 'const clean = DOMPurify.sanitize(input);' },
    { pattern: /trim/i, label: '去除首尾空格', code: 'input.trim()' },
  ],
  'credential-exposure': [
    { pattern: /env/i, label: '使用环境变量', code: 'const API_KEY = process.env.API_KEY;' },
    { pattern: /vault/i, label: '密钥管理服务' },
    { pattern: /secret.*manager/i, label: '密钥管理服务' },
  ],
  'data-corruption': [
    { pattern: /try.*parse/i, label: 'try-catch JSON.parse', code: 'try { JSON.parse(data) } catch { return defaultValue; }' },
    { pattern: /schema.*valid/i, label: '校验 JSON schema' },
    { pattern: /default/i, label: '提供默认值', code: 'const config = { ...defaults, ...userConfig };' },
  ],
  'auth-issues': [
    { pattern: /token.*refresh/i, label: 'Token 刷新机制', code: 'axios.interceptors.response.use(..., refreshTokenOn401)' },
    { pattern: /middleware.*auth/i, label: '认证中间件' },
    { pattern: /session/i, label: '会话管理' },
  ],
  'destructive-confirm': [
    { pattern: /confirm/i, label: '添加确认对话框', code: 'if (!confirm("确定删除？")) return;' },
    { pattern: /undo/i, label: '撤销功能', code: 'await deleteItem(id); showUndoToast();' },
    { pattern: /modal.*confirm/i, label: '模态确认框' },
  ],
  'stale-data': [
    { pattern: /refetch|invalidate/i, label: '数据重新获取', code: 'queryClient.invalidateQueries("items");' },
    { pattern: /websocket|polling|SSE/i, label: '实时更新', code: 'new WebSocket("wss://...");' },
    { pattern: /cache.*invalid/i, label: '缓存失效' },
  ],
  'state-persistence': [
    { pattern: /try.*parse|try.*load/i, label: '异常安全加载', code: 'try { return JSON.parse(data) } catch { return defaultState; }' },
    { pattern: /validat|schema/i, label: '验证持久化数据' },
    { pattern: /version|migrate/i, label: '数据迁移' },
  ],
  'missing-loading-states': [
    { pattern: /isLoading|isFetching/i, label: '条件渲染加载态', code: '{isLoading ? <Skeleton /> : <ActualContent />}' },
    { pattern: /skeleton/i, label: '骨架屏', code: '<Skeleton variant="text" />' },
    { pattern: /spinner/i, label: '加载 spinner', code: '<CircularProgress />' },
  ],
  'missing-empty-states': [
    { pattern: /empty.*state|Empty/i, label: '空状态组件', code: '{data.length === 0 ? <EmptyState /> : <List />}' },
    { pattern: /isEmpty|noData/i, label: '空数据判断', code: 'if (data.length === 0) return <Empty />' },
  ],
};

export async function enrich(learnedPath, dataDir) {
  if (!existsSync(learnedPath)) {
    console.log('尚无数据。先运行: insights crawl owner/repo');
    return;
  }
  const data = JSON.parse(readFileSync(learnedPath, 'utf-8'));
  const repos = data.repos || [];

  if (repos.length === 0) {
    console.log('没有仓库数据可分析');
    return;
  }

  console.log(`\n  开始爬取解决方案...`);
  console.log(`  分析 ${repos.length} 个仓库的 issue 评论和 PR\n`);

  const solutionDict = {};

  for (const repo of repos) {
    const [owner, name] = repo.repo.split('/');
    if (!owner || !name) continue;

    console.log(`  📦 ${repo.repo}: 正在爬取评论...`);

    try {
      // Get closed issues with comments (these are most likely to have solutions)
      const issues = await fetchJSON(
        `${GITHUB_API}/repos/${owner}/${name}/issues?state=closed&per_page=30&sort=comments&direction=desc`
      );

      for (const issue of issues.filter(i => !i.pull_request && i.comments > 0)) {
        // Find which patterns this issue matches
        const text = `${issue.title} ${issue.body || ''}`.toLowerCase();
        const matchedPatterns = [];

        for (const [checkId, solutions] of Object.entries(SOLUTION_KEYWORDS)) {
          for (const sol of solutions) {
            if (sol.pattern.test(text)) {
              matchedPatterns.push(checkId);
              break;
            }
          }
        }

        if (matchedPatterns.length === 0) continue;

        // Fetch comments
        const comments = await fetchJSON(issue.comments_url);
        const usefulComments = comments.filter(c => {
          const body = c.body || '';
          return body.length > 50 && !/^\/\*|^\{|^\[/.test(body.trim());
        });

        for (const checkId of matchedPatterns) {
          if (!solutionDict[checkId]) {
            solutionDict[checkId] = { solutions: [], totalIssues: 0 };
          }
          solutionDict[checkId].totalIssues++;

          // Try to extract solution from comments
          for (const sol of SOLUTION_KEYWORDS[checkId] || []) {
            for (const comment of usefulComments) {
              if (sol.pattern.test(comment.body || '')) {
                // Extract a code snippet if present
                const codeMatch = comment.body.match(/```[\s\S]*?```/);
                const code = codeMatch ? codeMatch[0] : sol.code || '';

                // Check if this solution is already recorded
                const existing = solutionDict[checkId].solutions.find(s =>
                  s.label === sol.label && s.code === code
                );
                if (existing) {
                  existing.count++;
                  existing.sources.push({
                    repo: repo.repo,
                    issue: issue.number,
                    url: issue.html_url,
                    commentUrl: comment.html_url,
                  });
                } else {
                  solutionDict[checkId].solutions.push({
                    label: sol.label,
                    code,
                    description: comment.body.slice(0, 200).replace(/\n/g, ' '),
                    count: 1,
                    sources: [{
                      repo: repo.repo,
                      issue: issue.number,
                      url: issue.html_url,
                      commentUrl: comment.html_url,
                    }],
                  });
                }
                break;
              }
            }
          }
        }
      }

      const totalSolutions = Object.values(solutionDict).reduce((a, s) => a + s.solutions.length, 0);
      console.log(`     ✓ 提取 ${totalSolutions} 个解决方案`);
    } catch (e) {
      console.log(`     ⚠ ${e.message}`);
    }
  }

  // ─── Sort and deduplicate ───
  for (const [checkId, dict] of Object.entries(solutionDict)) {
    dict.solutions.sort((a, b) => b.count - a.count);
    // Deduplicate by label
    const seen = new Set();
    dict.solutions = dict.solutions.filter(s => {
      if (seen.has(s.label)) return false;
      seen.add(s.label);
      return true;
    });
  }

  // ─── Print results ───
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  解决方案字典构建完成\n`);

  for (const [checkId, dict] of Object.entries(solutionDict).sort((a, b) => b[1].totalIssues - a[1].totalIssues)) {
    console.log(`  📖 ${checkId} (${dict.totalIssues} 个相关 issue)`);
    for (const sol of dict.solutions.slice(0, 3)) {
      console.log(`     ✅ ${sol.label} (${sol.count} 个来源)`);
      if (sol.code) console.log(`        ${sol.code.slice(0, 80)}`);
      const sources = sol.sources.map(s => `#${s.issue}`).join(', ');
      console.log(`        来源: ${sources}`);
    }
    console.log();
  }

  // ─── Save ───
  const savePath = join(dataDir, 'solutions.json');
  writeFileSync(savePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    reposCount: repos.length,
    dictionary: solutionDict,
  }, null, 2), 'utf-8');
  console.log(`  💾 已保存: ${savePath}`);
}
