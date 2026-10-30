import { el } from './app.js';
import { put } from './db.js';
import { confirmThen } from './confirm.js';
import { assignGroup, collectWord, createGroup, deleteGroup, groupsFor, renameGroup, undoGroupChange } from './groups.js';
import { libWordIds, loadAll, nextLibOrder, PALETTE } from './store.js';
import { openSheet } from './sheet.js';
import { showToast } from './toast.js';

export function undoToast(text,snapshot,onChange=()=>{}) {
  showToast(text,{kind:'ok',action:{label:'撤销',onClick:async()=>{
    try{await undoGroupChange(snapshot);await onChange();showToast('已撤销');}
    catch(error){showToast(error.message,{kind:'bad'});}
  }}});
}

function nameForm(placeholder,submit,onSave) {
  const input=el('input',{className:'field',type:'text',maxlength:'40',required:true,placeholder,'aria-label':placeholder});
  const button=el('button',{className:'ghost',type:'submit'},submit);
  const form=el('form',{className:'group-name-form'},[input,button]);
  form.addEventListener('submit',e=>{e.preventDefault();onSave(input.value,button);});
  return {form,input};
}

export function openGroupName(libId, current = null, onChange=()=>{}) {
  const sheet=openSheet(current?'重命名分组':'新建分组','分组只在当前词库内生效');
  const {form,input}=nameForm('分组名称',current?'保存':'创建',(_,button)=>sheet.run(button,async()=>{
    const result=current?await renameGroup(current.id,input.value):await createGroup(libId,input.value);
    sheet.close();await onChange(result);
  }));
  input.value=current?.name||'';
  sheet.body.append(form);input.focus();
}

export async function openManageGroups(libId,onChange) {
  const data=await loadAll();
  const sheet=openSheet('管理分组','删除分组后，单词回到未分组，学习记录保留');
  for(const g of groupsFor(data,libId)){
    const rename=el('button',{className:'ghost',type:'button',onclick:()=>{
      sheet.close();openGroupName(libId,g,onChange);
    }},'重命名');
    const remove=el('button',{className:'ghost danger',type:'button'},'删除');
    confirmThen(remove,()=>sheet.run(remove,async()=>{
      const snapshot=await deleteGroup(g.id);sheet.close();await onChange();undoToast('已删除分组，单词回到未分组',snapshot,onChange);
    }));
    sheet.body.append(el('div',{className:'group-manage-row'},[el('strong',{},g.name),rename,remove]));
  }
  if(!groupsFor(data,libId).length)sheet.body.append(el('p',{className:'settings-note'},'还没有分组，先创建一个。'));
  sheet.body.append(el('button',{className:'ghost',type:'button',onclick:()=>{sheet.close();openGroupName(libId,null,onChange);}},'新建分组'));
}

export async function openAssignGroup(libId,wordIds,onChange) {
  const data=await loadAll();
  const sheet=openSheet('调整分组',`将选中的 ${wordIds.length} 个词放入一个分组`,'assign-group-dialog');
  let chosen=null;
  const options=el('div',{className:'group-options'});
  for(const g of [{id:null,name:'未分组'},...groupsFor(data,libId)]){
    const button=el('button',{className:'chip',type:'button',dataset:{assignGroup:g.id||'ungrouped'},'aria-pressed':String(!g.id),onclick:()=>{
      chosen=g.id;for(const b of options.children)b.setAttribute('aria-pressed',String(b===button));
    }},g.name);options.append(button);
  }
  const save=el('button',{className:'primary',type:'button',dataset:{testid:'confirm-assign-group'},onclick:()=>sheet.run(save,async()=>{
    const snap=await assignGroup(libId,wordIds,chosen);sheet.close();await onChange();undoToast(`已调整 ${wordIds.length} 个词的分组`,snap,onChange);
  })},'确认调整');
  sheet.body.append(options,save);
}

