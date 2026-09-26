/* 界面 C：导入
 *
 * 主路径是"从 Excel 复制两列 → 粘进来"。真实词表的前三行是标题/统计/空行、
 * 表头在第 4 行、释义是英汉混排——这些都由 parse.js 处理，这里只管界面：
 *   粘贴/选文件 → 自动认列（可以手动改）→ 预览前 5 行 → 勾词库 → 预览统计 → 导入
 */

import { $, el } from './app.js';
import { all, applyImport, put } from './db.js';
import { guessColumns, parseTable, planImport, rowsToWords } from './parse.js';
import { fillPhonetics, loadDict } from './phonetic.js';
import { PALETTE, loadAll, nextLibOrder } from './store.js';
import { readXlsx, rowsToTsv } from './xlsx.js';

const PREVIEW_ROWS = 5;

/** 文本解码：优先 UTF-8；出现替换字符就按 GBK 再来一次（Excel 老式 CSV 是 GBK） */
function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gbk').decode(bytes);
  } catch {
    return utf8;
  }
}

const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

export async function renderImport() {
  const view = $('#view-import');
  if (!view) return;

  let data = await loadAll();
  const s = {
    rows: [],
    delim: '\t',
    cols: { termCol: 0, meanCol: 1, posCol: -1, exampleCol: -1, headerRow: -1 },
    source: '',
    items: [],
    plan: { create: [], merge: [], skip: 0 },
    mode: 'skip',
    libIds: new Set(),
    existing: data.words
  };

  // ---------------------------------------------------------------- 骨架
  const ta = el('textarea', {
    className: 'import-text',
    dataset: { testid: 'import-text' },
    rows: '6',
    spellcheck: 'false',
    'aria-label': '粘贴词表（单词和释义两列）',
    placeholder: '在 Excel 里选中单词和释义两列，Ctrl+C，粘到这里'
  });
  const file = el('input', {
    type: 'file',
    dataset: { testid: 'import-file' },
    // 把能读的格式都列进来，别让 iOS 把它们置灰点不动；
    // 读不了的（.xls/.ods）也放进来，选了我们给明确提示，而不是让系统默默禁用
    accept: '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,text/plain,text/csv',
    'aria-label': '选择词表文件',
    hidden: true
  });
  const fileBtn = el('button', { className: 'ghost', type: 'button', onclick: () => file.click() }, '选择文件…');
  const fileHint = el('div', { className: 'file-hint', dataset: { testid: 'file-hint' } },
    '支持 .csv / .tsv / .txt，以及 Excel 的 .xlsx（直接选就行，应用自己会读）。老式的 .xls 请先「另存为 .xlsx」；也可以直接在 Excel 里选中单词和释义两列复制，粘到上面的框里。');
  const hint = el('div', { className: 'import-hint', dataset: { testid: 'import-hint' } },
    '在 Excel 里选中「单词」和「释义」两列 → Ctrl+C → 粘到上面的框里；也可以直接选 .csv / .tsv 文件。前三行的标题、统计、空行会自动跳过，表头和列会自动识别。');

  const stats = el('div', { className: 'import-stats', dataset: { testid: 'import-stats' } }, '');
  const result = el('div', { className: 'import-result', dataset: { testid: 'import-result' } });

  // 列选择
  const mkSelect = (testid, withNone, label) => {
    const sel = el('select', { className: 'col-select', dataset: { testid }, 'aria-label': label });
    if (withNone) sel.append(el('option', { value: '-1' }, '不用'));
    sel.addEventListener('change', () => {
      const key = testid === 'sel-term' ? 'termCol' : testid === 'sel-mean' ? 'meanCol' : testid === 'sel-pos' ? 'posCol' : 'exampleCol';
      s.cols[key] = Number(sel.value);
      recomputeItems();
    });
    return sel;
  };
  const selTerm = mkSelect('sel-term', false, '单词在哪一列');
  const selMean = mkSelect('sel-mean', false, '释义在哪一列');
  const selPos = mkSelect('sel-pos', true, '词性在哪一列');
  const selExample = mkSelect('sel-example', true, '例句或搭配在哪一列');

  const preview = el('table', { className: 'import-preview', dataset: { testid: 'import-preview' } }, [
    el('colgroup', {}),
    el('thead', {}, el('tr', {})),
    el('tbody', {})
  ]);

  const libBox = el('div', { className: 'lib-checks', dataset: { testid: 'lib-checks' } });
  const newLibForm = el('form', { className: 'card newlib-form', dataset: { testid: 'import-newlib-form' }, hidden: true }, [
    el('input', { name: 'name', type: 'text', placeholder: '新词库名字', maxlength: '40', 'aria-label': '新词库名字' }),
    el('div', { className: 'row-2' }, [
      el('button', { className: 'ghost', type: 'button', onclick: () => { newLibForm.hidden = true; } }, '取消'),
      el('button', { className: 'primary', type: 'submit' }, '创建')
    ])
  ]);
  newLibForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newLibForm.querySelector('input[name="name"]').value.trim();
    if (!name) return;
    const now = Date.now();
    const lib = { id: crypto.randomUUID(), name, color: PALETTE[data.libs.length % PALETTE.length], order: nextLibOrder(data.libs), createdAt: now, updatedAt: now };
    await put('libs', lib);
    data = await loadAll();
    s.libIds.add(lib.id);
    newLibForm.hidden = true;
    newLibForm.querySelector('input[name="name"]').value = '';
    renderLibs();
  });

  const dupWrap = el('div', { className: 'dup-modes', dataset: { testid: 'dup-mode' } }, [
    el('label', {}, [el('input', { type: 'radio', name: 'dup', dataset: { testid: 'dup-skip' }, value: 'skip', checked: true, onchange: () => { s.mode = 'skip'; recomputeItems(); } }), ' 跳过已存在的']),
    el('label', {}, [el('input', { type: 'radio', name: 'dup', dataset: { testid: 'dup-merge' }, value: 'merge', onchange: () => { s.mode = 'merge'; recomputeItems(); } }), ' 合并释义'])
  ]);

  const importBtn = el('button', { className: 'primary', dataset: { testid: 'btn-import' }, type: 'button', onclick: () => doImport() }, '导入');
  const newLibBtn = el('button', { className: 'ghost', dataset: { testid: 'btn-import-newlib' }, type: 'button', onclick: () => { newLibForm.hidden = !newLibForm.hidden; } }, '新建词库');

  const work = el('div', { className: 'import-work', hidden: true }, [
    el('div', { className: 'card import-map' }, [
      el('div', { className: 'field-label' }, '哪一列是单词 / 释义'),
      el('div', { className: 'map-row' }, [el('span', {}, '单词'), selTerm]),
      el('div', { className: 'map-row' }, [el('span', {}, '释义'), selMean]),
      el('div', { className: 'map-row' }, [el('span', {}, '词性'), selPos]),
      el('div', { className: 'map-row' }, [el('span', {}, '例句/搭配'), selExample])
    ]),
    el('div', { className: 'card' }, [el('div', { className: 'field-label' }, '预览（前 5 行）'), preview]),
    el('div', { className: 'card import-target' }, [
      el('div', { className: 'field-label' }, '放进哪个词库（可以多选）'),
      libBox,
      newLibBtn,
      newLibForm,
      el('div', { className: 'field-label' }, '遇到已经有的词'),
      dupWrap
    ]),
    el('div', { className: 'import-actions' }, [stats, importBtn, result])
  ]);

  view.replaceChildren(
    el('h2', { className: 'page-title' }, '导入词表'),
    el('div', { className: 'card' }, [
      ta,
      el('div', { className: 'row-2' }, [fileBtn, el('span', { className: 'file-name', dataset: { testid: 'file-name' } }, '')]),
      file,
      fileHint,
      hint
    ]),
    work
  );

  // ---------------------------------------------------------------- 渲染片段
  function renderLibs() {
    libBox.replaceChildren(
      ...data.libs.map((lib) =>
        el('label', { className: 'lib-check-label' }, [
          el('input', {
            type: 'checkbox',
            dataset: { testid: 'lib-check' },
            value: lib.id,
            checked: s.libIds.has(lib.id),
            onchange: (e) => {
              if (e.currentTarget.checked) s.libIds.add(lib.id);
              else s.libIds.delete(lib.id);
            }
          }),
          el('span', { className: 'lib-check-dot', style: { background: lib.color || PALETTE[0] } }),
          lib.name
        ])
      )
    );
  }

  function colOptions(sel, width, rows, value, withNone) {
    const keep = sel.value;
    sel.replaceChildren();
    if (withNone) sel.append(el('option', { value: '-1' }, '不用'));
    for (let i = 0; i < width; i++) {
      const sample = rows.map((r) => r[i]).find((v) => String(v ?? '').trim());
      sel.append(el('option', { value: String(i) }, `第 ${i + 1} 列${sample ? ` · ${truncate(sample, 10)}` : ''}`));
    }
    sel.value = String(value);
    if (sel.value !== String(value) && keep) sel.value = keep;
  }

  function renderPreview() {
    // 只显示真正用到的列（原始表可能有"序号""背诵确认"这种用不上的列，全塞进来会挤成一团）
    const cols = [
      ['单词', s.cols.termCol],
      ['释义', s.cols.meanCol],
      ['词性', s.cols.posCol],
      ['例句/搭配', s.cols.exampleCol]
    ].filter(([, i]) => i >= 0);

    const thead = preview.querySelector('thead tr');
    thead.replaceChildren(...cols.map(([label]) => el('th', {}, label)));
    preview.querySelector('colgroup').replaceChildren(
      ...cols.map(([label]) => el('col', { className: label === '单词' ? 'w-term' : label === '释义' ? 'w-mean' : 'w-small' }))
    );

    const body = preview.querySelector('tbody');
    const dataRows = s.rows.slice(s.cols.headerRow + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
    body.replaceChildren(
      ...dataRows.slice(0, PREVIEW_ROWS).map((r) =>
        el('tr', {}, cols.map(([label, i]) => el('td', { className: label === '单词' ? 'is-term' : '' }, el('div', { className: 'clamp' }, r[i] ?? ''))))
      )
    );
  }

  function renderStats() {
    stats.textContent = `新词 ${s.plan.create.length} · 已存在 ${s.plan.merge.length + s.plan.skip}`;
    importBtn.textContent = s.plan.create.length ? `导入 ${s.plan.create.length} 个新词` : '导入';
  }

  function computeItems() {
    s.items = rowsToWords(s.rows, s.cols);
    s.plan = planImport(s.items, s.existing, s.mode);
    renderPreview();
    renderStats();
  }

  function recompute() {
    const text = ta.value;
    if (!text.trim()) {
      work.hidden = true;
      hint.hidden = false;
      result.textContent = '';
      return;
    }
    const { rows, delim } = parseTable(text);
    s.rows = rows;
    s.delim = delim;
    const g = guessColumns(rows);
    s.cols = { termCol: g.termCol, meanCol: g.meanCol, posCol: g.posCol, exampleCol: g.exampleCol, headerRow: g.headerRow };
    s.source = g.source;
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const dataRows = rows.slice(g.headerRow + 1);
    colOptions(selTerm, width, dataRows, g.termCol, false);
    colOptions(selMean, width, dataRows, g.meanCol, false);
    colOptions(selPos, width, dataRows, g.posCol, true);
    colOptions(selExample, width, dataRows, g.exampleCol, true);
    work.hidden = false;
    hint.hidden = true;
    computeItems();
  }

  function recomputeItems() {
    if (!s.rows.length) return;
    computeItems();
  }

  function showResult(text, kind = 'ok') {
    result.textContent = '';
    result.dataset.kind = kind;
    result.append(el('span', {}, text));
    if (kind === 'ok') {
      result.append(el('button', { className: 'ghost', dataset: { testid: 'btn-go-practice' }, type: 'button', style: { marginLeft: '10px' }, onclick: () => { location.hash = '#/practice'; } }, '去练习'));
    }
  }

  async function doImport() {
    const libIds = [...s.libIds];
    if (!libIds.length) return showResult('请先勾选要放进哪个词库', 'bad');
    if (!s.items.length) return showResult('没解析出词条，检查一下列选得对不对', 'bad');
    const plan = planImport(s.items, s.existing, s.mode);
    if (!plan.create.length && !plan.merge.length) {
      return showResult(`没有新词要导入（跳过 ${plan.skip} 个已存在的）`, 'warn');
    }
    try {
      const res = await applyImport(plan, { libIds, now: Date.now() });
      s.existing = await all('words');
      computeItems(); // 统计会立刻变成"已存在 N"
      showResult(`新增 ${res.created} · 合并 ${res.merged} · 跳过 ${plan.skip}`, 'ok');
      // 音标库已经缓存过的话，顺手把新词的音标补上（不会联网、不打扰）
      try {
        const dict = await loadDict();
        if (dict && dict.value) {
          const fr = await fillPhonetics({ words: await all('words') });
          if (fr.filled) showResult(`新增 ${res.created} · 合并 ${res.merged} · 跳过 ${plan.skip} · 顺手补了 ${fr.filled} 个音标`, 'ok');
        }
      } catch {
        /* 补音标失败不影响导入 */
      }
    } catch (err) {
      showResult('导入失败了：' + (err && err.message ? err.message : err), 'bad');
    }
  }

  ta.addEventListener('input', recompute);

  const XLSX_RE = /\.(xlsx|xlsm)$/i;
  const OLD_SHEET_RE = /\.(xls|xlsb|ods|numbers)$/i;

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    view.querySelector('[data-testid="file-name"]').textContent = f.name;

    // ① 现代 Excel：自己解压 XML 读出来（见 src/xlsx.js）
    if (XLSX_RE.test(f.name)) {
      try {
        const sheets = await readXlsx(await f.arrayBuffer());
        const sheet = sheets[0];
        ta.value = rowsToTsv(sheet.rows); // 转成 TSV，后面认列/预览/导入整条流程原样复用
        recompute();
        showResult(`已从 Excel 工作表「${sheet.name}」读到 ${sheet.rows.length} 行`, 'info');
      } catch (err) {
        ta.value = '';
        recompute();
        showResult(
          `读这个 Excel 失败了：${err && err.message ? err.message : err}。` +
            '可以改用：① 在电脑上跑 python tool\\xlsx_to_tsv.py 转成 .tsv；' +
            '② 用 WPS / Excel 打开它，选中「单词」和「释义」两列复制后粘到上面的框里。',
          'bad'
        );
      }
      return;
    }

    // ② 老格式 Excel / ODS：明确说清楚，别让人对着"新词 0"发懵
    if (OLD_SHEET_RE.test(f.name)) {
      ta.value = '';
      recompute();
      showResult(
        `老式的表格格式（.${f.name.split('.').pop().toLowerCase()}）读不了，` +
          '请在 Excel / WPS 里「另存为 .xlsx」再来，或者选中「单词」和「释义」两列复制后粘到上面的框里。',
        'bad'
      );
      return;
    }

    // ③ 纯文本：.csv / .tsv / .txt
    const text = decodeText(await f.arrayBuffer());
    if (text.includes('\u0000')) {
      ta.value = '';
      recompute();
      showResult('这看起来不是文本表格文件（可能是 PDF / 图片 / 二进制）。请用 .csv / .tsv / .txt，或 Excel 的 .xlsx。', 'bad');
      return;
    }
    ta.value = text;
    recompute();
  });

  renderLibs();
  if (!data.libs.length) {
    newLibForm.hidden = false;
    hint.textContent = '还没有词库：先新建一个，再导入词表。';
  }
}
