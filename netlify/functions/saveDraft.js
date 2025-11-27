const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  try {
    const { title, data } = JSON.parse(event.body);
    if (!title || !data) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Title and data are required" }),
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // RLS uses auth.uid() so no user_id passed manually
    const { data: saved, error } = await supabase
      .from('iso_drafts')
      .insert([{ title, data }]); 

    if (error) {
      console.error("Supabase save error:", error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, saved }),
    };

  } catch (err) {
    console.error("saveDraft handler error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
