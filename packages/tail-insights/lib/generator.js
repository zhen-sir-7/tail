import { readFileSync, writeFileSync, existsSync } from 'fs';

const CHECK_TEMPLATES = {
  'silent-failure': `for (let i = 0; i < lines.length - 1; i++) {
      if (/catch\\\\s*\\\\(/.test(lines[i])) {
        const next = lines[i + 1].trim();
        if (next === '{' && lines[i + 2] && /^\\\\s*\\\\}\\\\s*$/.test(lines[i + 2])) {
          results.push(issue('silent-failure', i + 1, 'code-quality', 'high', 95, '空的 catch 块', 'catch 块为空，错误被静默吞掉'));
        }
      }
      if (/\\\\.catch\\\\(\\\\s*[\\\\w]+\\\\s*=>\\\\s*\\\\{\\\\s*\\\\}\\\\s*\\\\)/.test(lines[i])) {
        results.push(issue('silent-failure', i + 1, 'code-quality', 'high', 95, '静默错误', '.catch() 为空，Promise 错误被忽略'));
      }
    }`,
  'infinite-loading': `if (type !== 'css' && /(fetch|axios|useQuery|mutateAsync)/.test(content)) {
      if (!/(AbortController|signal|timeout|Promise\\\\.race)/.test(content))
        results.push(issue('infinite-loading', 1, 'workflow', 'high', 90, '缺少超时', '异步操作缺少超时机制，可能永远挂起'));
    }`,
  'missing-input-validation': `if (!['css','html'].includes(type) && /(req\\\\.(body|params|query)|process\\\\.argv|prompt|input|formData)/.test(content) && !/(validate|zod|yup|joi|schema|sanitize)/.test(content)) {
      results.push(issue('missing-input-validation', 1, 'workflow', 'high', 90, '缺少输入验证', '用户输入未验证可能导致崩溃或安全漏洞'));
    }`,
  'credential-exposure': `for (let i = 0; i < lines.length; i++) {
      if (/(api[_-]?key|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(lines[i]) && !/^\\\\s*\\\\/\\\\//.test(lines[i]) && !/process\\\\.env/.test(lines[i]) && !/import/.test(lines[i])) {
        results.push(issue('credential-exposure', i + 1, 'code-quality', 'critical', 100, '凭证硬编码', 'API Key 应使用环境变量'));
        break;
      }
    }`,
  'data-corruption': `if (!['css','html'].includes(type) && /JSON\\\\.(stringify|parse)/.test(content) && !/try\\\\s*\\\\{/.test(content)) {
      results.push(issue('data-corruption', 1, 'code-quality', 'high', 85, '数据完整性风险', 'JSON 操作无 try-catch，非法数据将崩溃'));
    }`,
  'auth-issues': `if (!['css','html'].includes(type) && /(fetch|axios)/.test(content) && !/(auth|token|Authorization|Bearer)/.test(content)) {
      results.push(issue('auth-issues', 1, 'workflow', 'critical', 100, '缺少鉴权', 'API 调用未检测到鉴权机制'));
    }`,
  'destructive-confirm': `if (/(delete|remove|destroy)/i.test(content) && !/(confirm|confirmDialog|window\\\\.confirm|are you sure)/i.test(content)) {
      results.push(issue('destructive-confirm', 1, 'workflow', 'high', 75, '缺少删除确认', '删除操作无确认弹窗'));
    }`,
  'stale-data': `if (!['css','html'].includes(type) && /(mutate|create|update|delete|save|write)/.test(content) && !/(refetch|invalidate|refresh|reload|onSuccess)/.test(content)) {
      results.push(issue('stale-data', 1, 'workflow', 'high', 90, '数据同步问题', '数据变更后缺少刷新机制'));
    }`,
  'state-persistence': `if (!['css','html'].includes(type) && /(localStorage\\\\.setItem|writeFileSync|save|persist)/.test(content) && /(localStorage\\\\.getItem|readFileSync|load|restore)/.test(content) && !/(try\\\\s*\\\\{|validate|schema|default)/.test(content)) {
      results.push(issue('state-persistence', 1, 'code-quality', 'medium', 75, '状态持久化问题', '持久化数据缺少校验'));
    }`,
  'platform-compat': `if (/\\\\/usr\\\\/(local\\\\/)?bin\\\\//.test(content) || /C:\\\\\\\\Users/.test(content) || /~\\\\/\\\\./.test(content)) {
      results.push(issue('platform-compat', 1, 'code-quality', 'medium', 70, '平台兼容性', '硬编码路径不跨平台'));
    }`,
  'missing-loading-states': `if (!['css','html'].includes(type) && /(fetch|axios|async|useQuery)/.test(content) && !/(loading|isLoading|isFetching|skeleton|spinner)/.test(content)) {
      results.push(issue('missing-loading-states', 1, 'ui-ux', 'high', 85, '缺少加载状态', '异步请求期间用户看不到反馈'));
    }`,
  'missing-empty-states': `if (!['css','html'].includes(type) && /\\\\.map\\\\(/.test(content) && !/(empty|noData|noResults|isEmpty|length\\\\s*===\\\\s*0)/.test(content)) {
      results.push(issue('missing-empty-states', 1, 'ui-ux', 'medium', 80, '缺少空状态', '列表渲染未处理空数据'));
    }`,
};

