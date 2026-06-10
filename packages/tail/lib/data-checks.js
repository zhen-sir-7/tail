// ══════════════════════════════════════════════════
// data-checks.js — 自动生成于 2026-06-10T10:23:21.584Z
// 来源: 4 个 AI 项目 · 4741 个 issue
// 运行 `insights generate` 重新生成此文件
// ══════════════════════════════════════════════════

const _id = (() => { let c = 0; return () => ++c; })();

function issue(checkId, line, category, severity, impact, title, description) {
  return { id: checkId + '-' + _id(), checkId, file: '', line, category, severity, impact, title, description, fixable: false };
}

export const dataChecks = [
  // platform-compat: 平台兼容性问题
  // 置信度 100% · 出现 1925 次 · 1619/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(3), eyaltoledano/claude-task-master(2), farion1231/cc-switch(1)
  {
    id: 'platform-compat',
    title: '平台兼容性问题',
    category: 'code-quality',
    severity: 'medium',
    impact: 70,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (/\\/usr\\/(local\\/)?bin\\//.test(content) || /C:\\\\Users/.test(content) || /~\\/\\./.test(content)) {
      results.push(issue('platform-compat', 1, 'code-quality', 'medium', 70, '平台兼容性', '硬编码路径不跨平台'));
    }
      return results;
    }
  },

  // silent-failure: 静默错误/空 catch
  // 置信度 100% · 出现 1686 次 · 1304/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(4), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'silent-failure',
    title: '静默错误/空 catch',
    category: 'code-quality',
    severity: 'high',
    impact: 95,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      for (let i = 0; i < lines.length - 1; i++) {
      if (/catch\\s*\\(/.test(lines[i])) {
        const next = lines[i + 1].trim();
        if (next === '{' && lines[i + 2] && /^\\s*\\}\\s*$/.test(lines[i + 2])) {
          results.push(issue('silent-failure', i + 1, 'code-quality', 'high', 95, '空的 catch 块', 'catch 块为空，错误被静默吞掉'));
        }
      }
      if (/\\.catch\\(\\s*[\\w]+\\s*=>\\s*\\{\\s*\\}\\s*\\)/.test(lines[i])) {
        results.push(issue('silent-failure', i + 1, 'code-quality', 'high', 95, '静默错误', '.catch() 为空，Promise 错误被忽略'));
      }
    }
      return results;
    }
  },

  // auth-issues: 认证/权限问题
  // 置信度 100% · 出现 854 次 · 602/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(2), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'auth-issues',
    title: '认证/权限问题',
    category: 'workflow',
    severity: 'critical',
    impact: 100,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /(fetch|axios)/.test(content) && !/(auth|token|Authorization|Bearer)/.test(content)) {
      results.push(issue('auth-issues', 1, 'workflow', 'critical', 100, '缺少鉴权', 'API 调用未检测到鉴权机制'));
    }
      return results;
    }
  },

  // credential-exposure: 凭证泄露风险
  // 置信度 100% · 出现 749 次 · 601/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(2), farion1231/cc-switch(1)
  {
    id: 'credential-exposure',
    title: '凭证泄露风险',
    category: 'code-quality',
    severity: 'critical',
    impact: 100,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      for (let i = 0; i < lines.length; i++) {
      if (/(api[_-]?key|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(lines[i]) && !/^\\s*\\/\\//.test(lines[i]) && !/process\\.env/.test(lines[i]) && !/import/.test(lines[i])) {
        results.push(issue('credential-exposure', i + 1, 'code-quality', 'critical', 100, '凭证硬编码', 'API Key 应使用环境变量'));
        break;
      }
    }
      return results;
    }
  },

  // infinite-loading: 无限加载/无超时
  // 置信度 100% · 出现 616 次 · 537/4 仓库
  // 来源: anthropics/claudes-c-compiler(2), onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(2)
  {
    id: 'infinite-loading',
    title: '无限加载/无超时',
    category: 'workflow',
    severity: 'high',
    impact: 90,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (type !== 'css' && /(fetch|axios|useQuery|mutateAsync)/.test(content)) {
      if (!/(AbortController|signal|timeout|Promise\\.race)/.test(content))
        results.push(issue('infinite-loading', 1, 'workflow', 'high', 90, '缺少超时', '异步操作缺少超时机制，可能永远挂起'));
    }
      return results;
    }
  },

  // missing-input-validation: 缺少输入验证
  // 置信度 100% · 出现 441 次 · 379/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(2), farion1231/cc-switch(1)
  {
    id: 'missing-input-validation',
    title: '缺少输入验证',
    category: 'workflow',
    severity: 'high',
    impact: 90,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /(req\\.(body|params|query)|process\\.argv|prompt|input|formData)/.test(content) && !/(validate|zod|yup|joi|schema|sanitize)/.test(content)) {
      results.push(issue('missing-input-validation', 1, 'workflow', 'high', 90, '缺少输入验证', '用户输入未验证可能导致崩溃或安全漏洞'));
    }
      return results;
    }
  },

  // stale-data: 数据同步/刷新问题
  // 置信度 100% · 出现 365 次 · 336/4 仓库
  // 来源: onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'stale-data',
    title: '数据同步/刷新问题',
    category: 'workflow',
    severity: 'high',
    impact: 90,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /(mutate|create|update|delete|save|write)/.test(content) && !/(refetch|invalidate|refresh|reload|onSuccess)/.test(content)) {
      results.push(issue('stale-data', 1, 'workflow', 'high', 90, '数据同步问题', '数据变更后缺少刷新机制'));
    }
      return results;
    }
  },

  // state-persistence: 状态持久化问题
  // 置信度 100% · 出现 288 次 · 257/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'state-persistence',
    title: '状态持久化问题',
    category: 'code-quality',
    severity: 'medium',
    impact: 75,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /(localStorage\\.setItem|writeFileSync|save|persist)/.test(content) && /(localStorage\\.getItem|readFileSync|load|restore)/.test(content) && !/(try\\s*\\{|validate|schema|default)/.test(content)) {
      results.push(issue('state-persistence', 1, 'code-quality', 'medium', 75, '状态持久化问题', '持久化数据缺少校验'));
    }
      return results;
    }
  },

  // missing-empty-states: 缺少空状态
  // 置信度 100% · 出现 116 次 · 115/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'missing-empty-states',
    title: '缺少空状态',
    category: 'ui-ux',
    severity: 'medium',
    impact: 80,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /\\.map\\(/.test(content) && !/(empty|noData|noResults|isEmpty|length\\s*===\\s*0)/.test(content)) {
      results.push(issue('missing-empty-states', 1, 'ui-ux', 'medium', 80, '缺少空状态', '列表渲染未处理空数据'));
    }
      return results;
    }
  },

  // missing-loading-states: 缺少加载状态
  // 置信度 100% · 出现 114 次 · 107/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'missing-loading-states',
    title: '缺少加载状态',
    category: 'ui-ux',
    severity: 'high',
    impact: 85,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /(fetch|axios|async|useQuery)/.test(content) && !/(loading|isLoading|isFetching|skeleton|spinner)/.test(content)) {
      results.push(issue('missing-loading-states', 1, 'ui-ux', 'high', 85, '缺少加载状态', '异步请求期间用户看不到反馈'));
    }
      return results;
    }
  },

  // destructive-confirm: 危险操作缺少确认
  // 置信度 100% · 出现 60 次 · 58/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(1), farion1231/cc-switch(1)
  {
    id: 'destructive-confirm',
    title: '危险操作缺少确认',
    category: 'workflow',
    severity: 'high',
    impact: 75,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (/(delete|remove|destroy)/i.test(content) && !/(confirm|confirmDialog|window\\.confirm|are you sure)/i.test(content)) {
      results.push(issue('destructive-confirm', 1, 'workflow', 'high', 75, '缺少删除确认', '删除操作无确认弹窗'));
    }
      return results;
    }
  },

  // data-corruption: 数据完整性风险
  // 置信度 100% · 出现 43 次 · 42/4 仓库
  // 来源: anthropics/claudes-c-compiler(1), onlook-dev/onlook(1), eyaltoledano/claude-task-master(2), farion1231/cc-switch(1)
  {
    id: 'data-corruption',
    title: '数据完整性风险',
    category: 'code-quality',
    severity: 'high',
    impact: 85,
    confidence: 100,
    detect: (ctx) => {
      const results = [];
      const { content, lines, type } = ctx;
      if (!['css','html'].includes(type) && /JSON\\.(stringify|parse)/.test(content) && !/try\\s*\\{/.test(content)) {
      results.push(issue('data-corruption', 1, 'code-quality', 'high', 85, '数据完整性风险', 'JSON 操作无 try-catch，非法数据将崩溃'));
    }
      return results;
    }
  },
];

export function getActiveChecks(threshold = 50) {
  return dataChecks.filter(c => (c.confidence || 0) >= threshold);
}
