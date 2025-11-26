// netlify/functions/get-session.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

exports.handler = async () => {
  try {
    // Get the current user session from Supabase
    const { data: { user }, error } = await supabase.auth.getUser();
    
    // If there's an error or no user, return an unauthorized error
    if (error || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'User not authenticated' })
      };
    }

    // Return the user details if authenticated
    return {
      statusCode: 200,
      body: JSON.stringify({ user })
    };
  } catch (err) {
    // If something goes wrong, return a server error
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: ' + err.message })
    };
  }
};
