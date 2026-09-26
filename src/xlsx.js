/* 直接读 .xlsx —— 不引入任何第三方库。
 *
 * .xlsx 本质是一个 zip，里面装着 XML：
 *     xl/sharedStrings.xml        共享字符串表（单元格里是"第几条字符串"）
 *     xl/workbook.xml             工作表清单
 *     xl/_rels/workbook.xml.rels  rId → 具体文件
 *     xl/worksheets/sheetN.xml    每张表的单元格
 * 解压用浏览器自带的 DecompressionStream('deflate-raw')（Chrome 103+ / Safari 16.4+），
 * 解 XML 用自带的 DOMParser。所以依旧零依赖、完全离线。
 *
 * 只做"把表格读成二维文本"，认列是 parse.js 的活。
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const utf8 = new TextDecoder('utf-8');

function findEocd(view) {
  const span = Math.min(view.byteLength, 65557); // zip 结尾注释最长 64KB
  for (let i = view.byteLength - 22; i >= view.byteLength - span && i >= 0; i--) {
    if (u32(view, i) === SIG_EOCD) return i;
  }
  throw new Error('这不是有效的 .xlsx 文件（找不到 zip 结尾）。Excel 的 .xls 老格式和 .ods 也不支持。');
}

function listEntries(view) {
  const eocd = findEocd(view);
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > view.byteLength || u32(view, p) !== SIG_CENTRAL) break;
    const method = u16(view, p + 10);
    const compSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const offset = u32(view, p + 42);
    const name = utf8.decode(new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen));
    entries.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) throw new Error('这个 .xlsx 里没有任何文件（zip 目录是空的）');
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('这个浏览器不支持解压 Excel，请在电脑上转成 .tsv，或者直接复制粘贴');
  }
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(view, entry) {
  const p = entry.offset;
  if (u32(view, p) !== SIG_LOCAL) throw new Error('zip 结构损坏（本地文件头不对）');
  const nameLen = u16(view, p + 26);
  const extraLen = u16(view, p + 28);
  const start = p + 30 + nameLen + extraLen;
  if (start + entry.compSize > view.byteLength) throw new Error('zip 结构损坏（数据超出文件末尾）');
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compSize);
  if (entry.method === 0) return utf8.decode(raw); // 没压缩
  if (entry.method !== 8) throw new Error(`不支持的压缩方式（${entry.method}）`);
  return utf8.decode(await inflateRaw(raw));
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

function parseSharedStrings(text) {
  if (!text) return [];
  const doc = parseXml(text);
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')
  );
}

/** "AB12" → 27（列号从 0 开始） */
function colIndexOf(ref) {
  let n = 0;
  for (const ch of String(ref)) {
    const c = ch.toUpperCase();
    if (c < 'A' || c > 'Z') break;
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n - 1;
}

function parseSheet(text, shared) {
  const doc = parseXml(text);
  const rows = [];
  for (const rowEl of doc.getElementsByTagName('row')) {
    const r = parseInt(rowEl.getAttribute('r') || '', 10);
    const idx = Number.isFinite(r) && r > 0 ? r - 1 : rows.length;
    const cells = [];
    for (const c of rowEl.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const col = ref ? colIndexOf(ref) : cells.length;
      const type = c.getAttribute('t') || '';
      let value = '';
      if (type === 'inlineStr') {
        value = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
      } else {
        const v = c.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        // t="s" 是共享字符串表的下标；数字/日期/公式结果直接就是文本
        value = type === 's' ? shared[Number(raw)] ?? '' : raw;
      }
      cells[col] = String(value).trim();
    }
    const width = cells.length;
    rows[idx] = Array.from({ length: width }, (_, i) => cells[i] ?? '');
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function parseWorkbook(wbText, relsText) {
  const out = [];
  try {
    const rels = {};
    if (relsText) {
      for (const r of parseXml(relsText).getElementsByTagName('Relationship')) {
        rels[r.getAttribute('Id')] = r.getAttribute('Target') || '';
      }
    }
    const doc = parseXml(wbText);
    for (const s of doc.getElementsByTagName('sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttribute('id') || '';
      const target = (rels[rid] || '').replace(/^\/?xl\//, '').replace(/^\//, '');
      out.push({ name: s.getAttribute('name') || 'Sheet', path: target ? `xl/${target}` : '' });
    }
  } catch {
    /* 读不出清单就退回"扫 worksheets 目录" */
  }
  return out;
}

/**
 * 读一个 .xlsx。
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Array<{name: string, rows: string[][]}>>}
 */
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 22) throw new Error('文件太小，不像是有效的 .xlsx');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = listEntries(view);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (name) => (byName.has(name) ? readEntry(view, byName.get(name)) : '');

  const shared = parseSharedStrings(await read('xl/sharedStrings.xml'));
  let sheets = parseWorkbook(await read('xl/workbook.xml'), await read('xl/_rels/workbook.xml.rels'));
  if (!sheets.length || sheets.some((s) => !s.path)) {
    const found = entries
      .filter((e) => /^xl\/worksheets\/sheet\d*\.xml$/.test(e.name))
      .map((e) => ({ name: e.name.split('/').pop().replace(/\.xml$/, ''), path: e.name }));
    sheets = sheets.length ? sheets.map((s) => s.path ? s : (found.shift() ?? s)) : found;
  }

  const out = [];
  for (const s of sheets) {
    if (!s.path) continue;
    const xml = await read(s.path);
    if (!xml) continue;
    out.push({ name: s.name, rows: parseSheet(xml, shared) });
  }
  if (!out.length) throw new Error('这个 Excel 里没找到可读的工作表');
  return out;
}

/** 把读出来的行拼成 TSV 文本 —— 这样后面"认列、预览、导入"整条流程完全复用 */
export function rowsToTsv(rows) {
  return (rows || [])
    .map((cells) => {
      const copy = [...(cells || [])];
      while (copy.length && copy[copy.length - 1] === '') copy.pop();
      return copy.join('\t');
    })
    .join('\n');
}
