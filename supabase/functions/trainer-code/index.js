const SITE = 'https://cfatulare.onrender.com';
const ACTIONS = new Set(['sign_in', 'sign_out', 'team', 'save_progress', 'save_overall', 'add_member', 'assign_department']);
const TRAINING_AREAS = new Set(['FOH', 'BOH', 'BOTH']);
const ERRORS = {
  invalid_request: [400, 'Check the code or training entry and try again.'],
  invalid_code: [401, 'That trainer code is incorrect.'],
  session_expired: [401, 'Your trainer session expired. Enter the trainer code again.'],
  wrong_department: [409, 'This trainee or checklist is no longer in the selected department. Refresh and try again.'],
  limited: [429, 'Too many incorrect trainer codes. Try again later.'],
  unavailable: [503, 'Trainer sign-in is temporarily unavailable. Try again in a moment.'],
};

export function createTrainerHandler({projectUrl, serviceKey, transport = fetch}) {
  return async function handler(req) {
    const headers = {
      'Vary': 'Origin', 'Cache-Control': 'no-store, private',
      'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff',
    };
    const send = (status, value) => new Response(JSON.stringify(value), {status, headers});
    const fail = (code, delay) => {
      const [status, message] = ERRORS[code];
      if (code === 'limited' && Number.isInteger(delay) && delay > 0 && delay <= 86400) {
        headers['Retry-After'] = String(delay);
      }
      return send(status, {code, message});
    };
    if (req.headers.get('origin') !== SITE) return send(403, {code:'forbidden'});
    Object.assign(headers, {
      'Access-Control-Allow-Origin': SITE,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'apikey, content-type',
      'Access-Control-Expose-Headers': 'Retry-After',
    });
    if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (req.method !== 'POST') return send(405, {code:'method_not_allowed'});
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return fail('invalid_request');
    }

    let data;
    try {
      const reader = req.body.getReader();
      const decoder = new TextDecoder('utf-8', {fatal:true});
      let text = '', size = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return fail('invalid_request');
        }
        text += decoder.decode(value, {stream:true});
      }
      data = JSON.parse(text + decoder.decode());
    } catch { return fail('invalid_request'); }
    if (!data || typeof data !== 'object' || !ACTIONS.has(data.action)) return fail('invalid_request');
    const {action} = data;
    const input = {};
    if (action === 'sign_in') {
      if (typeof data.pin !== 'string' || !/^[0-9]{5,12}$/.test(data.pin)) return fail('invalid_request');
      input.pin = data.pin;
    } else {
      if (typeof data.token !== 'string' || !/^[0-9a-f]{64}$/.test(data.token)) return fail('session_expired');
      input.token = data.token;
      if (action === 'add_member') {
        const name = typeof data.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
        if (!name || Array.from(name).length > 100 || !TRAINING_AREAS.has(data.training_area)) {
          return fail('invalid_request');
        }
        input.name = name;
        input.training_area = data.training_area;
      }
      if (action === 'save_progress' || action === 'save_overall' || action === 'assign_department') {
        if (typeof data.member_id !== 'string' || !data.member_id || data.member_id.length > 160) {
          return fail('invalid_request');
        }
        input.member_id = data.member_id;
        if (action === 'save_progress') {
          if (typeof data.item_id !== 'string' || !data.item_id || data.item_id.length > 160 ||
              !['Not started','In Training','Trained'].includes(data.status)) return fail('invalid_request');
          input.item_id = data.item_id;
          input.status = data.status;
        } else if (action === 'save_overall') {
          if (!['BOH','FOH'].includes(data.department) || !['In Training','Trained'].includes(data.status)) {
            return fail('invalid_request');
          }
          input.department = data.department;
          input.status = data.status;
        } else {
          if (!TRAINING_AREAS.has(data.training_area)) return fail('invalid_request');
          input.training_area = data.training_area;
        }
      }
    }
    if (!projectUrl || !serviceKey) return fail('unavailable');

    // This endpoint does its own authentication. The server credential never
    // leaves the function; the RPC admits only valid code-issued sessions.
    try {
      const response = await transport(projectUrl + '/rest/v1/rpc/training_trainer_code', {
        method:'POST',
        headers:{apikey:serviceKey, Authorization:'Bearer '+serviceKey, 'Content-Type':'application/json'},
        body:JSON.stringify({p_action:action, p_data:input}),
        signal:AbortSignal.timeout(8000),
      });
      if (!response.ok) return fail('unavailable');
      const result = await response.json();
      if (Object.hasOwn(ERRORS, result?.error)) return fail(result.error, result.retry_after);
      if (action === 'sign_in' && /^[0-9a-f]{64}$/.test(result?.token) &&
          Number.isSafeInteger(result.expires_at)) {
        return send(200, {token:result.token, expires_at:result.expires_at});
      }
      if (action === 'team' && Array.isArray(result?.members) && Array.isArray(result?.progress)) {
        return send(200, {members:result.members, progress:result.progress});
      }
      if (action === 'add_member' && typeof result?.id === 'string' && /^[0-9a-f-]{36}$/.test(result.id)) {
        return send(200, {id:result.id});
      }
      if (['sign_out','save_progress','save_overall','assign_department'].includes(action) && result?.ok === true) {
        return send(200, {ok:true});
      }
    } catch { /* Do not log request bodies, credentials, or upstream results. */ }
    return fail('unavailable');
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createTrainerHandler({
    projectUrl:Deno.env.get('SUPABASE_URL'),
    serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }));
}
