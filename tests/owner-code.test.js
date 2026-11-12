import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerHandler} from '../supabase/functions/owner-code/index.js';
import {TrainingStore} from '../store.js';

const origin='https://cfatulare.onrender.com',projectUrl='https://test-project.supabase.co';
const rpc='/rest/v1/rpc/training_owner_code_attempt',admin='/auth/v1/admin';
const ownerId='cb6c662f-a977-488a-8b4b-8061f7697b94',otherId='00151231-e441-45aa-bb33-d714c102af08';
const passcode='0684206517394028',ownerEmail='fixture-owner@example.invalid';
const owner={id:ownerId,email:ownerEmail,email_confirmed_at:'2026-01-01T00:00:00Z'};
const auth={access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600,user:owner};
const conf={projectUrl,serviceKey:'test-service-key',publicKey:'test-public-key',getPasscode:()=>passcode};
const json=(value,options)=>Response.json(value,options);
const request=(body,{site=origin,method='POST'}={})=>new Request(projectUrl+'/functions/v1/owner-code',{
 method,headers:{origin:site,'Content-Type':'application/json'},
 ...(method==='POST'?{body:JSON.stringify(body)}:{}),
});
const relative=url=>url.slice(projectUrl.length);
function memory(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function serviceFixture({overrides={}}={}){
 const calls=[];
 const handle=createOwnerHandler({...conf,transport:async(url,opts)=>{
  const path=relative(url),body=opts.body&&JSON.parse(opts.body);
  calls.push({path,body,headers:opts.headers});
  if(Object.hasOwn(overrides,path))return json(overrides[path]);
  if(path===rpc)return json(body.p_match?{owner_id:ownerId}:{error:'invalid_code'});
  if(path===admin+'/users/'+ownerId)return json(owner);
  if(path===admin+'/users/'+ownerId+'/factors')return json(null);
  if(path===admin+'/generate_link')return json({...owner,hashed_token:'fixture-one-time-token',action_link:'not returned'});
  if(path==='/auth/v1/verify')return json(auth);
  assert.fail('Unexpected upstream: '+path);
 }});
 return {handle,calls};
}

test('owner sign-in starts disabled; browser origin and length are checked before any backend call',async()=>{
 const handle=createOwnerHandler({...conf,getPasscode:()=>undefined,transport:()=>assert.fail('Unexpected backend call')});
 const preflight=await handle(request(null,{method:'OPTIONS'}));
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await handle(request({code:passcode},{site:'https://other.example'}))).status,403);
 assert.equal((await handle(request({code:'01579'}))).status,400);
 assert.equal((await handle(request({code:Number(passcode)}))).status,400);
 assert.equal((await handle(request({code:passcode,junk:'a'.repeat(256)}))).status,400);
 const off=await handle(request({code:passcode}));
 assert.equal(off.status,503);
 assert.equal((await off.json()).code,'not_configured');
});

test('a wrong owner passcode cannot reach Auth admin even when the database response is unexpected',async()=>{
 const {handle,calls}=serviceFixture();
 const wrong=await handle(request({code:'0684206517394029'}));
 assert.equal(wrong.status,401);
 assert.deepEqual(calls.map(({path,body})=>({path,body})),[{path:rpc,body:{p_match:false}}]);
 const odd=serviceFixture({overrides:{[rpc]:{owner_id:ownerId}}});
 assert.equal((await odd.handle(request({code:'0684206517394029'}))).status,503);
 assert.equal(odd.calls.length,1);
});

test('owner code sign-in applies retry limits without touching Auth email',async()=>{
 const {handle,calls}=serviceFixture({overrides:{[rpc]:{error:'limited',retry_after:96}}});
 const limited=await handle(request({code:passcode}));
 assert.equal(limited.status,429);
 assert.equal(limited.headers.get('Retry-After'),'96');
 assert.equal(calls.length,1);
});

test('a leading-zero passcode creates a normal session only for the existing owner and sends no email',async()=>{
 const {handle,calls}=serviceFixture();
 const result=await handle(request({code:passcode,user_id:otherId,email:'attacker@example.invalid'}));
 assert.equal(result.status,200);
 assert.match(result.headers.get('Cache-Control'),/no-store/);
 assert.deepEqual(await result.json(),{access_token:auth.access_token,refresh_token:auth.refresh_token,expires_in:3600});
 assert.deepEqual(calls[0].body,{p_match:true});
 assert.ok(!JSON.stringify(calls).includes(passcode));
 assert.deepEqual(calls.find(c=>c.path===admin+'/generate_link').body,{type:'magiclink',email:ownerEmail});
 const verify=calls.find(c=>c.path==='/auth/v1/verify');
 assert.deepEqual(verify.body,{type:'magiclink',token_hash:'fixture-one-time-token'});
 assert.equal(verify.headers.Authorization,undefined);
 assert.equal(verify.headers.apikey,'test-public-key');
 assert.ok(!calls.some(c=>['/auth/v1/otp','/auth/v1/recover','/auth/v1/signup'].includes(c.path)));
});

test('owner code login refuses existing MFA and any token for a different identity',async()=>{
 const mfa=serviceFixture({overrides:{[admin+'/users/'+ownerId+'/factors']:{factors:[{status:'verified'}]}}});
 const restricted=await mfa.handle(request({code:passcode}));
 assert.equal((await restricted.json()).code,'mfa_required');
 assert.ok(!mfa.calls.some(c=>c.path===admin+'/generate_link'));
 const mismatch=serviceFixture({overrides:{[admin+'/generate_link']:{...owner,id:otherId,hashed_token:'fixture'}}});
 assert.equal((await mismatch.handle(request({code:passcode}))).status,503);
 assert.ok(!mismatch.calls.some(c=>c.path==='/auth/v1/verify'));
 const wrongSession=serviceFixture({overrides:{['/auth/v1/verify']:{...auth,user:{...owner,id:otherId}}}});
 assert.equal((await wrongSession.handle(request({code:passcode}))).status,503);
});

test('app verifies the owner role before opening the workspace and never keeps the passcode',async t=>{
 const config={url:projectUrl,key:'sb_publishable_fixture',ownerCodeOrigin:origin},calls=[],browser=memory();
 let role='trainer';
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const path=relative(url),body=options.body&&JSON.parse(options.body);
  calls.push({path,body});
  if(path==='/functions/v1/owner-code')return json(auth);
  if(path==='/auth/v1/user')return json(owner);
  if(path.startsWith('/rest/v1/access_users'))return json([{user_id:ownerId,role}]);
  return json([]);
 });
 const wrongOrigin=new TrainingStore(browser,config,memory(),'https://old-site.example');
 await assert.rejects(wrongOrigin.signInWithOwnerPasscode(passcode),/current training address/);
 const store=new TrainingStore(browser,config,memory(),origin);
 await assert.rejects(store.signInWithOwnerPasscode('01579'),/16–24 digits/);
 assert.equal(calls.length,0);
 await assert.rejects(store.signInWithOwnerPasscode(passcode),/not approved for owner access/);
 assert.equal(store.canEdit(),false);
 assert.equal(browser.getItem('training-owner-session'),null);
 role='owner';
 await store.signInWithOwnerPasscode(passcode);
 assert.equal(store.canEdit(),true);
 assert.ok(!browser.getItem('training-owner-session').includes(passcode));
 assert.deepEqual(calls.find(c=>c.path==='/functions/v1/owner-code').body,{code:passcode});
 assert.ok(!calls.some(c=>c.path==='/auth/v1/otp'));
});