export function generate(learnedPath, outputPath) {
  if (!existsSync(learnedPath)) {
    console.log('尚无数据。先运行: insights crawl owner/repo');
    return;
  }

  const data = JSON.parse(readFileSync(learnedPath, 'utf-8'));
  const patterns = data.patterns || [];
  const totalIssues = data.totalIssues || 0;
  const repoCount = data.repoCount || data.repos?.length || 0;

  let checksCode = '';
  let activeCount = 0;

  for (const p of patterns) {
    const tmpl = CHECK_TEMPLATES[p.checkId];
    if (!tmpl) continue;

    const evidence = (p.evidence || []).map(e => `${e.repo}(${e.count})`).join(', ');
    const confidence = p.confidence || Math.min(100, Math.round((p.breadth || 1) / 4 * 50 + Math.log2((p.occurrences || 1) + 1) * 5));

    checksCode += `
  // ${p.checkId}: ${p.title}
  // 置信度 ${confidence}% · 出现 ${p.occurrences} 次 · ${p.breadth || '?'}/${repoCount} 仓库
  // 来源: ${evidence || '无'}
  {
    id: '${p.checkId}',
    title: '${p.title}',
    category: '${p.category || 'code-quality'}',
    severity: '${p.severity || 'medium'}',
    impact: ${p.impact || 50},
    confidence: ${confidence},
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      ${tmpl}
      return results;
    }
  },
`;
    if (confidence >= 50) activeCount++;
  }

  const code = `// ══════════════════════════════════════════════════
// data-checks.js — 自动生成于 ${new Date().toISOString()}
// 来源: ${repoCount} 个 AI 项目 · ${totalIssues} 个 issue
// 运行 \`insights generate\` 重新生成此文件
// ══════════════════════════════════════════════════

const _id = (() => { let c = 0; return () => ++c; })();

function issue(checkId, line, category, severity, impact, title, description) {
  return { id: checkId + '-' + _id(), checkId, file: '', line, category, severity, impact, title, description, fixable: false };
}

export const dataChecks = [${checksCode}];

export function getActiveChecks(threshold = 50) {
  return dataChecks.filter(c => (c.confidence || 0) >= threshold);
}
`;

  writeFileSync(outputPath, code, 'utf-8');
  console.log(`  ✓ 已生成: ${outputPath}`);
  console.log(`  ℹ ${checksCode.split('id:').length - 1} 条规则 · ${activeCount} 条活跃 (置信度≥50)`);
}