export async function openCollect(word,{revealTerm=true}={}) {
  const route=location.hash;
  let data=await loadAll();
  if(location.hash!==route)return;
  const sheet=openSheet('加入词库','选择存放位置，继续背当前这个词','collect-dialog');
  const targets=new Map();
  const destinations=el('div',{className:'collect-destinations'});
  const save=el('button',{className:'primary',type:'button',dataset:{testid:'collect-save'},disabled:true},'请选择目标词库');
  const sync=()=>{save.disabled=!targets.size;save.textContent=targets.size?`加入 ${targets.size} 个词库`:'请选择目标词库';};
  const newLibrary=el('button',{className:'link-btn',type:'button'},'＋ 新建词库');
  const createLib=nameForm('新词库名字','创建',(_,button)=>sheet.run(button,async()=>{
    const name=createLib.input.value.trim();if(!name)throw new Error('请填写词库名字');
    const id=crypto.randomUUID(),now=Date.now();
    await put('libs',{id,name,color:PALETTE[data.libs.length%PALETTE.length],order:nextLibOrder(data.libs),createdAt:now,updatedAt:now});
    targets.set(id,null);data=await loadAll();createLib.form.hidden=true;createLib.input.value='';paint();
  }));
  createLib.form.hidden=true;
  newLibrary.onclick=()=>{createLib.form.hidden=!createLib.form.hidden;if(!createLib.form.hidden)createLib.input.focus();};
  sheet.body.append(el('div',{className:'collect-word'},[
    el('strong',{},revealTerm?word.term:'当前题目'),el('span',{className:'settings-note'},revealTerm?(word.meanings||[]).join('；'):'保存当前题目的单词，不提前揭晓答案')
  ]),el('div',{className:'group-section-head'},[el('span',{},'选择词库 · 可多选'),newLibrary]),createLib.form,destinations,save,
  el('p',{className:'settings-note'},'单词仍保留在原词库，学习记录继续保留。'));
  function paint(){
    destinations.replaceChildren();
    for(const lib of data.libs){
      const already=libWordIds(data,lib.id).includes(word.id);
      const check=el('input',{type:'checkbox',value:lib.id,checked:already||targets.has(lib.id),disabled:already,dataset:{testid:'collect-library'},'aria-label':lib.name});
      const groups=el('div',{className:'group-options',hidden:!targets.has(lib.id)});
      const block=el('div',{className:'collect-destination'+(targets.has(lib.id)?' chosen':'')},[
        el('label',{},[check,el('span',{},(lib.parentId?'↳ ':'')+lib.name),already?el('small',{},'已在词库'):null]),groups
      ]);
      check.onchange=()=>{if(check.checked)targets.set(lib.id,null);else targets.delete(lib.id);groups.hidden=!check.checked;block.classList.toggle('chosen',check.checked);sync();};
      const groupList=[{id:null,name:'未分组'},...groupsFor(data,lib.id)];
      for(const g of groupList){
        const button=el('button',{className:'chip',type:'button',dataset:{collectGroup:g.id||'ungrouped'},'aria-pressed':String((targets.get(lib.id)||null)===g.id),onclick:()=>{
          targets.set(lib.id,g.id);for(const b of groups.querySelectorAll('[data-collect-group]'))b.setAttribute('aria-pressed',String(b===button));sync();
        }},g.name);groups.append(button);
      }
      const add=el('button',{className:'chip',type:'button'},'＋ 新建组');
      const create=nameForm('新分组名字','创建',(_,button)=>sheet.run(button,async()=>{
        const g=await createGroup(lib.id,create.input.value);targets.set(lib.id,g.id);data=await loadAll();paint();
      }));create.form.hidden=true;
      add.onclick=()=>{create.form.hidden=!create.form.hidden;if(!create.form.hidden)create.input.focus();};
      groups.append(add,create.form);destinations.append(block);
    }
    if(!data.libs.length)destinations.append(el('p',{className:'settings-note'},'先新建一个词库，再收集当前单词。'));
    sync();
  }
  save.onclick=()=>sheet.run(save,async()=>{
    const snapshot=await collectWord(word.id,[...targets].map(([libId,groupId])=>({libId,groupId})));
    sheet.close();undoToast(`已将${revealTerm?'「'+word.term+'」':'当前单词'}加入 ${targets.size} 个词库`,snapshot);
  });
  paint();
}
