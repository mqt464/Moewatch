import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscussionBody } from './DiscussionBody';
const render = (text: string) => renderToStaticMarkup(createElement(DiscussionBody, { text }));
test('renders emphasis, quotes, lists, code, tables, and strikethrough', () => {
  const html = render('__bold__ and *italic* and ~~removed~~\n\n> quoted\n\n- first\n- second\n\n`code`\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  for (const expected of ['<strong>bold</strong>', '<em>italic</em>', '<del>removed</del>', '<blockquote>', '<ul>', '<code>code</code>', '<table>']) assert.ok(html.includes(expected), expected);
});
test('renders AniList and Markdown images, keeps spoilers hidden, and leaves code intact', () => {
  const html = render('img320(http://example.com/a.jpg)\n\n![Scene](https://example.com/b.png)\n\n~!__spoiler__!~');
  assert.match(html, /src="https:\/\/example.com\/a.jpg"/);
  assert.match(html, /alt="Scene"/);
  assert.match(html, /<details class="discussion-spoiler"><summary>Spoiler<\/summary>/);
  assert.match(html, /<strong>spoiler<\/strong>/);
  assert.doesNotMatch(render('`img320(https://example.com/code.png)`'), /<img/);
});
test('untrusted Markdown cannot execute HTML or unsafe URLs', () => {
  const html = render('<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n![bad](data:text/html,bad)');
  assert.doesNotMatch(html, /<script|href="javascript:|src="data:/);
});
test('discussion sources contain no replacement characters', () => {
  for (const file of ['Discussions.tsx', 'DiscussionBody.tsx', 'discussionContent.ts', 'discussions.css']) assert.ok(!readFileSync(new URL(file, import.meta.url), 'utf8').includes('\uFFFD'), file);
});
