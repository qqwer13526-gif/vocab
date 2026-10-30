import { el } from './app.js';

/** 读取原生选区，不拦截长按、不绘制系统菜单。每次换题和离开路由清理。 */
export function wireWordSelection(view,card,current,open) {
  const bar=el('div',{className:'word-collect-bar',dataset:{testid:'collect-bar'},hidden:true});
  const label=el('strong',{});
  const save=el('button',{className:'primary',type:'button',dataset:{testid:'collect-open'},onclick:()=>open()},'加入词库');
  const close=el('button',{className:'collect-dismiss',type:'button','aria-label':'关闭收集入口',onclick:()=>{getSelection()?.removeAllRanges();bar.hidden=true;}},'×');
  bar.append(el('div',{},[label,el('small',{},'收集当前单词')]),save,close);view.append(bar);
  const change=()=>{
    const selected=getSelection();
    const word=current();
    const inside=selected&&!selected.isCollapsed&&card.contains(selected.anchorNode)&&card.contains(selected.focusNode);
    // iOS 点页面按钮时可能先收起原生选区。入口保留到关闭/换题，不能在点击中途消失。
    if(!word||view.hidden||document.querySelector('dialog[open]'))bar.hidden=true;
    else if(inside){bar.hidden=false;label.textContent=word.label;}
  };
  document.addEventListener('selectionchange',change);
  const reset=()=>{bar.hidden=true;const selected=getSelection();if(selected&&card.contains(selected.anchorNode))selected.removeAllRanges();};
  const dispose=()=>{reset();document.removeEventListener('selectionchange',change);window.removeEventListener('hashchange',dispose);bar.remove();};
  window.addEventListener('hashchange',dispose,{once:true});
  return {reset,dispose};
}
