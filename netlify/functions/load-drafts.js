const { createClient } = require("@supabase/supabase-js");

exports.handler = async () => {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // user_id comes from query param
    const user_id = event.queryStringParameters.user_id;

    const { data, error } = await supabase
      .from("iso_drafts")
      .select("*")
      .eq("user_id", user_id)
      .order("id", { ascending: false });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error }) };
    }

    return { statusCode: 200, body: JSON.stringify({ drafts: data }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
