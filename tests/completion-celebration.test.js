import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {TrainingStore,stats,trainingAreas,memberTrainingArea,memberInDepartment,isCrossTrained,categoriesInOrder} from '../store.js';

function workspace(){
 const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 const message={textContent:''},listeners={},timers=new Map();
 const popup={open:false,shown:0,querySelector:()=>message,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,
  showModal(){this.open=true;this.shown++;},close(){if(this.open){this.open=false;listeners.close?.();}}};
 const nodes={'#app':{},'#dialog':{},'#toast':{style:{}},'#training-celebration':popup};
 let timer=0;
 const context={TrainingStore,stats,trainingAreas,memberTrainingArea,memberInDepartment,isCrossTrained,categoriesInOrder,
  localStorage:storage,sessionStorage:storage,window:{TRAINING_CONFIG:{}},document:{querySelector:selector=>nodes[selector]},
  CSS:{escape:s=>s},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const end=source.indexOf('\nrender();if(store.cloud)');
 assert.ok(end>0,'Find application startup after its event handlers');
 vm.runInNewContext(source.slice(0,end).replace(/^import .*\n/gm,'')+'\nglobalThis.api={store,saveOverallTraining,saveTrainingProgress,closeTrainingCelebration};',context);
 const api=context.api;
 api.store.data={settings:{name:'Training'},members:[{id:'member',name:'Alex',training_area:'BOTH',status_foh:'In Training',status_boh:'In Training'}],
  categories:[{id:'category',title:'Food Safety',department:'FOH'}],
  items:[{id:'first',category_id:'category'},{id:'last',category_id:'category'},{id:'hidden',category_id:'category',hidden:true}],progress:[]};
 return {...api,popup,message,timers};
}

test('celebrates after the final visible checklist item saves, through either progress control',async()=>{
 const w=workspace();
 await w.saveTrainingProgress('member','first','Trained');
 assert.equal(w.popup.shown,0);
 await w.saveTrainingProgress('member','last','In Training');
 assert.equal(w.popup.shown,0);
 await w.saveTrainingProgress('member','last','Trained');
 assert.equal(w.popup.shown,1);
 assert.equal(w.message.textContent,'Alex completed Food Safety!');
 assert.equal(w.store.data.members[0].status_foh,'In Training','Checklist completion keeps the separate trainer assessment');
 await w.saveTrainingProgress('member','last','Trained');
 assert.equal(w.popup.shown,1,'Repeated saves do not replay the celebration');
});

test('celebrates a new overall Trained status in either department and acknowledges cross-training',async()=>{
 const w=workspace();
 await w.saveOverallTraining('member','FOH','Trained');
 assert.equal(w.message.textContent,'Alex is now trained in FOH!');
 assert.equal(w.popup.shown,1);
 w.closeTrainingCelebration();
 await w.saveOverallTraining('member','FOH','Trained');
 assert.equal(w.popup.shown,1);
 await w.saveOverallTraining('member','BOH','Trained');
 assert.equal(w.message.textContent,'Alex is now trained in both FOH and BOH!');
 assert.equal(w.popup.shown,2);
 w.closeTrainingCelebration();
 await w.saveOverallTraining('member','FOH','In Training');
 assert.equal(w.popup.shown,2,'Returning to In Training does not celebrate');
});

test('failed saves and unconfirmed updates never celebrate',async()=>{
 const w=workspace();
 w.store.setOverallStatus=async()=>{throw Error('Save failed');};
 await assert.rejects(w.saveOverallTraining('member','FOH','Trained'),/Save failed/);
 w.store.recordProgress=async()=>{throw Error('Save failed');};
 await assert.rejects(w.saveTrainingProgress('member','last','Trained'),/Save failed/);
 w.store.setOverallStatus=async()=>{};
 await w.saveOverallTraining('member','FOH','Trained');
 assert.equal(w.popup.shown,0);
});

test('rounding to 100 percent does not count as finished training',async()=>{
 const w=workspace();
 w.store.data.items=Array.from({length:201},(_,i)=>({id:'item'+i,category_id:'category'}));
 w.store.data.progress=w.store.data.items.slice(0,199).map(i=>({member_id:'member',item_id:i.id,status:'Trained'}));
 await w.saveTrainingProgress('member','item199','Trained');
 assert.equal(stats(w.store.data,'member','category').percent,100);
 assert.equal(w.popup.shown,0);
 await w.saveTrainingProgress('member','item200','Trained');
 assert.equal(w.popup.shown,1);
});

test('celebration closes automatically and clears its pending timer',async()=>{
 const w=workspace();
 await w.saveOverallTraining('member','FOH','Trained');
 assert.equal(w.popup.open,true);
 const dismiss=[...w.timers.values()].at(-1);
 dismiss();
 assert.equal(w.popup.open,false);
 w.closeTrainingCelebration();
 assert.equal(w.popup.open,false);
});
