import { el } from './app.js';

/** 原生 dialog 提供焦点约束；路由离开时关闭，避免旧面板残留到下一页。 */
export function openSheet(title, subtitle = '', testid = 'group-dialog') {
  document.querySelectorAll('dialog.app-sheet').forEach(d => d.closeSheet());
  const previous = document.activeElement;
  const dialog = el('dialog', { className:'app-sheet', dataset:{testid}, 'aria-labelledby':'sheet-heading' });
  const heading = el('h2', {id:'sheet-heading'}, title);
  const close = el('button',{className:'sheet-close',type:'button',dataset:{testid:'sheet-close'},'aria-label':'关闭面板',onclick:()=>dismiss()},'×');
  const body = el('div',{className:'sheet-body'});
  const status = el('p',{className:'sheet-status',role:'status','aria-live':'polite'});
  dialog.append(el('div',{className:'sheet-handle','aria-hidden':'true'}),el('header',{className:'sheet-head'},[
    el('div',{},[heading,subtitle?el('p',{className:'settings-note'},subtitle):null]),close
  ]),body,status);
  const overflow = document.body.style.overflow;
  document.body.append(dialog);
  document.body.style.overflow='hidden';
  let closed=false;
  function dismiss(){
    if(closed)return;
    closed=true;
    dialog.close();
    window.removeEventListener('hashchange',onRoute);
    document.body.style.overflow=overflow;
    dialog.remove();
    if(previous?.isConnected)previous.focus({preventScroll:true});
  }
  dialog.closeSheet=dismiss;
  const onRoute=dismiss;
  window.addEventListener('hashchange',onRoute);
  dialog.addEventListener('close',dismiss,{once:true});
  dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  dialog.addEventListener('click',e=>{
    const r=dialog.getBoundingClientRect();
    if(e.target===dialog && (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dismiss();
  });
  dialog.showModal();
  return {dialog,body,status,close:dismiss,async run(button,action){
    if(button?.disabled)return;
    if(button)button.disabled=true;
    status.textContent='';
    try{await action();}catch(error){status.textContent=error.message||String(error);}
    finally{if(button?.isConnected)button.disabled=false;}
  }};
}
