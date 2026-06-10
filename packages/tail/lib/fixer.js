import { readFileSync, writeFileSync } from 'fs';

export class Fixer {
  constructor(reporter) {
    this.reporter = reporter;
  }

  fix(issue, fileContent) {
    const { checkId, file, line } = issue;
    const handler = this._handlers[checkId];
    if (!handler) return null;
    return handler(fileContent, line, issue);
  }

  get _handlers() {
    return {
      'img-without-alt': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        const imgRegex = /<img\s/;
        if (imgRegex.test(lines[lineIdx])) {
          lines[lineIdx] = lines[lineIdx].replace(
            /<img\s/,
            '<img alt="" '
          );
          return lines.join('\n');
        }
        return null;
      },

      'missing-meta-viewport': (content) => {
        return content.replace(
          '</head>',
          '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n</head>'
        );
      },

      'console-log': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        const original = lines[lineIdx];
        const trimmed = original.trim();
        // Only fix single-line console.log (not multi-line template strings)
        if (/^console\.(log|debug|info)\([^)]*\);?$/.test(trimmed) && /^console\.(log|debug|info)\(/.test(trimmed)) {
          lines[lineIdx] = original.replace(trimmed, `// ${trimmed}`);
          return lines.join('\n');
        }
        return null;
      },

      'empty-catch': (content, line) => {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i >= line - 1 && /catch\s*\(/.test(lines[i])) {
            const nextLine = lines[i + 1];
            if (nextLine && /^\s*\{\s*\}\s*$/.test(nextLine)) {
              lines[i + 1] = nextLine.replace(
                /\{\s*\}/,
                '{ /* TODO: handle error */ }'
              );
              return lines.join('\n');
            }
          }
        }
        return null;
      },

      'button-without-type': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        const match = lines[lineIdx].match(/(<button\s)([^>]*)(>)/);
        if (match && !lines[lineIdx].includes('type=')) {
          lines[lineIdx] = lines[lineIdx].replace(
            /<button\s/,
            '<button type="button" '
          );
          return lines.join('\n');
        }
        return null;
      },

      'href-void': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        if (/href\s*=\s*["']#["']/.test(lines[lineIdx]) ||
            /href\s*=\s*["']javascript:void\(0\)["']/.test(lines[lineIdx])) {
          lines[lineIdx] = lines[lineIdx].replace(
            /href\s*=\s*["'](?:#|javascript:void\(0\))["']/,
            'role="button" tabindex="0"'
          );
          return lines.join('\n');
        }
        return null;
      },

      'todo-comment': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        if (/\/\/\s*(TODO|FIXME|HACK)/.test(lines[lineIdx])) {
          lines[lineIdx] = lines[lineIdx].replace(
            /(\/\/\s*(TODO|FIXME|HACK).*)/,
            '$1 — (需处理)'
          );
          return lines.join('\n');
        }
        return null;
      },

      'magic-color': (content, line) => {
        const lines = content.split('\n');
        const lineIdx = line - 1;
        const colorMatch = lines[lineIdx].match(/(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/);
        if (colorMatch) {
          this.reporter.warn(`第 ${line} 行发现硬编码颜色 ${colorMatch[1]}，建议提取为 CSS 变量`);
        }
        return null;
      },
    };
  }

  apply(issue) {
    try {
      const content = readFileSync(issue.file, 'utf-8');
      const result = this.fix(issue, content);
      if (result) {
        writeFileSync(issue.file, result, 'utf-8');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
