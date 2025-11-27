const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  try {
    const { title, data, user_id } = JSON.parse(event.body);
    if (!title || !data || !user_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Title, data, and user_id are required" }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;  // correct
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data: saved, error } = await supabase
      .from('iso_drafts')
      .upsert(
        { user_id, title, data, updated_at: new Date().toISOString() },
        { onConflict: ['user_id','title'], returning: 'representation' }
      );

    if (error) {
      console.error("Supabase save error:", error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, saved }) };

  } catch (err) {
    console.error("saveDraft handler error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
