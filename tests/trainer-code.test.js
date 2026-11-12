import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingStore,isCrossTrained,memberInDepartment,stats} from '../store.js';
import {createTrainerHandler} from '../supabase/functions/trainer-code/index.js';

const origin = 'https://cfatulare.onrender.com';
const endpoint = 'https://test-project.supabase.co/functions/v1/trainer-code';
const config = {url:'https://test-project.supabase.co', key:'sb_publishable_fixture', trainerCodeOrigin:origin};
const token = '2a'.repeat(32);
const fixturePin = '01462';
const session = () => ({token,expires_at:Math.floor(Date.now()/1000)+3600});
const memory = () => {
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const json = (value,options={}) => Response.json(value,options);
const req = (data, site=origin, method='POST') => new Request(endpoint,{
 method,headers:{origin:site,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{}),
});

test('trainer endpoint keeps the leading zero and never forwards extra fields or credentials from the browser',async()=>{
 const calls=[];
 const handle=createTrainerHandler({
  projectUrl:config.url,serviceKey:'test-server-only',transport:async(url,opts)=>{
   calls.push({url,opts});return json(session());
  },
 });
 const preflight=await handle(req({},origin,'OPTIONS'));
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
 const result=await handle(req({action:'sign_in',pin:fixturePin,role:'owner',apiKey:'client-choice'}));
 assert.equal(result.status,200);
 assert.match(result.headers.get('Cache-Control'),/no-store/);
 assert.equal((await result.json()).token,token);
 assert.equal(calls.length,1);
 assert.ok(calls[0].url.endsWith('/rest/v1/rpc/training_trainer_code'));
 assert.deepEqual(JSON.parse(calls[0].opts.body),{p_action:'sign_in',p_data:{pin:fixturePin}});
 assert.equal(calls[0].opts.headers.Authorization,'Bearer test-server-only');
});

test('trainer endpoint rejects unknown actions, untrusted origins, and missing sessions before calling the database',async()=>{
 const handle=createTrainerHandler({projectUrl:config.url,serviceKey:'test',transport:async()=>{
  assert.fail('Invalid requests must never reach the database');
 }});
 assert.equal((await handle(req({action:'sign_in',pin:fixturePin},'https://other.example'))).status,403);
 assert.equal((await handle(req({action:'sign_in',pin:Number(fixturePin)}))).status,400);
 assert.equal((await handle(req({action:'delete_member',token}))).status,400);
 assert.equal((await handle(req({action:'team'}))).status,401);
 assert.equal((await handle(req({action:'save_overall',token,member_id:'m1',department:'bogus',status:'Trained'}))).status,400);
 assert.equal((await handle(req({action:'sign_in',pin:'1'.repeat(1050)}))).status,400);
});

test('the endpoint applies the server throttle without returning database errors',async()=>{
 const limited=createTrainerHandler({
  projectUrl:config.url,serviceKey:'test',transport:async()=>json({error:'limited',retry_after:181}),
 });
 const res=await limited(req({action:'sign_in',pin:fixturePin}));
 assert.equal(res.status,429);
 assert.equal(res.headers.get('Retry-After'),'181');
 const fail=createTrainerHandler({
  projectUrl:config.url,serviceKey:'test',transport:async()=>json({detail:'internal server detail'},{status:400}),
 });
 const bad=await fail(req({action:'sign_in',pin:fixturePin}));
 assert.equal(bad.status,503);
 assert.doesNotMatch(await bad.text(),/internal server detail/);
});

test('the code opens a scoped, restorable trainer session with no email requests',async t=>{
 const calls=[];
 const ownerStorage=memory(),trainerStorage=memory();
 const team={members:[{id:'m1',name:'Example trainee'}],progress:[]};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url!==endpoint){calls.push({url});return json([]);}
  const body=JSON.parse(opts.body);calls.push({url,body});
  return json(body.action==='sign_in'?session():body.action==='team'?team:{ok:true});
 });
 const store=new TrainingStore(ownerStorage,config,trainerStorage,origin);
 await store.signInWithTrainerCode(fixturePin);
 assert.equal(store.canTrain(),true);
 assert.equal(store.canEdit(),false);
 assert.equal(store.canManageTeam(),false);
 assert.equal(store.data.members[0].id,'m1');
 assert.equal(store.session,null);
 assert.equal(ownerStorage.getItem('training-owner-session'),null);
 assert.ok(!trainerStorage.getItem('training-trainer-session').includes(fixturePin));
 await assert.rejects(store.save('items',{}),/Only the owner/);
 await assert.rejects(store.save('members',{}),/manage team members/);
 await assert.rejects(store.remove('members','m1'),/permission/);
 await store.recordProgress('m1','c0-item','Trained');
 await store.setOverallStatus('m1','BOH','Trained');
 const restored=new TrainingStore(ownerStorage,config,trainerStorage,origin);
 assert.equal(await restored.restoreTrainerSession(),true);
 await restored.logout();
 assert.equal(restored.canTrain(),false);
 assert.equal(trainerStorage.getItem('training-trainer-session'),null);
 assert.deepEqual(restored.data.members,[]);
 assert.deepEqual(calls.filter(call=>call.body&&call.body.action!=='team').map(call=>call.body),[
  {action:'sign_in',pin:fixturePin},
  {action:'save_progress',member_id:'m1',item_id:'c0-item',status:'Trained',token},
  {action:'save_overall',member_id:'m1',department:'BOH',status:'Trained',token},
  {action:'sign_out',token},
 ]);
 assert.ok(calls.every(({url})=>!url.includes('/auth/v1/')&&!url.includes('/rest/v1/members')&&!url.includes('/rest/v1/progress')));
});

