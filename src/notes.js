/* 笔记 / 提纲的 Markdown 子集渲染（v53）。
 *
 * 设计取舍：
 *   · **纯函数返回 HTML 字符串** —— 能在 Node 里单测，安全性也更容易验证
 *   · **先转义、再套标签**：正文里写 <script>、onerror=、javascript: 都只会变成字面文字 ✓
 *   · 只支持这份提纲真正用到的子集：标题/分隔线/引用/代码块/表格/圆点/有序/粗细斜/行内代码
 *   · 表格外面包一层 .md-table（手机屏放不下三列表格，交给它横向滚动 ✓ 不让整页横滚 ✗）
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 行内标记。传入的是**原始**文本，内部负责先转义。 */
function inline(raw) {
  let t = esc(raw);
  // 行内代码最先（里面的 * 不该被当成粗体）
  t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // 斜体：避免把 ** 的残余、列表符号当成斜体
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d+[.)]\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** 从第 i 行开始是不是一张表（要有表头行 + 分隔行） */
function isTableAt(lines, i) {
  if (i + 1 >= lines.length) return false;
  if (!lines[i].includes('|')) return false;
  return RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-');
}

export function mdToHtml(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  /** 把连续的普通行收成一个段落 */
  const flushParagraph = (buf) => {
    const text = buf.join('\n').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    buf.length = 0;
  };

  let para = [];
  // 防呆：主循环最多跑「行数×8 + 64」轮。任何分支一旦忘了推进 i，
  // 这里会立刻抛错而不是静默死循环（真踩过：三个分支漏了 i++ → 测试吃到 OOM ✗）
  let guard = 0;
  const guardMax = lines.length * 8 + 64;
  while (i < lines.length) {
    if (++guard > guardMax) throw new Error('mdToHtml: 主循环疑似死循环（某分支漏了推进 i）');
    const line = lines[i];

    // ---- 代码块（优先级最高：里面的内容一个都不解析）
    if (/^\s*```/.test(line)) {
      flushParagraph(para);
      i++;
      const body = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // 跳过结束的 ```
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // ---- 空行：段落断点
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    // ---- 表格（要在分隔线判断之前，因为 `---` 和表格分隔行长得像）
    if (isTableAt(lines, i)) {
      flushParagraph(para);
      const head = splitRow(lines[i]);
      i += 2; // 表头 + 分隔行
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      out.push(`<div class="md-table"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // ---- 分隔线
    if (RE_HR.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i++;
      continue;
    }

    // ---- 标题
    const h = RE_HEADING.exec(line);
    if (h) {
      flushParagraph(para);
      const level = Math.min(h[1].length, 4); // 只到 h4（更深的层级在手机上没意义）
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // ---- 引用（连续多行合成一段）
    if (RE_QUOTE.test(line)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(RE_QUOTE.exec(lines[i])[1]);
        i++; // ⚠️ 别忘推进（第一版漏了这里 → 静默死循环 → 测试 OOM ✗）
      }
      out.push(`<blockquote>${inline(buf.join('\n').trim())}</blockquote>`);
      continue;
    }

    // ---- 有序列表（先判，否则 `1. x` 会被圆点规则吃掉）
    if (RE_OL.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        items.push(inline(RE_OL.exec(lines[i])[1]));
        i++;
      }
      out.push(`<ol>${items.map((t) => `<li>${t}</li>`).join('')}</ol>`);
      continue;
    }

    // ---- 圆点列表
    if (RE_UL.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        items.push(inline(RE_UL.exec(lines[i])[1]));
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`);
      continue;
    }

    // ---- 普通行：攒成段落
    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out.join('');
}
