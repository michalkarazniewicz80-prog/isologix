const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  try {
    const { user_id } = JSON.parse(event.body);
    if (!user_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'user_id is required' }) };
    }

    onst SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from('iso_drafts')
      .select('id, title, data, updated_at')
      .eq('user_id', user_id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Supabase loadDrafts error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ drafts: data }) };

  } catch (err) {
    console.error('loadDrafts handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
