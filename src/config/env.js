/**
 * env.js
 * Centralised, validated access to public environment variables.
 * NEVER read import.meta.env elsewhere in the app — go through this module.
 */

function required(name, value) {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`
    );
  }
  return value.trim();
}

const SUPABASE_URL = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = required(
  'VITE_SUPABASE_ANON_KEY',
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const AZURE_TENANT_ID = (import.meta.env.VITE_AZURE_TENANT_ID || '').trim();

const ALLOWED_EMAIL_DOMAINS = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || 'epita.fr')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export const env = Object.freeze({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  AZURE_TENANT_ID,
  ALLOWED_EMAIL_DOMAINS,
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
});
