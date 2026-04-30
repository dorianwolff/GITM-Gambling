/**
 * supabase.js
 * Single Supabase client instance for the whole app.
 * Only the public ANON key is shipped to the browser; all sensitive logic
 * (credit mutations, game resolution) lives in Postgres functions with RLS.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
