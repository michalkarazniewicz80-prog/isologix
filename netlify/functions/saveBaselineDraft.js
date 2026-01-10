// netlify/functions/saveBaselineDraft.js
const fetch = require('node-fetch'); // ensure package.json has node-fetch as dependency

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env' }) };

    const body = JSON.parse(event.body || '{}');
    const { title, data, form_data, id } = body;
    const draftData = form_data ?? data;
    if (!title || !draftData) return { statusCode: 400, body: JSON.stringify({ error: 'title and form_data required' }) };
    if (!draftData.draft_title) draftData.draft_title = title;

    // Expect client's Authorization header: "Bearer <access_token>"
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization token' }) };
    const token = authHeader.split(' ')[1];

    // 1) verify token & get user
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!userResp.ok) {
      const txt = await userResp.text();
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token', detail: txt }) };
    }
    const user = await userResp.json();
    const user_id = user?.id;
    if (!user_id) return { statusCode: 401, body: JSON.stringify({ error: 'Unable to get user id' }) };

    // 2) Upsert via PostgREST; forward the user's JWT to have RLS apply as that user
    const payload = {
      user_id,
      form_data: draftData,
      updated_at: new Date().toISOString()
    };

    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload)
    };

    let resp;
    if (id) {
      const url = `${SUPABASE_URL}/rest/v1/drafts?id=eq.${encodeURIComponent(id)}`;
      resp = await fetch(url, {
        method: 'PATCH',
        ...requestConfig
      });
    } else {
      const url = `${SUPABASE_URL}/rest/v1/drafts`;
      resp = await fetch(url, {
        method: 'POST',
        ...requestConfig
      });
    }

    const respJson = await resp.json();
    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: respJson }) };
    }

    const saved = Array.isArray(respJson) ? respJson[0] : respJson;
    return { statusCode: 200, body: JSON.stringify({ success: true, saved, id: saved?.id }) };
  } catch (err) {
    console.error('saveBaselineDraft error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'server error' }) };
  }
};
