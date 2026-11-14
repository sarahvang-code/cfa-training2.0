import {primarySandwichItems} from './boh-builds.js';

function sameOrder(a,b){return a.length===b.length&&a.every((id,i)=>id===b[i]);}
export function categoriesInOrder(data,department){
 return data.categories.filter(c=>c.department===department).sort((a,b)=>a.position-b.position||(a.id<b.id?-1:a.id>b.id?1:0));
}

export const titles=['Welcome & Restaurant Tour','BOH Food Safety','Primary','Secondary','Machines','Breading','Fries','RSA Assessment','Closing'];
const starter=[['Clock in and meet your trainer','Restaurant tour','Uniform and handwashing expectations'],['Handwashing and glove use','Temperature checks','Prevent cross-contamination'],['Set up the primary station','Practice order assembly'],['Set up the secondary station','Practice station handoffs'],['Equipment overview','Safe operation and cleaning'],['Prepare the breading station','Review safe handling'],['Prepare the fry station','Review timers and holding procedures'],['Review restaurant safety expectations','Complete the trainer assessment'],['Complete station cleaning','Review the closing checklist']];
export function seed(){const categories=titles.map((title,i)=>({id:`c${i}`,title,description:i===0?'A great first day starts here.':'Practice the essentials with your trainer.',position:i}));const items=starter.flatMap((a,i)=>a.map((title,j)=>({id:`i${i}-${j}`,category_id:`c${i}`,section:i===0?'Welcome':'Station essentials',title,notes:'Example checklist item. Replace with your restaurant’s approved training.',link:'',position:j})));return {categories,items,members:[{id:'m1',name:'Alex Morgan',role:'Team member',auth_user_id:null},{id:'m2',name:'Jordan Lee',role:'Team member',auth_user_id:null},{id:'m3',name:'Taylor Reed',role:'Team member',auth_user_id:null}],progress:[],settings:{name:'Restaurant Training'}};}
export function stats(data,memberId,categoryId,department){const categoryIds=data.categories.filter(c=>!department||c.department===department).map(c=>c.id);const items=data.items.filter(i=>!i.hidden&&categoryIds.includes(i.category_id)&&(!categoryId||i.category_id===categoryId));const trained=items.filter(i=>data.progress.some(p=>p.member_id===memberId&&p.item_id===i.id&&p.status==='Trained')).length;const started=items.filter(i=>data.progress.some(p=>p.member_id===memberId&&p.item_id===i.id&&p.status!=='Not started')).length;return {total:items.length,trained,started,percent:items.length?Math.round(trained/items.length*100):0,status:items.length&&trained===items.length?'Trained':started?'In Training':'Not started'};}
export const trainingAreas=Object.freeze(['FOH','BOH','BOTH']);
export function memberTrainingArea(member){return trainingAreas.includes(member?.training_area)?member.training_area:'UNASSIGNED';}
export function memberInDepartment(member,department){
 if(!member||!['FOH','BOH'].includes(department))return false;
 return [department,'BOTH','UNASSIGNED'].includes(memberTrainingArea(member));
}
export function isCrossTrained(member){
 return memberTrainingArea(member)==='BOTH'&&member.status_foh==='Trained'&&member.status_boh==='Trained';
}
function teamMemberFields(name,trainingArea,allowUnassigned=false){
 name=typeof name==='string'?name.trim().replace(/\s+/g,' '):'';
 if(!name||Array.from(name).length>100)throw Error('Enter a team member name with up to 100 characters.');
 if(!trainingAreas.includes(trainingArea)&&!(allowUnassigned&&trainingArea==='UNASSIGNED'))throw Error('Choose FOH, BOH, or both departments.');
 return {name,training_area:trainingArea};
}
export class TrainingStore{
 constructor(storage,config={},trainerStorage=storage,siteOrigin=globalThis.location?.origin){this.storage=storage;this.trainerStorage=trainerStorage;this.config=config.url&&config.key?config:JSON.parse(storage.getItem('training-connection')||'{}');this.cloud=!!(this.config.url&&this.config.key);this.trainerCodeEnabled=!!(this.cloud&&this.config.trainerCodeOrigin&&this.config.trainerCodeOrigin===siteOrigin);this.ownerCodeEnabled=!!(this.cloud&&this.config.ownerCodeOrigin&&this.config.ownerCodeOrigin===siteOrigin);this.session=null;this.trainerSession=null;this.trainerLastLoad=0;this.profile=null;this.data=this.cloud?{categories:[],items:[],members:[],progress:[],settings:{name:'Restaurant Training'}}:JSON.parse(storage.getItem('training-demo-v2')||'null')||seedReference();}
 persist(){this.storage.setItem('training-demo-v2',JSON.stringify(this.data));}
 async reorderCategories(department,previousIds,orderedIds){
  if(!this.canEdit())throw Error('Only the owner can reorder training categories.');
  if(!['FOH','BOH'].includes(department)||!Array.isArray(previousIds)||!Array.isArray(orderedIds))throw Error('Choose one department and its category order.');
  const current=categoriesInOrder(this.data,department).map(c=>c.id);
  if(sameOrder(current,orderedIds))return;
  if(!sameOrder(current,previousIds))throw Error('Categories changed on another device. Refresh the list and try again.');
  if(current.length!==orderedIds.length||new Set(orderedIds).size!==current.length||orderedIds.some(id=>!current.includes(id)))throw Error('Include every category in this department exactly once.');
  if(this.cloud){
   await this.request('/rest/v1/rpc/reorder_training_categories',{method:'POST',body:{p_department:department,p_previous_ids:previousIds,p_ordered_ids:orderedIds}});
  }
  const positions=new Map(orderedIds.map((id,i)=>[id,i]));
  this.data.categories=this.data.categories.map(c=>c.department===department?{...c,position:positions.get(c.id)}:c);
  if(!this.cloud)this.persist();
 }
 async renameCategory(id,title,description){
  if(!this.canEdit())throw Error('Only the owner can edit training.');
  const category=this.data.categories.find(c=>c.id===id);
  if(!category)throw Error('This category is no longer in the list.');
  if(!this.cloud){await this.save('categories',{...category,title,description});return;}
  const result=await this.request('/rest/v1/categories?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{title,description}});
  if(!Array.isArray(result)||!result.length)throw Error('This category could not be updated. Refresh the list and try again.');
  await this.load();
 }
 async renameSection(categoryId,oldName,newName){if(!this.canEdit())throw Error('Owner access required.');if(this.cloud){await this.request('/rest/v1/items?category_id=eq.'+encodeURIComponent(categoryId)+'&section=eq.'+encodeURIComponent(oldName),{method:'PATCH',body:{section:newName}});await this.load();}else{this.data.items.filter(i=>i.category_id===categoryId&&i.section===oldName).forEach(i=>i.section=newName);this.persist();}}
 configure(url,key){url=url.trim().replace(/\/$/,'');key=key.trim();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw Error('Enter your Supabase project URL (https://your-project.supabase.co).');let valid=key.startsWith('sb_publishable_');if(key.startsWith('eyJ')){try{valid=JSON.parse(atob(key.split('.')[1])).role==='anon';}catch{valid=false;}}if(!valid)throw Error('Use the publishable key or legacy anon key, never a secret/service-role key.');this.storage.setItem('training-connection',JSON.stringify({url,key}));}
 async request(path,{method='GET',body,prefer='return=representation'}={}){if(!this.session&&method!=='GET')throw Error('Owner or trainer sign-in is required to save changes.');if(this.session&&this.session.expires_at<Date.now()/1000+60)await this.refresh();const r=await fetch(this.config.url+path,{method,headers:{apikey:this.config.key,...(this.session?{Authorization:`Bearer ${this.session.access_token}`}:{ }),'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});const txt=await r.text();let value;try{value=txt?JSON.parse(txt):null;}catch{throw Error('Unexpected response from Supabase.');}if(!r.ok)throw Error(value?.message||value?.msg||value?.error_description||'Could not save. Check your connection and permissions.');return value;}
 async authRequest(path,body){
  const r=await fetch(this.config.url+path,{method:'POST',headers:{apikey:this.config.key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await r.text();let value;
  try{value=text?JSON.parse(text):{};}catch{throw Error('Could not reach sign-in. Please try again.');}
  if(!r.ok){
   const code=value.error_code||value.code,message=value.msg||value.message||value.error_description||'Sign-in failed. Please try again.';
   if(r.status===429&&path.split('?')[0]==='/auth/v1/otp'&&(code==='over_email_send_rate_limit'||/email rate limit exceeded/i.test(message))){
    const seconds=String(message).match(/after\s+(\d+)\s+seconds?\b/i)?.[1];
    const error=Error(seconds?`No new email was sent. Wait ${seconds} seconds before requesting another, or use a link you already have.`:'No new email was sent because the hourly limit was reached. You can use a link you already have, or wait before requesting another.');
    error.code='over_email_send_rate_limit';throw error;
   }
   if(r.status===429&&path==='/functions/v1/owner-code'){
    const seconds=Number(r.headers.get('Retry-After'));
    if(Number.isFinite(seconds)&&seconds>0&&seconds<=86400){
     const delay=seconds<=60?Math.ceil(seconds)+' sec':seconds<=3600?Math.ceil(seconds/60)+' min':Math.ceil(seconds/3600)+' hr';
     throw Error('Try owner sign-in again in about '+delay+'.');
    }
   }
   if(code==='otp_expired')throw Error('That sign-in link or code has already been used or has expired. If it opened a Safari error page, paste the address from that tab here.');
   throw Error(message);
  }
  return value;
 }
 rememberSession(){
  if(this.session)this.storage.setItem('training-owner-session',JSON.stringify({project:this.config.url,session:this.session}));
 }
 clearSession(){
  this.session=null;this.profile=null;
  this.data.members=[];this.data.progress=[];
  this.storage.removeItem('training-owner-session');
 }
 async refresh(){
  if(this.refreshing)return this.refreshing;
  this.refreshing=(async()=>{
   try{
    const value=await this.authRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:this.session.refresh_token});
    this.session={...value,expires_at:value.expires_at||Date.now()/1000+(value.expires_in||3600)};
    this.rememberSession();
   }catch(e){this.clearSession();throw Error('Your session expired. Please sign in again.');}
   finally{this.refreshing=null;}
  })();
  return this.refreshing;
 }
 async requestSignInLink(email,redirectTo=this.config.siteUrl){
  let path='/auth/v1/otp';
  if(redirectTo){
   const url=new URL(redirectTo);
   if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost'))throw Error('The sign-in return address must use HTTPS.');
   url.hash='';url.search='';
   path+='?redirect_to='+encodeURIComponent(url.href);
  }
  await this.authRequest(path,{email:email.trim(),create_user:true});
 }
 async verifySignIn(email,input){
  let body;input=input.trim();const code=input.replace(/\s/g,'');
  if(/^\d{6,10}$/.test(code))body={email:email.trim(),token:code,type:'email'};
  else{
   let url;try{url=new URL(input);}catch{throw Error('Paste the sign-in link from your email, or the email code.');}
   if(url.origin==='http://localhost:3000'&&url.pathname==='/'&&!url.username&&!url.password){
    const params=new URLSearchParams(url.hash.slice(1));
    if(!params.get('access_token')||!params.get('refresh_token')||!['email','magiclink','signup'].includes(params.get('type')||'email'))throw Error('This Safari address does not contain an active email sign-in. Try the original Safari tab or an unused email link.');
    // Read the returned session locally, then verify it with this project's Auth service.
    await this.handleAuthCallback(url.href,email);
    return;
   }
   if(url.origin!==this.config.url||url.pathname!=='/auth/v1/verify')throw Error('Copy the original sign-in link from your email, or the address of the Safari error page it opened.');
   const token_hash=url.searchParams.get('token_hash')||url.searchParams.get('token'),type=url.searchParams.get('type')||'email';
   if(!token_hash||!['email','magiclink','signup'].includes(type))throw Error('That link is not a valid email sign-in link.');
   body={token_hash,type};
  }
  const value=await this.authRequest('/auth/v1/verify',body);
  await this.activateSession(value,email);
 }
 async handleAuthCallback(input,email){
  const url=new URL(input),params=new URLSearchParams(url.hash.slice(1));
  const error=params.get('error_description')||url.searchParams.get('error_description');
  if(error){
   if((params.get('error_code')||url.searchParams.get('error_code'))==='otp_expired')throw Error('That sign-in link has already been used or has expired. Request a new email.');
   throw Error(error);
  }
  const access_token=params.get('access_token'),refresh_token=params.get('refresh_token');
  if(access_token&&refresh_token){
   if(params.get('type')==='recovery')throw Error('Use an owner sign-in email, rather than a password reset link.');
   const expiry=Number(params.get('expires_at'));
   const expires_at=Number.isFinite(expiry)&&expiry>0?expiry:undefined;
   if(email&&expires_at&&expires_at<=Date.now()/1000+60)throw Error('That Safari sign-in has expired. Use an unused email link, or request a new one when the email limit resets.');
   await this.activateSession({access_token,refresh_token,expires_at,expires_in:Number(params.get('expires_in'))||3600},email);
   return true;
  }
  const token_hash=url.searchParams.get('token_hash'),type=url.searchParams.get('type')||'email';
  if(token_hash&&['email','magiclink','signup'].includes(type)){
   const value=await this.authRequest('/auth/v1/verify',{token_hash,type});
   await this.activateSession(value,email);return true;
  }
  return false;
 }
 async signInWithOwnerPasscode(code){
  if(!this.ownerCodeEnabled)throw Error('Owner passcode sign-in is available at the current training address.');
  if(this.profile)throw Error('Sign out before starting an owner session.');
  if(typeof code!=='string'||!/^\d{16,24}$/.test(code.trim()))throw Error('Enter the owner passcode using 16–24 digits.');
  const value=await this.authRequest('/functions/v1/owner-code',{code:code.trim()});
  await this.activateSession(value,undefined,'owner');
 }
 async activateSession(value,email,expectedRole){
  if(!value.access_token)throw Error('Sign-in did not return a session. Try again.');
  this.clearTrainerSession();
  this.session={...value,expires_at:value.expires_at||Date.now()/1000+(value.expires_in||3600)};this.profile=null;
  try{
   // Resolve identity with Auth; never trust a stored user or a role from a URL.
   const user=await this.request('/auth/v1/user');
   if(!user?.id||!user.email_confirmed_at)throw Error('Please verify your email before signing in.');
   if(email&&user.email?.toLowerCase()!==email.trim().toLowerCase())throw Error('The sign-in link belongs to a different email address.');
   this.session.user=user;
   const profiles=await this.request('/rest/v1/access_users?user_id=eq.'+encodeURIComponent(user.id));
   this.profile=profiles[0];
   if(!this.profile||!['owner','trainer','member'].includes(this.profile.role))throw Error('This email has not been approved for owner or trainer access.');
   if(expectedRole&&this.profile.role!==expectedRole)throw Error('This account is not approved for owner access.');
   await this.load();this.rememberSession();
  }catch(e){this.clearSession();await this.load().catch(()=>{});throw e;}
 }
 async restoreSession(){
  let stored;try{stored=JSON.parse(this.storage.getItem('training-owner-session')||'null');}catch{this.clearSession();return false;}
  if(!stored)return false;
  if(stored.project!==this.config.url||!stored.session?.access_token){this.clearSession();return false;}
  await this.activateSession(stored.session);return true;
 }
 async trainerRequest(action,input={}){
  if(!this.trainerCodeEnabled)throw Error('Trainer code sign-in is available at the current training address.');
  const session=this.trainerSession;
  if(action!=='sign_in'&&(!session||session.expires_at<=Date.now()/1000)){
   this.clearTrainerSession();
   throw Error('Your trainer session expired. Enter the trainer code again.');
  }
  let response,value;
  try{
   response=await fetch(this.config.url+'/functions/v1/trainer-code',{
    method:'POST',cache:'no-store',headers:{apikey:this.config.key,'Content-Type':'application/json'},
    body:JSON.stringify({action,...input,...(action!=='sign_in'?{token:session.token}:{})}),
   });
   value=await response.json();
  }catch{throw Error('Could not reach trainer sign-in. Check your connection and try again.');}
  if(!response.ok){
   if(response.status===401&&action!=='sign_in'){
    this.clearTrainerSession();
    throw Error('Your trainer session expired. Enter the trainer code again.');
   }
   if(response.status===429&&action==='sign_in'){
    const seconds=Number(response.headers.get('Retry-After'));
    if(Number.isFinite(seconds)&&seconds>0&&seconds<=86400){
     const delay=seconds<=3600?Math.ceil(seconds/60)+' min':Math.ceil(seconds/3600)+' hr';
     throw Error('Too many incorrect trainer codes. Try again in about '+delay+'.');
    }
   }
   throw Error(value?.message||'Trainer access is temporarily unavailable. Try again in a moment.');
  }
  return value;
 }
 validTrainerSession(value){
  return typeof value?.token==='string'&&/^[0-9a-f]{64}$/.test(value.token)&&Number.isSafeInteger(value.expires_at)&&value.expires_at>Date.now()/1000;
 }
 clearTrainerSession(){
  if(this.trainerSession){
   this.profile=null;this.data.members=[];this.data.progress=[];
  }
  this.trainerSession=null;this.trainerLastLoad=0;
  this.trainerStorage.removeItem('training-trainer-session');
 }
 async signInWithTrainerCode(pin){
  if(this.profile)throw Error('Sign out before starting a new trainer session.');
  if(typeof pin!=='string'||!/^\d{5,12}$/.test(pin.trim()))throw Error('Enter the trainer code using digits only.');
  const value=await this.trainerRequest('sign_in',{pin:pin.trim()});
  if(!this.validTrainerSession(value))throw Error('Trainer sign-in did not return a valid session.');
  this.trainerSession={token:value.token,expires_at:value.expires_at};
  try{
   await this.load();
   if(!this.trainerSession)throw Error('The trainer session has expired. Try signing in again.');
   this.trainerStorage.setItem('training-trainer-session',JSON.stringify({project:this.config.url,session:this.trainerSession}));
  }catch(e){this.clearTrainerSession();throw e;}
 }
 async restoreTrainerSession(){
  if(!this.trainerCodeEnabled||this.session)return false;
  let stored;try{stored=JSON.parse(this.trainerStorage.getItem('training-trainer-session')||'null');}catch{this.clearTrainerSession();return false;}
  if(stored?.project!==this.config.url||!this.validTrainerSession(stored.session)){this.clearTrainerSession();return false;}
  this.trainerSession=stored.session;
  try{await this.load();return this.profile?.role==='trainer';}
  catch{this.clearTrainerSession();return false;}
 }
 async logout(){
  if(this.trainerSession){
   try{await this.trainerRequest('sign_out');}finally{this.clearTrainerSession();await this.load();}
   return;
  }
  try{if(this.session)await this.request('/auth/v1/logout',{method:'POST'});}finally{this.clearSession();await this.load();}
 }
 async load(){
  if(!this.cloud)return;
  const trainer=this.trainerSession;
  const [categories,items,settings]=await Promise.all(['categories?order=position','items?order=position','settings'].map(t=>this.request('/rest/v1/'+t)));
  let members=[],progress=[];
  if(trainer&&this.trainerSession===trainer){
   try{
    const team=await this.trainerRequest('team');
    if(!Array.isArray(team?.members)||!Array.isArray(team?.progress))throw Error('Could not load team progress.');
    if(this.trainerSession===trainer){
     ({members,progress}=team);this.profile={role:'trainer'};this.trainerLastLoad=Date.now();
    }
   }catch(e){if(this.trainerSession)throw e;}
  }else if(this.session&&this.profile){
   [members,progress]=await Promise.all(['members?order=name','progress'].map(t=>this.request('/rest/v1/'+t)));
  }
  this.data={categories,items,members,progress,settings:settings[0]||{name:'Restaurant Training'}};
 }
 canEdit(){return !this.cloud||this.profile?.role==='owner';}
 canTrain(){return !this.cloud||['owner','trainer'].includes(this.profile?.role);}
 canManageTeam(){return this.canTrain()&&!this.trainerSession;}
 async addTeamMember(name,trainingArea,position='Team member'){
  if(!this.canTrain())throw Error('Sign in as a trainer or owner to add a team member.');
  const row=teamMemberFields(name,trainingArea);
  if(this.trainerSession){
   const result=await this.trainerRequest('add_member',row);
   if(typeof result?.id!=='string'||!result.id)throw Error('Could not confirm the new team member.');
   await this.load();return result.id;
  }
  const id=crypto.randomUUID();
  await this.save('members',{id,...row,role:position.trim()||'Team member',auth_user_id:null,status_boh:'In Training',status_foh:'In Training'});
  return id;
 }
 async assignMemberDepartment(id,trainingArea){
  if(!this.canTrain())throw Error('Sign in as a trainer or owner to change departments.');
  if(!trainingAreas.includes(trainingArea))throw Error('Choose FOH, BOH, or both departments.');
  if(this.trainerSession){
   await this.trainerRequest('assign_department',{member_id:id,training_area:trainingArea});await this.load();return;
  }
  await this.updateMemberFields(id,{training_area:trainingArea});
 }
 async editTeamMember(id,name,trainingArea,position){
  if(!this.canManageTeam())throw Error('This sign-in cannot edit a team member’s name.');
  await this.updateMemberFields(id,{...teamMemberFields(name,trainingArea,true),role:position.trim()||'Team member'});
 }
 async updateMemberFields(id,fields){
  if(!this.canManageTeam())throw Error('This sign-in cannot edit team member details.');
  const member=this.data.members.find(m=>m.id===id);
  if(!member)throw Error('This team member could not be found.');
  if(this.cloud){
   const updated=await this.request('/rest/v1/members?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:fields});
   if(!Array.isArray(updated)||!updated.length)throw Error('This team member could not be updated.');
   await this.load();return;
  }
  await this.save('members',{...member,...fields});
 }
 async recordProgress(memberId,itemId,status){
  if(!this.canTrain())throw Error('Only trainers and owners can record progress.');
  if(this.trainerSession){
   await this.trainerRequest('save_progress',{member_id:memberId,item_id:itemId,status});await this.load();return;
  }
  await this.save('progress',{member_id:memberId,item_id:itemId,status,updated_at:new Date().toISOString(),
   ...(this.session?.user?.id?{recorded_by:this.session.user.id}:{})});
 }
 async setOverallStatus(memberId,department,status){
  if(!this.canTrain())throw Error('Only trainers and owners can record progress.');
  if(this.trainerSession){
   await this.trainerRequest('save_overall',{member_id:memberId,department,status});await this.load();return;
  }
  if(!['FOH','BOH'].includes(department)||!['In Training','Trained'].includes(status))throw Error('Choose a valid training status.');
  await this.updateMemberFields(memberId,{['status_'+department.toLowerCase()]:status});
 }
 async save(table,row){if(table==='progress'&&!this.canTrain())throw Error('Only trainers and owners can record progress.');if(['categories','items','settings'].includes(table)&&!this.canEdit())throw Error('Only the owner can edit training.');if(table==='members'&&!this.canManageTeam())throw Error(this.trainerSession?'The shared trainer code cannot manage team members.':'Only trainers and owners can manage team members.');if(this.cloud){await this.request('/rest/v1/'+table+(table==='progress'?'?on_conflict=member_id,item_id':''),{method:'POST',body:row,prefer:'resolution=merge-duplicates,return=representation'});await this.load();return;}if(table==='settings')this.data.settings=row;else{const rows=this.data[table];const index=rows.findIndex(r=>table==='progress'?r.member_id===row.member_id&&r.item_id===row.item_id:r.id===row.id);if(index<0)rows.push(row);else rows[index]={...rows[index],...row};}this.persist();}
 async remove(table,id){if(table==='members'?!this.canManageTeam():!this.canEdit())throw Error('You do not have permission to delete this record.');if(this.cloud){await this.request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});await this.load();return;}this.data[table]=this.data[table].filter(r=>r.id!==id);if(table==='categories'){const removed=this.data.items.filter(i=>i.category_id===id).map(i=>i.id);this.data.items=this.data.items.filter(i=>i.category_id!==id);this.data.progress=this.data.progress.filter(p=>!removed.includes(p.item_id));}if(table==='items')this.data.progress=this.data.progress.filter(p=>p.item_id!==id);if(table==='members')this.data.progress=this.data.progress.filter(p=>p.member_id!==id);this.persist();}
}
export function seedReference(){
 const data=seed();data.categories.forEach(c=>c.department='BOH');data.items.forEach(i=>i.hidden=false);data.members.forEach(m=>{m.status_boh='In Training';m.status_foh='In Training';});
 const groups={
  'Welcome & Restaurant Tour':{'Welcome':['Clock In','Restaurant Tour'],'What makes Chick-fil-A Unique?':['How Truett Cathy Built a Good Name']},
  'BOH Food Safety':{'Food Safety Basics':['Handwashing before food handling','Understand cross-contamination','Review approved food temperature procedures']},
  'Primary':{'Station Setup':['Prepare the primary station'],'Orders':['Build sandwiches','Follow special-order instructions'],'AHA + Communication':['Communicate with bagger and breader','Follow the PAN system','Use AHA tracking']},
  'Secondary':{'Orders':['Use nugget/strip box tabs and labels correctly','Cobb/customized salads','Place items in correct chutes','Bake and bag cookies'],'AHA + Communication':['Communicate with bagger and breader','Follow the PAN system','Use AHA tracking']},
  'Breading':{'Breading':['Bread filets','Bread nuggets','Bread strips'],'Coater + Milkwash':['Follow chicken load amounts','Add new coater when needed','Properly sift coater','Prepare milkwash'],'Grilled + Rotation':['Drop grilled filets/nuggets','Review rotation with the trainer']},
  'Closing':{'Closing Boards':['Clean and sanitize boards','Restock the station'],'Closing Machines':['Complete machine cleaning procedures'],'Closing Breading Table':['Clean and sanitize the breading table'],'Closing Dishes':['Wash and organize dishes']}
 };
 for(const c of data.categories){if(groups[c.title]){data.items=data.items.filter(i=>i.category_id!==c.id);let position=0;for(const [section,names]of Object.entries(groups[c.title]))for(const title of names)data.items.push({id:`${c.id}-ref-${position}`,category_id:c.id,section,title,notes:'',link:'',position:position++,hidden:false});}}
 data.items.push(...primarySandwichItems.map(item=>({...item})));
 const foh={
  'Welcome & Restaurant Tour':groups['Welcome & Restaurant Tour'],
  'FOH Food Safety':{'Food Safety Basics':['Handwashing before food handling','Prevent cross-contamination','Review approved cleaning and sanitizing procedures']},
  'Winning Hearts Everyday':{'Second-Mile Service':['Understands the second-mile service portion of Winning Hearts Everyday','Language of Hospitality','Proactive','Personal','Generous','Attentive and Friendly','Above and Beyond','Emotional Connections','Service Recovery']},
  'FOH Basic Training':{'Guest Experience':['Uses CORE 4 with guests','Practice order taking','Practice payment handling','Review restaurant service expectations']},
  'Bagger Training':{'Bagging':['Bags all food items with reasonable speed and excellent accuracy','Understands what bags to use and when','Proficient communication with the BOH team','Basic understanding of the bagging matrix and dine-ready meals','Understands Prep Kanban system','Understands the KPS and bump bar system','Proficient communication with the saucer/stuffer position when applicable','Utilizes CORE 4 when handing out food to guests','Awareness of mobile and third-party beverage screen and prepares items when applicable','Sanitizes the chutes and other food prep surfaces every 4 hours']},
  'FSA Assessments':{'Assessment Check':['Complete the trainer assessment','Review areas for continued practice']},
  'RSA Assessments':{'Assessment Check':['Complete the restaurant safety assessment','Review areas for continued practice']},
  'Closing':{'FOH Closing':['Lowboy fridge is cleaned and polished','Sauce wall is stocked and surrounding countertop is clean','Tea brewer parts are emptied, cleaned, and returned to the correct location','Dry storage items are stocked and organized appropriately','All countertops are cleaned and sanitized with no residue','Line stanchions are separated and stowed away','Floor is swept, scrubbed, squeegeed, and mopped','FOH closet floor is swept underneath shelving']}
 };
 let position=0;for(const [title,sections]of Object.entries(foh)){const id='foh-'+position;data.categories.push({id,title,description:'Select a team member in Trainer View to record training status.',department:'FOH',position:position++});let p=0;for(const [section,names]of Object.entries(sections))for(const t of names)data.items.push({id:id+'-'+p,category_id:id,section,title:t,notes:'',link:'',position:p++,hidden:false});}
 return data;
}
