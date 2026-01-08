const fetch = require("node-fetch"); // Needed for Node <18

function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" }, { Allow: "POST" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return json(500, { error: "Missing Supabase env" });
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization token" });
    }

    const token = authHeader.split(" ")[1];
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!userResp.ok) {
      const detail = await userResp.text();
      return json(401, { error: "Invalid token", detail });
    }

    const user = await userResp.json();
    const userId = user?.id;
    if (!userId) {
      return json(401, { error: "Unable to get user id" });
    }

    const rolesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(
        userId
      )}`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const rolesData = await rolesResp.json();
    if (!rolesResp.ok) {
      return json(rolesResp.status, { error: rolesData });
    }

    return json(200, { roles: rolesData.map(r => r.role) });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
