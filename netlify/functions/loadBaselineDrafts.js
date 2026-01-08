// netlify/functions/loadBaselineDrafts.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env' }) };

    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization token' }) };
    const token = authHeader.split(' ')[1];

    // verify token & get user
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

    // Now fetch drafts for that user (RLS will also apply)
    const url = `${SUPABASE_URL}/rest/v1/drafts?user_id=eq.${encodeURIComponent(user_id)}&select=id,title,data,updated_at&order=updated_at.desc`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ drafts: data }) };
  } catch (err) {
    console.error('loadBaselineDrafts error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'server error' }) };
  }
};
