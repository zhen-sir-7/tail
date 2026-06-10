import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHECK_TEMPLATES = {
  'silent-failure': `// silent-failure: 静默错误 (来自 insights crawl)
    checks.push({
      id: 'silent-failure', title: '静默错误', impact: 95,
      detect: (ctx) => {
        const r = [];
        for (let i = 0; i < ctx.lines.length - 1; i++) {
          if (/catch\\s*\\(/.test(ctx.lines[i]) && ctx.lines[i+1].trim() === '{' && ctx.lines[i+2] && /^\\s*\\}\\s*$/.test(ctx.lines[i+2]))
            r.push({ id:'silent-failure-'+i, checkId:'silent-failure', file:ctx.file, line:i+1, category:'code-quality', severity:'high', impact:95, title:'空 catch 块', description:'错误被静默吞掉', fixable:false });
          if (/\\.catch\\(\\s*[\\w]+\\s*=>\\s*\\{\\s*\\}\\s*\\)/.test(ctx.lines[i]))
            r.push({ id:'silent-failure-catch-'+i, checkId:'silent-failure', file:ctx.file, line:i+1, category:'code-quality', severity:'high', impact:95, title:'.catch() 为空', description:'Promise 错误被忽略', fixable:false });
        }
        return r;
      }
    });`,
  'infinite-loading': `// infinite-loading: 缺少超时 (来自 insights crawl)
    checks.push({
      id: 'infinite-loading', title: '缺少超时', impact: 90,
      detect: (ctx) => {
        if (ctx.type === 'css') return [];
        if (/(fetch|axios|useQuery|mutateAsync)/.test(ctx.content) && !/(AbortController|signal|timeout|Promise\\.race)/.test(ctx.content))
          return [{ id:'infinite-loading-1', checkId:'infinite-loading', file:ctx.file, line:1, category:'workflow', severity:'high', impact:90, title:'异步操作无超时', description:'可能永远挂起，建议加 AbortController', fixable:false }];
        return [];
      }
    });`,
  'missing-input-validation': `// missing-input-validation: 缺少输入验证 (来自 insights crawl)
    checks.push({
      id: 'missing-input-validation', title: '缺少输入验证', impact: 90,
      detect: (ctx) => {
        if (['css','html'].includes(ctx.type)) return [];
        if (/(req\\.(body|params|query)|process\\.argv|prompt|input|formData)/.test(ctx.content) && !/(validate|zod|yup|joi|schema|sanitize)/.test(ctx.content))
          return [{ id:'input-validation-1', checkId:'missing-input-validation', file:ctx.file, line:1, category:'workflow', severity:'high', impact:90, title:'输入未验证', description:'可能导致崩溃或安全漏洞', fixable:false }];
        return [];
      }
    });`,
  'credential-exposure': `// credential-exposure: 凭证硬编码 (来自 insights crawl)
    checks.push({
      id: 'credential-exposure', title: '凭证硬编码', impact: 100,
      detect: (ctx) => {
        for (let i = 0; i < ctx.lines.length; i++) {
          if (/(api[_-]?key|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(ctx.lines[i]) && !/^\\s*\\/\\//.test(ctx.lines[i]) && !/process\\.env/.test(ctx.lines[i]))
            return [{ id:'cred-exposure-'+i, checkId:'credential-exposure', file:ctx.file, line:i+1, category:'code-quality', severity:'critical', impact:100, title:'密钥硬编码', description:'应使用环境变量', fixable:false }];
        }
        return [];
      }
    });`,
  'data-corruption': `// data-corruption: 数据完整性 (来自 insights crawl)
    checks.push({
      id: 'data-corruption', title: '数据完整性风险', impact: 85,
      detect: (ctx) => {
        if (['css','html'].includes(ctx.type)) return [];
        if (/JSON\\.(stringify|parse)/.test(ctx.content) && !/try\\s*\\{/.test(ctx.content))
          return [{ id:'data-corruption-1', checkId:'data-corruption', file:ctx.file, line:1, category:'code-quality', severity:'high', impact:85, title:'JSON 操作无 try-catch', description:'非法数据将导致崩溃', fixable:false }];
        return [];
      }
    });`,
};

export function apply(learnedPath, targetEnginePath) {
  if (!existsSync(learnedPath)) {
    console.log('尚无数据。先运行: insights crawl owner/repo');
    return;
  }

  const data = JSON.parse(readFileSync(learnedPath, 'utf-8'));
  const patterns = data.patterns || [];
  const totalIssues = data.totalIssues || 0;
  const repoCount = data.repoCount || 0;

  if (!existsSync(targetEnginePath)) {
    console.log(`目标文件不存在: ${targetEnginePath}`);
    return;
  }

  let engine = readFileSync(targetEnginePath, 'utf-8');

  // Generate check code blocks, sorted by frequency
  const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences);
  let injectCode = `\n  // --- data-driven checks (insights) ---
  // Generated from ${repoCount} repos, ${totalIssues} issues\n`;
  let injectedCount = 0;

  for (const p of sorted) {
    const tmpl = CHECK_TEMPLATES[p.checkId];
    if (!tmpl) continue;
    const confidence = p.confidence || Math.min(100, Math.round((p.breadth || 1) / 3 * 50 + Math.log2((p.occurrences || 1) + 1) * 5));
    if (confidence < 50) continue;

    injectCode += `  // ${p.title} · 확신도 ${confidence}% · ${p.occurrences}회 출현\n`;
    injectCode += tmpl + '\n';
    injectedCount++;
  }

  // Check if already applied — replace old injected code
  const INJECT_MARKER = '// --- data-driven checks (insights) ---';
  if (engine.includes(INJECT_MARKER)) {
    console.log('  ℹ engine.js 已包含 insights 注入的检查，替换旧代码');
    engine = engine.replace(/\n\s*\/\/ --- data-driven checks \(insights\) ---[\s\S]*?(?=\n\s*\/\/ ---|$)/, '');
  }

  const marker = '    return checks;';
  const idx = engine.lastIndexOf(marker);
  if (idx === -1) {
    console.log('  ✗ 找不到插入点 (return checks)');
    return;
  }

  const newEngine = engine.slice(0, idx) + injectCode + '\n' + engine.slice(idx);
  writeFileSync(targetEnginePath, newEngine, 'utf-8');

  console.log(`\n  ✓ 已注入 ${injectedCount} 条数据驱动检查规则到 engine.js`);
  console.log(`  ℹ 来源: ${repoCount} 个仓库 · ${totalIssues} 个 issue`);
  console.log(`  ℹ 下次 tail scan 时自动生效`);
}
