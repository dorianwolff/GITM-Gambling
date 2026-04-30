/**
 * session.js
 * Bootstraps the auth lifecycle: loads the current Supabase session, fetches
 * the matching profile row, and keeps the userStore in sync on auth events.
 */
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { userStore, setUser, setProfile, clearUser } from '../state/user-store.js';
import { fetchOrCreateProfile } from '../services/profile-service.js';
import { isAllowedDomain } from '../utils/validation.js';
import { env } from '../config/env.js';

let initialized = false;

export async function initSession() {
  if (initialized) return;
  initialized = true;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  await applySession(session);

  supabase.auth.onAuthStateChange(async (event, sess) => {
    logger.debug('auth event', event);
    await applySession(sess);
  });
}

async function applySession(session) {
  const user = session?.user ?? null;

  if (!user) {
    clearUser();
    return;
  }

  // Defense-in-depth: even if Azure tenant somehow let through a non-EPITA
  // address, drop the session here. Supabase auth_hook in schema.sql is the
  // primary gate.
  const email = user.email ?? user.user_metadata?.email ?? '';
  if (!isAllowedDomain(email, env.ALLOWED_EMAIL_DOMAINS)) {
    logger.warn('rejecting non-allowed domain login', email);
    await supabase.auth.signOut();
    clearUser();
    return;
  }

  setUser(user);
  try {
    const profile = await fetchOrCreateProfile(user);
    setProfile(profile);
  } catch (e) {
    logger.error('failed to load profile', e);
  }
}

export function onUserChange(fn) {
  return userStore.subscribe(fn);
}
