import {createHash,timingSafeEqual} from 'node:crypto';

const SITE = 'https://cfatulare.onrender.com';
const DIGITS = /^[0-9]{16,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = {
  invalid_request: [400, 'Enter the owner passcode using 16–24 digits.'],
  invalid_code: [401, 'That owner passcode is incorrect.'],
  forbidden: [403, 'Owner passcode sign-in is only available on the training site.'],
  mfa_required: [403, 'This account uses an additional sign-in check. Use your regular owner sign-in.'],
  limited: [429, 'Too many owner sign-in attempts. Try again later.'],
  not_configured: [503, 'The owner passcode has not been set up yet.'],
  unavailable: [503, 'Owner sign-in is temporarily unavailable. Try again in a moment.'],
};
const digest = value => createHash('sha256').update(value,'utf8').digest();
function configuredPasscode(value) {
  return typeof value==='string' && DIGITS.test(value) && new Set(value).size>=5
    && !/^([0-9]{1,4})\1+$/.test(value);
}

async function readCode(req) {
  const reader=req.body?.getReader();
  if(!reader) return null;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let length=0, text='';
  for(;;){
    const {done,value}=await reader.read();
    if(done) break;
    length+=value.byteLength;
    if(length>256){await reader.cancel();return null;}
    text+=decoder.decode(value,{stream:true});
  }
  const value=JSON.parse(text+decoder.decode());
  return typeof value?.code==='string'&&DIGITS.test(value.code)?value.code:null;
}

export function createOwnerHandler({projectUrl,serviceKey,publicKey,getPasscode,transport=fetch}) {
  return async function handler(req) {
    const headers = {
      'Vary':'Origin', 'Cache-Control':'no-store, private', 'Content-Type':'application/json',
      'X-Content-Type-Options':'nosniff',
    };
    const send=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    const fail=(reason,delay)=>{
      const [status,message]=ERRORS[reason];
      if(reason==='limited'&&Number.isSafeInteger(delay)&&delay>0&&delay<=86400)headers['Retry-After']=String(delay);
      return send(status,{code:reason,message});
    };
    if(req.headers.get('origin')!==SITE) return fail('forbidden');
    Object.assign(headers,{
      'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'apikey, content-type','Access-Control-Expose-Headers':'Retry-After',
    });
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(req.method!=='POST') return send(405,{code:'method_not_allowed'});
    if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') return fail('invalid_request');
    let candidate;
    try {candidate=await readCode(req);} catch {return fail('invalid_request');}
    if(!candidate) return fail('invalid_request');

    try {
      const passcode=getPasscode();
      if(!configuredPasscode(passcode)) return fail('not_configured');
      if(!projectUrl||!serviceKey||!publicKey) return fail('unavailable');
      const same=timingSafeEqual(digest(candidate),digest(passcode));
      const adminHeaders={apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'};
      const authHeaders={apikey:publicKey,'Content-Type':'application/json'};
      const call=(path,options)=>transport(projectUrl+path,{...options,signal:AbortSignal.timeout(6000)});
      const check=await call('/rest/v1/rpc/training_owner_code_attempt',{
        method:'POST',headers:adminHeaders,body:JSON.stringify({p_match:same}),
      });
      if(!check.ok) return fail('unavailable');
      const allowed=await check.json();
      if(allowed?.error==='limited') return fail('limited',allowed.retry_after);
      if(!same) return fail(allowed?.error==='invalid_code'?'invalid_code':'unavailable');
      const id=allowed?.owner_id;
      if(typeof id!=='string'||!UUID.test(id)) return fail('unavailable');

      const userPath='/auth/v1/admin/users/'+id;
      const [identityResponse,factorResponse]=await Promise.all([
        call(userPath,{headers:adminHeaders}),
        call(userPath+'/factors',{headers:adminHeaders}),
      ]);
      if(!identityResponse.ok||!factorResponse.ok) return fail('unavailable');
      const identityBody=await identityResponse.json();
      const identity=identityBody?.user??identityBody;
      const factorBody=await factorResponse.json();
      // GoTrue can return a JSON null slice when there are no factors.
      const factors=factorBody===null?[]:Array.isArray(factorBody)?factorBody:factorBody?.factors;
      if(!Array.isArray(factors)) return fail('unavailable');
      if(factors.some(f=>f?.status!=='unverified')||
         (Array.isArray(identity?.factors)&&identity.factors.some(f=>f?.status!=='unverified'))) return fail('mfa_required');
      if(identity?.id!==id||typeof identity.email!=='string'||!identity.email_confirmed_at||
         identity.is_anonymous===true||identity.is_sso_user===true||identity.deleted_at||
         (identity.banned_until&&Date.parse(identity.banned_until)>Date.now())) return fail('unavailable');

      // Supabase's admin API generates a one-time token without sending mail.
      // Redeem it here; neither the link nor any admin credential leaves the server.
      const issued=await call('/auth/v1/admin/generate_link',{
        method:'POST',headers:adminHeaders,body:JSON.stringify({type:'magiclink',email:identity.email}),
      });
      if(issued.status===429) return fail('limited',Number(issued.headers.get('Retry-After')));
      if(!issued.ok) return fail('unavailable');
      const link=await issued.json();
      const oneTimeToken=link?.properties?.hashed_token??link?.hashed_token;
      if((link?.user?.id??link?.id)!==id||typeof oneTimeToken!=='string'||!oneTimeToken) return fail('unavailable');
      const verified=await call('/auth/v1/verify',{
        method:'POST',headers:authHeaders,body:JSON.stringify({type:'magiclink',token_hash:oneTimeToken}),
      });
      if(verified.status===429) return fail('limited',Number(verified.headers.get('Retry-After')));
      if(!verified.ok) return fail('unavailable');
      const result=await verified.json();
      if(result?.user?.id!==id||typeof result.access_token!=='string'||!result.access_token||
         typeof result.refresh_token!=='string'||!result.refresh_token||
         !Number.isSafeInteger(result.expires_in)||result.expires_in<1) return fail('unavailable');
      return send(200,{
        access_token:result.access_token,refresh_token:result.refresh_token,expires_in:result.expires_in,
        ...(Number.isSafeInteger(result.expires_at)?{expires_at:result.expires_at}:{}),
      });
    } catch {return fail('unavailable');}
  };
}

if(typeof Deno!=='undefined'){
  Deno.serve(createOwnerHandler({
    projectUrl:Deno.env.get('SUPABASE_URL'),
    serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    publicKey:Deno.env.get('SUPABASE_ANON_KEY'),
    getPasscode:()=>Deno.env.get('TRAINING_OWNER_PASSCODE'),
  }));
}
