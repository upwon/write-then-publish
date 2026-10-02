const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(`${__dirname}/../src/app.js`, 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
const context = vm.createContext({ FONT_STACKS: {}, CARD_BODY_FONT_WEIGHT: 400, roundedRect() {}, drawUnderlineRun() {} });
vm.runInContext([
  'applyInlineStyle', 'findMatchingMarkerClose', 'matchInlineMarker',
  'matchUnderlineMarker', 'matchInlineCodeSpan', 'findInlineEmphasisClose', 'parseInline', 'escapeHtml', 'escapeAttribute',
  'renderArticleInline', 'renderArticleInlineTokens',
  'fontString', 'fontFamilyForText', 'glyphWidth', 'tokenLetterSpacing', 'drawTextLine',
].map(extract).join('\n'), context);
const plain = (text) => context.parseInline(text).map(t => t.text || '').join('');
test('card tokens remove inline-code delimiters and retain source offsets', () => {
  const input = '按下 `Cmd+Shift+4` 截图';
  assert.equal(plain(input), '按下 Cmd+Shift+4 截图');
  const code = context.parseInline(input).find(t => t.code);
  assert.equal(code.text, 'Cmd+Shift+4');
  assert.equal(input.slice(code.sourceStart, code.sourceEnd), code.text);
});
test('code content stays literal, including Markdown and HTML', () => {
  assert.equal(context.renderArticleInline('`**bold** <img>`'), '<code>**bold** &lt;img&gt;</code>');
});
test('matching backtick runs allow embedded backticks', () => {
  assert.equal(plain('``a`b``'), 'a`b');
  assert.equal(context.renderArticleInline('``a`b``'), '<code>a`b</code>');
});
test('unmatched delimiters stay visible', () => {
  assert.equal(plain('a `unfinished'), 'a `unfinished');
  assert.equal(plain('``a`'), '``a`');
});
test('existing bold and links still render with inline code', () => {
  const tokens = context.parseInline('**快捷键** [按 `Cmd`](https://example.com)');
  assert.equal(tokens[0].bold, true);
  assert.equal(tokens.filter(t => t.link).map(t => t.text).join(''), '按 Cmd');
  assert.equal(tokens.find(t => t.code).link, 'https://example.com');
  assert.match(context.renderArticleInlineTokens(tokens), /<code>Cmd<\/code>/);
});
test('canvas preview/export draw code with monospace and a background', () => {
  const texts = [];
  const fonts = [];
  let fills = 0;
  const ctx = { measureText: t => ({ width: t.length * 10 }), fill: () => fills++, fillText(t) { texts.push(t); fonts.push(this.font); } };
  const line = context.parseInline('按 `Cmd+Shift+4` 截图');
  context.drawTextLine(ctx, { line, style: { size: 24, weight: 400, color: '#111' }, x: 0, y: 0, lineHeight: 36 }, {});
  assert.equal(texts.join(''), '按 Cmd+Shift+4 截图');
  assert.match(fonts[1], /monospace/);
  assert.equal(fills, 1);
});
test('code padding trims one space and preserves internal spacing', () => {
  assert.equal(plain('`` a  b ``'), 'a  b');
  assert.equal(plain('`   `'), '   ');
});
test('emphasis delimiters inside code do not close outer emphasis', () => {
  assert.equal(context.renderArticleInline('**`a**b`**'), '<strong><code>a**b</code></strong>');
  assert.equal(context.renderArticleInline('*foo`*`'), '*foo<code>*</code>');
});
