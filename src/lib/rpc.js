/**
 * rpc.js
 * Tiny wrapper around `supabase.rpc(...)` so services can share a single
 * import path for RPC calls.
 */
import { supabase } from './supabase.js';

export async function rpc(name, params = {}) {
  return supabase.rpc(name, params);
}
