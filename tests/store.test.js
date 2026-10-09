import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingStore,stats,seedReference} from '../store.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('reference includes both departments and BOH closing areas',()=>{const d=seedReference();assert.equal(d.categories.filter(c=>c.department==='BOH').length,9);assert.equal(d.categories.filter(c=>c.department==='FOH').length,8);const c=d.categories.find(c=>c.department==='BOH'&&c.title==='Closing');assert.deepEqual([...new Set(d.items.filter(i=>i.category_id===c.id).map(i=>i.section))],['Closing Boards','Closing Machines','Closing Breading Table','Closing Dishes']);});
test('checklist progress persists and remains separate from overall training status',async()=>{const s=storage(),store=new TrainingStore(s);const member=store.data.members[0],item=store.data.items.find(i=>i.category_id==='c0');await store.save('progress',{member_id:member.id,item_id:item.id,status:'Trained'});const st=stats(store.data,member.id,item.category_id);assert.equal(st.trained,1);assert.equal(st.percent,33);await store.save('members',{...member,status_boh:'Trained'});assert.equal(stats(store.data,member.id,item.category_id).percent,33);const reopened=new TrainingStore(s);assert.equal(reopened.data.members[0].status_boh,'Trained');assert.equal(reopened.data.progress[0].status,'Trained');assert.equal(stats(reopened.data,member.id,null,'FOH').trained,0);});
test('hiding excludes an item from totals and restoring preserves its progress',async()=>{const store=new TrainingStore(storage()),item=store.data.items.find(i=>i.category_id==='c0'),id=store.data.members[0].id;await store.save('progress',{member_id:id,item_id:item.id,status:'Trained'});await store.save('items',{...item,hidden:true});assert.equal(stats(store.data,id,item.category_id).trained,0);assert.equal(stats(store.data,id,item.category_id).total,2);await store.save('items',{...item,hidden:false});assert.equal(stats(store.data,id,item.category_id).trained,1);});
test('renaming a heading updates the whole group, and deleting a category removes dependent data',async()=>{const store=new TrainingStore(storage()),item=store.data.items.find(i=>i.category_id==='c0');await store.renameSection(item.category_id,item.section,'Orientation');assert.equal(store.data.items.filter(i=>i.category_id===item.category_id&&i.section==='Orientation').length,2);await store.save('progress',{member_id:'m1',item_id:item.id,status:'Trained'});await store.remove('categories',item.category_id);assert.equal(store.data.items.filter(i=>i.category_id===item.category_id).length,0);assert.equal(store.data.progress.length,0);});
test('connection form rejects secret and service-role credentials',()=>{const store=new TrainingStore(storage());assert.throws(()=>store.configure('https://example.supabase.co','sb_secret_bad'));const role=btoa(JSON.stringify({role:'service_role'}));assert.throws(()=>store.configure('https://example.supabase.co',`eyJheader.${role}.signature`));assert.throws(()=>store.configure('http://example.supabase.co','sb_publishable_test'));store.configure('https://example.supabase.co/','sb_publishable_test');});
test('member and trainer roles cannot edit training content',async()=>{const store=new TrainingStore(storage(),{url:'https://example.supabase.co',key:'sb_publishable_test'});store.profile={role:'trainer'};await assert.rejects(store.save('items',{id:'x'}),/Only the owner/);store.profile={role:'member'};await assert.rejects(store.save('progress',{}),/Only trainers/);await assert.rejects(store.save('members',{}),/Only trainers/);await assert.rejects(store.renameSection('c0','a','b'),/Owner access/);});
test('failed cloud save leaves local shared data unchanged',async()=>{const previous=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({message:'permission denied'}),{status:403});try{const store=new TrainingStore(storage(),{url:'https://example.supabase.co',key:'sb_publishable_test'});store.profile={role:'owner'};store.session={access_token:'test',expires_at:Date.now()/1000+3600,user:{id:'u1'}};await assert.rejects(store.save('categories',{id:'new',title:'New'}),/permission denied/);assert.equal(store.data.categories.length,0);}finally{globalThis.fetch=previous;}});
test('cloud section rename scopes the update by category and heading',async()=>{const previous=globalThis.fetch;let calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('[]',{status:200});};try{const store=new TrainingStore(storage(),{url:'https://example.supabase.co',key:'sb_publishable_test'});store.profile={role:'owner'};store.session={access_token:'test',expires_at:Date.now()/1000+3600,user:{id:'u1'}};await store.renameSection('c0','Welcome','Getting started');assert.equal(calls[0].options.method,'PATCH');assert.ok(calls[0].url.endsWith('items?category_id=eq.c0&section=eq.Welcome'));assert.deepEqual(JSON.parse(calls[0].options.body),{section:'Getting started'});assert.ok(calls.every(c=>c.options.headers.apikey==='sb_publishable_test'));assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer test'));}finally{globalThis.fetch=previous;}});
test('anonymous visitors load public content without requesting team data or sending a user token',async()=>{const previous=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(url.includes('/settings')?'[{"id":1,"name":"Training"}]':'[]',{status:200});};try{const store=new TrainingStore(storage(),{url:'https://example.supabase.co',key:'sb_publishable_test'});await store.load();assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.url.includes('/members')&&!c.url.includes('/progress')));assert.ok(calls.every(c=>!c.options.headers.Authorization));assert.deepEqual(store.data.members,[]);assert.equal(store.canEdit(),false);assert.equal(store.canTrain(),false);await assert.rejects(store.request('/rest/v1/categories',{method:'POST',body:{title:'Unauthorized'}}),/sign-in is required/);}finally{globalThis.fetch=previous;}});
const authConfig={url:'https://example.supabase.co',key:'sb_publishable_test'};
const verifiedOwner={id:'owner-id',email:'owner@example.com',email_confirmed_at:'2026-10-09T20:00:00Z'};
const authResponse={access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:verifiedOwner};
function ownerResponse(url){
 if(url.includes('/auth/v1/user'))return new Response(JSON.stringify(verifiedOwner));
 if(url.includes('/access_users'))return new Response('[{"user_id":"owner-id","role":"owner"}]');
 return new Response('[]');
}
test('owner email-link verification activates only a database-authorized role',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/verify'))return new Response(JSON.stringify(authResponse));return ownerResponse(url);};
 try{
  const store=new TrainingStore(storage(),authConfig);
  await store.verifySignIn('owner@example.com','https://example.supabase.co/auth/v1/verify?token=tokenhash&type=magiclink');
  assert.equal(store.canEdit(),true);assert.equal(store.canTrain(),true);
  assert.deepEqual(JSON.parse(calls[0].options.body),{token_hash:'tokenhash',type:'magiclink'});
  assert.ok(calls.find(c=>c.url.includes('/auth/v1/user')&&c.options.headers.Authorization==='Bearer test-access'));
  assert.ok(calls.find(c=>c.url.includes('/access_users?user_id=eq.owner-id')));
  assert.ok(calls.find(c=>c.url.includes('/members')));
 }finally{globalThis.fetch=previous;}
});
test('sign-in link validation rejects foreign project links before a network request',async()=>{
 const store=new TrainingStore(storage(),authConfig);
 await assert.rejects(store.verifySignIn('owner@example.com','https://other.supabase.co/auth/v1/verify?token=hash&type=magiclink'),/original sign-in link/);
 await assert.rejects(store.verifySignIn('owner@example.com','https://example.supabase.co/auth/v1/verify?token=hash&type=recovery'),/not a valid/);
});
test('verified accounts without an authorized role return to public view',async()=>{
 const previous=globalThis.fetch,s=storage();
 globalThis.fetch=async(url)=>url.includes('/auth/v1/user')?new Response(JSON.stringify({...verifiedOwner,id:'no-access'})):new Response('[]');
 try{
  const store=new TrainingStore(s,authConfig);
  await assert.rejects(store.activateSession(authResponse),/not been approved/);
  assert.equal(store.session,null);assert.equal(store.profile,null);assert.equal(store.canEdit(),false);
  assert.deepEqual(store.data.members,[]);assert.equal(s.getItem('training-owner-session'),null);
 }finally{globalThis.fetch=previous;}
});
test('email requests specify the live app as their redirect and do not grant a client role',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('{}');};
 try{
  const store=new TrainingStore(storage(),authConfig);
  await store.requestSignInLink(' owner@example.com ','https://training.example.com/#ignored');
  assert.equal(new URL(calls[0].url).searchParams.get('redirect_to'),'https://training.example.com/');
  assert.deepEqual(JSON.parse(calls[0].options.body),{email:'owner@example.com',create_user:true});
  assert.equal(store.canEdit(),false);assert.equal(store.session,null);
 }finally{globalThis.fetch=previous;}
});
test('a clicked email callback verifies the token and restores owner access after reloading',async()=>{
 const previous=globalThis.fetch,calls=[],s=storage();
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return ownerResponse(url);};
 try{
  const store=new TrainingStore(s,authConfig);
  assert.equal(await store.handleAuthCallback('https://training.example.com/#access_token=test-access&refresh_token=test-refresh&expires_in=3600&type=magiclink'),true);
  assert.equal(store.canEdit(),true);
  const reopened=new TrainingStore(s,authConfig);
  assert.equal(reopened.canEdit(),false);
  assert.equal(await reopened.restoreSession(),true);
  assert.equal(reopened.canEdit(),true);
  assert.equal(calls.filter(c=>c.url.includes('/auth/v1/user')).length,2);
  assert.equal(calls.filter(c=>c.url.includes('/auth/v1/verify')).length,0);
 }finally{globalThis.fetch=previous;}
});
test('saved sessions refresh before loading private data and sign-out removes their credentials',async()=>{
 const previous=globalThis.fetch,calls=[],s=storage();
 s.setItem('training-owner-session',JSON.stringify({project:authConfig.url,session:{...authResponse,expires_at:Date.now()/1000-30}}));
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('grant_type=refresh_token'))return new Response(JSON.stringify({...authResponse,access_token:'new-access',refresh_token:'new-refresh'}));
  return ownerResponse(url);
 };
 try{
  const store=new TrainingStore(s,authConfig);await store.restoreSession();
  assert.ok(calls[0].url.includes('grant_type=refresh_token'));
  assert.deepEqual(JSON.parse(calls[0].options.body),{refresh_token:'test-refresh'});
  assert.equal(JSON.parse(s.getItem('training-owner-session')).session.refresh_token,'new-refresh');
  assert.equal(calls.find(c=>c.url.includes('/members')).options.headers.Authorization,'Bearer new-access');
  await store.logout();assert.equal(s.getItem('training-owner-session'),null);assert.equal(store.canEdit(),false);
  assert.deepEqual(store.data.members,[]);assert.deepEqual(store.data.progress,[]);
 }finally{globalThis.fetch=previous;}
});
test('restoring a session ignores a locally forged identity and owner role',async()=>{
 const previous=globalThis.fetch,calls=[],s=storage();
 s.setItem('training-owner-session',JSON.stringify({project:authConfig.url,session:{...authResponse,user:{id:'forged-owner',email:'attacker@example.com'}},profile:{role:'owner'}}));
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({...verifiedOwner,id:'trainer-id'}));
  if(url.includes('/access_users'))return new Response('[{"user_id":"trainer-id","role":"trainer"}]');
  return new Response('[]');
 };
 try{
  const store=new TrainingStore(s,authConfig);await store.restoreSession();
  assert.equal(store.session.user.id,'trainer-id');assert.equal(store.canEdit(),false);assert.equal(store.canTrain(),true);
  assert.ok(calls.find(c=>c.url.includes('/access_users?user_id=eq.trainer-id')));
  assert.ok(calls.every(c=>!c.url.includes('forged-owner')));
 }finally{globalThis.fetch=previous;}
});
test('a session for another project is removed without sending its token',async()=>{
 const previous=globalThis.fetch,s=storage();let requests=0;
 s.setItem('training-owner-session',JSON.stringify({project:'https://other.supabase.co',session:authResponse}));
 globalThis.fetch=async()=>{requests++;return new Response('[]');};
 try{
  const store=new TrainingStore(s,authConfig);assert.equal(await store.restoreSession(),false);
  assert.equal(requests,0);assert.equal(s.getItem('training-owner-session'),null);
 }finally{globalThis.fetch=previous;}
});
test('email codes with spaces verify and mismatched emails do not receive a training role',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/verify')?new Response(JSON.stringify(authResponse)):ownerResponse(url);};
 try{
  const store=new TrainingStore(storage(),authConfig);await store.verifySignIn('owner@example.com','123 456 78');
  assert.deepEqual(JSON.parse(calls[0].options.body),{email:'owner@example.com',token:'12345678',type:'email'});
  calls.length=0;
  await assert.rejects(store.verifySignIn('different@example.com','12345678'),/different email/);
  assert.equal(store.canEdit(),false);assert.ok(calls.every(c=>!c.url.includes('/access_users')));
 }finally{globalThis.fetch=previous;}
});
test('used email links give a recovery message without attempting to consume the token again',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({code:'otp_expired',msg:'Token has expired or is invalid'}),{status:403});
 try{
  const store=new TrainingStore(storage(),authConfig);
  await assert.rejects(store.verifySignIn('owner@example.com','123456'),/already been used or has expired/);
  await assert.rejects(store.handleAuthCallback('https://training.example.com/#error=access_denied&error_code=otp_expired&error_description=Token+has+expired'),/Request a new email/);
  assert.equal(store.session,null);assert.equal(store.canEdit(),false);
 }finally{globalThis.fetch=previous;}
});
