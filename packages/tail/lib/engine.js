import { existsSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

import { Scanner } from './scanner.js';
import { Reporter } from './reporter.js';
import { Fixer } from './fixer.js';
import { Profile } from './profile.js';

const require = createRequire(import.meta.url);

let _idCounter = 0;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

export class Engine {
  constructor(targetDir, state, { silent = false, preset = null, auto = false } = {}) {
    this.targetDir = targetDir;
    this.state = state;
    this.config = state.loadConfig();
    if (preset) this.config.projectType = preset;
    this.auto = auto;
    this.profiler = new Profile(targetDir);
    this.scanner = new Scanner(targetDir, this.config);
    this.reporter = new Reporter({ silent });
    this.fixer = new Fixer(this.reporter);
    this.profile = null;
    this.dataChecks = null;
  }

  async _loadDataChecks() {
    if (this.dataChecks) return;
    try {
      const mod = await import(/* @vite-ignore */ join(this.targetDir, 'lib', 'data-checks.js'));
      this.dataChecks = mod.getActiveChecks ? mod.getActiveChecks() : (mod.dataChecks || []);
    } catch {
      // data-checks.js 不存在时静默跳过
      this.dataChecks = [];
    }
  }

  async init() {
    const cfgPath = join(this.targetDir, '.polishrc.json');
    if (existsSync(cfgPath)) {
      this.reporter.warn('.polishrc.json 已存在，跳过初始化');
      return;
    }

    // Auto-profile project and generate config
    this.reporter.info('正在分析项目特征...');
    const profile = await this.profiler.build();
    const projectType = await this.profiler.guessProjectType();

    const defaultConfig = {
      projectType,
      suppress: [],
      include: ['**/*.{html,css,js,jsx,ts,tsx,vue,svelte}'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.min.*', '**/coverage/**'],
      checks: { 'ui-ux': true, 'code-quality': true, 'workflow': true },
      threshold: 80,
      maxLoops: 10,
      _generatedFrom: {
        framework: profile.framework,
        type: profile.type,
        styling: profile.styling,
        stateManagement: profile.stateManagement,
      },
    };

    const { writeFileSync } = await import('fs');
    writeFileSync(cfgPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    this.reporter.success(`配置文件已创建: ${cfgPath}`);
    this.reporter.info(`检测到项目类型: ${projectType} (框架: ${profile.framework || '未知'})`);
    this.reporter.info('运行 polish scan 开始扫描');
  }

  async _buildProfile() {
    if (!this.profile) {
      this.profile = await this.profiler.build();
    }
    return this.profile;
  }

  async _runChecks() {
    const files = await this.scanner.scan();
    const profile = await this._buildProfile();
    const allIssues = [];

    for (const file of files) {
      const result = this.scanner.readFile(file.path);
      if (!result) continue;

      const ctx = {
        file: file.path,
        lines: result.lines,
        content: result.content,
        type: file.type,
        profile,
        config: this.config,
      };

      // Determine which check groups to run based on profile
      await this._loadDataChecks();
      const checks = await this._getChecksForProfile(profile);

      for (const check of checks) {
        try {
          const issues = check.detect(ctx);
          if (issues && issues.length > 0) allIssues.push(...issues);
        } catch { /* skip broken check */ }
      }
    }

    // Project-level checks should only emit one issue (not per file)
    const projectLevelChecks = ['cli-help-interface', 'cli-exit-codes', 'missing-user-feedback', 'infinite-loading', 'missing-input-validation', 'data-corruption', 'state-persistence'];
    const projectLevelFired = new Set();

    const unique = allIssues.filter(i => {
      if (projectLevelChecks.includes(i.checkId)) {
        if (projectLevelFired.has(i.checkId)) return false;
        projectLevelFired.add(i.checkId);
        return true;
      }
      return true; // all others pass through
    });

    // Deduplicate by checkId + file + line
    const seen = new Set();
    const deduped = unique.filter(i => {
      const key = `${i.checkId}:${i.file}:${i.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return this._sortByImpact(deduped);
  }

  async _getChecksForProfile(profile) {
    const checks = [];
    const type = profile?.type || 'frontend-react';
    const patterns = profile?.patterns || {};
    const isFrontend = type.startsWith('frontend');
    const isCli = type === 'cli';
    const isBackend = type === 'library';

    // ─── ALWAYS: Core UX flaws (these matter regardless of project type) ───
    checks.push({
      id: 'missing-user-feedback',
      title: '用户操作缺乏反馈',
      impact: 90,
      detect: (ctx) => {
        if (ctx.type === 'css') return [];
        const { content, profile } = ctx;
        const issues = [];
        const isCli = profile?.type === 'cli';

        // CLI tools use stdout/stderr, not Toast
        const feedbackPattern = isCli
          ? /(console\.(log|error|warn)|process\.stdout|chalk)/  // CLI feedback mechanisms
          : /(toast|notification|message\.(success|error)|snackbar|\.success\(|\.error\()/;

        const hasAsync = /(fetch|axios|mutate|create\w+|update\w+|delete\w+|save|submit)/.test(content);
        const hasFeedback = feedbackPattern.test(content) || profile?.patterns?.hasToasts;

        if (hasAsync && !hasFeedback) {
          const msg = isCli
            ? 'CLI 工具在异步操作后应输出反馈(成功/失败信息)到控制台，否则用户不知道操作结果。'
            : '用户执行操作后看不到成功/失败提示，不确定操作是否生效。建议添加 Toast 通知。';
          issues.push(this._issue(ctx, 'missing-user-feedback', 'workflow', 'high',
            '异步操作缺少用户反馈', msg));
        }

        return issues;
      }
    });

    // ─── FRONTEND ONLY: Component state coverage (loading/empty/error) ───
    if (isFrontend) {
      checks.push({
        id: 'missing-loading-states',
        title: '组件缺少加载状态',
        impact: 85,
        detect: (ctx) => {
          if (['css', 'html'].includes(ctx.type)) return [];
          const { content, profile } = ctx;
          const issues = [];

          const hasAsync = /(fetch|axios|useEffect|async|query|useQuery)/.test(content);
          const hasLoading = /(loading|isLoading|isFetching|isPending|skeleton|Skeleton)/.test(content);

          if (hasAsync && !hasLoading && !profile.patterns.hasLoadingStates) {
            issues.push(this._issue(ctx, 'missing-loading-states', 'ui-ux', 'high',
              '组件缺少加载状态',
              '检测到异步数据请求，但组件没有加载态。用户等待时看到空白页面，以为是 Bug。'));
          }
          return issues;
        }
      });

      checks.push({
        id: 'missing-empty-states',
        title: '列表缺少空状态',
        impact: 80,
        detect: (ctx) => {
          if (['css', 'html'].includes(ctx.type)) return [];
          const { content, profile } = ctx;

          const hasList = /\.map\(/.test(content) || /v-for/.test(content) || /ngFor/.test(content);
          const hasEmpty = /(empty|noData|noResults|isEmpty|length\s*===\s*0|length\s*<=\s*0)/.test(content);

          if (hasList && !hasEmpty && !profile.patterns.hasEmptyStates) {
            return [this._issue(ctx, 'missing-empty-states', 'ui-ux', 'medium',
              '列表缺少空状态',
              '使用 .map() / v-for 渲染列表，但未处理空数据场景。数据为空时用户看到空白区域。')];
          }
          return [];
        }
      });

      checks.push({
        id: 'missing-error-boundaries',
        title: '缺少错误边界',
        impact: 75,
        detect: (ctx) => {
          if (!['tsx', 'jsx', 'vue', 'svelte'].includes(ctx.type)) return [];
          const { content, profile } = ctx;
          const hasComponent = /export\s+(default\s+)?(function|class)/.test(content);
          const hasBoundary = /(ErrorBoundary|errorElement|errorCaptured|onError)/.test(content);

          if (hasComponent && !hasBoundary && !profile.patterns.hasErrorBoundaries) {
            return [this._issue(ctx, 'missing-error-boundaries', 'ui-ux', 'high',
              '缺少错误边界',
              '组件未包裹 ErrorBoundary，运行时异常会导致整个应用白屏。')];
          }
          return [];
        }
      });
    }

    // ─── FRONTEND: Perceptual polish ───
    if (isFrontend) {
      if (profile.styling !== 'tailwind') {
        checks.push({
          id: 'hardcoded-colors',
          title: '硬编码颜色',
          impact: 60,
          detect: (ctx) => {
            if (ctx.type !== 'css') return [];
            const results = [];
            for (let i = 0; i < ctx.lines.length; i++) {
              const m = ctx.lines[i].match(/(?:color|background|border|box-shadow)\s*:[^;]*?(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/);
              if (m && !ctx.lines[i].includes('var(')) {
                results.push(this._issue(ctx, 'hardcoded-colors', 'ui-ux', 'medium',
                  '硬编码颜色值',
                  `第 ${i + 1} 行: ${m[1]}，建议提取为 CSS 变量以便统一主题管理`));
              }
            }
            return results;
          }
        });
      }

      checks.push({
        id: 'missing-interaction-feedback',
        title: '交互缺少反馈',
        impact: 70,
        detect: (ctx) => {
          const results = [];
          for (let i = 0; i < ctx.lines.length; i++) {
            const line = ctx.lines[i];
            // Buttons without type (can cause form submission issues)
            if (/<button\s/.test(line) && !/type\s*=/.test(line) && !/<button>/.test(line.trim())) {
              results.push(this._issue(ctx, 'button-without-type', 'ui-ux', 'high',
                '按钮缺少 type 属性',
                `第 ${i + 1} 行: 缺少 type 的 button 在 form 中默认提交表单，导致意外页面刷新`));
            }
            // Empty href links
            if (/href\s*=\s*["']#["']/.test(line) || /href\s*=\s*["']javascript:void\(0\)["']/.test(line)) {
              results.push(this._issue(ctx, 'href-void', 'ui-ux', 'medium',
                '使用无意义 href',
                `第 ${i + 1} 行: 建议用 <button> 替代，或添加 role="button" 以改善无障碍`));
            }
          }
          return results;
        }
      });
    }

    // ─── FRONTEND: Accessibility basics ───
    if (isFrontend) {
      checks.push({
        id: 'missing-alt-text',
        title: '图片缺少替代文本',
        impact: 65,
        detect: (ctx) => {
          const results = [];
          for (let i = 0; i < ctx.lines.length; i++) {
            if (/<img\s/.test(ctx.lines[i]) && !/alt\s*=/.test(ctx.lines[i])) {
              results.push(this._issue(ctx, 'img-without-alt', 'ui-ux', 'high',
                '图片缺少 alt 属性',
                `第 ${i + 1} 行: 影响屏幕阅读器使用者，SEO 也依赖 alt 文本`));
            }
          }
          return results;
        }
      });
    }

    // ─── CLI ONLY: Interface completeness ───
    if (isCli) {
      checks.push({
        id: 'cli-help-interface',
        title: 'CLI 帮助接口',
        impact: 90,
        detect: (ctx) => {
          // Only check entry/main files, not every module
          const isEntry = ctx.file.includes('/bin/') || ctx.file.endsWith('index.js') || ctx.file.endsWith('main.js') || ctx.file.endsWith('cli.js');
          if (!isEntry) return [];
          const { content } = ctx;
          if (!/--help/.test(content) && !/help/.test(content)) {
            return [this._issue(ctx, 'cli-help-interface', 'code-quality', 'high',
              '缺少 --help 参数处理',
              'CLI 工具应支持 --help 参数输出使用说明。')];
          }
          return [];
        }
      });

      checks.push({
        id: 'cli-exit-codes',
        title: 'CLI 退出码',
        impact: 70,
        detect: (ctx) => {
          const isEntry = ctx.file.includes('/bin/') || ctx.file.endsWith('index.js') || ctx.file.endsWith('main.js') || ctx.file.endsWith('cli.js');
          if (!isEntry) return [];
          const { content } = ctx;
          if (!/process\.exit/.test(content)) {
            return [this._issue(ctx, 'cli-exit-codes', 'code-quality', 'medium',
              '缺少显式退出码',
              'CLI 工具应在错误时使用 process.exit(1)，失败静默会隐藏问题。')];
          }
          return [];
        }
      });
    }

    // ─── FRONTEND: Form UX ───
    if (isFrontend) {
      checks.push({
        id: 'form-ux',
        title: '表单体验',
        impact: 85,
        detect: (ctx) => {
          const results = [];
          const { content } = ctx;
          const hasForm = /(<form|onSubmit|handleSubmit)/.test(content);
          if (hasForm) {
            const hasValidation = /(required|validate|error|errorMessage|helperText|schema|yup|zod)/.test(content);
            const hasSubmitFeedback = /(toast|message|onSuccess|onError)/.test(content);

            if (!hasValidation && !profile.patterns.hasFormLib) {
              results.push(this._issue(ctx, 'form-no-validation', 'workflow', 'high',
                '表单缺少验证反馈',
                '表单提交无客户端验证，用户在点击提交后才知道输入是否正确。'));
            }
            if (!hasSubmitFeedback && !profile.patterns.hasToasts) {
              results.push(this._issue(ctx, 'form-no-feedback', 'workflow', 'high',
                '表单缺少提反馈',
                '表单提交后无成功/失败提示，用户不确定操作是否生效。'));
            }
          }
          return results;
        }
      });

      checks.push({
        id: 'destructive-confirm',
        title: '危险操作确认',
        impact: 75,
        detect: (ctx) => {
          const { content } = ctx;
          if (/(delete|remove|destroy)/i.test(content) && !/(confirm|confirmDialog|Modal\.confirm|window\.confirm|are you sure|确定删除)/i.test(content)) {
            return [this._issue(ctx, 'destructive-confirm', 'workflow', 'high',
              '删除操作缺少确认',
              '检测到删除/移除操作但无确认弹窗，用户可能误删数据。')];
          }
          return [];
        }
      });
    }

    // ─── ALWAYS: Code quality essentials ───
    checks.push({
      id: 'dead-code',
      title: '死代码残留',
      impact: 50,
      detect: (ctx) => {
        const results = [];
        for (let i = 0; i < ctx.lines.length; i++) {
          const line = ctx.lines[i];
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/.test(line)) {
            results.push(this._issue(ctx, 'todo-comment', 'code-quality', 'low',
              '遗留 TODO/FIXME 注释',
              `第 ${i + 1} 行: ${line.trim().substring(0, 60)}`));
          }
        }
        return results;
      }
    });

    // ─── DATA-DRIVEN: Patterns from real AI-project issues ───

    // Pattern 1: Silent failures — catch blocks that swallow errors (from claudes-c-compiler #260, #262)
    // AI projects often silently compile/run invalid code instead of reporting errors
    checks.push({
      id: 'silent-failure',
      title: '静默吞掉错误',
      impact: 95,
      detect: (ctx) => {
        const results = [];
        for (let i = 0; i < ctx.lines.length - 1; i++) {
          const line = ctx.lines[i];
          // Empty catch blocks
          if (/catch\s*\(/.test(line)) {
            const next = ctx.lines[i + 1];
            if (next && /^\s*\{\s*\}\s*$/.test(next)) {
              results.push(this._issue(ctx, 'silent-failure', 'code-quality', 'high',
                '空的 catch 块',
                `第 ${i + 1} 行: catch 块为空，错误被静默吞掉。这是 AI 生成代码的常见问题。`));
            }
          }
          // .catch() without body or with () => {}
          if (/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
            results.push(this._issue(ctx, 'silent-failure', 'code-quality', 'high',
              '空的 Promise.catch()',
              `第 ${i + 1} 行: .catch() 为空，Promise 错误被静默忽略。`));
          }
        }
        return results;
      }
    });

    // Pattern 2: Infinite loading / no timeout (from onlook #3097, claude-task-master #1696)
    // AI projects often forget to add timeouts or error states for async operations
    checks.push({
      id: 'infinite-loading',
      title: '无限加载/无超时',
      impact: 90,
      detect: (ctx) => {
        if (['css', 'html'].includes(ctx.type)) return [];
        const content = ctx.lines.join('\n');
        const results = [];

        // Has async operation but no loading state and no error handler
        const hasAsync = /(fetch|axios|\.get\(|\.post\(|useQuery|mutateAsync)/.test(content);
        const hasSpinner = /(loading|isLoading|isFetching|spinner|Skeleton)/.test(content);
        const hasTimeout = /(timeout|abort|AbortController|signal|Promise\.race)/.test(content);
        const hasErrorState = /(error|isError|onError|catch|try\s*\{)/.test(content);

        if (hasAsync && !hasTimeout) {
          results.push(this._issue(ctx, 'infinite-loading', 'workflow', 'high',
            '异步操作缺少超时机制',
            'AI 项目常见问题: 请求可能永远挂起。建议添加 AbortController 或 Promise.race 超时。'));
        }
        if (hasAsync && !hasSpinner && !hasErrorState) {
          results.push(this._issue(ctx, 'infinite-loading', 'ui-ux', 'high',
            '异步操作缺少加载状态和错误处理',
            '用户触发操作后看不到反馈，请求失败也无提示。'));
        }
        return results;
      }
    });

    // Pattern 3: Data corruption / schema drift (from claude-task-master #1708)
    // AI projects often serialize/deserialize without validation
    checks.push({
      id: 'data-corruption',
      title: '数据完整性风险',
      impact: 85,
      detect: (ctx) => {
        if (['css', 'html'].includes(ctx.type)) return [];
        const content = ctx.lines.join('\n');
        const results = [];

        const hasJsonOp = /JSON\.(stringify|parse)/.test(content);
        const hasTryCatch = /try\s*\{/.test(content);

        if (hasJsonOp && !hasTryCatch) {
          results.push(this._issue(ctx, 'data-corruption', 'code-quality', 'high',
            'JSON 操作缺少 try-catch',
            'JSON.parse/stringify 无异常处理，非法数据会导致整个应用崩溃。'));
        }

        // Check for unchecked type conversions (common in AI code)
        for (let i = 0; i < ctx.lines.length; i++) {
          if (/\.id\s*=\s*[a-zA-Z]/.test(ctx.lines[i]) && !/String\(/.test(ctx.lines[i]) && !/toString\(/.test(ctx.lines[i])) {
            results.push(this._issue(ctx, 'data-corruption', 'code-quality', 'medium',
              'ID 赋值可能发生类型转换',
              `第 ${i + 1} 行: 数字 ID 直接赋值给字符串字段可能发生隐式转换。`));
            break;
          }
        }
        return results;
      }
    });

    // Pattern 4: Input validation missing (from claude-task-master #1696, cc-switch #3980)
    // AI projects often assume input is well-formed
    checks.push({
      id: 'missing-input-validation',
      title: '缺少输入验证',
      impact: 90,
      detect: (ctx) => {
        if (['css', 'html'].includes(ctx.type)) return [];
        const content = ctx.lines.join('\n');
        const results = [];

        const hasInput = /(req\.(body|params|query)|process\.argv|readline|prompt|input|formData)/.test(content);
        const hasValidation = /(validate|zod|yup|joi|if\s*\(!\w+|required|schema|sanitize|trim\b)/.test(content);

        if (hasInput && !hasValidation) {
          results.push(this._issue(ctx, 'missing-input-validation', 'workflow', 'high',
            '用户输入缺少验证',
            'AI 项目常见问题: 未验证的输入会导致崩溃或安全漏洞。建议使用 zod/yup schema。'));
        }
        return results;
      }
    });

    // Pattern 5: Credential exposure (from claude-task-master #1704)
    // AI projects often hardcode API keys
    checks.push({
      id: 'credential-exposure',
      title: '凭证泄露风险',
      impact: 100,
      detect: (ctx) => {
        const results = [];
        for (let i = 0; i < ctx.lines.length; i++) {
          const line = ctx.lines[i];
          if (/(api[_-]?key|secret|token|password|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(line) &&
              !/^\s*\/\//.test(line) && !/process\.env/.test(line) && !/import/.test(line)) {
            results.push(this._issue(ctx, 'credential-exposure', 'code-quality', 'critical',
              '源代码中存在凭证硬编码',
              `第 ${i + 1} 行: 检测到可能的 API Key/Token。应使用环境变量。`));
            break;
          }
        }
        return results;
      }
    });

    // Pattern 6: State persistence without validation (from cc-switch #3982)
    // AI projects often save/load state without verification
    checks.push({
      id: 'state-persistence',
      title: '状态持久化风险',
      impact: 75,
      detect: (ctx) => {
        if (['css', 'html'].includes(ctx.type)) return [];
        const content = ctx.lines.join('\n');
        const hasSave = /(localStorage\.setItem|writeFileSync|save|persist|store\.set)/.test(content);
        const hasLoad = /(localStorage\.getItem|readFileSync|load|restore|store\.get)/.test(content);
        const hasValidation = /(try\s*\{|if\s*\(|validate|schema|default)/.test(content);

        if (hasSave && hasLoad && !hasValidation) {
          return [this._issue(ctx, 'state-persistence', 'code-quality', 'medium',
            '状态持久化缺少校验',
            '保存/读取状态时未验证数据完整性，损坏的数据会被静默加载。')];
        }
        return [];
      }
    });

    // Pattern 7: Platform-specific assumptions (from onlook #3116, cc-switch #3983)
    // AI projects often assume a single platform
    checks.push({
      id: 'platform-assumptions',
      title: '平台兼容性',
      impact: 70,
      detect: (ctx) => {
        const results = [];
        const content = ctx.lines.join('\n');

        // Check for hardcoded platform paths
        if (/\/usr\/(local\/)?bin\//.test(content) || /C:\\Users/.test(content) || /~\/\./.test(content)) {
          results.push(this._issue(ctx, 'platform-assumptions', 'code-quality', 'medium',
            '硬编码平台路径',
            '路径可能在不同 OS 上不兼容，建议使用 os.homedir() 或 path.join()。'));
        }

        // Check for uname/arch assumptions without fallback
        if (/(darwin|win32|linux)/.test(content) && !/os\.platform|process\.platform/.test(content)) {
          results.push(this._issue(ctx, 'platform-assumptions', 'code-quality', 'medium',
            '平台特定代码缺少兼容处理',
            '直接硬编码平台名可能导致其他 OS 上无法运行。'));
        }
        return results;
      }
    });

    // ─── FRONTEND: Accessibility ───
    if (isFrontend) {
      checks.push({
        id: 'focus-indicator',
        title: '键盘焦点指示',
        impact: 55,
        detect: (ctx) => {
          if (ctx.type !== 'css') return [];
          const content = ctx.lines.join('\n');
          if (!/:focus-visible/.test(content)) {
            return [this._issue(ctx, 'missing-focus-visible', 'ui-ux', 'medium',
              '缺少 :focus-visible 样式',
              '键盘用户(Tab 导航)无法看到焦点位置，建议为交互元素添加 :focus-visible 样式。')];
          }
          return [];
        }
      });
    }

    // ─── Merge data-driven checks from insights ───
    if (this.dataChecks && this.dataChecks.length > 0) {
      const active = this.dataChecks.filter(c => (c.confidence || 0) >= 50);
      checks.push(...active.map(dc => ({
        id: dc.id,
        title: dc.title,
        impact: dc.impact || 50,
        detect: (ctx) => {
          try {
            const results = dc.detect(ctx) || [];
            // Patch file path and fixed status from context
            for (const r of results) {
              if (!r.file) r.file = ctx.file;
              r.fixed = false;
            }
            return results;
          } catch { return []; }
        },
        _dataDriven: true,
      })));
    }

    return checks;
  }

  _issue(ctx, id, category, severity, title, description) {
    const uid = `${id}-${++_idCounter}`;
    return {
      id: uid,
      checkId: id,
      file: ctx.file,
      line: ctx.line || 1,
      category,
      severity,
      title,
      description,
      fixable: false,
      impact: this._getImpact(id),
    };
  }

  _getImpact(id) {
    const impactMap = {
      'credential-exposure': 100,
      'silent-failure': 95,
      'missing-user-feedback': 90,
      'infinite-loading': 90,
      'missing-input-validation': 90,
      'data-corruption': 85,
      'missing-loading-states': 85,
      'form-ux': 85,
      'missing-empty-states': 80,
      'destructive-confirm': 75,
      'missing-error-boundaries': 75,
      'state-persistence': 75,
      'platform-assumptions': 70,
      'missing-interaction-feedback': 70,
      'cli-exit-codes': 70,
      'missing-alt-text': 65,
      'hardcoded-colors': 60,
      'focus-indicator': 55,
      'dead-code': 50,
    };
    return impactMap[id] || 50;
  }

  _sortByImpact(issues) {
    return issues.sort((a, b) => (b.impact || 0) - (a.impact || 0));
  }

  _formatIssuesByPriority(issues) {
    const critical = issues.filter(i => (i.impact || 50) >= 80);
    const important = issues.filter(i => (i.impact || 50) >= 60 && (i.impact || 50) < 80);
    const niceToHave = issues.filter(i => (i.impact || 50) < 60);
    return { critical, important, niceToHave };
  }

  _profileSummary(profile) {
    const type = profile?.type || '?';
    const framework = profile?.framework || '未检测到';
    const styling = profile?.styling || '?';
    const p = profile?.patterns || {};

    const existing = [];
    if (p.hasLoadingStates) existing.push('✅ 加载态');
    else existing.push('⬜ 加载态');
    if (p.hasEmptyStates) existing.push('✅ 空状态');
    else existing.push('⬜ 空状态');
    if (p.hasErrorBoundaries) existing.push('✅ 错误边界');
    else existing.push('⬜ 错误边界');
    if (p.hasToasts) existing.push('✅ 通知反馈');
    else existing.push('⬜ 通知反馈');
    if (p.usesCssVariables) existing.push('✅ CSS 变量');
    else existing.push('⬜ CSS 变量');

    this.reporter.header('项目画像');
    this.reporter.raw(`  类型:      ${BOLD}${type}${RESET}`);
    this.reporter.raw(`  框架:      ${framework}`);
    this.reporter.raw(`  样式方案:  ${styling}\n`);

    this.reporter.subheader('模式检测');
    for (const item of existing) this.reporter.raw(`    ${item}`);

    // Show what's being skipped
    const skipped = [];
    if (type === 'cli' || type === 'library') {
      skipped.push('UI/UX 组件检查（loading 态、空状态、错误边界等）— 非前端项目');
      skipped.push('工作流检查（表单验证、删除确认、返回按钮等）— 非前端项目');
    }
    if (styling === 'tailwind') {
      skipped.push('硬编码颜色检查 — 使用 Tailwind 体系');
    }

    if (skipped.length > 0) {
      this.reporter.raw('');
      this.reporter.subheader('已跳过（上下文感知）');
      for (const s of skipped) this.reporter.raw(`    ${DIM}⊘ ${s}${RESET}`);
    }
    this.reporter.raw('');
  }

  _issueWithGuidance(issue) {
    this.reporter.issue(issue);
    const guidance = this._guidanceFor(issue.checkId);
    if (guidance) {
      this.reporter.raw(`    ${CYAN}└ 修复思路: ${guidance}${RESET}\n`);
    }
  }

  _guidanceFor(checkId) {
    const map = {
      'missing-user-feedback':
        '为异步操作添加成功/失败反馈。前端: toast 通知。CLI: 操作完成后 console.log 输出结果。',
      'unhandled-promise':
        '在 .then() 后链式调用 .catch(err => console.error(err))，或用 async/await + try-catch 替换。',
      'missing-loading-states':
        '在数据请求期间显示骨架屏或 loading spinner。条件: {isLoading ? <Skeleton /> : <Content />}',
      'missing-empty-states':
        '列表数据为空时显示提示文案和引导操作。条件: {data.length === 0 ? <EmptyState /> : <List />}',
      'missing-error-boundaries':
        '用 <ErrorBoundary fallback={<ErrorFallback />}> 包裹可能抛错的组件，防止白屏。',
      'button-without-type':
        '显式添加 type="button"（普通按钮）或 type="submit"（表单提交）。',
      'href-void':
        '替换为 <button> 或添加 role="button" tabindex={0} + 键盘事件处理。',
      'img-without-alt':
        '添加 alt 属性。纯装饰图用 alt=""，内容图用描述性文本。',
      'hardcoded-colors':
        '提取为 CSS 变量: --color-primary: #1890ff; 然后使用 var(--color-primary)。',
      'missing-focus-visible':
        '添加 :focus-visible { outline: 2px solid var(--color-primary); } 到全局样式。',
      'cli-help-interface':
        '解析 --help / -h 参数并输出 usage 信息。建议使用 commander / yargs 库。',
      'cli-exit-codes':
        '成功 process.exit(0)，失败 process.exit(1)。不要静默吞掉错误。',
      'todo-comment':
        '评估 TODO 是否需要处理。不需要则删除，需要则创建 issue 跟踪。',
      'form-no-validation':
        '用 formik / react-hook-form + yup/zod schema 做客户端验证，实时显示错误。',
      'form-no-feedback':
        '提交成功后 toast.success()，失败后 toast.error()，让用户确认操作结果。',
      'destructive-confirm':
        '使用 window.confirm() 或 Modal.confirm() 弹窗，让用户二次确认再执行删除。',
      // Data-driven patterns from real AI-project issue analysis
      'silent-failure':
        'catch 块必须记录或处理错误，至少 console.error(err)。空的 catch/7 是 AI 生成代码最常见的问题之一 (claudes-c-compiler #260)。',
      'infinite-loading':
        '为所有异步请求添加超时: AbortController + setTimeout，或使用 Promise.race()。AI 项目常忘记超时 (onlook #3097)。',
      'data-corruption':
        'JSON.parse/stringify 必须包裹在 try-catch 中。类型转换应显式: String(id) 而非直接赋值 (claude-task-master #1708)。',
      'missing-input-validation':
        '所有用户输入必须验证。用 zod/yup schema 定义预期结构，不符合则拒绝 (claude-task-master #1696)。',
      'credential-exposure':
        'API Key/Token 必须通过环境变量加载: process.env.XXX。永远不要硬编码在源码中 (claude-task-master #1704)。',
      'state-persistence':
        '加载持久化状态后应验证数据结构完整性，损坏的数据应丢弃或重置为默认值 (cc-switch #3982)。',
      'platform-assumptions':
        '使用 os.homedir()、path.join()、process.platform 替代硬编码路径。假设 POSIX 路径在 Windows 上会崩溃 (onlook #3116)。',
    };
    return map[checkId] || null;
  }

  async scan() {
    const profile = await this._buildProfile();
    this._profileSummary(profile);

    this.reporter.info('正在扫描...');
    const issues = await this._runChecks();
    this.state.setIssues(issues);

    if (issues.length === 0) {
      this.reporter.success('没有发现问题，项目看起来很整洁！');
      return;
    }

    const { critical, important, niceToHave } = this._formatIssuesByPriority(issues);

    this.reporter.header('待处理问题');
    this.reporter.raw(`  共 ${issues.length} 项 · 严重 ${critical.length} · 重要 ${important.length} · 优化 ${niceToHave.length}\n`);

    if (critical.length > 0) {
      this.reporter.subheader(`🔴 必须修复 (${critical.length})`);
      for (const issue of critical) this._issueWithGuidance(issue);
    }
    if (important.length > 0) {
      this.reporter.subheader(`🟡 建议修复 (${important.length})`);
      for (const issue of important) this._issueWithGuidance(issue);
    }
    if (niceToHave.length > 0) {
      this.reporter.subheader(`⚪ 可优化 (${niceToHave.length})`);
      for (const issue of niceToHave) this._issueWithGuidance(issue);
    }

    this.state.nextLoop();
  }

  async list() {
    const issues = this.state.data.issues;
    if (!issues || issues.length === 0) {
      this.reporter.info('暂无问题记录，请先运行 polish scan');
      return;
    }

    const active = issues.filter(i => !i.fixed);
    const fixed = issues.filter(i => i.fixed);
    const { critical, important, niceToHave } = this._formatIssuesByPriority(active);

    this.reporter.subheader(`待处理: ${active.length} (严重 ${critical.length} · 重要 ${important.length} · 优化 ${niceToHave.length})`);

    if (active.length === 0) {
      this.reporter.success('所有问题已修复！');
      return;
    }

    for (const issue of active) this.reporter.issue(issue);

    if (fixed.length > 0) {
      this.reporter.subheader(`已修复 (${fixed.length})`);
      for (const issue of fixed) this.reporter.issue(issue);
    }
  }

  async fixOne(issueId) {
    const issues = this.state.data.issues;
    const issue = issues.find(i => i.id === issueId);
    if (!issue) { this.reporter.error(`未找到: ${issueId}`); return; }
    if (issue.fixed) { this.reporter.warn(`已修复: ${issueId}`); return; }
    if (!issue.fixable) { this.reporter.warn(`需手动修复: ${issueId}`); return; }

    const ok = this.fixer.apply(issue);
    if (ok) { this.state.markFixed(issueId); this.reporter.success(`${issueId}: 已修复`); }
    else { this.reporter.error(`${issueId}: 修复失败`); }
  }

  async fixAll() {
    const issues = this.state.data.issues;
    const fixable = issues.filter(i => !i.fixed && i.fixable);
    if (fixable.length === 0) { this.reporter.info('没有可自动修复的问题'); return; }
    let success = 0;
    for (const issue of fixable) {
      if (this.fixer.apply(issue)) { this.state.markFixed(issue.id); success++; }
    }
    this.reporter.success(`成功修复 ${success}/${fixable.length}`);
    this.state.nextLoop();
  }

  async status() {
    const data = this.state.data;
    const issues = data.issues || [];
    const active = issues.filter(i => !i.fixed);
    const { critical, important, niceToHave } = this._formatIssuesByPriority(active);

    this.reporter.header('打磨进度');

    if (this.profile) {
      this.reporter.raw(`  项目画像:  ${this.profile.type} · ${this.profile.framework || '未知'} · ${this.profile.styling}`);
      if (this.profile.patterns) {
        const marks = [];
        if (this.profile.patterns.hasLoadingStates) marks.push('加载态');
        if (this.profile.patterns.hasEmptyStates) marks.push('空状态');
        if (this.profile.patterns.hasErrorBoundaries) marks.push('错误边界');
        if (this.profile.patterns.hasToasts) marks.push('通知反馈');
        if (this.profile.patterns.usesCssVariables) marks.push('CSS变量');
        if (marks.length > 0) this.reporter.raw(`  已有模式:  ${marks.join(' · ')}`);
      }
    }

    this.reporter.raw(`  Loop 次数:  ${data.currentLoop}`);
    this.reporter.raw(`  待处理:     ${active.length} 项 (严重 ${critical.length} · 重要 ${important.length} · 优化 ${niceToHave.length})\n`);

    if (data.history && data.history.length > 0) {
      this.reporter.subheader('Loop 历史');
      for (const h of data.history) {
        const change = h.fixedIssues > 0 ? `(+${h.fixedIssues})` : '';
        this.reporter.raw(`   第 ${h.loop} 轮: ${h.totalIssues} 项发现 · ${h.fixedIssues} 项修复${change} · 评分 ${h.score}%`);
      }
      this.reporter.raw('');
    }

    // Progress bar based on real progress
    const everTotal = Math.max(data.totalIssues, data.history.flatMap(h => h.totalIssues).reduce((a,b) => Math.max(a,b), data.totalIssues));
    const totalForBar = Math.max(everTotal, 1);
    const fixedCount = data.fixedIssues || 0;
    const pct = Math.round((fixedCount / totalForBar) * 100);
    const barLen = 30;
    const filled = Math.round((pct / 100) * barLen);
    let bar = '';
    for (let i = 0; i < barLen; i++) bar += i < filled ? '█' : '░';
    this.reporter.raw(`  ${bar} ${pct}%`);
  }

  async loop() {
    const maxLoops = this.config.maxLoops;

    for (let loopNum = this.state.data.currentLoop + 1; loopNum <= maxLoops; loopNum++) {
      this.reporter.loopHeader(loopNum);

      // Phase 1: Profile
      this.reporter.info('分析项目特征...');
      const profile = await this._buildProfile();
      this._profileSummary(profile);

      // Phase 2: Scan
      this.reporter.info('扫描中...');
      const issues = await this._runChecks();
      this.state.setIssues(issues);

      if (issues.length === 0) {
        this.reporter.success('✨ 项目已达到完美状态！');
        return;
      }

      const { critical, important, niceToHave } = this._formatIssuesByPriority(issues);
      this.reporter.raw(`\n  共 ${issues.length} 项 · 严重 ${critical.length} · 重要 ${important.length} · 优化 ${niceToHave.length}\n`);

      if (critical.length > 0) {
        this.reporter.subheader(`🔴 必须修复 (${critical.length})`);
        for (const issue of critical) this._issueWithGuidance(issue);
      }
      if (important.length > 0) {
        this.reporter.subheader(`🟡 建议修复 (${important.length})`);
        for (const issue of important) this._issueWithGuidance(issue);
      }
      if (niceToHave.length > 0) {
        this.reporter.subheader(`⚪ 可优化 (${niceToHave.length})`);
        for (const issue of niceToHave) this._issueWithGuidance(issue);
      }

      const prevFixed = this.state.data.fixedIssues;
      this.state.nextLoop();
      const newFixed = this.state.data.fixedIssues;
      const delta = newFixed - prevFixed;

      if (delta > 0) {
        this.reporter.success(`本轮修复 ${delta} 项，累计修复 ${newFixed}/${this.state.data.totalIssues}`);
      } else if (critical.length > 0) {
        this.reporter.raw(`  ${CYAN}仍有 ${critical.length} 个严重问题需手动处理。修复思路已提供，请逐项排查。${RESET}`);
      }

      if (critical.length === 0 && important.length === 0) {
        const allFixed = issues.filter(i => !i.fixed).filter(i => (i.impact || 0) >= 60).length === 0;
        if (allFixed) {
          this.reporter.success('🎉 所有严重和重要问题已处理，打磨完成！');
          return;
        }
      }

      // Auto-stop: if auto mode and nothing changed in this round, stop
      const madeProgress = delta > 0;
      if (!madeProgress && this.auto && loopNum >= 2) {
        if (critical.length <= 1) {
          this.reporter.info('无新变化，自动结束打磨。手动处理后可重新运行。');
          return;
        }
      }

      if (loopNum < maxLoops) {
        if (this.auto) {
          if (critical.length > 0 || important.length > 0) {
            this.reporter.info(`自动模式 — 继续第 ${loopNum + 1} 轮`);
            continue;
          }
          return;
        }
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(res => {
          rl.question('\n  按 Enter 继续下一轮 (a 接受建议并标记, q 退出, s 状态): ', a => { rl.close(); res(a.toLowerCase()); });
        });
        if (answer === 'q') { this.reporter.info('已退出'); return; }
        if (answer === 's') { await this.status(); }
        if (answer === 'a') {
          for (const issue of critical) this.state.markFixed(issue.id);
          for (const issue of important) this.state.markFixed(issue.id);
          this.reporter.success(`已标记 ${critical.length + important.length} 项为"已接受"，继续下一轮`);
        }
      }
    }
    this.reporter.warn(`已达到最大循环次数 (${maxLoops})`);
  }
}
