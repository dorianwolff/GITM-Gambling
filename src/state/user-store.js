/**
 * user-store.js
 * App-wide reactive store for the signed-in user, profile and credit balance.
 */
import { createStore } from './store.js';

export const userStore = createStore({
  /** @type {import('@supabase/supabase-js').User | null} */
  user: null,
  /** @type {{ id:string, display_name:string, email:string, credits:number,
   *           is_admin:boolean, streak_days:number, last_claim_date:string|null }|null} */
  profile: null,
  loading: true,
});

export function setUser(user) {
  userStore.set({ user, loading: false });
}

export function setProfile(profile) {
  userStore.set({ profile });
}

export function patchProfile(patch) {
  const cur = userStore.get().profile;
  if (!cur) return;
  userStore.set({ profile: { ...cur, ...patch } });
}

export function clearUser() {
  userStore.set({ user: null, profile: null, loading: false });
}

export function getCredits() {
  return userStore.get().profile?.credits ?? 0;
}

export function isAdmin() {
  return !!userStore.get().profile?.is_admin;
}
