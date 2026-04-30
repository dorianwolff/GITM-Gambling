/**
 * auth-service.js
 * Microsoft (Azure AD) sign-in via Supabase OAuth, scoped to a single tenant
 * so only school accounts can sign in.
 */
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export async function signInWithMicrosoft() {
  // queryParams.tenant restricts the Azure AD tenant to your school's tenant.
  // If VITE_AZURE_TENANT_ID is empty we fall back to "organizations" (any
  // work/school account, no personal Microsoft accounts).
  const tenant = env.AZURE_TENANT_ID || 'organizations';

  const redirectTo = `${window.location.origin}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo,
      scopes: 'openid email profile',
      queryParams: {
        tenant,
        prompt: 'select_account',
      },
    },
  });

  if (error) {
    logger.error('signInWithMicrosoft failed', error);
    throw error;
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) logger.error('signOut failed', error);
}
