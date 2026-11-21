import {TrainingStore,stats,trainingAreas,memberTrainingArea,memberInDepartment,isCrossTrained,categoriesInOrder} from './store.js';
import {getBohBuild,renderBuildDiagram} from './boh-builds.js';
const store=new TrainingStore(localStorage,window.TRAINING_CONFIG||{},sessionStorage);let page='training',categoryId=null,sectionView=null,department=localStorage.getItem('training-department')||'FOH',memberId='',filter='All',search='',editing=false,busy=false,loaded=!store.cloud,loadError='',itemDraft=null;const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M20 4h-4a3 3 0 0 0-3 3 M20 4v15h-3',check:'m5 12 4 4 10-10',team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',chart:'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2 2 M16.4 16.4l2 2 M5.6 18.4l2-2 M16.4 7.6l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',arrow:'M5 12h14 M14 7l5 5-5 5',back:'M19 12H5 M10 7l-5 5 5 5',link:'M15 3h6v6 M10 14 21 3 M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5',search:'M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z',clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',clipboard:'M9 5H5v16h14V5h-4 M9 3h6v4H9z M8 12h8 M8 16h5',plus:'M12 5v14 M5 12h14',close:'m6 6 12 12 M6 18 18 6',fire:'M12 2c0 7-7 7-7 13a7 7 0 0 0 14 0c0-4-4-5-4-9-1 4-3 5-3 7'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n]||paths.clipboard}"/></svg>`;
function badge(s){return `<span class="badge ${s==='Trained'?'trained':s==='In Training'?'training':''}">${esc(s)}</span>`;}
function toast(message,error=false){const el=document.querySelector('#toast');el.textContent=message;el.style.display='block';el.style.background=error?'#9b1e36':'#293c2e';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.style.display='none',4500);}
async function run(fn){if(busy){render();return;}busy=true;try{await fn();render();}catch(e){toast(e.message,true);}finally{busy=false;render();}}
let celebrationTimer,celebrationFocus='';
function closeTrainingCelebration(){
 clearTimeout(celebrationTimer);
 document.querySelector('#training-celebration')?.close();
}
function showTrainingCelebration(message,focusSelector){
 const celebration=document.querySelector('#training-celebration');
 if(!celebration)return;
 clearTimeout(celebrationTimer);
 celebration.querySelector('[data-celebration-message]').textContent=message;
 celebrationFocus=focusSelector;
 if(!celebration.open)celebration.showModal();
 celebrationTimer=setTimeout(closeTrainingCelebration,5200);
}
async function saveOverallTraining(id,area,status){
 const key='status_'+area.toLowerCase();
 const previous=store.data.members.find(m=>m.id===id)?.[key];
 await store.setOverallStatus(id,area,status);
 const member=store.data.members.find(m=>m.id===id);
 toast('Overall training status saved.');
 if(previous!=='Trained'&&status==='Trained'&&member?.[key]==='Trained'){
  const message=isCrossTrained(member)?`${member.name} is now trained in both FOH and BOH!`:`${member.name} is now trained in ${area}!`;
  showTrainingCelebration(message,`[data-overall-member="${CSS.escape(id)}"]`);
 }
}
async function saveTrainingProgress(id,itemId,status){
 const item=store.data.items.find(i=>i.id===itemId);
 const category=store.data.categories.find(c=>c.id===item?.category_id);
 const before=category?stats(store.data,id,category.id):null;
 await store.recordProgress(id,itemId,status);
 toast('Training progress saved.');
 const after=category?stats(store.data,id,category.id):null;
 const member=store.data.members.find(m=>m.id===id);
 if(member&&status==='Trained'&&before?.status!=='Trained'&&after?.status==='Trained'){
  showTrainingCelebration(`${member.name} completed ${category.title}!`,`[data-check="${CSS.escape(itemId)}"]`);
 }
}
const celebration=document.querySelector('#training-celebration');
celebration?.querySelectorAll('[data-close-celebration]').forEach(b=>b.addEventListener('click',closeTrainingCelebration));
celebration?.addEventListener('click',e=>{if(e.target===celebration){const r=celebration.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeTrainingCelebration();}});
celebration?.addEventListener('close',()=>{
 clearTimeout(celebrationTimer);
 document.querySelector(celebrationFocus||'#app')?.focus({preventScroll:true});
 celebrationFocus='';
});
const current=()=>store.data.members.find(m=>m.id===memberId);
function totalStats(){const sums=store.data.members.map(m=>stats(store.data,m.id));return {trained:sums.filter(s=>s.status==='Trained').length,inTraining:sums.filter(s=>s.status!=='Trained').length,average:sums.length?Math.round(sums.reduce((a,s)=>a+s.percent,0)/sums.length):0};}
const teamForDepartment=()=>store.data.members.filter(m=>memberInDepartment(m,department));
const addTeamButton=()=>store.canTrain()?'<button class="primary" data-action="add-member">Add Team Member</button>':'';
const areaLabel={FOH:'FOH',BOH:'BOH',BOTH:'FOH + BOH',UNASSIGNED:'Department not set'};
function cowBadge(m){
 if(!isCrossTrained(m))return '';
 return `<span class="cross-trained" title="Trained in FOH and BOH">
  <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" width="25" height="25">
   <path d="M9 9c-1-3-1-4 0-6 2 0 4 2 5 4m4 0c1-2 3-4 5-4 1 2 1 3 0 6" fill="#f6dcb6" stroke="#29252c" stroke-width="1.3" stroke-linejoin="round"/>
   <path d="M9 11C5 7 2 8 1 11c1 4 4 6 8 4m14-4c4-4 7-3 8 0-1 4-4 6-8 4" fill="#39333d" stroke="#29252c" stroke-width="1.2"/>
   <path d="M3 11c1-1 3 0 5 1-1 2-4 1-5-1m26 0c-1-1-3 0-5 1 1 2 4 1 5-1" fill="#f5a8b3"/>
   <path d="M10 24c1 4 3 6 6 6s5-2 6-6l-6 2Z" fill="#bf1940" stroke="#8d1330" stroke-width="1"/>
   <path d="M16 6c-7 0-10 4-10 10v4c0 5 4 7 10 7s10-2 10-7v-4c0-6-3-10-10-10Z" fill="#fffdfa" stroke="#29252c" stroke-width="1.4"/>
   <path d="M6.8 12.7C8 9.1 10 7.7 13.7 7c3 1 2.4 4.1.9 5.9-1.9 2.2-3.5 2.9-7.9 2.4Z" fill="#353039"/>
   <ellipse cx="16" cy="21.4" rx="7.1" ry="4.4" fill="#ffd0d8" stroke="#a75669" stroke-width=".8"/>
   <ellipse cx="11.2" cy="15.6" rx="1.45" ry="1.9" fill="#282330"/><ellipse cx="21" cy="15.6" rx="1.45" ry="1.9" fill="#282330"/>
   <circle cx="11.6" cy="15" r=".55" fill="#fff"/><circle cx="21.4" cy="15" r=".55" fill="#fff"/>
   <circle cx="13.5" cy="20.9" r=".7" fill="#82394e"/><circle cx="18.5" cy="20.9" r=".7" fill="#82394e"/>
   <path d="M14.6 22.5q1.4 1.3 2.8 0" fill="none" stroke="#82394e" stroke-width=".8" stroke-linecap="round"/>
  </svg><span>Cross-trained</span></span>`;
}
function progressSummary(st,label){
 return `<div class="team-meter"><div class="meter-line"><span>${st.total?`${st.trained} of ${st.total} items trained`:'No checklist items yet'}</span><strong>${st.total?`${st.percent}%`:'—'}</strong></div><progress aria-label="${esc(label)}" value="${st.trained}" max="${st.total||1}"></progress></div>`;
}
function selected(){
 const members=teamForDepartment(),active=current();
 const option=m=>`<option value="${esc(m.id)}" ${m.id===memberId?'selected':''}>${esc(m.name)}${memberTrainingArea(m)==='BOTH'?' (FOH + BOH)':''}</option>`;
 const assigned=members.filter(m=>memberTrainingArea(m)!=='UNASSIGNED'),unassigned=members.filter(m=>memberTrainingArea(m)==='UNASSIGNED');
 return `<div class="selector"><label for="member-select">${department} team member</label><select id="member-select" ${!members.length||store.profile?.role==='member'?'disabled':''}><option value="">Choose a team member</option>${assigned.length?`<optgroup label="${department} team">${assigned.map(option).join('')}</optgroup>`:''}${unassigned.length?`<optgroup label="Needs department">${unassigned.map(option).join('')}</optgroup>`:''}</select>${cowBadge(active)}<span class="tiny">${store.canTrain()?'Choose a name to record checklist progress.':'Your trainer records your training progress.'}</span></div>`;
}
function shell(content){const name=store.data.settings.name||'Restaurant Training';return `<header class="reference-header"><div class="header-inner"><div class="brand"><span class="brand-symbol">${icon('clipboard')}</span><strong>${esc(department)} TRAINING</strong></div><div class="actions"><button class="department-button ${department==='FOH'?'active':''}" data-department="FOH" aria-pressed="${department==='FOH'}">FOH</button><button class="department-button ${department==='BOH'?'active':''}" data-department="BOH" aria-pressed="${department==='BOH'}">BOH</button><button data-action="home">Home</button><button class="plain" data-nav="settings" aria-label="Workspace settings">${icon('settings')}</button></div></div></header><main class="reference-main">${!store.cloud?'<div class="demo-banner"><span><strong>Preview</strong> · Example team. Editable starter content. Saved on this device only.</span><button data-action="connect">Connect Supabase →</button></div>':`<div class="connection-status"><span class="dot ${store.profile?'green':''}"></span>${store.trainerSession?'Trainer workspace':store.profile?'Signed-in workspace':'Open training reference'}${store.profile?'<button class="plain" data-action="logout">Sign out</button>':signInButtons()}</div>`}${content}<footer><span>${esc(name)}</span><button class="plain" data-action="install">Add to home screen</button></footer></main><nav class="reference-nav" aria-label="Main navigation"><div>${[['training','Training'],['progress','My Progress'],['trainer','Trainer View']].map(([id,t])=>`<button class="${page===id?'active':''}" data-nav="${id}" ${page===id?'aria-current="page"':''}>${t}</button>`).join('')}</div></nav>`;}
function head(title,desc,actions='',eyebrow='YOUR TRAINING WORKSPACE',hero=false){
 return `<div class="page-head${hero?' training-hero':''}"><div class="page-head-copy"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="sub">${esc(desc)}</p></div>${actions?`<div class="actions">${actions}</div>`:''}${hero?'<div class="training-pattern-art" aria-hidden="true"><span class="pattern-stitch"></span><span class="pattern-diagonal"></span><span class="pattern-dots"></span><span class="pattern-stitch"></span></div>':''}</div>`;
}
function overview(){const n=totalStats();return `<div class="stats"><div class="stat"><div class="stat-label">Team members ${icon('team')}</div><strong>${store.data.members.length.toString().padStart(2,'0')}</strong><small>Learning and growing together</small></div><div class="stat"><div class="stat-label">In training ${icon('clock')}</div><strong>${n.inTraining.toString().padStart(2,'0')}</strong><small>${n.trained} fully trained across all categories</small></div><div class="stat"><div class="stat-label">Team completion ${icon('chart')}</div><strong>${n.average}%</strong><small>Average checklist completion</small></div></div>`;}
function training(){
 const categories=categoriesInOrder(store.data,department);
 const trainingIcon=c=>/welcome/i.test(c.title)?'team':/safety|assessment/i.test(c.title)?'shield':/closing/i.test(c.title)?'check':'book';
 return head(department+' Training','Build confidence, one skill at a time.','','LEARN. PRACTICE. GROW.',true)+
  `<div class="learning-path-heading"><h2>Your learning path</h2><span>${department==='FOH'?'Front of house':'Back of house'}</span></div>
  <div class="reference-menu">${categories.map((c,i)=>`<button class="training-tile${i===0&&/welcome/i.test(c.title)?' welcome-button':''}" data-category="${esc(c.id)}"><span class="training-tile-icon">${icon(trainingIcon(c))}</span><span class="training-tile-label">${esc(c.title)}</span></button>`).join('')}
   <button class="training-shortcut" data-nav="progress">${icon('chart')}<span>My Progress</span></button>
   ${store.canTrain()?'<button class="training-shortcut" data-action="add-member">'+icon('plus')+'<span>Add Team Member</span></button>':''}
   <button class="training-shortcut" data-nav="team">${icon('team')}<span>All Progress</span></button>
   ${store.canEdit()?'<button class="training-shortcut" data-action="open-editor">'+icon('clipboard')+'<span>Edit Training</span></button>':''}
  </div><p class="starter-note">Browse a training checklist and open its Pathway resources. Select FOH or BOH above to switch departments.</p>`;
}
const buildSteps=new Map();
let buildTimer;
function buildCaption(build,step){return `${step} of ${build.steps.length}: ${build.steps[step-1]}`;}
function buildControls(item,large=false){
 const build=getBohBuild(item.id);
 if(!build)return '';
 const step=buildSteps.get(item.id),art=renderBuildDiagram(item.id,step??build.steps.length),id=esc(item.id);
 const artwork=large?`<div class="build-artwork build-artwork-large" data-build-artwork="${id}">${art}</div>`:
  `<button type="button" class="build-thumbnail" data-build-enlarge="${id}" aria-label="Enlarge ${esc(item.title)} build">
   <span class="build-artwork" data-build-artwork="${id}">${art}</span><span>Tap to enlarge</span>
  </button>`;
 return `<div class="build-controls${large?' build-controls-large':''}">
  ${artwork}
  <button type="button" class="primary build-play" data-build-play="${id}"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1.5v9L10 6z" fill="currentColor"/></svg> Play / Replay build</button>
  <div class="build-step" role="status" data-build-step="${id}">${step?esc(buildCaption(build,step)):''}</div>
  ${large?`<ol class="build-legend" aria-label="Build order">${build.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}
 </div>`;
}
function showBuildStep(itemId,step){
 buildSteps.set(itemId,step);
 const build=getBohBuild(itemId),art=renderBuildDiagram(itemId,step,true);
 const visibleRoots=dialog.open?[app,dialog]:[app];
 for(const root of visibleRoots){
  root.querySelectorAll('[data-build-artwork]').forEach(el=>{if(el.dataset.buildArtwork===itemId)el.innerHTML=art;});
  root.querySelectorAll('[data-build-step]').forEach(el=>{if(el.dataset.buildStep===itemId)el.textContent=buildCaption(build,step);});
 }
}
function playBuild(itemId){
 const build=getBohBuild(itemId);
 if(!build)return;
 clearTimeout(buildTimer);
 const advance=(step)=>{
  showBuildStep(itemId,step);
  if(step<build.steps.length)buildTimer=setTimeout(()=>advance(step+1),1500);
 };
 advance(1);
}
function bindBuildControls(root){
 root.querySelectorAll('[data-build-play]').forEach(button=>button.onclick=()=>playBuild(button.dataset.buildPlay));
 root.querySelectorAll('[data-build-enlarge]').forEach(button=>button.onclick=()=>{
  const item=store.data.items.find(i=>i.id===button.dataset.buildEnlarge);
  if(!item||!getBohBuild(item.id))return;
  modal(item.title,buildControls(item,true));
  bindBuildControls(dialog);
 });
}
function trainingItem(item,showEdit){
 const progress=store.data.progress.find(p=>p.item_id===item.id&&p.member_id===memberId);
 const status=progress?.status||'Not started';
 const id=esc(item.id),title=esc(item.title),canRecord=store.canTrain()&&memberId&&!item.hidden;
 return `<div class="reference-item ${item.hidden?'hidden-item':''}">
  <label class="training-check-target"><input class="training-checkbox" type="checkbox" aria-label="Mark ${title} trained" data-check="${id}" ${status==='Trained'?'checked':''} ${canRecord?'':'disabled'}></label>
  <div class="item-info"><h3>${title}${item.hidden?' <span class="badge">Hidden</span>':''}</h3>
   ${item.notes?`<p class="item-instructions">${esc(item.notes)}</p>`:''}
   ${buildControls(item)}
   ${/^https:\/\//i.test(item.link)?`<a class="pathway-link" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Open Link ${icon('link')}</a>`:''}
   ${canRecord?`<select data-status="${id}" aria-label="Status for ${title}">${['Not started','In Training','Trained'].map(st=>`<option ${status===st?'selected':''}>${st}</option>`).join('')}</select>`:''}
   ${showEdit?`<div class="actions"><button data-edit-item="${id}">Edit</button>${item.hidden?`<button data-restore-item="${id}">Restore</button>`:`<button data-hide-item="${id}">Delete</button>`}</div>`:''}
  </div>
 </div>`;
}
function category(){
 const c=store.data.categories.find(c=>c.id===categoryId);
 if(!c){categoryId=null;return training();}
 const edit=store.canEdit(),isEditor=page==='editor',showEdit=edit&&(editing||isEditor);
 let items=store.data.items.filter(i=>i.category_id===c.id&&(showEdit||!i.hidden)).sort((a,b)=>a.position-b.position);
 const sectionName=i=>i.section||'Training checklist';
 const sections=[...new Set(items.map(sectionName))];
 if(c.title==='Closing'&&department==='BOH'&&!sectionView&&!isEditor)return head('Closing','Choose a closing area.',edit?'<button data-action="open-editor">Edit Training</button>':'')+`<div class="reference-menu">${sections.map(section=>`<button data-section-view="${esc(section)}">${esc(section)}<span>›</span></button>`).join('')}</div><button class="back" data-action="back">${icon('back')} Back to training</button>`;
 if(sectionView&&!isEditor)items=items.filter(i=>i.section===sectionView);
 const shownSections=[...new Set(items.map(sectionName))];
 return head(isEditor?'Edit Training':sectionView||c.title,isEditor?`Reorder ${department} categories or edit the selected checklist.`:store.profile?'Select a team member in Trainer View to record training status.':'Browse this training checklist and its resources.')+
  (isEditor?`<select id="editor-category" aria-label="Training category">${categoriesInOrder(store.data,department).map(x=>`<option value="${esc(x.id)}" ${x.id===c.id?'selected':''}>${esc(x.title)}</option>`).join('')}</select><div class="editor-actions"><button class="reorder-entry" data-action="reorder-categories">Reorder Categories</button><button data-action="edit-category">Edit page title</button><button data-action="add-category">Add category</button></div>`:
   `<div class="editor-actions">${edit?'<button data-action="edit-category">Edit page title</button><button data-action="edit-mode">'+(editing?'Finish editing':'Edit Training')+'</button>'+(editing?'<button class="reorder-entry" data-action="reorder-categories">Reorder Categories</button>':''):''}</div>`)+
  (!isEditor&&(page==='trainer'||memberId)?selected():'')+
  (!isEditor&&memberId?progressSummary(stats(store.data,memberId,c.id),`${c.title} completion for ${current()?.name}`):'')+
  shownSections.map(section=>`<section class="panel"><div class="panel-heading"><h3>${esc(section)}</h3>${showEdit?`<button data-edit-section="${esc(section)}">Edit heading</button>`:''}</div>
   ${items.filter(i=>sectionName(i)===section).map(i=>trainingItem(i,showEdit)).join('')}
   ${showEdit?`<button class="add-item" data-add-section-item="${esc(section)}">Add Item</button>`:''}
  </section>`).join('')+
  (showEdit?'<button class="primary" data-action="add-item">+ Add item or section</button>':'')+
  (!items.length?'<div class="empty"><h3>This checklist is ready for your content</h3><p>Use Edit Training to add items, notes, and Pathway links.</p></div>':'')+
  (sectionView?'<button class="back" data-action="closing-back">Back to closing areas</button>':'');
}
function myProgress(trainer=false){
 const title=trainer?'Trainer View':'My Progress';
 if(store.cloud&&!store.profile)return restricted(title);
 if(trainer&&!store.canTrain())return head(title,'Your trainer records checklist progress.')+'<div class="empty"><p>Ask your project owner for trainer access.</p></div>';
 const categories=categoriesInOrder(store.data,department),member=current();
 return head(title,trainer?`Add a ${department} team member, or select one and open a checklist to record training.`:`See checklist completion for ${department}.`,trainer?addTeamButton()+'<button data-nav="team">All Progress</button>':'')+selected()+
  (member?progressSummary(stats(store.data,memberId,null,department),`Overall ${department} checklist progress for ${member.name}`)+categories.map(c=>{
   const st=stats(store.data,memberId,c.id);
   return `<button class="progress-card" data-category="${esc(c.id)}"><h3>${esc(c.title)}</h3><div class="progress-bar" aria-hidden="true"><span style="width:${st.percent}%"></span></div><p>${st.trained} of ${st.total} trained · ${st.percent}%</p></button>`;
  }).join(''):'<div class="empty"><h3>'+ (teamForDepartment().length?'Choose a team member':`No ${department} team members yet`)+'</h3><p>'+ (teamForDepartment().length?'Select a name above to see category progress.':trainer?'Use Add Team Member to get started.':'Progress will appear once a trainer adds a team member.')+'</p></div>');
}
function teamCard(m){
 const status=m['status_'+department.toLowerCase()]||'In Training',name=esc(m.name),id=esc(m.id);
 return `<section class="panel team-progress"><div class="panel-heading"><div><h3 class="roster-name">${name}${cowBadge(m)}</h3><span class="roster-department">${areaLabel[memberTrainingArea(m)]}</span></div>
  ${store.canTrain()?`<button data-edit-member="${id}">${store.canManageTeam()?'Edit member':'Change department'}</button>`:''}</div>
  ${progressSummary(stats(store.data,m.id,null,department),`${department} checklist progress for ${m.name}`)}
  <div class="overall-control"><label for="overall-${id}">Overall ${department} status</label>
  ${store.canTrain()?`<select id="overall-${id}" class="overall-status ${status==='Trained'?'is-trained':''}" data-overall-member="${id}" aria-label="Overall ${department} status for ${name}"><option ${status==='In Training'?'selected':''}>In Training</option><option ${status==='Trained'?'selected':''}>Trained</option></select>`:badge(status)}</div>
  <button class="open-progress" data-view-member="${id}">Open ${name}’s checklists <span>›</span></button></section>`;
}
function team(){
 if(store.cloud&&!store.profile)return restricted('All Progress');
 const roster=teamForDepartment(),assigned=roster.filter(m=>memberTrainingArea(m)!=='UNASSIGNED'),unassigned=roster.filter(m=>memberTrainingArea(m)==='UNASSIGNED');
 return head('All Progress',`Showing the ${department} team. People assigned to both departments appear in both lists.`,addTeamButton())+
  `<h2 class="roster-group-heading">${department} team <span>${assigned.length}</span></h2>`+
  (assigned.length?assigned.map(teamCard).join(''):`<div class="empty"><h3>No ${department} team members yet</h3><p>${store.canTrain()?'Add someone or assign an existing member to this department.':'Assigned team members will appear here.'}</p></div>`)+
  (unassigned.length?'<h2 class="roster-group-heading">Needs department</h2><p class="helper">Assign these team members to FOH, BOH, or both. Their previous progress stays with them.</p>'+unassigned.map(teamCard).join(''):'')+
  '<p class="status-note">The bar counts checked-off items. The cow appears when a team member assigned to both departments is marked Trained in both.</p>';
}
function settings(){if(store.trainerSession)return head('Trainer workspace','You can view and record training progress.')+'<section class="panel"><h2>Add to home screen</h2><button data-action="install">Installation instructions</button></section>';if(store.cloud&&!store.profile)return head('Restaurant Training','Training resources for your team.')+'<section class="panel"><h2>Add to home screen</h2><p class="helper">Open this app in Safari on your phone or iPad, tap Share, then Add to Home Screen.</p><button data-action="install">Installation instructions</button></section><div class="actions">'+signInButtons()+'</div>';return head('Make it your restaurant.','Set up your workspace, keep a backup, and connect your team.','','WORKSPACE SETTINGS')+`<div class="settings-grid"><section class="panel"><div class="eyebrow">YOUR WORKSPACE</div><h2 style="margin-top:12px">Restaurant details</h2><p>${esc(store.data.settings.name)}</p>${store.canEdit()?'<button data-action="rename">Edit restaurant name</button>':''}</section><section class="panel"><div class="eyebrow">SHARED TRAINING</div><h2 style="margin-top:12px">${store.cloud?'Supabase connection':'Bring your team together'}</h2><p>${store.cloud?'Training content and progress are read from your Supabase project. Sign in on another device with the same project to see shared changes.':'This preview saves to this browser. Connect a Supabase project to keep training and progress consistent across devices.'}</p><div class="actions"><button class="primary" data-action="connect">${store.cloud?'Connection settings':'Connect Supabase'}</button><button data-action="setup">Setup guide</button></div></section><section class="panel"><div class="eyebrow">AT YOUR FINGERTIPS</div><h2 style="margin-top:12px">Add to home screen</h2><p>Keep training one tap away on your phone or iPad. Open in Safari, tap Share, then Add to Home Screen.</p><button data-action="install">Installation instructions</button></section><section class="panel"><div class="eyebrow">A COPY YOU CAN KEEP</div><h2 style="margin-top:12px">Backup your training</h2><p>Download your categories, checklist items, team records, and progress as JSON. Code versions are saved separately.</p><button data-action="backup">Download data backup</button></section></div><p class="status-note">Pathway links open in Pathway. Team members may need to sign in there. Opening a link does not automatically complete an item.</p>`;}
function restricted(title){return head(title,'A leader sign-in is required to view or record team progress.')+'<div class="empty"><h3>Owner and trainer access</h3><p>Training checklists are open to view. Sign in as a leader to work with team records.</p><div class="actions">'+signInButtons()+'</div></div>';}
function render(){if(itemDraft&&!store.canEdit())itemDraft=null;if(store.cloud&&store.profile?.role==='member')memberId=teamForDepartment().find(m=>m.auth_user_id===store.session?.user.id)?.id||'';else if(memberId&&!memberInDepartment(current(),department))memberId='';app.innerHTML=shell(!loaded?'<div class="loading">Loading training…</div>':loadError?'<div class="empty"><h3>Could not load training</h3><p>'+esc(loadError)+'</p><button data-action="reload-training">Try again</button></div>':itemDraft?bohItemEditor():categoryId?category():({training,progress:()=>myProgress(),trainer:()=>myProgress(true),team,settings,editor:()=>head('Edit Training','Add your first training category.')+'<button class="primary" data-action="add-category">Add category</button>'}[page])());bind();}
function modal(title,body,onSubmit,successMessage='Saved successfully.'){
 dialog.innerHTML=`<div class="modal-top"><h2>${esc(title)}</h2><button class="plain" data-close aria-label="Close dialog">${icon('close')}</button></div>${body}`;
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>dialog.close());
 const f=dialog.querySelector('form');
 if(f)f.onsubmit=async e=>{
  e.preventDefault();const button=f.querySelector('[type=submit]'),label=button.textContent;button.disabled=true;button.textContent='Working…';f.querySelector('.form-error').textContent='';
  try{
   const close=await onSubmit(new FormData(f));
   if(close===false||f!==dialog.querySelector('form')||!dialog.open)return;
   dialog.close();render();toast(successMessage);
  }catch(err){if(f===dialog.querySelector('form'))f.querySelector('.form-error').textContent=err.message;}
  finally{button.disabled=false;button.textContent=label;}
 };
 if(!dialog.open)dialog.showModal();
}
const field=(label,name,value='',type='text',required=false)=>`<div class="field"><label for="f-${name}">${label}</label>${type==='textarea'?`<textarea id="f-${name}" name="${name}">${esc(value)}</textarea>`:`<input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${name==='password'?'autocomplete="current-password"':''}>`}</div>`;
const form=(body,button='Save')=>`<form>${body}<p class="form-error" role="alert"></p><div class="form-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${button}</button></div></form>`;
function editCategory(c){
 if(!store.canEdit())return;
 modal(c?'Edit category':'Add category',form(field('Category name','title',c?.title||'','text',true)+field('Description','description',c?.description||'','textarea')+(c?'<button type="button" class="danger" id="delete-category">Delete category and its items</button>':'')),async f=>{
  const title=f.get('title').trim(),description=f.get('description').trim();
  if(!title)throw Error('Enter a category name.');
  if(c){await store.renameCategory(c.id,title,description);return;}
  const last=categoriesInOrder(store.data,department).at(-1);
  await store.save('categories',{id:crypto.randomUUID(),title,description,department,position:last?last.position+1:0});
 });
 if(c)dialog.querySelector('#delete-category').onclick=()=>{dialog.close();confirmDelete('categories',c.id,c.title);};
}
function openCategoryOrder(){
 if(!store.canEdit())return;
 const area=department,original=categoriesInOrder(store.data,area);
 if(original.length<2){modal(`Reorder ${area} Categories`,'<p class="helper">Add at least two categories to change their order.</p>');return;}
 const draft=[...original],before=original.map(c=>c.id);
 modal(`Reorder ${area} Categories`,form('<p class="helper">Use the arrows to move a category. Tap Save order to update this department’s training menu for everyone.</p><ol class="category-order-list" role="list"></ol><p class="category-order-status" role="status"></p>','Save order'),async()=>{
  const controls=[...dialog.querySelectorAll('[data-order-id],[data-close],[data-cancel]')];
  const disabled=controls.map(b=>b.disabled);
  controls.forEach(b=>b.disabled=true);
  const lockClose=e=>e.preventDefault();
  dialog.addEventListener('cancel',lockClose);
  try{
   await store.reorderCategories(area,before,draft.map(c=>c.id));
  }finally{
   controls.forEach((b,i)=>b.disabled=disabled[i]);
   dialog.removeEventListener('cancel',lockClose);
  }
 },`${area} category order saved.`);
 const list=dialog.querySelector('.category-order-list'),submit=dialog.querySelector('button[type=submit]');
 const status=dialog.querySelector('.category-order-status');
 function draw(focusId,delta){
  list.innerHTML=draft.map((c,i)=>`<li class="category-order-row"><span class="category-order-number" aria-hidden="true">${i+1}</span><span class="category-order-name">${esc(c.title)}</span><div class="category-order-buttons"><button type="button" data-order-id="${esc(c.id)}" data-order-move="-1" aria-label="Move ${esc(c.title)} up" ${i===0?'disabled':''}>↑</button><button type="button" data-order-id="${esc(c.id)}" data-order-move="1" aria-label="Move ${esc(c.title)} down" ${i===draft.length-1?'disabled':''}>↓</button></div></li>`).join('');
  submit.disabled=before.every((id,i)=>id===draft[i].id);
  if(focusId){
   const controls=[...list.querySelectorAll('[data-order-id]')].filter(b=>b.dataset.orderId===focusId&&!b.disabled);
   (controls.find(b=>Number(b.dataset.orderMove)===delta)||controls[0])?.focus({preventScroll:true});
  }
 }
 list.onclick=e=>{
  const button=e.target.closest('button[data-order-id]');
  if(!button||button.disabled)return;
  const index=draft.findIndex(c=>c.id===button.dataset.orderId),delta=Number(button.dataset.orderMove),next=index+delta;
  if(index<0||next<0||next>=draft.length)return;
  const moved=draft[index];
  [draft[index],draft[next]]=[draft[next],moved];
  draw(moved.id,delta);
  status.textContent=`${moved.title} is now ${next+1} of ${draft.length}.`;
 };
 draw();
}
async function saveTrainingItem(f,item,section,category){
 const title=f.get('title').trim();
 let link=f.get('link').trim();
 if(!title)throw Error('Enter a checklist title.');
 if(link){
  let target;try{target=new URL(link);}catch{}
  if(target?.protocol!=='https:')throw Error('Use an HTTPS link for your training resource.');
  link=target.href;
 }
 const latest=item?store.data.items.find(i=>i.id===item.id):null;
 if(item&&!latest)throw Error('This item is no longer in the checklist.');
 const lastPosition=Math.max(-1,...store.data.items.filter(i=>i.category_id===category).map(i=>i.position));
 await store.save('items',{
  id:latest?.id||crypto.randomUUID(),category_id:category,title,
  section:String(f.get('section')??section??'').trim()||'Training checklist',
  notes:f.get('notes').trim(),link,hidden:latest?.hidden??false,position:latest?.position??(lastPosition+1)
 });
}
function editItem(item,section){
 if(!store.canEdit()||!categoryId)return;
 if(department==='BOH'){
  itemDraft={item,section:item?.section||section||'Training checklist',category:categoryId,returnScroll:window.scrollY,askSection:!item&&!section};
  render();window.scrollTo(0,0);app.querySelector('#boh-editor-title')?.focus({preventScroll:true});
  return;
 }
 const category=categoryId;
 modal(item?'Edit training item':'Add training item',form(field('Checklist title','title',item?.title||'','text',true)+field('Section heading','section',item?.section||section||'Training checklist','text',true)+field('Training notes','notes',item?.notes||'','textarea')+field('Pathway link (optional)','link',item?.link||'','url')+'<p class="helper">Copy the actual resource link from Pathway. It opens in a new tab and may require Pathway sign-in.</p>'),f=>saveTrainingItem(f,item,section,category));
}
function bohItemEditor(){
 const {item,section,category,askSection}=itemDraft;
 const categoryName=store.data.categories.find(c=>c.id===category)?.title||'BOH';
 return `<section class="boh-item-editor" aria-labelledby="boh-editor-title">
  <p class="boh-editor-context">${esc(categoryName)} <span aria-hidden="true">›</span> ${esc(section)}</p>
  <h1 id="boh-editor-title" tabindex="-1">${item?'Edit Training Item':'Add Training Item'}</h1>
  <form id="boh-item-form">
   <div class="field"><label for="boh-item-title">Title</label><input id="boh-item-title" name="title" value="${esc(item?.title||'')}" required></div>
   <div class="field"><label for="boh-item-notes">Instructions</label><textarea id="boh-item-notes" name="notes" rows="6">${esc(item?.notes||'')}</textarea></div>
   <div class="field"><label for="boh-item-link">Link (optional)</label><input id="boh-item-link" name="link" type="url" placeholder="https://" value="${esc(item?.link||'')}"></div>
   <details class="boh-editor-section"${askSection?' open':''}><summary>Section heading</summary>
    <div class="field"><label for="boh-item-section">Heading name</label><input id="boh-item-section" name="section" value="${esc(section)}"></div>
   </details>
   <p class="form-error" role="alert"></p>
   <div class="form-actions"><button class="primary" type="submit">${item?'Save Changes':'Add Item'}</button><button type="button" data-cancel-item-editor>Cancel</button></div>
  </form>
 </section>`;
}
function closeBohEditor(){
 const scroll=itemDraft?.returnScroll||0;
 itemDraft=null;render();window.scrollTo(0,scroll);
}
function bindBohItemEditor(){
 const form=app.querySelector('#boh-item-form');
 if(!form)return;
 const submit=form.querySelector('[type=submit]'),cancel=form.querySelector('[data-cancel-item-editor]');
 cancel.onclick=closeBohEditor;
 form.onsubmit=async e=>{
  e.preventDefault();
  if(submit.disabled)return;
  const draft=itemDraft,label=submit.textContent,error=form.querySelector('.form-error');
  submit.disabled=cancel.disabled=true;submit.textContent='Saving…';error.textContent='';
  try{
   await saveTrainingItem(new FormData(form),draft.item,draft.section,draft.category);
   if(itemDraft===draft)closeBohEditor();
   toast('Training item saved.');
  }catch(e){if(itemDraft===draft)error.textContent=e.message;}
  finally{submit.disabled=cancel.disabled=false;submit.textContent=label;}
 };
}
function trainingAreaField(value,allowUnassigned=false){
 const options=allowUnassigned?[...trainingAreas,'UNASSIGNED']:trainingAreas;
 return `<div class="field"><label for="f-training-area">Training department</label><select id="f-training-area" name="training_area" required>${!options.includes(value)?'<option value="" disabled selected>Choose a department</option>':''}${options.map(area=>`<option value="${area}" ${area===value?'selected':''}>${areaLabel[area]}</option>`).join('')}</select></div>`;
}
function editMember(m){
 if(!store.canTrain())return;
 if(m&&!store.canManageTeam()){
  modal('Change department',form(`<p class="helper">Choose where <strong>${esc(m.name)}</strong> trains. Their progress will be kept.</p>`+trainingAreaField(memberTrainingArea(m)),'Save department'),
   async f=>store.assignMemberDepartment(m.id,f.get('training_area')),'Department saved.');
  return;
 }
 modal(m?'Edit team member':'Add team member',form(
  '<div class="field"><label for="f-name">Team member name</label><input id="f-name" name="name" type="text" required maxlength="100" value="'+esc(m?.name||'')+'"></div>'+
  trainingAreaField(m?memberTrainingArea(m):department,!!m)+
  (store.canManageTeam()?field('Position (optional)','role',m?.role||''):'')+
  (m?'<button type="button" class="danger" id="delete-member">Delete team member and progress</button>':''),
  m?'Save changes':'Add Team Member'),async f=>{
   const name=f.get('name'),area=f.get('training_area'),position=f.get('role')||'';
   if(m){await store.editTeamMember(m.id,name,area,position);return;}
   memberId=await store.addTeamMember(name,area,position);
   if(area!=='BOTH'&&area!==department){department=area;localStorage.setItem('training-department',area);}
   if(page!=='team')page='trainer';
   categoryId=null;sectionView=null;
  },m?'Team member updated.':'Team member added.');
 if(m)dialog.querySelector('#delete-member').onclick=()=>{dialog.close();confirmDelete('members',m.id,m.name);};
}
function confirmDelete(table,id,title){modal('Delete this record?',form(`<p class="helper">Delete “${esc(title)}”? ${table==='categories'?'Its checklist items and progress will also be removed.':table==='members'?'This team member’s progress will also be removed.':'Its recorded progress will also be removed.'} Download a backup first if you need to keep a copy.</p>`,'Delete'),async()=>{await store.remove(table,id);if(table==='categories')categoryId=null;});}
function signInButtons(){
 return `<span class="actions">${store.trainerCodeEnabled?'<button class="primary" data-action="trainer-code">Trainer code</button>':''}<button class="plain" data-action="owner-login">Owner sign-in</button></span>`;
}
function trainerCodeLogin(){
 if(!store.trainerCodeEnabled)return;
 modal('Trainer sign-in',form('<p class="helper">Enter your trainer code. No email is needed.</p><div class="field"><label for="trainer-pin">Trainer code</label><input id="trainer-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{5,12}" minlength="5" maxlength="12" autocomplete="off" required></div>','Sign in as trainer'),async f=>{
  await store.signInWithTrainerCode(f.get('pin'));
  page=page==='team'?'team':'trainer';categoryId=null;sectionView=null;memberId='';editing=false;render();
 },'Signed in as trainer.');
}
function openOwnerLogin(){
 if(!store.ownerCodeEnabled){ownerLogin();return;}
 modal('Owner sign-in',form('<p class="helper">Enter your private owner passcode. No email is needed.</p><div class="field"><label for="owner-passcode">Owner passcode</label><input id="owner-passcode" name="owner_passcode" type="password" inputmode="numeric" pattern="[0-9]{16,24}" minlength="16" maxlength="24" autocomplete="current-password" required></div><button type="button" id="use-owner-email">Use an email link instead</button>','Sign in as owner'),async f=>{
  await store.signInWithOwnerPasscode(f.get('owner_passcode'));
  localStorage.removeItem('training-pending-email');
  page='training';categoryId=null;sectionView=null;memberId='';editing=false;
 },'Signed in as owner.');
 dialog.querySelector('#use-owner-email').onclick=()=>ownerLogin();
}
function ownerLogin(email=localStorage.getItem('training-pending-email')||'',error=''){
 modal('Sign in by email',form('<p class="helper">Enter your approved owner or trainer email.</p>'+field('Email','email',email,'email',true)+'<div class="actions"><button type="button" id="existing-sign-in">I already have a link or code</button>'+(store.ownerCodeEnabled?'<button type="button" id="use-owner-passcode">Use owner passcode</button>':'')+'</div>','Send sign-in email'),async f=>{
  const email=f.get('email').trim(),sendingForm=dialog.querySelector('form');
  let notice='';
  try{await store.requestSignInLink(email,new URL('./',location.href).href);}
  catch(e){if(e.code!=='over_email_send_rate_limit')throw e;notice=e.message;}
  localStorage.setItem('training-pending-email',email);
  if(dialog.open&&dialog.querySelector('form')===sendingForm)ownerVerification(email,!notice,notice);
  return false;
 });
 dialog.querySelector('#existing-sign-in').onclick=()=>{const input=dialog.querySelector('[name=email]');if(input.reportValidity())ownerVerification(input.value.trim());};
 const usePasscode=dialog.querySelector('#use-owner-passcode');
 if(usePasscode)usePasscode.onclick=openOwnerLogin;
 if(error)dialog.querySelector('.form-error').textContent=error;
}
function ownerVerification(email,emailJustSent=false,notice=''){
 modal('Finish sign-in',form((notice?'<p class="helper" role="status">'+esc(notice)+'</p>':'')+'<p class="helper">'+(emailJustSent?'Email sent to ':'Signing in as ')+'<strong>'+esc(email)+'</strong>. Paste your email code or copy the link from the newest email without opening it.</p><p class="helper">Already clicked it and got a Safari error? Copy the address from that Safari tab and paste it below.</p>'+field('Email code or sign-in link','verification','','text',true)+'<button type="button" id="new-sign-in">Request a new email</button>','Verify and sign in'),async f=>{
  await store.verifySignIn(email,f.get('verification'));localStorage.removeItem('training-pending-email');page='training';categoryId=null;memberId='';
 },'Signed in successfully.');
 const verification=dialog.querySelector('[name=verification]');verification.autocomplete='one-time-code';verification.spellcheck=false;verification.setAttribute('autocapitalize','off');
 dialog.querySelector('#new-sign-in').onclick=()=>ownerLogin(email);
}
async function initializeTraining(){
 busy=true;let authError='',signedIn=false;
 const callback=new URL(location.href),fragment=new URLSearchParams(callback.hash.slice(1));
 const hasCallback=fragment.has('access_token')||fragment.has('error')||callback.searchParams.has('token_hash')||callback.searchParams.has('error');
 if(hasCallback){
  const clean=new URL(callback);clean.hash='';
  for(const key of ['token_hash','type','error','error_code','error_description'])clean.searchParams.delete(key);
  history.replaceState(null,'',clean.href);
 }
 try{
  try{if(hasCallback)signedIn=await store.handleAuthCallback(callback.href);else if(!(await store.restoreTrainerSession()))await store.restoreSession();}
  catch(e){authError=e.message;}
  if(store.profile){loaded=true;render();}else await loadTraining();
  if(signedIn){localStorage.removeItem('training-pending-email');toast('Signed in successfully.');}
  if(authError)ownerLogin(undefined,authError);
 }finally{busy=false;}
}
async function loadTraining(){loadError='';try{await store.load();loaded=true;}catch(e){loaded=true;loadError=e.message;}render();}
function connect(){modal('Connect your Supabase project',form('<p class="helper">Run the supplied schema in your project’s SQL Editor, create a user in Authentication, and grant owner access before signing in. Demo records are not copied to Supabase.</p>'+field('Project URL','url',store.config.url||'','url',true)+field('Publishable key / legacy anon key','key',store.config.key||'','text',true)+'<p class="helper">Find these under Project Settings → API. Use a publishable key only. Your secret or service-role key must never be used in this app.</p>','Save connection'),async f=>{store.configure(f.get('url'),f.get('key'));location.reload();});}
function setup(){modal('Set up your shared workspace',`<div class="helper"><ol><li>Create a Supabase project for this restaurant.</li><li><a href="./supabase-schema.sql" download>Download the database schema</a> and run it in Supabase’s SQL Editor.</li><li>Create a leader account under Authentication → Users. Copy its user ID.</li><li>Run the owner-access SQL from the setup guide with that user ID. Assign additional leaders as trainers.</li><li>Enter the project URL and publishable key in Connection settings. For all devices, put those two public values in <code>config.js</code> before publishing.</li><li>Add your restaurant’s approved checklists, Pathway links, and team members. Test the same account on a second device.</li></ol><p>The preview is hosted privately with Sites. GitHub Pages publication and your Supabase account setup have not been completed.</p><p><a href="./SETUP.md" download>Download the detailed GitHub + Supabase guide</a> · <a href="./source.zip" download>Download app source backup</a></p></div>`);}
function install(){modal('One tap to your training',`<div class="helper"><h3>iPhone or iPad</h3><p>Open this app in Safari. Tap Share, then <strong>Add to Home Screen</strong>. Confirm the name and tap Add.</p><h3>Android</h3><p>Open in Chrome, open the menu, then select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p>Your cloud workspace requires a connection to sign in and save changes. The demo is specific to this browser.</p></div>`);}
function bind(){bindBohItemEditor();bindBuildControls(app);app.querySelectorAll('[data-department]').forEach(b=>b.onclick=()=>{itemDraft=null;department=b.dataset.department;localStorage.setItem('training-department',department);categoryId=null;sectionView=null;if(!['trainer','progress','team'].includes(page))page='training';editing=false;render();});app.querySelector('#editor-category')?.addEventListener('change',e=>{categoryId=e.target.value;render();});app.querySelectorAll('[data-section-view]').forEach(b=>b.onclick=()=>{sectionView=b.dataset.sectionView;render();window.scrollTo(0,0);});app.querySelectorAll('[data-edit-section]').forEach(b=>b.onclick=()=>modal('Edit section heading',form(field('Section heading','section',b.dataset.editSection,'text',true)),async f=>{const name=f.get('section').trim();if(!name)throw Error('Enter a section heading.');await store.renameSection(categoryId,b.dataset.editSection,name);}));app.querySelectorAll('[data-add-section-item]').forEach(b=>b.onclick=()=>editItem(null,b.dataset.addSectionItem));app.querySelectorAll('[data-hide-item]').forEach(b=>b.onclick=()=>modal('Hide this training item?',form('<p class="helper">The item will be hidden from checklists and completion totals. You can restore it in Edit Training; existing progress is kept.</p>','Hide item'),async()=>{const item=store.data.items.find(i=>i.id===b.dataset.hideItem);await store.save('items',{...item,hidden:true});}));app.querySelectorAll('[data-restore-item]').forEach(b=>b.onclick=()=>run(async()=>{const item=store.data.items.find(i=>i.id===b.dataset.restoreItem);await store.save('items',{...item,hidden:false});toast('Item restored.');}));app.querySelectorAll('[data-overall-member]').forEach(el=>el.onchange=()=>run(async()=>{await saveOverallTraining(el.dataset.overallMember,department,el.value);}));app.querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>run(async()=>{await saveTrainingProgress(memberId,el.dataset.check,el.checked?'Trained':'Not started');}));app.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{itemDraft=null;page=b.dataset.nav;categoryId=null;sectionView=null;editing=false;search='';render();window.scrollTo(0,0);});app.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{categoryId=b.dataset.category;sectionView=null;render();window.scrollTo(0,0);});app.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});app.querySelector('#member-select')?.addEventListener('change',e=>{memberId=e.target.value;render();});app.querySelector('#search')?.addEventListener('input',e=>{search=e.target.value;const pos=e.target.selectionStart;render();const input=app.querySelector('#search');input.focus();input.setSelectionRange(pos,pos);});app.querySelectorAll('[data-status]').forEach(s=>s.onchange=()=>{const status=s.value;s.disabled=true;run(async()=>{await saveTrainingProgress(memberId,s.dataset.status,status);}).finally(()=>{s.disabled=false;render();});});app.querySelectorAll('[data-edit-item]').forEach(b=>b.onclick=()=>editItem(store.data.items.find(i=>i.id===b.dataset.editItem)));app.querySelectorAll('[data-delete-item]').forEach(b=>b.onclick=()=>confirmDelete('items',b.dataset.deleteItem,store.data.items.find(i=>i.id===b.dataset.deleteItem).title));app.querySelectorAll('[data-edit-member]').forEach(b=>b.onclick=()=>editMember(store.data.members.find(i=>i.id===b.dataset.editMember)));app.querySelectorAll('[data-view-member]').forEach(b=>b.onclick=()=>{memberId=b.dataset.viewMember;page=store.canTrain()?'trainer':'progress';categoryId=null;sectionView=null;render();window.scrollTo(0,0);});app.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.action;if(['home','back','logout'].includes(a))itemDraft=null;if(a==='edit-mode'){editing=!editing;render();}if(a==='open-editor'){page='editor';editing=true;sectionView=null;categoryId=categoryId||categoriesInOrder(store.data,department)[0]?.id;render();}if(a==='home'){page='training';categoryId=null;sectionView=null;editing=false;render();}if(a==='closing-back'){sectionView=null;render();}if(a==='back'){categoryId=null;render();}if(a==='welcome'){categoryId=store.data.categories.find(c=>/welcome/i.test(c.title))?.id;if(categoryId)render();else toast('Add a Welcome & Restaurant Tour category in Edit Training.');}if(a==='connect')connect();if(a==='owner-login')openOwnerLogin();if(a==='trainer-code')trainerCodeLogin();if(a==='reload-training')loadTraining();if(a==='setup')setup();if(a==='install')install();if(a==='add-category')editCategory();if(a==='reorder-categories')openCategoryOrder();if(a==='edit-category')editCategory(store.data.categories.find(c=>c.id===categoryId));if(a==='add-item')editItem();if(a==='add-member')editMember();if(a==='rename')modal('Restaurant name',form(field('Restaurant name','name',store.data.settings.name,'text',true)),async f=>{const name=f.get('name').trim();if(!name)throw Error('Enter a restaurant name.');await store.save('settings',{id:1,name});});if(a==='backup'){const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),mode:store.cloud?'supabase':'demo',...store.data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='training-backup-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}if(a==='logout')run(async()=>store.logout());});}

render();if(store.cloud)initializeTraining();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
setInterval(async()=>{if(store.cloud&&!busy&&!dialog.open&&!itemDraft&&(!store.trainerSession||Date.now()-store.trainerLastLoad>=60000)&&document.visibilityState==='visible'){busy=true;try{await store.load();if(!itemDraft)render();}catch(e){toast('Shared updates unavailable: '+e.message,true);}finally{busy=false;}}},15000);
