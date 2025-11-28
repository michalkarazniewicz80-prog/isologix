const fetch = require("node-fetch");

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // 1. Read Authorization header from client
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Missing Authorization header" }),
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid Authorization header" }),
    };
  }

  // 2. Validate token with Supabase
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: data?.message || "Invalid session" }),
    };
  }

  // 3. Valid session → return user
  return {
    statusCode: 200,
    body: JSON.stringify({ user: data }),
  };
};
