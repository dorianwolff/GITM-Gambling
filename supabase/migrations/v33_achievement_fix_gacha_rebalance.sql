-- ============================================================================
-- v33_achievement_fix_gacha_rebalance.sql
--
-- Fix 1: list_my_achievements() — "record 'ua' has no field 'code'"
--   When no user_achievements row exists for a given code, the SELECT INTO
--   leaves the record variable in an uninitialized state. Reading ua.code on
--   an uninitialized record raises "record has no field 'code'" at runtime.
--   Fix: use the implicit FOUND boolean instead of ua.code for the existence
--   check, and gate all other ua field accesses behind FOUND.
--
-- Fix 2: Shop → Gacha rebalance
--   Most of the 60 new v32 items were inserted as source='shop'. The intent
--   is that only a handful of inexpensive basics live in the shop; the rest
--   should only be obtainable from the gacha wheel.
--
--   Items remaining in shop (5 items only):
--     frame-bicycle       common  100 cr  — the humble starter frame
--     badge-cat           common   60 cr  — classic
--     badge-fox           common   80 cr  — classic
--     title-all-rounder   uncommon 900 cr
--     title-the-shadow    rare    1500 cr
--
--   Everything else from v32 that had source='shop' is moved to gacha
--   (source='admin', gacha_only=true, shop_price=NULL) and gets a
--   gacha_pool entry weighted by rarity.
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ============================================================================
-- FIX 1: Recreate list_my_achievements() without the ua.code field access
-- ============================================================================
-- The only change from v32 is replacing `ua.code IS NOT NULL` with the
-- implicit FOUND boolean set by the preceding SELECT INTO.

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
  uid     uuid := auth.uid();
  adef    public.achievement_defs%ROWTYPE;
  ua      public.user_achievements%ROWTYPE;
  ua_found boolean;
  cv      bigint;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  FOR adef IN
    SELECT * FROM public.achievement_defs
     WHERE is_active
     ORDER BY sort_order
  LOOP
    -- Try to fetch the user's existing unlock row.
    -- FOUND is set to true/false by SELECT INTO; we capture it separately
    -- so we never touch ua fields when no row was returned.
    SELECT * INTO ua
      FROM public.user_achievements
     WHERE user_id = uid AND code = adef.code;
    ua_found := FOUND;

    -- Compute the user's current progress value
    cv := 0;
    BEGIN
      IF adef.cond_type = 'stat' THEN
        EXECUTE format(
          'SELECT (%I)::bigint FROM public.profiles WHERE id = $1',
          adef.cond_column
        ) INTO cv USING uid;

      ELSIF adef.cond_type = 'query' THEN
        EXECUTE replace(adef.cond_query, '$uid', quote_literal(uid))
          INTO cv;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      cv := 0;  -- if the condition SQL fails, treat as 0 progress
    END;

    cv := COALESCE(cv, 0);

    -- Populate output columns — only touch ua.* when a row was found
    code             := adef.code;
    name             := adef.name;
    description      := adef.description;
    category         := adef.category;
    reward_credits   := adef.reward_credits;
    reward_item_slug := adef.reward_item_slug;
    sort_order       := adef.sort_order;
    current_value    := cv;
    target_value     := COALESCE(adef.cond_target, 1);
    is_unlocked      := ua_found;
    is_claimed       := CASE WHEN ua_found THEN COALESCE(ua.is_claimed, false) ELSE false END;
    can_claim        := (cv >= COALESCE(adef.cond_target, 1))
                        AND NOT (CASE WHEN ua_found THEN COALESCE(ua.is_claimed, false) ELSE false END);

    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL  ON FUNCTION public.list_my_achievements() FROM public;
GRANT EXECUTE ON FUNCTION public.list_my_achievements() TO authenticated;


-- ============================================================================
-- FIX 2A: Mark v32 shop items that are moving to gacha
-- ============================================================================
-- Set source='admin', gacha_only=true, shop_price=NULL for the items
-- that should no longer appear in the shop.

UPDATE public.market_items
   SET source     = 'admin',
       gacha_only = true,
       shop_price = NULL
 WHERE slug IN (
   -- Frames (all new v32 frames except frame-bicycle stay in shop)
   'frame-fire-engine',
   'frame-race-car',
   'frame-spaceship',
   'frame-helicopter',
   'frame-golden-eagle',
   'frame-neon-green',
   'frame-galaxy',
   'frame-skull',
   'frame-diamond',
   'frame-cherry-blossom',
   'frame-snowflake',
   'frame-lightning',
   -- Badges (keep badge-cat, badge-fox in shop)
   'badge-racing-driver',
   'badge-pilot',
   'badge-astronaut',
   'badge-captain',
   'badge-biker',
   'badge-eagle',
   'badge-bear',
   'badge-owl',
   'badge-cobra',
   -- Titles (keep title-all-rounder, title-the-shadow in shop)
   'title-speed-demon',
   'title-sky-captain',
   'title-star-chaser',
   'title-road-king',
   'title-sea-wolf',
   'title-the-predator',
   'title-wild-one',
   'title-the-hawk'
 );


-- ============================================================================
-- FIX 2B: Add the newly-gacha items to gacha_pool
-- ============================================================================
-- Weights by rarity: uncommon=12, rare=6, epic=3 (legendary=1 handled in v32)
-- ON CONFLICT DO NOTHING is idempotent.

-- ── Frames ────────────────────────────────────────────────────────────────────

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'frame-fire-engine'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'frame-race-car'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic', 3, false FROM public.market_items WHERE slug = 'frame-spaceship'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'frame-helicopter'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'frame-golden-eagle'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'frame-neon-green'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic', 3, false FROM public.market_items WHERE slug = 'frame-galaxy'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'frame-skull'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic', 3, false FROM public.market_items WHERE slug = 'frame-diamond'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'frame-cherry-blossom'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'frame-snowflake'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'frame-lightning'
ON CONFLICT DO NOTHING;

-- ── Badges ────────────────────────────────────────────────────────────────────

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'badge-racing-driver'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'badge-pilot'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic', 3, false FROM public.market_items WHERE slug = 'badge-astronaut'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'badge-captain'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'badge-biker'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'badge-eagle'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'badge-bear'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'badge-owl'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'badge-cobra'
ON CONFLICT DO NOTHING;

-- ── Titles ────────────────────────────────────────────────────────────────────

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'title-speed-demon'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'title-sky-captain'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'title-star-chaser'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'title-road-king'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'title-sea-wolf'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'epic', 3, false FROM public.market_items WHERE slug = 'title-the-predator'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'uncommon', 12, false FROM public.market_items WHERE slug = 'title-wild-one'
ON CONFLICT DO NOTHING;

INSERT INTO public.gacha_pool (item_id, rarity, weight, is_unique)
SELECT id, 'rare', 6, false FROM public.market_items WHERE slug = 'title-the-hawk'
ON CONFLICT DO NOTHING;


-- ============================================================================
-- Done.
-- ============================================================================
