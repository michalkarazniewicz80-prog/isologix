// netlify/functions/signup.js

const fetch = require("node-fetch"); // Needed for Node <18

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Allow": "POST" },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  let email, password;
  try {
    ({ email, password } = JSON.parse(event.body));
    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email and password are required" }),
      };
    }
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data?.error_description || data?.message || "Signup failed" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error: " + err.message }),
    };
  }
};
