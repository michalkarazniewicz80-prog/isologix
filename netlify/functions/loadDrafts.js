const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Get drafts for the current logged-in user
    const { data, error } = await supabase
      .from('iso_drafts')
      .select('id, title, data, updated_at')
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

