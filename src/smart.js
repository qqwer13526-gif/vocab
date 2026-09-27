/* 智能库的纯逻辑：不存数据，按 prog.level 实时算。
 *
 * 为什么不用"真库 + 自动搬词"：那样会有两份数据，标记变了要同步，
 * 一不小心就不同步（比如在词条页改了标记、或者恢复了备份）。实时算永远一致。
 */

export const SMART_LIBS = [
  {
    id: 'smart:unfamiliar',
    name: '生疏词',
    level: 'unfamiliar',
    color: '#ff375f',
    hint: '练习时点「生疏」的词会自动进来；标成「熟记」就自动移出'
  },
  {
    id: 'smart:known',
    name: '熟记词',
    level: 'known',
    color: '#34c759',
    hint: '练习时点「熟记」的词会自动进来'
  }
];

export const isSmartId = (id) => typeof id === 'string' && id.startsWith('smart:');

export const smartDef = (id) => SMART_LIBS.find((s) => s.id === id) || null;

/** 某个智能库里的词 id（按"最近标记的在前"排） */
export function smartWordIds(data, id) {
  const def = smartDef(id);
  if (!def) return [];
  const progs = data.progs || {};
  const rows = [];
  for (const w of data.words || []) {
    if (!w || w.deleted) continue;
    const p = progs[w.id];
    if (p && p.level === def.level) rows.push({ id: w.id, at: p.levelAt ?? 0 });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows.map((r) => r.id);
}

export const smartCount = (data, id) => smartWordIds(data, id).length;
