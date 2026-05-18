-- ============================================================================
-- v32_collectibles_achievements.sql
--
-- Major additions:
--   * 60 new market_items (20 frames, 20 badges, 20 titles)
--     including timed_shop items (midnight / 11:11 windows) and
--     achievement-gated items.
--   * time_condition column on market_items
--   * Extended source CHECK to include 'timed_shop' and 'achievement'
--   * _is_time_window_active(cond text) helper
--   * Recreated market_buy to support timed_shop purchases
--   * 11 gacha_pool entries for gacha-only new items
--   * achievement_defs table — seeded with 21 achievement definitions
--   * user_achievements extended with is_claimed / claimed_at
--   * list_my_achievements() RPC — progress + claimability
--   * claim_achievement(p_code text) RPC — validates, rewards, marks claimed
--
-- Idempotent: safe to re-run.
-- Depends on: v5 (market_items, user_items, market_buy, _apply_credit_delta),
--             v6 (profiles.items_unique/items_total triggers),
--             v8 (gacha_pool, gacha_only),
--             v14 (user_achievements),
--             v19 (warfront_games), v30 (mp_warfront_games)
-- ============================================================================


-- ============================================================================
-- PART 1A: Extend market_items — source check constraint
-- ============================================================================

-- Drop existing source check (name may vary) and recreate with new sources.
DO $$
DECLARE cn text;
BEGIN
  FOR cn IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.market_items'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.market_items DROP CONSTRAINT %I', cn);
  END LOOP;
END $$;

ALTER TABLE public.market_items
  ADD CONSTRAINT market_items_source_check
    CHECK (source IN ('shop','case_drop','event_reward','admin','timed_shop','achievement'));


-- ============================================================================
-- PART 1B: Add time_condition column
-- ============================================================================
-- Possible values:
--   NULL       → always available
--   'midnight' → current UTC hour IN (23, 0)
--   '11:11'    → (hour=11 AND minute BETWEEN 9 AND 13)
--                OR (hour=23 AND minute BETWEEN 9 AND 13)

ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS time_condition text;


