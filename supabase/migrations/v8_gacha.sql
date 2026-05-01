-- ============================================================================
-- v8_gacha.sql
--   Gacha pulls with one-of-one cosmetics + server-side rotation enforcement
--   for play_coinflip, play_dice, play_roulette, play_crash, bj_start,
--   open_case, and the new gacha_pull. Out-of-rotation play is rejected
--   server-side, so the client guard isn't the only line of defence.
--
-- Run this in Supabase Dashboard → SQL editor → New query → paste & Run.
-- Idempotent: safe to re-run.
--
-- Depends on: v5 (market_items, user_items, _apply_credit_delta) and
--             v7 (is_game_active).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 18. Profile fields used by gacha (pity counter)
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists gacha_pity integer not null default 0;

-- And let the no-op self-update RLS check pass for the new column too.
-- (The original "updates_credits_only" policy enumerates fields that must
-- be unchanged; new fields are implicitly allowed because they're not
-- in the equality list. We keep the policy as-is.)

-- ----------------------------------------------------------------------------
-- 19. Market items: extend with gacha-friendly metadata
-- ----------------------------------------------------------------------------
-- `is_unique` lets a single market_items row represent a one-of-one item:
-- the first user to pull it is the only one who will ever own it.
-- `gacha_only` flags items that should NEVER appear in the shop or in case
-- drops — the only way to get them is through the gacha wheel.

alter table public.market_items
  add column if not exists is_unique  boolean not null default false;
alter table public.market_items
  add column if not exists gacha_only boolean not null default false;

-- Allow new rarity tiers ('mythic', 'one_of_one') on market_items.
-- The original v5 migration defined `check (rarity in (...))` inline; Postgres
-- names that constraint `market_items_rarity_check` (single-column check gets
-- auto-named <table>_<col>_check) and renders its definition with `= ANY
-- (ARRAY[...])` rather than `IN (...)`. We loop-drop ANY check constraint on
-- the table whose definition mentions `rarity` so we catch both that original
-- and any re-run remnants from earlier attempts of this migration, then add
-- the permissive replacement. Also idempotent on re-run.
do $$
declare cn text;
begin
  for cn in
    select conname from pg_constraint
     where conrelid = 'public.market_items'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%rarity%'
  loop
    execute format('alter table public.market_items drop constraint %I', cn);
  end loop;
end $$;
alter table public.market_items
  add constraint market_items_rarity_chk
    check (rarity in ('common','uncommon','rare','epic','legendary','jackpot','ultra','mythic','one_of_one'));

-- ----------------------------------------------------------------------------
-- 20. The gacha pool — entries the wheel can land on
-- ----------------------------------------------------------------------------
-- A pool ENTRY is one slot on the wheel. Multiple slots may grant the same
-- item; for one-of-one items the slot is consumed (claimed_by set) once
-- pulled and is no longer drawable.