test('incorrect codes never grant trainer access and revoked sessions drop private data',async t=>{
 let allow=false;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url!==endpoint)return json([]);
  const {action}=JSON.parse(opts.body);
  if(action==='sign_in')return allow?json(session()):json({message:'That trainer code is incorrect.'},{status:401});
  if(action==='team'&&allow)return json({members:[{id:'m1'}],progress:[{member_id:'m1'}]});
  return json({message:'Your trainer session expired.'},{status:401});
 });
 const browser=memory();
 const store=new TrainingStore(memory(),config,browser,origin);
 await assert.rejects(store.signInWithTrainerCode(fixturePin),/incorrect/);
 assert.equal(store.canTrain(),false);
 assert.equal(browser.getItem('training-trainer-session'),null);
 allow=true;
 await store.signInWithTrainerCode(fixturePin);
 assert.equal(store.data.progress.length,1);
 allow=false;
 await store.load();
 assert.equal(store.canTrain(),false);
 assert.deepEqual(store.data.members,[]);
 assert.deepEqual(store.data.progress,[]);
 assert.equal(browser.getItem('training-trainer-session'),null);
});

test('roster calls require a trainer session and only forward name and department fields',async()=>{
 const calls=[],created='0cc49262-dcfe-48ca-82d8-ed2efade17f2';
 const handle=createTrainerHandler({
  projectUrl:config.url,serviceKey:'test-server-only',transport:async(url,opts)=>{
   const payload=JSON.parse(opts.body);calls.push(payload);
   return json(payload.p_action==='add_member'?{id:created}:{ok:true});
  },
 });
 const add={action:'add_member',name:'  Test   Person  ',training_area:'BOTH',auth_user_id:'unexpected',role:'owner',status_foh:'Trained'};
 assert.equal((await handle(req(add))).status,401);
 assert.equal((await handle(req({...add,token,name:' '}))).status,400);
 assert.equal((await handle(req({...add,token,training_area:'UNASSIGNED'}))).status,400);
 assert.deepEqual(await (await handle(req({...add,token}))).json(),{id:created});
 assert.deepEqual(await (await handle(req({action:'assign_department',token,member_id:created,training_area:'BOH',name:'ignored'}))).json(),{ok:true});
 assert.deepEqual(calls,[
  {p_action:'add_member',p_data:{token,name:'Test Person',training_area:'BOTH'}},
  {p_action:'assign_department',p_data:{token,member_id:created,training_area:'BOH'}},
 ]);
});

test('a signed-in trainer can add and reassign people without owner or roster delete permissions',async t=>{
 const calls=[],members=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url!==endpoint)return json([]);
  const body=JSON.parse(opts.body);calls.push(body);
  if(body.action==='sign_in')return json(session());
  if(body.action==='team')return json({members,progress:[]});
  if(body.action==='add_member'){members.push({id:'new',name:body.name,training_area:body.training_area});return json({id:'new'});}
  if(body.action==='assign_department'){members[0].training_area=body.training_area;return json({ok:true});}
  assert.fail('Unexpected action: '+body.action);
 });
 const store=new TrainingStore(memory(),config,memory(),origin);
 await assert.rejects(store.addTeamMember('Test Person','FOH'),/Sign in/);
 await store.signInWithTrainerCode(fixturePin);
 await assert.rejects(store.addTeamMember('Test Person','UNKNOWN'),/Choose FOH/);
 const id=await store.addTeamMember(' Test   Person ','FOH','Ignored');
 assert.equal(id,'new');
 await store.assignMemberDepartment(id,'BOTH');
 assert.equal(store.data.members[0].training_area,'BOTH');
 await assert.rejects(store.editTeamMember(id,'Other Person','BOTH','Leader'),/cannot edit/);
 await assert.rejects(store.remove('members',id),/permission/);
 assert.equal(store.canEdit(),false);
 assert.deepEqual(calls.filter(c=>c.action==='add_member'||c.action==='assign_department'),[
  {action:'add_member',name:'Test Person',training_area:'FOH',token},
  {action:'assign_department',member_id:'new',training_area:'BOTH',token},
 ]);
});

test('roster filtering, cross-training, and per-department counts preserve legacy data',()=>{
 const foh={id:'a',training_area:'FOH',status_foh:'Trained',status_boh:'Trained'};
 const dual={...foh,training_area:'BOTH',status_boh:'In Training'};
 assert.equal(memberInDepartment(foh,'FOH'),true);
 assert.equal(memberInDepartment(foh,'BOH'),false);
 assert.equal(memberInDepartment(dual,'FOH'),true);
 assert.equal(memberInDepartment(dual,'BOH'),true);
 assert.equal(memberInDepartment({id:'old'},'FOH'),true);
 assert.equal(memberInDepartment({id:'old'},'BOH'),true);
 assert.equal(isCrossTrained(foh),false);
 assert.equal(isCrossTrained(dual),false);
 assert.equal(isCrossTrained({...dual,status_boh:'Trained'}),true);
 const data={
  categories:[{id:'f',department:'FOH'},{id:'b',department:'BOH'}],
  items:[{id:'f1',category_id:'f'},{id:'f2',category_id:'f'},{id:'f3',category_id:'f',hidden:true},{id:'b1',category_id:'b'}],
  progress:[{member_id:'a',item_id:'f1',status:'Trained'},{member_id:'a',item_id:'f3',status:'Trained'},{member_id:'a',item_id:'b1',status:'Trained'}],
 };
 assert.equal(stats(data,'a',null,'FOH').percent,50);
 assert.equal(stats(data,'a',null,'BOH').percent,100);
});