-- ============================================================================
-- PART 1C: _is_time_window_active(cond text)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._is_time_window_active(cond text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h  int := EXTRACT(hour   FROM now() AT TIME ZONE 'UTC')::int;
  m  int := EXTRACT(minute FROM now() AT TIME ZONE 'UTC')::int;
BEGIN
  IF cond IS NULL THEN
    RETURN true;
  ELSIF cond = 'midnight' THEN
    RETURN h IN (23, 0);
  ELSIF cond = '11:11' THEN
    RETURN (h = 11 AND m BETWEEN 9 AND 13)
        OR (h = 23 AND m BETWEEN 9 AND 13);
  ELSE
    -- Unknown condition → treat as unavailable (safe default)
    RETURN false;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._is_time_window_active(text) FROM public;
GRANT  EXECUTE ON FUNCTION public._is_time_window_active(text) TO authenticated;


-- ============================================================================
-- PART 1D: Recreate market_buy to support timed_shop
-- ============================================================================
-- The original v5 version only allowed source='shop'. We recreate it here
-- to also allow 'timed_shop', enforcing the time window check. All other
-- behaviour is preserved (the items counter is maintained by triggers on
-- user_items, so we don't need to touch profiles directly here).

CREATE OR REPLACE FUNCTION public.market_buy(p_item uuid)
RETURNS setof public.user_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  it  public.market_items%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO it FROM public.market_items WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

  IF it.shop_price IS NULL THEN
    RAISE EXCEPTION 'This item is not sold in the shop';
  END IF;

  IF it.source NOT IN ('shop', 'timed_shop') THEN
    RAISE EXCEPTION 'Not a shop item';
  END IF;

  IF it.source = 'timed_shop'
     AND NOT public._is_time_window_active(it.time_condition)
  THEN
    RAISE EXCEPTION 'This item is only available during its special time window';
  END IF;

  PERFORM public._apply_credit_delta(uid, -it.shop_price, 'market_buy',
    jsonb_build_object('item_id', p_item, 'slug', it.slug, 'price', it.shop_price));

  INSERT INTO public.user_items (user_id, item_id, qty)
    VALUES (uid, p_item, 1)
    ON CONFLICT (user_id, item_id) DO UPDATE
      SET qty = user_items.qty + 1;

  RETURN QUERY SELECT * FROM public.user_items WHERE user_id = uid AND item_id = p_item;
END;
$$;
REVOKE ALL  ON FUNCTION public.market_buy(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.market_buy(uuid) TO authenticated;


-- ============================================================================
-- PART 1E: Insert 60 new market_items
-- ============================================================================
-- We insert without time_condition (column is new) and follow with UPDATEs
-- for timed_shop items to set their time_condition.
-- Columns: (slug, name, description, category, rarity, shop_price, source,
--            metadata, is_unique, gacha_only)

-- ----------------------------------------------------------------------------
-- +20 FRAMES
-- ----------------------------------------------------------------------------
INSERT INTO public.market_items
  (slug, name, description, category, rarity, shop_price, source, metadata, is_unique, gacha_only)
VALUES
  ('frame-fire-engine',     'Frame · Fire Engine',      'Racing-red fire engine frame.',                          'frame','uncommon',  380,   'shop',       '{"color":"#ff4020"}',             false, false),
  ('frame-race-car',        'Frame · Race Car',         'Speed demon frame.',                                     'frame','rare',     1400,   'shop',       '{"color":"#e00020"}',             false, false),
  ('frame-spaceship',       'Frame · Spaceship',        'Rocket-launched frame.',                                 'frame','epic',     5200,   'shop',       '{"color":"#0040ff"}',             false, false),
  ('frame-bicycle',         'Frame · Bicycle',          'Humble two-wheeled frame.',                              'frame','common',    100,   'shop',       '{"color":"#40c040"}',             false, false),
  ('frame-helicopter',      'Frame · Helicopter',       'Blades spinning.',                                       'frame','rare',     1800,   'shop',       '{"color":"#808040"}',             false, false),
  ('frame-lion-pride',      'Frame · Lion Pride',       'Pride of the savannah, gacha-only.',                    'frame','epic',      null,   'admin',      '{"color":"#e0a020","emoji":"🦁"}',false, true),
  ('frame-wolf-pack',       'Frame · Wolf Pack',        'Run with the pack, gacha-only.',                        'frame','rare',      null,   'admin',      '{"color":"#6080b0","emoji":"🐺"}',false, true),
  ('frame-dragon-fire',     'Frame · Dragon Fire',      'Ancient dragonfire, gacha-only.',                       'frame','legendary', null,   'admin',      '{"color":"#ff6000","emoji":"🐉"}',false, true),
  ('frame-golden-eagle',    'Frame · Golden Eagle',     'Sharp-eyed apex predator.',                              'frame','rare',     2200,   'shop',       '{"color":"#c0a020"}',             false, false),
  ('frame-tidal-shark',     'Frame · Tidal Shark',      'Apex of the deep, gacha-only.',                         'frame','epic',      null,   'admin',      '{"color":"#2060c0","emoji":"🦈"}',false, true),
  ('frame-neon-green',      'Frame · Neon Green',       'Electric green.',                                        'frame','uncommon',  300,   'shop',       '{"color":"#00ff80"}',             false, false),
  ('frame-galaxy',          'Frame · Galaxy',           'Infinite cosmos frame.',                                 'frame','epic',     5500,   'shop',       '{"color":"prismatic-galaxy"}',    false, false),
  ('frame-aurora',          'Frame · Aurora',           'Appears only at midnight.',                              'frame','legendary',18000, 'timed_shop', '{"color":"prismatic"}',            false, false),
  ('frame-skull',           'Frame · Skull',            'Death comes for us all.',                                'frame','rare',     1600,   'shop',       '{"color":"#808080"}',             false, false),
  ('frame-diamond',         'Frame · Diamond',          'Hardest flex.',                                          'frame','epic',     6000,   'shop',       '{"color":"#c0f0ff"}',             false, false),
  ('frame-cherry-blossom',  'Frame · Cherry Blossom',   'Ephemeral beauty.',                                      'frame','uncommon',  450,   'shop',       '{"color":"#ff80a0"}',             false, false),
  ('frame-snowflake',       'Frame · Snowflake',        'Cold and crystalline.',                                  'frame','uncommon',  400,   'shop',       '{"color":"#80c0ff"}',             false, false),
  ('frame-lightning',       'Frame · Lightning',        'Strikes fast.',                                          'frame','uncommon',  500,   'shop',       '{"color":"#ffe040"}',             false, false),
  ('frame-warfront-victor', 'Frame · Warfront Victor',  'Earned in battle. Achievement only.',                   'frame','rare',      null,  'achievement','{"color":"#c06000","emoji":"⚔️"}',false, false),
  ('frame-lion-slayer',     'Frame · Lion Slayer',      'Defeat the Legendary lions. Achievement only.',          'frame','epic',      null,  'achievement','{"color":"#e08000","emoji":"🦁"}',false, false)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- +20 BADGES
-- ----------------------------------------------------------------------------
INSERT INTO public.market_items
  (slug, name, description, category, rarity, shop_price, source, metadata, is_unique, gacha_only)
VALUES
  ('badge-racing-driver', 'Racing Driver', 'Vroom.',                                    'badge','uncommon',  450,  'shop',       '{"emoji":"🏎️"}', false, false),
  ('badge-pilot',         'Pilot',         'Sky-high ambitions.',                       'badge','rare',     1300,  'shop',       '{"emoji":"✈️"}',  false, false),
  ('badge-astronaut',     'Astronaut',     'Beyond the atmosphere.',                    'badge','epic',     5000,  'shop',       '{"emoji":"🚀"}',  false, false),
  ('badge-captain',       'Captain',       'Of the high seas.',                         'badge','rare',     1800,  'shop',       '{"emoji":"⚓"}',  false, false),
  ('badge-biker',         'Biker',         'Two wheels, full throttle.',                'badge','uncommon',  380,  'shop',       '{"emoji":"🏍️"}', false, false),
  ('badge-wolf',          'Wolf',          'Hunts alone. Gacha-only.',                  'badge','rare',      null, 'admin',      '{"emoji":"🐺"}',  false, true),
  ('badge-lion',          'Lion',          'King of beasts. Achievement only.',         'badge','epic',      null, 'achievement','{"emoji":"🦁"}',  false, false),
  ('badge-shark',         'Shark',         'Apex predator. Gacha-only.',                'badge','rare',      null, 'admin',      '{"emoji":"🦈"}',  false, true),
  ('badge-eagle',         'Eagle',         'Eyes like a hawk.',                         'badge','uncommon',  600,  'shop',       '{"emoji":"🦅"}',  false, false),
  ('badge-fox',           'Fox',           'Clever and cunning.',                       'badge','common',     80,  'shop',       '{"emoji":"🦊"}',  false, false),
  ('badge-bear',          'Bear',          'Strength and patience.',                    'badge','rare',     1400,  'shop',       '{"emoji":"🐻"}',  false, false),
  ('badge-dragon',        'Dragon',        'Ancient and unstoppable. Gacha-only.',      'badge','legendary', null, 'admin',      '{"emoji":"🐉"}',  false, true),
  ('badge-cat',           'Cat',           'Independent spirit.',                       'badge','common',     60,  'shop',       '{"emoji":"🐱"}',  false, false),
  ('badge-owl',           'Owl',           'Wise in the ways of odds.',                 'badge','uncommon',  400,  'shop',       '{"emoji":"🦉"}',  false, false),
  ('badge-panda',         'Panda',         'Appears at 11:11.',                         'badge','uncommon',  800,  'timed_shop', '{"emoji":"🐼"}',  false, false),
  ('badge-unicorn',       'Unicorn',       'Midnight myth.',                            'badge','epic',     7500,  'timed_shop', '{"emoji":"🦄"}',  false, false),
  ('badge-phoenix',       'Phoenix',       'Reborn from ashes. Gacha-only.',            'badge','legendary', null, 'admin',      '{"emoji":"🔥"}',  false, true),
  ('badge-cobra',         'King Cobra',    'Venom strikes fast.',                       'badge','rare',     1600,  'shop',       '{"emoji":"🐍"}',  false, false),
  ('badge-gambler',       'The Gambler',   'Achievement only.',                         'badge','epic',      null, 'achievement','{"emoji":"🎲"}',  false, false),
  ('badge-tycoon',        'Tycoon',        'Achievement only.',                         'badge','legendary', null, 'achievement','{"emoji":"💰"}',  false, false)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- +20 TITLES
-- ----------------------------------------------------------------------------
INSERT INTO public.market_items
  (slug, name, description, category, rarity, shop_price, source, metadata, is_unique, gacha_only)
VALUES
  ('title-speed-demon',     'Title · Speed Demon',     'Speed Demon',      'title','rare',     2000,  'shop',       '{"text":"Speed Demon"}',    false, false),
  ('title-sky-captain',     'Title · Sky Captain',     'Sky Captain',      'title','rare',     2200,  'shop',       '{"text":"Sky Captain"}',    false, false),
  ('title-star-chaser',     'Title · Star Chaser',     'Star Chaser',      'title','uncommon',  700,  'shop',       '{"text":"Star Chaser"}',    false, false),
  ('title-road-king',       'Title · Road King',       'Road King',        'title','uncommon',  850,  'shop',       '{"text":"Road King"}',      false, false),
  ('title-sea-wolf',        'Title · Sea Wolf',        'Sea Wolf',         'title','rare',     1700,  'shop',       '{"text":"Sea Wolf"}',       false, false),
  ('title-the-predator',    'Title · The Predator',    'The Predator',     'title','epic',     5500,  'shop',       '{"text":"The Predator"}',   false, false),
  ('title-alpha',           'Title · Alpha',           'Alpha',            'title','epic',      null, 'admin',      '{"text":"Alpha"}',          false, true),
  ('title-apex',            'Title · Apex',            'Apex',             'title','legendary', null, 'admin',      '{"text":"Apex"}',           false, true),
  ('title-wild-one',        'Title · Wild One',        'Wild One',         'title','uncommon',  900,  'shop',       '{"text":"Wild One"}',       false, false),
  ('title-the-hawk',        'Title · The Hawk',        'The Hawk',         'title','rare',     1800,  'shop',       '{"text":"The Hawk"}',       false, false),
  ('title-lion-heart',      'Title · Lion Heart',      'Lion Heart',       'title','epic',      null, 'achievement','{"text":"Lion Heart"}',     false, false),
  ('title-the-goat',        'Title · The G.O.A.T.',    'The G.O.A.T.',     'title','legendary',25000, 'timed_shop','{"text":"The G.O.A.T."}',   false, false),
  ('title-midnight-rider',  'Title · Midnight Rider',  'Midnight Rider',   'title','rare',     3500,  'timed_shop','{"text":"Midnight Rider"}',  false, false),
  ('title-at-1111',         'Title · 11:11',           '11:11',            'title','epic',     8000,  'timed_shop','{"text":"11:11"}',           false, false),
  ('title-rising-phoenix',  'Title · Rising Phoenix',  'Rising Phoenix',   'title','epic',      null, 'admin',      '{"text":"Rising Phoenix"}', false, true),
  ('title-warfront-legend', 'Title · Warfront Legend', 'Warfront Legend',  'title','epic',      null, 'achievement','{"text":"Warfront Legend"}',false, false),
  ('title-centurion',       'Title · Centurion',       'Centurion',        'title','rare',      null, 'achievement','{"text":"Centurion"}',      false, false),
  ('title-deathless',       'Title · Deathless',       'Deathless',        'title','epic',      null, 'achievement','{"text":"Deathless"}',      false, false),
  ('title-all-rounder',     'Title · All-Rounder',     'All-Rounder',      'title','uncommon',  900,  'shop',       '{"text":"All-Rounder"}',    false, false),
  ('title-the-shadow',      'Title · The Shadow',      'The Shadow',       'title','rare',     1500,  'shop',       '{"text":"The Shadow"}',     false, false)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================================
-- PART 1F: Set time_condition on timed_shop items
-- ============================================================================

-- midnight items
UPDATE public.market_items SET time_condition = 'midnight'
  WHERE slug IN (
    'frame-aurora',
    'badge-unicorn',
    'title-the-goat',
    'title-midnight-rider'
  );

-- 11:11 items
UPDATE public.market_items SET time_condition = '11:11'
  WHERE slug IN (
    'badge-panda',
    'title-at-1111'
  );


-- ============================================================================
-- PART 1G: Add gacha-only items to gacha_pool
-- ============================================================================
-- Use INSERT ... SELECT ... ON CONFLICT DO NOTHING to be fully idempotent.
-- We do NOT add items that already have a pool entry (the v8 seed covers
-- pre-existing gacha_ slugs; these are brand-new slugs).

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic',      3, false FROM public.market_items WHERE slug = 'frame-lion-pride'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare',      5, false FROM public.market_items WHERE slug = 'frame-wolf-pack'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'legendary', 1, false FROM public.market_items WHERE slug = 'frame-dragon-fire'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic',      3, false FROM public.market_items WHERE slug = 'frame-tidal-shark'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare',      5, false FROM public.market_items WHERE slug = 'badge-wolf'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare',      5, false FROM public.market_items WHERE slug = 'badge-shark'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'legendary', 1, false FROM public.market_items WHERE slug = 'badge-dragon'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'legendary', 1, false FROM public.market_items WHERE slug = 'badge-phoenix'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic',      3, false FROM public.market_items WHERE slug = 'title-alpha'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'legendary', 1, false FROM public.market_items WHERE slug = 'title-apex'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic',      3, false FROM public.market_items WHERE slug = 'title-rising-phoenix'
ON CONFLICT DO NOTHING;


-- ============================================================================
-- PART 2A: achievement_defs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.achievement_defs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text        UNIQUE NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  -- general | warfront | gacha | cases | pvp
  category        text        NOT NULL DEFAULT 'general',
  -- 'stat'  → read a column from profiles
  -- 'query' → evaluate cond_query (SQL returning bigint, $uid placeholder)
  cond_type       text        NOT NULL,
  cond_column     text,         -- for cond_type='stat': profile column name
  cond_target     bigint      NOT NULL DEFAULT 1,  -- threshold value
  cond_query      text,         -- for cond_type='query': SQL expr returning bigint
  reward_credits  integer     NOT NULL DEFAULT 0,
  reward_item_slug text,        -- nullable slug of market_items to grant on claim
  sort_order      int         NOT NULL DEFAULT 100,
  is_active       boolean     NOT NULL DEFAULT true
);

ALTER TABLE public.achievement_defs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "achievement_defs read all" ON public.achievement_defs;
CREATE POLICY "achievement_defs read all"
  ON public.achievement_defs FOR SELECT USING (true);


-- ============================================================================
-- PART 2B: Extend user_achievements with claim tracking
-- ============================================================================

ALTER TABLE public.user_achievements
  ADD COLUMN IF NOT EXISTS is_claimed boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;


-- ============================================================================
-- PART 2C: Seed achievement_defs (21 achievements)
-- ============================================================================

INSERT INTO public.achievement_defs
  (code, name, description, category, cond_type, cond_column, cond_target,
   cond_query, reward_credits, reward_item_slug, sort_order)
VALUES

  -- ── General / stat-based ──────────────────────────────────────────────────
  ('first-steps',
   'First Steps',
   'Wager at least 100 credits total.',
   'general', 'stat', 'total_wagered', 100,
   null, 50, null, 10),

  ('high-roller-ach',
   'High Roller',
   'Wager at least 10,000 credits total.',
   'general', 'stat', 'total_wagered', 10000,
   null, 250, null, 20),

  ('whale-ach',
   'The Whale',
   'Wager at least 100,000 credits total.',
   'general', 'stat', 'total_wagered', 100000,
   null, 1000, 'badge-tycoon', 30),

  ('big-win-ach',
   'Big Win',
   'Win at least 1,000 credits in a single bet.',
   'general', 'stat', 'biggest_single_win', 1000,
   null, 200, null, 40),

  ('jackpot-hit-ach',
   'Jackpot',
   'Win at least 5,000 credits in a single bet.',
   'general', 'stat', 'biggest_single_win', 5000,
   null, 500, null, 50),

  ('case-opener-ach',
   'Case Opener',
   'Open at least 5 cases.',
   'cases', 'stat', 'cases_opened', 5,
   null, 200, null, 60),

  ('case-addict-ach',
   'Case Addict',
   'Open at least 20 cases.',
   'cases', 'stat', 'cases_opened', 20,
   null, 500, null, 70),

  ('collector-ach',
   'Collector',
   'Own at least 5 unique collectibles.',
   'general', 'stat', 'items_unique', 5,
   null, 300, null, 80),

  ('hoarder-ach',
   'Hoarder',
   'Own at least 15 unique collectibles.',
   'general', 'stat', 'items_unique', 15,
   null, 0, 'frame-diamond', 90),

  ('peak-1k-ach',
   'On the Up',
   'Reach 1,000 credits at once.',
   'general', 'stat', 'peak_credits', 1000,
   null, 100, null, 100),

  ('peak-10k-ach',
   'Rich',
   'Reach 10,000 credits at once.',
   'general', 'stat', 'peak_credits', 10000,
   null, 500, null, 110),

  ('peak-100k-ach',
   'Filthy Rich',
   'Reach 100,000 credits at once.',
   'general', 'stat', 'peak_credits', 100000,
   null, 2000, null, 120),

  ('streak-7-ach',
   'Consistent',
   'Log in 7 days in a row.',
   'general', 'stat', 'streak_days', 7,
   null, 300, null, 130),

  ('total-won-10k-ach',
   'The Winner',
   'Win 10,000 total credits.',
   'general', 'stat', 'total_won', 10000,
   null, 300, null, 140),

  ('total-won-100k-ach',
   'The Champion',
   'Win 100,000 total credits.',
   'general', 'stat', 'total_won', 100000,
   null, 1000, 'title-deathless', 150),

  -- ── Warfront-specific (cond_type='query') ─────────────────────────────────
  ('warfront-first-win',
   'First Blood',
   'Win your first Warfront battle.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',
   100, 'frame-warfront-victor', 200),

  ('warfront-wins-10',
   'Warfront Legend',
   'Win 10 Warfront battles.',
   'warfront', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',
   500, 'title-warfront-legend', 210),

  ('warfront-animal-leg',
   'Animal Tamer',
   'Beat Legendary difficulty in Animals mode.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND collection = ''animals'' AND enemy_difficulty = ''Legendary'')',
   0, 'badge-lion', 220),

  ('warfront-pvp-win',
   'PvP Champion',
   'Win a Warfront PvP match.',
   'pvp', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.mp_warfront_games WHERE (player_x = $uid AND winner = 0) OR (player_o = $uid AND winner = 1))',
   300, null, 230),

  -- ── Gacha-related ─────────────────────────────────────────────────────────
  ('gacha-first-ach',
   'Fortune''s Wheel',
   'Make your first gacha pull.',
   'gacha', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.gacha_pulls WHERE user_id = $uid)',
   100, null, 300),

  ('gacha-10-ach',
   'Dedicated Roller',
   'Pull 10 times from the gacha wheel.',
   'gacha', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.gacha_pulls WHERE user_id = $uid)',
   300, null, 310)

