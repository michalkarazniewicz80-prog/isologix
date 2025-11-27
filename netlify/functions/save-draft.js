const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { user_id, title, payload } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("iso_drafts")
      .insert([{ user_id, title, payload }])
      .select("*");

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, draft: data[0] }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