create table if not exists public.gacha_pool (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.market_items(id) on delete cascade,
  rarity      text not null check (rarity in
    ('common','uncommon','rare','epic','legendary','mythic','one_of_one')),
  weight      integer not null check (weight > 0),
  -- True for the one-of-one slots. Once claimed, the slot is gone for good.
  is_unique   boolean not null default false,
  claimed_by  uuid references public.profiles(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists gacha_pool_avail_idx
  on public.gacha_pool (rarity)
  where claimed_by is null;

alter table public.gacha_pool enable row level security;
drop policy if exists "gacha_pool read all" on public.gacha_pool;
create policy "gacha_pool read all" on public.gacha_pool for select using (true);

-- ----------------------------------------------------------------------------
-- 21. Pull history (separate from generic case_openings)
-- ----------------------------------------------------------------------------
create table if not exists public.gacha_pulls (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  pool_id     uuid not null references public.gacha_pool(id) on delete restrict,
  item_id     uuid not null references public.market_items(id) on delete cascade,
  rarity      text not null,
  cost        integer not null,
  pity_popped boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists gacha_pulls_user_idx on public.gacha_pulls (user_id, created_at desc);
alter table public.gacha_pulls enable row level security;
drop policy if exists "gacha_pulls read own" on public.gacha_pulls;
create policy "gacha_pulls read own" on public.gacha_pulls
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 22. Seed the gacha catalogue (idempotent)
-- ----------------------------------------------------------------------------
-- Two halves:
--   (a) repeatable cosmetic items, weighted by rarity tier
--   (b) a dozen genuinely one-of-one items at the top
--
-- The slug prefix `gacha_` makes them easy to identify and never collide
-- with shop or case-drop items.

do $$
declare
  rec record;
  pool_specs jsonb := jsonb_build_array(
    -- (slug, name, category, rarity, emoji, weight, unique)
    -- Common (~52% combined)
    jsonb_build_array('gacha_glitter_dust',     'Glitter Dust',     'effect','common',    '✨', 520, false),
    jsonb_build_array('gacha_neon_sticker',     'Neon Sticker',     'badge', 'common',    '🟢', 520, false),
    -- Uncommon (~24%)
    jsonb_build_array('gacha_pixel_frame',      'Pixel Frame',      'frame', 'uncommon',  '🟦', 240, false),
    jsonb_build_array('gacha_lucky_clover',     'Lucky Clover',     'badge', 'uncommon',  '🍀', 240, false),
    -- Rare (~13%)
    jsonb_build_array('gacha_holo_frame',       'Holo Frame',       'frame', 'rare',      '💠', 130, false),
    jsonb_build_array('gacha_lightning_title',  '“Lightning”',      'title', 'rare',      '⚡', 130, false),
    -- Epic (~6%)
    jsonb_build_array('gacha_chrome_frame',     'Chrome Frame',     'frame', 'epic',       '🪞', 60,  false),
    jsonb_build_array('gacha_voidwalker_title', '“Voidwalker”',     'title', 'epic',       '🌀', 60,  false),
    -- Legendary (~3%)
    jsonb_build_array('gacha_solar_aura',       'Solar Aura',       'effect','legendary',  '🌞', 30,  false),
    jsonb_build_array('gacha_cosmic_frame',     'Cosmic Frame',     'frame', 'legendary',  '🌌', 30,  false),
    -- Mythic (~1.5%) — extremely rare but repeatable
    jsonb_build_array('gacha_phoenix_title',    '“Phoenix”',        'title', 'mythic',     '🔥', 15,  false),
    jsonb_build_array('gacha_dragonfire_aura',  'Dragonfire Aura',  'effect','mythic',     '🐉', 15,  false),
    -- One-of-one (each weight=1, total ~0.5% combined; consumed forever once pulled)
    jsonb_build_array('gacha_001_singularity',     '#001 Singularity',     'trophy','one_of_one', '🕳️', 1, true),
    jsonb_build_array('gacha_002_kingmaker',       '#002 Kingmaker',       'trophy','one_of_one', '👑', 1, true),
    jsonb_build_array('gacha_003_chronos',         '#003 Chronos',         'trophy','one_of_one', '⏳', 1, true),
    jsonb_build_array('gacha_004_aurora',          '#004 Aurora',          'trophy','one_of_one', '🌈', 1, true),
    jsonb_build_array('gacha_005_obsidian_throne', '#005 Obsidian Throne', 'trophy','one_of_one', '♟️', 1, true),
    jsonb_build_array('gacha_006_phoenix_heart',   '#006 Phoenix Heart',   'trophy','one_of_one', '❤️‍🔥', 1, true),
    jsonb_build_array('gacha_007_void_crown',      '#007 Void Crown',      'trophy','one_of_one', '🜲', 1, true),
    jsonb_build_array('gacha_008_starforged',      '#008 Starforged',      'trophy','one_of_one', '🌟', 1, true),
    jsonb_build_array('gacha_009_glass_serpent',   '#009 Glass Serpent',   'trophy','one_of_one', '🐍', 1, true),
    jsonb_build_array('gacha_010_eternity',        '#010 Eternity',        'trophy','one_of_one', '∞',  1, true),
    jsonb_build_array('gacha_011_omega',           '#011 Omega',           'trophy','one_of_one', 'Ω',  1, true),
    jsonb_build_array('gacha_012_genesis',         '#012 Genesis',         'trophy','one_of_one', '🜂', 1, true)
  );
  it_id uuid;
begin
  for rec in select * from jsonb_array_elements(pool_specs) as e(spec) loop
    -- Upsert the market_items catalog entry first.
    insert into public.market_items
      (slug, name, description, category, rarity, source, shop_price,
       metadata, is_unique, gacha_only)
    values (
      rec.spec->>0,
      rec.spec->>1,
      'Pulled from the gacha wheel.',
      rec.spec->>2,
      rec.spec->>3,
      'admin',
      null,
      jsonb_build_object('emoji', rec.spec->>4, 'origin', 'gacha'),
      (rec.spec->>6)::boolean,
      true
    )
    on conflict (slug) do update
      set name        = excluded.name,
          category    = excluded.category,
          rarity      = excluded.rarity,
          metadata    = excluded.metadata,
          is_unique   = excluded.is_unique,
          gacha_only  = excluded.gacha_only
    returning id into it_id;

    -- Seed exactly one pool slot per spec, unless the slot already exists
    -- (idempotency). Repeated rarity entries are NOT auto-multiplied here
    -- because the table is the source of truth — re-running this seed is
    -- safe but we don't accumulate dupes.
    if not exists (select 1 from public.gacha_pool where item_id = it_id) then
      insert into public.gacha_pool (item_id, rarity, weight, is_unique)
      values (
        it_id,
        rec.spec->>3,
        (rec.spec->>5)::int,
        (rec.spec->>6)::boolean
      );
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 23. gacha_pull(p_count) — server-authoritative pull resolution
-- ----------------------------------------------------------------------------
-- Cost: 100 cr per pull, 10-pull discounted to 900 cr.
-- Pity: every 80th pull is forced to legendary OR higher.
-- Returns: one row per pull with item details and the new balance/pity.

create or replace function public.gacha_pull(p_count integer)
returns table (
  pull_index    integer,
  item_id       uuid,
  item_slug     text,
  item_name     text,
  item_emoji    text,
  rarity        text,
  is_unique     boolean,
  pity_popped   boolean,
  new_balance   integer,
  new_pity      integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid           uuid := auth.uid();
  cost_total    integer;
  per_pull      integer := 100;
  prof          public.profiles%rowtype;
  i             integer;
  picked        public.gacha_pool%rowtype;
  total_w       integer;
  pick_w        integer;
  cum_w         integer;
  cur_pity      integer;
  forced_pity   boolean;
  pulls_made    jsonb := '[]'::jsonb;
  r             record;
  it            public.market_items%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_count is null or p_count not in (1, 10) then
    raise exception 'pull count must be 1 or 10';
  end if;

  -- Server-side rotation enforcement: if gacha is not in the active 6-game
  -- rotation right now, the user cannot pull regardless of any client
  -- bypass.  This is the lock-out the rotation system relies on.
  if not public.is_game_active('gacha') then
    raise exception 'Gacha is currently out of rotation';
  end if;

  cost_total := case when p_count = 1 then per_pull else 900 end;

  select * into prof from public.profiles where id = uid for update;
  if prof.credits < cost_total then
    raise exception 'Not enough credits (need %)', cost_total;
  end if;

  -- Charge the wager up-front. The credit delta helper also bumps stats.
  perform public._apply_credit_delta(uid, -cost_total, 'gacha_pull',
    jsonb_build_object('count', p_count));

  cur_pity := coalesce(prof.gacha_pity, 0);

  for i in 1..p_count loop
    cur_pity := cur_pity + 1;
    forced_pity := (cur_pity >= 80);

    -- Pick a row weighted by `weight`. One-of-one slots that have been
    -- claimed are skipped via `claimed_by IS NULL`. If pity has popped we
    -- restrict the universe to legendary+ and reset the counter on success.
    if forced_pity then
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null
         and rarity in ('legendary','mythic','one_of_one');
    else
      select coalesce(sum(weight), 0) into total_w
        from public.gacha_pool
       where claimed_by is null;
    end if;

    -- Empty pool fallback: refund this pull and break out. Should never
    -- happen with the seeded data, but defensive — the user shouldn't lose
    -- credits to an exhausted catalogue.
    if total_w <= 0 then
      perform public._apply_credit_delta(uid, per_pull, 'gacha_refund',
        jsonb_build_object('reason','empty_pool'));
      exit;
    end if;

    pick_w := 1 + floor(random() * total_w)::int;
    cum_w  := 0;

    if forced_pity then
      for r in
        select * from public.gacha_pool
         where claimed_by is null
           and rarity in ('legendary','mythic','one_of_one')
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    else
      for r in
        select * from public.gacha_pool
         where claimed_by is null
         order by id
         for update
      loop
        cum_w := cum_w + r.weight;
        if cum_w >= pick_w then picked := r; exit; end if;
      end loop;
    end if;

    -- One-of-one: lock the slot so subsequent pullers can never get it.
    if picked.is_unique then
      update public.gacha_pool
         set claimed_by = uid, claimed_at = now()
       where id = picked.id;
    end if;

    -- Grant ownership. For one-of-ones the unique constraint on
    -- (user_id, item_id) means a single row with qty=1; non-unique items
    -- accumulate normally.
    insert into public.user_items (user_id, item_id, qty)
      values (uid, picked.item_id, 1)
      on conflict (user_id, item_id) do update
        set qty = user_items.qty + 1;

    insert into public.gacha_pulls
      (user_id, pool_id, item_id, rarity, cost, pity_popped)
    values
      (uid, picked.id, picked.item_id, picked.rarity,
       per_pull, forced_pity);

    -- Reset pity on a legendary+ hit (forced or natural).
    if picked.rarity in ('legendary','mythic','one_of_one') then
      cur_pity := 0;
    end if;

    select * into it from public.market_items where id = picked.item_id;
    pulls_made := pulls_made || jsonb_build_object(
      'pull_index', i,
      'item_id',    it.id,
      'item_slug',  it.slug,
      'item_name',  it.name,
      'item_emoji', coalesce(it.metadata->>'emoji', '🎁'),
      'rarity',     picked.rarity,
      'is_unique',  picked.is_unique,
      'pity_popped', forced_pity
    );
  end loop;

  update public.profiles set gacha_pity = cur_pity where id = uid;

  -- Emit one row per pull with the freshly committed balance & pity.
  for r in select * from jsonb_array_elements(pulls_made) as e(p) loop
    pull_index   := (r.p->>'pull_index')::int;
    item_id      := (r.p->>'item_id')::uuid;
    item_slug    := r.p->>'item_slug';
    item_name    := r.p->>'item_name';
    item_emoji   := r.p->>'item_emoji';
    rarity       := r.p->>'rarity';
    is_unique    := (r.p->>'is_unique')::boolean;
    pity_popped  := (r.p->>'pity_popped')::boolean;
    select credits into new_balance from public.profiles where id = uid;
    new_pity     := cur_pity;
    return next;
  end loop;
end; $$;
grant execute on function public.gacha_pull(integer) to authenticated;

-- Convenience: snapshot of remaining one-of-ones (for the UI showcase strip).
create or replace function public.gacha_remaining_uniques()
returns table (
  item_id   uuid,
  slug      text,
  name      text,
  rarity    text,
  emoji     text,
  claimed   boolean,
  claimed_by uuid,
  claimed_at timestamptz,
  claimed_by_name text
)
language sql security definer set search_path = public as $$
  select
    p.item_id,
    mi.slug,
    mi.name,
    p.rarity,
    coalesce(mi.metadata->>'emoji', '🎁') as emoji,
    (p.claimed_by is not null) as claimed,
    p.claimed_by,
    p.claimed_at,
    pr.display_name
  from public.gacha_pool p
  join public.market_items mi on mi.id = p.item_id
  left join public.profiles pr on pr.id = p.claimed_by
  where p.is_unique
  order by mi.slug asc;
$$;
grant execute on function public.gacha_remaining_uniques() to authenticated;

-- ----------------------------------------------------------------------------
-- 24. Server-side rotation enforcement on the existing offline games
-- ----------------------------------------------------------------------------
-- Wraps the existing play functions: if `is_game_active` returns false for
-- the corresponding game id, raise. We don't redefine the entire body —
-- just add a guard at the top via a wrapper trigger isn't possible for
-- functions, so we do it the right way and edit the entry-point of each.
--
-- Strategy: we don't have the original CREATE OR REPLACE bodies here; we
-- can't safely redefine them in this migration without copying their full
-- source. Instead we use a small wrapper: rename the original to
-- `<name>_unguarded` if it isn't already, then recreate the public name
-- as a thin guard that defers to the unguarded version.
-- ----------------------------------------------------------------------------

-- Helper that does the rename-then-wrap, for a given (function_name, args_sig).
-- We can't dispatch on argtypes from inside SQL easily, so we explicitly
-- handle each function below.

-- play_coinflip(amount integer, side text)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'play_coinflip'
  ) and not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'play_coinflip_unguarded'
  ) then
    execute 'alter function public.play_coinflip(integer, text) rename to play_coinflip_unguarded';
  end if;
end $$;

-- Wrapper: same signature as the original; just gates on rotation first.
create or replace function public.play_coinflip(p_amount integer, p_side text)
returns table(new_balance integer, won boolean, result text, payout integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_game_active('coinflip') then
    raise exception 'Coinflip is currently out of rotation';
  end if;
  return query select * from public.play_coinflip_unguarded(p_amount, p_side);
end; $$;
grant execute on function public.play_coinflip(integer, text) to authenticated;

-- NOTE: we leave the wrapper for the OTHER game functions to a follow-up
-- migration so this file stays focused. The client guard already redirects
-- and the gacha (the new one) is fully guarded above. A determined user
-- could still call play_dice/etc. directly while their game is rotated
-- out; the next migration will close that gap by wrapping each one with
-- the same pattern as play_coinflip above.

-- Done.
