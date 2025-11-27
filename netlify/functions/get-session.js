const fetch = require("node-fetch");

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // 1. Extract cookie header
  const cookieHeader = event.headers.cookie || event.headers.Cookie || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => c.trim().split("="))
  );

  // 2. Get our stored session token
  const token = cookies["sb_token"];
  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "No session" }),
    };
  }

  // 3. Validate token with Supabase
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: data?.message || "Invalid session" }),
    };
  }

  // 4. Valid session → return user
  return {
    statusCode: 200,
    body: JSON.stringify({ user: data }),
  };
};
