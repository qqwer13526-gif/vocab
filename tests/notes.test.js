/* 笔记渲染器（v53）：把 Markdown 子集转成安全的 HTML 字符串。
 *
 * 为什么是"字符串 + 纯函数"而不是直接操作 DOM：
 *   ① 能在 Node 里测（不依赖浏览器）
 *   ② 安全性更好验证 —— 先把**所有**文本转义，再拼自己生成的标签，
 *      所以正文里写 <script> / onerror= 之类都只会变成字面文字 ✓
 *
 * 支持的子集（够用你那份提纲）：# ## ### #### 标题、--- 分隔线、> 引用、
 * ``` 代码块、表格、- 圆点、1. 有序、**粗**、*斜*、`行内代码`、空行分段
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mdToHtml } from '../src/notes.js';

test('标题：一到四级，越级也不报错', () => {
  assert.equal(mdToHtml('# 大标题'), '<h1>大标题</h1>');
  assert.equal(mdToHtml('## 二级'), '<h2>二级</h2>');
  assert.equal(mdToHtml('#### 四级'), '<h4>四级</h4>');
});

test('分隔线与引用', () => {
  assert.equal(mdToHtml('---'), '<hr>');
  assert.equal(mdToHtml('> 适用：校报投稿'), '<blockquote>适用：校报投稿</blockquote>');
});

test('圆点与有序列表各自成组，混排不串', () => {
  assert.equal(mdToHtml('- 甲\n- 乙'), '<ul><li>甲</li><li>乙</li></ul>');
  assert.equal(mdToHtml('1. 甲\n2. 乙'), '<ol><li>甲</li><li>乙</li></ol>');
  assert.equal(
    mdToHtml('- 甲\n1. 乙'),
    '<ul><li>甲</li></ul><ol><li>乙</li></ol>',
    '有序和无序要分成两个列表'
  );
});

test('行内：粗体、斜体、行内代码（可以套在标题和列表里）', () => {
  assert.equal(mdToHtml('**很粗**'), '<p><strong>很粗</strong></p>');
  assert.equal(mdToHtml('*有点斜*'), '<p><em>有点斜</em></p>');
  assert.equal(mdToHtml('用 `touch-action` 管手势'), '<p>用 <code>touch-action</code> 管手势</p>');
  assert.equal(mdToHtml('## **带粗体的标题**'), '<h2><strong>带粗体的标题</strong></h2>');
});

test('代码块：保留换行与缩进，且不参与行内解析', () => {
  const src = '```\nP1  引入\n  P2 **不该变粗**\n```';
  assert.equal(mdToHtml(src), '<pre><code>P1  引入\n  P2 **不该变粗**</code></pre>');
});

test('表格：表头 + 分隔行 + 表体', () => {
  const src = '| 问 | 答案 |\n|---|---|\n| 题眼 | future |\n| 场景 | campus |';
  assert.equal(
    mdToHtml(src),
    '<div class="md-table"><table><thead><tr><th>问</th><th>答案</th></tr></thead>' +
      '<tbody><tr><td>题眼</td><td>future</td></tr><tr><td>场景</td><td>campus</td></tr></tbody></table></div>',
    '表格外面要包一层可横向滚动的容器（手机屏放不下三列表格 ✗）'
  );
});

test('空行分段；连续多行合成一个段落', () => {
  assert.equal(mdToHtml('第一段\n第二行\n\n第二段'), '<p>第一段\n第二行</p><p>第二段</p>');
});

test('安全性：正文里的一切都转义，标签不会被执行', () => {
  const out = mdToHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script'), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
});

test('安全性：正文里的标签只会变成文字，不会生成图片/链接/属性', () => {
  const out = mdToHtml('![x](javascript:alert(1)) <img src=x onerror=alert(1)> <a href="x">y</a>');
  assert.ok(out.includes('&lt;img'), '尖括号要转义：' + out);
  assert.ok(!out.includes('<img'), out);
  assert.ok(!out.includes('href="'), 'href 必须被转义成 &quot;（不能形成真属性）：' + out);
  assert.ok(!out.includes('<a '), out);
});

test('整份提纲不炸：标题、表格、代码块、引用混在一起', () => {
  const src = [
    '# 机器人进校园',
    '',
    '> 适用：校报投稿',
    '',
    '---',
    '',
    '## 0. 审题三问',
    '',
    '| 问 | 答案 |',
    '|---|---|',
    '| 题眼 | future |',
    '',
    '```',
    'P1 引入',
    'P2 论证',
    '```',
    '',
    '- **★ 必加**：未来一句',
    '- 连接词：To begin with'
  ].join('\n');
  const out = mdToHtml(src);
  for (const piece of ['<h1>', '<blockquote>', '<hr>', '<h2>', '<div class="md-table">', '<pre><code>', '<ul>', '<strong>']) {
    assert.ok(out.includes(piece), `缺少 ${piece}`);
  }
  assert.ok(!out.includes('<p></p>'), '不该产出空段落');
});
