# GITM — Setup guide

You'll need free accounts on:

1. **Microsoft / Azure** (you already have this — your school account is on
   Entra ID).
2. **Supabase** — free tier, https://supabase.com.
3. **Netlify** (or Cloudflare Pages / Vercel) — free static hosting.

The whole stack is free for school-sized usage:

| Service  | Free tier                              |
| -------- | -------------------------------------- |
| Supabase | 500 MB Postgres, 2 GB egress, realtime |
| Netlify  | 100 GB bandwidth, unlimited sites      |
| Azure AD | OAuth app registration is free         |

---

## 1. Supabase project

1. Sign in at https://supabase.com → **New project**.
   - Region: `eu-west-2` (London) or whatever is closest.
   - Save the database password somewhere safe.
2. Wait for the project to provision (~1 minute).
3. From **Project Settings → API** copy:
   - `Project URL` → goes into `VITE_SUPABASE_URL`.
   - `anon` public key → goes into `VITE_SUPABASE_ANON_KEY`.
4. Open the **SQL Editor** → **New query** → paste the entire content of
   `supabase/schema.sql` → **Run**. You should see "Success. No rows
   returned." and several `CREATE FUNCTION` notices.
5. Open `supabase/schema.sql` again locally and find:
   ```sql
   create or replace function public.allowed_email_domains()
     returns text[] language sql immutable as $$
       select array['epita.fr']::text[];
     $$;
   ```
   This is the server-side allow-list. If you ever need to add more
   domains (e.g. `epita.eu`, `student.epita.fr`), edit this and re-run
   the function.

### 1b. Make yourself an admin

After your first sign-in (see step 3 below), come back to the SQL editor
and run:

```sql
update public.profiles set is_admin = true where email = 'YOU@epita.fr';
```

Admins can resolve any event, create unlimited events per day, and spawn
emoji hunts on demand.

---

## 2. Azure AD (Microsoft Entra ID) app registration

This is the one part that requires you to click through the Azure portal.

1. Go to https://portal.azure.com → search for **Microsoft Entra ID** →
   open it.
2. Left sidebar → **App registrations** → **+ New registration**.
   - **Name**: `GITM Gambling` (or whatever).
   - **Supported account types**:
     **"Accounts in this organizational directory only (EPITA only - Single tenant)"**.
     This is the key restriction — only @epita.fr accounts will be able to
     sign in.
   - **Redirect URI**: choose **Web** then paste your Supabase callback URL,
     which is:
     ```
     https://YOUR-PROJECT-ref.supabase.co/auth/v1/callback
     ```
     (You'll find the exact URL in Supabase → Authentication → Providers
     → Azure → Callback URL.)
   - Click **Register**.
3. On the new app's **Overview** page, copy:
   - **Application (client) ID** — paste into `VITE_AZURE_TENANT_ID`?
     No: this is the **Client ID** (used by Supabase below).
   - **Directory (tenant) ID** — this is what you paste into
     `VITE_AZURE_TENANT_ID`. This restricts the OAuth flow to your school's
     tenant.
4. Left sidebar of the app → **Certificates & secrets** → **+ New client
   secret** → 24 months expiry → **Add**. Copy the **Value** column
   (NOT the Secret ID — and do it now, you can't see it again).
5. Left sidebar → **API permissions** → make sure **Microsoft Graph →
   User.Read** and **email**, **openid**, **profile** are present (they
   are by default).

### Hook Azure into Supabase

In the Supabase dashboard:

1. **Authentication → Providers → Azure**.
2. Toggle it on.
3. Fill in:
   - **Client ID** → the Application (client) ID from step 3.
   - **Client Secret** → the secret value from step 4.
   - **Azure Tenant URL**:
     `https://login.microsoftonline.com/<your-tenant-id>`
     (replace `<your-tenant-id>` with the same value as
     `VITE_AZURE_TENANT_ID`). ⚠️ Do **not** add `/v2.0` at the end —
     Supabase appends `/oauth2/v2.0/authorize` itself; if you include
     `/v2.0` you'll get a 404 on sign-in.
4. Save.

---

## 3. Local development

```bash
git clone <your-fork-url> gitm-gambling
cd gitm-gambling
cp .env.example .env.local        # fill it in (values from steps above)
npm install
npm run dev
```

Open http://localhost:5173 → click **Continue with Microsoft** → sign in
with your @epita.fr account → you should land on the dashboard with 200
welcome credits.

If you instead see "Email domain is not allowed", check that:

- Your Azure app is **Single tenant** restricted to EPITA.
- `allowed_email_domains()` in `schema.sql` includes your domain.
- The user's primary email actually ends in `@epita.fr` (some EPITA
  students have alias addresses).

---

## 4. Production deploy on Netlify

1. Push the repo to GitHub.
2. https://app.netlify.com → **Add new site → Import from Git**.
3. Pick the repo. Build settings should auto-fill from `netlify.toml`.
4. **Site settings → Environment variables** → add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_AZURE_TENANT_ID`
   - `VITE_ALLOWED_EMAIL_DOMAINS` (e.g. `epita.fr`)
5. Trigger a deploy. You'll get a URL like `gitm-gambling.netlify.app`.
6. Back in Azure → your App registration → **Authentication** → add
   redirect URIs for both:
   - `https://YOUR-PROJECT-ref.supabase.co/auth/v1/callback`
     (already there from step 2)
   - You may also want to add the Netlify URL itself if you ever switch
     auth providers.
7. In Supabase → **Authentication → URL Configuration** → set
   **Site URL** to your Netlify URL and add it to **Redirect URLs**.

---

## 5. Day-to-day admin

- Spawn an emoji hunt: open `/games/emoji-hunt` while signed in as admin
  → click **Spawn one now**.
- Resolve any event: open the event detail page → "Resolve as winner"
  panel.
- Grant credits: in the SQL editor:
  ```sql
  select public._apply_credit_delta('<user-uuid>', 1000, 'admin_grant', '{}');
  ```
- Make someone an admin:
  ```sql
  update public.profiles set is_admin = true where email = 'someone@epita.fr';
  ```

---

## 6. Why is this safe?

- The browser only ever holds the **anon** key, which is rate-limited by
  Supabase and bound by Row-Level Security.
- Credit balance updates are gated by SECURITY DEFINER Postgres functions
  — the client cannot directly increment its own credits.
- All randomness for credit-affecting outcomes (coin, dice, roulette,
  blackjack, crash) lives in Postgres (`random()` server-side).
- Email domain is enforced both in Azure (single tenant) and at the
  database level (`allowed_email_domains()` in the auth trigger).
- This isn't real money so the threat model is "students trying to game
  the leaderboard" not "professional attackers" — but the architecture
  would survive a step or two beyond that as well.
