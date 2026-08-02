const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function readAttr(attrs, name) {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 's'))?.[2] || '';
}

function hasClass(attrs, className) {
  return readAttr(attrs, 'class').split(/\s+/).includes(className);
}

function collectDataRows(html) {
  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)>|<!--[\s\S]*?-->/g;
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  const stack = [];
  const rows = [];

  for (const match of html.matchAll(tagRe)) {
    const raw = match[0];
    if (raw.startsWith('<!--')) continue;

    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    if (raw.startsWith('</')) {
      while (stack.length) {
        const node = stack.pop();
        if (node.tag === tag) {
          if (node.isDataRow) rows.push(node);
          break;
        }
      }
      continue;
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push({
        tag,
        id: readAttr(attrs, 'id'),
        className: readAttr(attrs, 'class'),
      });
    }

    if (!raw.endsWith('/>') && !voidTags.has(tag)) {
      stack.push({
        tag,
        attrs,
        line: lineOf(html, match.index),
        id: readAttr(attrs, 'id'),
        className: readAttr(attrs, 'class'),
        children: [],
        isDataRow: hasClass(attrs, 'data-row'),
      });
    }
  }

  return rows;
}

function readCssRuleBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);

  const blockStart = css.indexOf('{', start);
  const blockEnd = css.indexOf('}', blockStart);
  assert.notEqual(blockEnd, -1, `missing CSS block end: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

test('sidepanel data rows use a single control area after the label', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const rows = collectDataRows(html);
  const offenders = rows.filter((row) => row.children.length > 2);

  assert.ok(rows.length > 0);
  assert.deepEqual(
    offenders.map((row) => ({
      line: row.line,
      id: row.id,
      className: row.className,
      children: row.children,
    })),
    []
  );
});

test('sidepanel form controls share one width system', () => {
  const css = fs.readFileSync('sidepanel/sidepanel.css', 'utf8');
  const dataLabelBlock = readCssRuleBlock(css, '.data-label');

  assert.match(css, /--data-label-width:\s*76px;/);
  assert.match(css, /--data-field-height:\s*34px;/);
  assert.match(css, /\.data-label\s*\{[\s\S]*flex:\s*0 0 var\(--data-label-width\);/);
  assert.match(css, /\.data-inline\s*\{[\s\S]*flex:\s*1 1 0;/);
  assert.match(css, /\.data-inline > \.data-input,[\s\S]*\.data-inline > \.input-with-icon\s*\{[\s\S]*flex:\s*1 1 0;/);
  assert.match(css, /\.btn\s*\{[\s\S]*min-height:\s*var\(--data-field-height\);[\s\S]*border:\s*1px solid var\(--border\);/);
  assert.match(css, /\.data-input\s*\{[\s\S]*min-height:\s*var\(--data-field-height\);/);
  assert.match(css, /\.data-select\s*\{[\s\S]*min-height:\s*var\(--data-field-height\);/);
  assert.match(css, /\.data-inline-btn\s*\{[\s\S]*min-width:\s*var\(--data-inline-action-min-width\);/);
  assert.match(css, /\.data-inline-btn\s*\{[\s\S]*min-height:\s*var\(--data-field-height\);/);
  assert.doesNotMatch(dataLabelBlock, /width:\s*56px;/);
  assert.doesNotMatch(css, /icon-action-btn/);
});