ON CONFLICT (code) DO UPDATE
  SET name             = excluded.name,
      description      = excluded.description,
      cond_target      = excluded.cond_target,
      reward_credits   = excluded.reward_credits,
      reward_item_slug = excluded.reward_item_slug;


-- ============================================================================
-- PART 3A: list_my_achievements()
-- ============================================================================
-- Returns all active achievement_defs enriched with per-user progress data:
--   current_value  — how far the user is toward the goal
--   target_value   — the threshold needed to unlock
--   is_unlocked    — true if user has a user_achievements row for this code
--   is_claimed     — true if the reward has already been claimed
--   can_claim      — true if condition met AND reward not yet claimed

CREATE OR REPLACE FUNCTION public.list_my_achievements()
RETURNS TABLE(
  code             text,
  name             text,
  description      text,
  category         text,
  reward_credits   integer,
  reward_item_slug text,
  sort_order       int,
  current_value    bigint,
  target_value     bigint,
  is_unlocked      boolean,
  is_claimed       boolean,
  can_claim        boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid  uuid := auth.uid();
  adef public.achievement_defs%ROWTYPE;
  ua   public.user_achievements%ROWTYPE;
  cv   bigint;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  FOR adef IN
    SELECT * FROM public.achievement_defs
     WHERE is_active
     ORDER BY sort_order
  LOOP
    -- Fetch existing unlock row (may not exist yet)
    SELECT * INTO ua
      FROM public.user_achievements
     WHERE user_id = uid AND code = adef.code;

    -- Compute the user's current progress value
    IF adef.cond_type = 'stat' THEN
      EXECUTE format(
        'SELECT (%I)::bigint FROM public.profiles WHERE id = $1',
        adef.cond_column
      ) INTO cv USING uid;

    ELSIF adef.cond_type = 'query' THEN
      -- Replace $uid placeholder with a quoted literal UUID
      EXECUTE replace(adef.cond_query, '$uid', quote_literal(uid))
        INTO cv;

    ELSE
      cv := 0;
    END IF;

    cv := COALESCE(cv, 0);

    -- Populate output columns
    code             := adef.code;
    name             := adef.name;
    description      := adef.description;
    category         := adef.category;
    reward_credits   := adef.reward_credits;
    reward_item_slug := adef.reward_item_slug;
    sort_order       := adef.sort_order;
    current_value    := cv;
    target_value     := COALESCE(adef.cond_target, 1);
    is_unlocked      := (ua.code IS NOT NULL);
    is_claimed       := COALESCE(ua.is_claimed, false);
    can_claim        := (cv >= COALESCE(adef.cond_target, 1))
                        AND NOT COALESCE(ua.is_claimed, false);

    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL  ON FUNCTION public.list_my_achievements() FROM public;
GRANT EXECUTE ON FUNCTION public.list_my_achievements() TO authenticated;


-- ============================================================================
-- PART 3B: claim_achievement(p_code text)
-- ============================================================================
-- 1. Verifies the achievement exists and is active.
-- 2. Checks it has not already been claimed by this user.
-- 3. Evaluates the condition (stat or query).
-- 4. If condition met: upserts user_achievements with is_claimed=true,
--    grants any credit reward, grants any item reward.
-- 5. Returns a jsonb summary.

CREATE OR REPLACE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid  uuid := auth.uid();
  adef public.achievement_defs%ROWTYPE;
  ua   public.user_achievements%ROWTYPE;
  cv   bigint;
  it   public.market_items%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load achievement definition
  SELECT * INTO adef
    FROM public.achievement_defs
   WHERE code = p_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive achievement: %', p_code;
  END IF;

  -- Idempotency: reject double-claim
  SELECT * INTO ua
    FROM public.user_achievements
   WHERE user_id = uid AND code = p_code;
  IF FOUND AND ua.is_claimed THEN
    RAISE EXCEPTION 'Achievement already claimed';
  END IF;

  -- Evaluate condition
  IF adef.cond_type = 'stat' THEN
    EXECUTE format(
      'SELECT (%I)::bigint FROM public.profiles WHERE id = $1',
      adef.cond_column
    ) INTO cv USING uid;

  ELSIF adef.cond_type = 'query' THEN
    EXECUTE replace(adef.cond_query, '$uid', quote_literal(uid))
      INTO cv;

  ELSE
    cv := 0;
  END IF;

  cv := COALESCE(cv, 0);

  IF cv < COALESCE(adef.cond_target, 1) THEN
    RAISE EXCEPTION 'Achievement condition not met (% / %)',
      cv, COALESCE(adef.cond_target, 1);
  END IF;

  -- Upsert the unlock+claim row
  INSERT INTO public.user_achievements
    (user_id, code, awarded_at, meta, is_claimed, claimed_at)
  VALUES
    (uid, p_code, now(), '{}', true, now())
  ON CONFLICT (user_id, code) DO UPDATE
    SET is_claimed = true,
        claimed_at = now();

  -- Grant credit reward
  IF adef.reward_credits > 0 THEN
    PERFORM public._apply_credit_delta(
      uid,
      adef.reward_credits,
      'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- Grant item reward (if any)
  IF adef.reward_item_slug IS NOT NULL THEN
    SELECT * INTO it
      FROM public.market_items
     WHERE slug = adef.reward_item_slug;

    IF FOUND THEN
      -- The trigger on user_items maintains profiles.items_unique / items_total
      INSERT INTO public.user_items (user_id, item_id, qty, equipped, first_acquired_at)
        VALUES (uid, it.id, 1, false, now())
      ON CONFLICT (user_id, item_id) DO UPDATE
        SET qty = user_items.qty + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code',             p_code,
    'reward_credits',   adef.reward_credits,
    'reward_item_slug', adef.reward_item_slug
  );
END;
$$;
REVOKE ALL  ON FUNCTION public.claim_achievement(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_achievement(text) TO authenticated;


-- Done.
