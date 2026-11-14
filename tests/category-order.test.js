import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingStore,categoriesInOrder} from '../store.js';

const cloud={url:'https://fixture.supabase.co',key:'sb_publishable_fixture'};
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const fixture=()=>({
  categories:[
    {id:'welcome',department:'FOH',title:'Welcome & Restaurant Tour',description:'Start here',position:0},
    {id:'drinks',department:'FOH',title:'Drinks',position:2},
    {id:'closing',department:'FOH',title:'Closing',position:3},
    {id:'fryers',department:'BOH',title:'Fryers',position:8},
  ],
  items:[{id:'recipe',category_id:'welcome'}],
  members:[{id:'test-trainee'}],
  progress:[{member_id:'test-trainee',item_id:'recipe',status:'Trained'}],
  settings:{name:'Test restaurant'},
});
const current=['welcome','drinks','closing'],next=['drinks','closing','welcome'];

test('saving a category order keeps checklist links and progress intact across a reload',async()=>{
 const browser=memory(),store=new TrainingStore(browser);
 store.data=fixture();
 const original=structuredClone(store.data);
 await store.reorderCategories('FOH',current,next);
 const reloaded=new TrainingStore(browser);
 assert.deepEqual(categoriesInOrder(reloaded.data,'FOH').map(c=>[c.id,c.position]),[['drinks',0],['closing',1],['welcome',2]]);
 assert.deepEqual(categoriesInOrder(reloaded.data,'BOH'),[original.categories[3]]);
 assert.equal(reloaded.data.categories.find(c=>c.id==='welcome').description,'Start here');
 assert.deepEqual(reloaded.data.items,original.items);
 assert.deepEqual(reloaded.data.progress,original.progress);
});

test('owners send one scoped save; a failed save leaves their existing order in place',async t=>{
 const store=new TrainingStore(memory(),cloud);
 store.data=fixture();
 store.profile={role:'owner'};
 store.session={access_token:'fixture-token',expires_at:Date.now()/1000+3600};
 let denied=true;
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,options});
  return denied?Response.json({message:'Categories changed on another device.'},{status:409}):new Response(null,{status:204});
 });
 await assert.rejects(store.reorderCategories('FOH',current,next),/changed on another device/);
 assert.deepEqual(categoriesInOrder(store.data,'FOH').map(c=>c.id),current);
 denied=false;
 await store.reorderCategories('FOH',current,next);
 assert.equal(calls.length,2);
 assert.equal(calls[1].url,cloud.url+'/rest/v1/rpc/reorder_training_categories');
 assert.equal(calls[1].options.headers.Authorization,'Bearer fixture-token');
 assert.deepEqual(JSON.parse(calls[1].options.body),{p_department:'FOH',p_previous_ids:current,p_ordered_ids:next});
 assert.deepEqual(categoriesInOrder(store.data,'FOH').map(c=>c.id),next);
});

test('trainers, stale lists, duplicates, and categories from another department cannot change the order',async t=>{
 const store=new TrainingStore(memory(),cloud);
 store.data=fixture();
 const transport=t.mock.method(globalThis,'fetch',()=>assert.fail('Invalid edit reached the server'));
 store.profile={role:'trainer'};
 await assert.rejects(store.reorderCategories('FOH',current,next),/Only the owner/);
 store.profile={role:'owner'};
 await assert.rejects(store.reorderCategories('FOH',next,['welcome','closing','drinks']),/changed on another device/);
 await assert.rejects(store.reorderCategories('FOH',current,['drinks','fryers','welcome']),/every category/);
 await assert.rejects(store.reorderCategories('FOH',current,['drinks','closing','closing']),/exactly once/);
 assert.equal(transport.mock.callCount(),0);
});
