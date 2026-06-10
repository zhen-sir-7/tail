const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';

const SEVERITY_COLORS = {
  critical: RED,
  high: YELLOW,
  medium: BLUE,
  low: DIM,
};

const CATEGORY_ICONS = {
  'ui-ux': '🎨',
  'code-quality': '🔧',
  'workflow': '🔄',
};

const SEVERITY_ICONS = {
  critical: '🔴',
  high: '🟡',
  medium: '🔵',
  low: '⚪',
};

export class Reporter {
  constructor({ silent = false } = {}) {
    this.silent = silent;
  }

  _out(msg) {
    if (!this.silent) console.log(msg);
  }

  _color(severity) {
    return SEVERITY_COLORS[severity] || WHITE;
  }

  _icon(category) {
    return CATEGORY_ICONS[category] || '•';
  }

  _severityIcon(s) {
    return SEVERITY_ICONS[s] || '•';
  }

  header(text) {
    this._out(`\n  ${BOLD}${CYAN}═══ ${text} ${RESET}${BOLD}${CYAN}${'═'.repeat(Math.max(0, 50 - text.length - 4))}${RESET}\n`);
  }

  subheader(text) {
    this._out(`  ${BOLD}${WHITE}▸ ${text}${RESET}`);
  }

  issue(issue) {
    const color = this._color(issue.severity);
    const icon = this._icon(issue.category);
    const sIcon = this._severityIcon(issue.severity);
    const status = issue.fixed
      ? `${GREEN}✓ 已修复${RESET}`
      : `${YELLOW}✗ 待处理${RESET}`;
    this._out(`  ${icon} ${BOLD}${issue.id}${RESET} ${status}`);
    this._out(`    ${sIcon} ${color}${issue.title}${RESET}`);
    if (issue.description) {
      this._out(`    ${DIM}${issue.description}${RESET}`);
    }
    this._out(`    ${DIM}文件: ${issue.file}:${issue.line} | 类别: ${issue.category} | 严重度: ${issue.severity}${RESET}`);
    if (issue.fixable) {
      this._out(`    ${GREEN}⚡ 可自动修复${RESET}`);
    }
    this._out('');
  }

  scanSummary(results) {
    const total = results.length;
    const fixed = results.filter(r => r.fixed).length;
    const bySeverity = {};
    const byCategory = {};

    for (const r of results) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    }

    this.header('扫描结果');
    this._out(`  ${BOLD}发现 ${total} 个待优化项，已修复 ${fixed} 个${RESET}\n`);

    this.subheader('按严重度');
    for (const [sev, count] of Object.entries(bySeverity)) {
      const color = this._color(sev);
      this._out(`    ${this._severityIcon(sev)} ${color}${sev}: ${count}${RESET}`);
    }

    this._out('');
    this.subheader('按类别');
    for (const [cat, count] of Object.entries(byCategory)) {
      this._out(`    ${this._icon(cat)} ${cat}: ${count}`);
    }

    this._out('');
  }

  scoreboard(data) {
    const { score, totalIssues, fixedIssues, currentLoop } = data;

    let bar = '';
    const barLen = 30;
    const filled = Math.round((score / 100) * barLen);
    for (let i = 0; i < barLen; i++) {
      bar += i < filled ? '█' : '░';
    }

    let scoreColor;
    if (score >= 80) scoreColor = BG_GREEN;
    else if (score >= 50) scoreColor = BG_YELLOW;
    else scoreColor = BG_RED;

    this.header('打磨进度');

    this._out(`  ${BOLD}Loop 次数${RESET}:    ${currentLoop}`);
    this._out(`  ${BOLD}打磨评分${RESET}:    ${scoreColor} ${String(score).padStart(3)}% ${RESET}`);
    this._out(`                  ${scoreColor === BG_GREEN ? GREEN : scoreColor === BG_YELLOW ? YELLOW : RED}${bar}${RESET}`);
    this._out(`  ${BOLD}已修复${RESET}:      ${GREEN}${fixedIssues}${RESET} / ${totalIssues}`);
    this._out(`  ${BOLD}待修复${RESET}:      ${YELLOW}${totalIssues - fixedIssues}${RESET}\n`);
  }

  progress(percent, label) {
    const barLen = 20;
    const filled = Math.round((percent / 100) * barLen);
    let bar = '';
    for (let i = 0; i < barLen; i++) {
      bar += i < filled ? '█' : '░';
    }
    this._out(`  ${BLUE}${bar}${RESET} ${BOLD}${percent}%${RESET} ${DIM}${label}${RESET}`);
  }

  loopHeader(loopNum) {
    this._out(`\n  ${BOLD}${MAGENTA}━━━ 打磨循环 #${loopNum} ━━━${RESET}\n`);
  }

  success(msg) {
    this._out(`  ${GREEN}✓ ${msg}${RESET}`);
  }

  warn(msg) {
    this._out(`  ${YELLOW}⚠ ${msg}${RESET}`);
  }

  info(msg) {
    this._out(`  ${BLUE}ℹ ${msg}${RESET}`);
  }

  error(msg) {
    this._out(`  ${RED}✗ ${msg}${RESET}`);
  }

  raw(text) {
    this._out(text);
  }
}
