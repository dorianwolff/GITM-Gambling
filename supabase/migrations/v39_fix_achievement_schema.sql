-- ============================================================================
-- v39_fix_achievement_schema.sql
--
-- ROOT CAUSE IDENTIFIED:
--   The real `user_achievements` table was created BEFORE v14 (which used
--   CREATE TABLE IF NOT EXISTS — a no-op).  The actual schema is:
--
--     id             uuid PRIMARY KEY
--     user_id        uuid
--     achievement_id text          ← NOT "code"
--     awarded_at     timestamptz
--     metadata       jsonb         ← NOT "meta"
--     is_claimed     boolean       (added by v32 ALTER TABLE)
--     claimed_at     timestamptz   (added by v32 ALTER TABLE)
--
--   Every migration from v32 onward wrote "code" and "meta" in both static
--   SQL statements and EXECUTE strings, causing runtime column-not-found
--   errors.  This migration fixes both RPCs.
--
-- FIXES:
--   1. list_my_achievements() — uses EXECUTE for user_achievements query
--      so "achievement_id" is resolved at runtime, not compile time.
--   2. claim_achievement()    — corrects all user_achievements column
--      references to "achievement_id" and "metadata".
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART 1 — list_my_achievements()
-- ============================================================================

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
  uid      uuid    := auth.uid();
  adef     record;           -- achievement_defs row (untyped)
  ua       record;           -- user_achievements row (untyped — real col is achievement_id)
  ua_found boolean;
  cv       bigint;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  FOR adef IN
    SELECT * FROM public.achievement_defs
     WHERE is_active
     ORDER BY sort_order
  LOOP
    -- EXECUTE keeps "achievement_id" out of PL/pgSQL compile-time resolution.
    -- FOUND is reliably set for EXECUTE INTO <record>.
    EXECUTE
      'SELECT * FROM public.user_achievements
        WHERE user_id = $1 AND achievement_id = $2'
      INTO ua USING uid, adef.code;
    ua_found := FOUND;

    -- Compute progress
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
      cv := 0;
    END;

    cv := COALESCE(cv, 0);

    -- Populate output row
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
-- PART 2 — claim_achievement()
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid      uuid    := auth.uid();
  adef     record;           -- achievement_defs row (untyped)
  ua       record;           -- user_achievements row (untyped, real col = achievement_id)
  ua_found boolean := false;
  cv       bigint  := 0;
  it       record;           -- market_items row
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Load achievement definition ─────────────────────────────────────────
  -- EXECUTE defers column resolution of "code" to runtime.
  -- No is_active filter: list_my_achievements() already gates by is_active.
  EXECUTE 'SELECT * FROM public.achievement_defs WHERE code = $1'
    INTO adef USING p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Achievement not found: %', p_code;
  END IF;

  -- ── Check for existing claim row ────────────────────────────────────────
  -- Real column name is "achievement_id", not "code".
  EXECUTE
    'SELECT * FROM public.user_achievements
      WHERE user_id = $1 AND achievement_id = $2'
    INTO ua USING uid, p_code;
  ua_found := FOUND;

  IF ua_found AND COALESCE(ua.is_claimed, false) THEN
    RAISE EXCEPTION 'Achievement already claimed';
  END IF;

  -- ── Evaluate condition ──────────────────────────────────────────────────
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
    RAISE EXCEPTION 'Could not evaluate achievement condition: %', SQLERRM;
  END;

  cv := COALESCE(cv, 0);
  IF cv < COALESCE(adef.cond_target, 1) THEN
    RAISE EXCEPTION 'Achievement condition not met (% / %)',
      cv, COALESCE(adef.cond_target, 1);
  END IF;

  -- ── Upsert claim row ────────────────────────────────────────────────────
  -- Real columns: achievement_id (not code), metadata (not meta).
  IF ua_found THEN
    EXECUTE
      'UPDATE public.user_achievements
          SET is_claimed = true, claimed_at = now()
        WHERE user_id = $1 AND achievement_id = $2'
      USING uid, p_code;
  ELSE
    EXECUTE
      'INSERT INTO public.user_achievements
         (user_id, achievement_id, awarded_at, metadata, is_claimed, claimed_at)
       VALUES ($1, $2, now(), $3::jsonb, true, now())'
      USING uid, p_code, '{}';
  END IF;

  -- ── Credit reward ───────────────────────────────────────────────────────
  IF COALESCE(adef.reward_credits, 0) > 0 THEN
    PERFORM public._apply_credit_delta(
      uid,
      adef.reward_credits,
      'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- ── Item reward ─────────────────────────────────────────────────────────
  IF adef.reward_item_slug IS NOT NULL THEN
    EXECUTE 'SELECT * FROM public.market_items WHERE slug = $1'
      INTO it USING adef.reward_item_slug;
    IF FOUND THEN
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


-- ============================================================================
-- PART 3 — Activate all achievement_defs rows
-- ============================================================================

UPDATE public.achievement_defs
   SET is_active = true
 WHERE is_active IS DISTINCT FROM true;


-- ============================================================================
-- PART 4 — Ensure reward items exist
-- ============================================================================

INSERT INTO public.market_items
  (slug, name, description, category, rarity, shop_price, source, metadata, gacha_only)
VALUES
  ('badge-godlike', 'GODLIKE',
   'Awarded to pinball players who hit a 16-hit combo.',
   'badge', 'legendary', null, 'achievement', '{"emoji":"⚡"}', false),
  ('title-pinball-wizard', 'Pinball Wizard',
   'Score 30,000 or more in a single pinball round.',
   'title', 'epic', null, 'achievement', '{"text":"Pinball Wizard"}', false)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================================
-- PART 5 — Re-seed all achievement definitions (idempotent)
-- Each DO block wraps the INSERT in EXECUTE $q$...$q$ so ON CONFLICT (code)
-- is resolved at runtime by the SQL engine, not at compile time by PL/pgSQL.
-- EXCEPTION handler ensures one failure never aborts the rest.
-- ============================================================================

-- ── General stat-based ───────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('first-steps','First Steps','Wager at least 100 credits total.','general','stat','total_wagered',100,null,50,null,10,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'first-steps: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('high-roller-ach','High Roller','Wager at least 10,000 credits total.','general','stat','total_wagered',10000,null,250,null,20,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'high-roller-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('whale-ach','The Whale','Wager at least 100,000 credits total.','general','stat','total_wagered',100000,null,1000,'badge-tycoon',30,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'whale-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('big-win-ach','Big Win','Win at least 1,000 credits in a single bet.','general','stat','biggest_single_win',1000,null,200,null,40,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'big-win-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('jackpot-hit-ach','Jackpot','Win at least 5,000 credits in a single bet.','general','stat','biggest_single_win',5000,null,500,null,50,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'jackpot-hit-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('case-opener-ach','Case Opener','Open 10 cases.','cases','stat','cases_opened',10,null,100,null,60,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'case-opener-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('case-addict-ach','Case Addict','Open 100 cases.','cases','stat','cases_opened',100,null,500,null,70,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'case-addict-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('gacha-pull-ach','Lucky Draw','Pull the gacha 10 times.','gacha','stat','gacha_pulls',10,null,100,null,80,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'gacha-pull-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('gacha-obsessed-ach','Gacha Obsessed','Pull the gacha 100 times.','gacha','stat','gacha_pulls',100,null,500,null,90,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'gacha-obsessed-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('streak-7-ach','Week Streak','Claim your daily bonus 7 days in a row.','general','stat','streak_days',7,null,200,null,100,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'streak-7-ach: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('streak-30-ach','Monthly Devotee','Claim your daily bonus 30 days in a row.','general','stat','streak_days',30,null,1000,null,110,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'streak-30-ach: %',SQLERRM; END $outer$;

-- ── Warfront ─────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-first-win','First Blood','Win your first Warfront battle.','warfront','query',null,1,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',100,null,200,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-first-win: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-wins-10','Veteran','Win 10 Warfront battles.','warfront','query',null,10,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',300,null,210,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-wins-10: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-wins-50','Warlord','Win 50 Warfront battles.','warfront','query',null,50,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',1000,null,540,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-wins-50: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-legend-fantasy','Fantasy Overlord','Beat Legendary difficulty in Fantasy mode.','warfront','query',null,1,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND collection = ''fantasy'' AND enemy_difficulty = ''Legendary'')',500,null,500,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-legend-fantasy: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-impossible','The Impossible','Beat Impossible difficulty in any Warfront mode.','warfront','query',null,1,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND enemy_difficulty = ''Impossible'')',1500,'badge-gambler',510,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-impossible: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-budget-8','Peasant King','Win a Fantasy Warfront battle spending 8 gold or less total.','warfront','query',null,1,'(SELECT COUNT(*)::bigint FROM public.warfront_games wg WHERE wg.user_id = $uid AND wg.payout > 0 AND wg.collection = ''fantasy'' AND (SELECT COALESCE(SUM((e->>''cost'')::int),0) FROM jsonb_array_elements(wg.player_picks) e) <= 8)',300,null,520,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-budget-8: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-big-bettor','All In','Wager at least 2,000 credits on a single Warfront game.','warfront','query',null,2000,'(SELECT COALESCE(MAX(bet),0)::bigint FROM public.warfront_games WHERE user_id = $uid)',250,null,530,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-big-bettor: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-pvp-wins-5','PvP Veteran','Win 5 Warfront PvP matches.','pvp','query',null,5,'(SELECT COUNT(*)::bigint FROM public.mp_warfront_games WHERE (player_x = $uid AND winner = 0) OR (player_o = $uid AND winner = 1))',600,null,550,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-pvp-wins-5: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-troop-golem','Rock Solid','Deploy Golem in 10 Fantasy battles.','warfront','query',null,10,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"golem"}]''::jsonb)',200,null,560,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-golem: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-troop-whale','Big Fish','Deploy Whale in 10 Animals battles.','warfront','query',null,10,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''animals'' AND player_picks @> ''[{"id":"whale"}]''::jsonb)',200,null,570,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-whale: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-troop-phoenix','From the Ashes','Deploy Phoenix in 25 Fantasy battles.','warfront','query',null,25,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"phoenix"}]''::jsonb)',300,null,580,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-phoenix: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('warfront-troop-bombgoblin','Boom Boom','Deploy Bomb Goblin in 50 Fantasy battles.','warfront','query',null,50,'(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"bombgoblin"}]''::jsonb)',350,null,590,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-bombgoblin: %',SQLERRM; END $outer$;

-- ── Pinball ───────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-first-round','Plunger Pulled','Complete your first pinball round.','pinball','query',null,1,'(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',50,null,400,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-first-round: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-score-5k','High Score','Score at least 5,000 points in a single pinball round.','pinball','query',null,5000,'(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',150,null,410,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-5k: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-score-10k','Pinball Pro','Score at least 10,000 points in a single pinball round.','pinball','query',null,10000,'(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',300,null,420,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-10k: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-score-30k','Pinball Wizard','Score at least 30,000 points in a single pinball round.','pinball','query',null,30000,'(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',800,'title-pinball-wizard',430,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-30k: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-combo-10','Chain Reaction','Achieve a 10-hit combo in a single pinball round.','pinball','query',null,10,'(SELECT COALESCE(MAX(combo_max),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',200,null,440,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-combo-10: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-godlike','GODLIKE','Achieve a 16-hit combo (GODLIKE) in a single pinball round.','pinball','query',null,16,'(SELECT COALESCE(MAX(combo_max),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',500,'badge-godlike',450,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-godlike: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-all-maps','World Tour','Play at least one round on each of the 5 pinball maps.','pinball','query',null,5,'(SELECT COUNT(DISTINCT map_key)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',200,null,460,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-all-maps: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('pinball-galaxy','Stargazer','Play 5 rounds on the Galaxy Drift map.','pinball','query',null,5,'(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'' AND map_key = ''galaxy_drift'')',100,null,470,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-galaxy: %',SQLERRM; END $outer$;

-- ── Dice ──────────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('dice-daredevil','Daredevil','Win a dice bet where your win chance was under 5.2% (multiplier ≥ 19×).','dice','query',null,1,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 19)',400,'badge-gambler',600,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dice-daredevil: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('dice-madman','The Madman','Win a dice bet where your win chance was under 3.3% (multiplier ≥ 30×).','dice','query',null,1,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 30)',1000,null,610,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dice-madman: %',SQLERRM; END $outer$;

-- ── Blackjack ─────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('bj-natural-5','Natural Born Winner','Get a natural blackjack (Ace + face card) 5 times.','blackjack','query',null,5,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') = ''blackjack'')',300,null,700,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-natural-5: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('bj-double-win-3','Double Trouble','Win 3 blackjack hands where you doubled down.','blackjack','query',null,3,'(SELECT COUNT(*)::bigint FROM (SELECT bh.id FROM public.blackjack_hands bh, jsonb_array_elements(bh.hands) h WHERE bh.user_id = $uid AND bh.status = ''done'' AND COALESCE((h->>''doubled'')::bool,false) = true AND (h->>''result'') IN (''win'',''blackjack'')) sq)',200,null,710,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-double-win-3: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('bj-wins-20','Card Shark','Win 20 blackjack hands (excludes pushes and surrenders).','blackjack','query',null,20,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') IN (''win'',''blackjack''))',250,null,720,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-wins-20: %',SQLERRM; END $outer$;

-- ── Coinflip ──────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('coinflip-wins-10','Lucky Flip','Win 10 coinflips.','coinflip','query',null,10,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',100,null,800,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'coinflip-wins-10: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('coinflip-wins-50','Heads I Win','Win 50 coinflips.','coinflip','query',null,50,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',300,null,810,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'coinflip-wins-50: %',SQLERRM; END $outer$;

-- ── Roulette ──────────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('roulette-wins-10','Lucky Spin','Win 10 roulette rounds.','roulette','query',null,10,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',150,null,900,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'roulette-wins-10: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('roulette-wins-50','Wheel of Fortune','Win 50 roulette rounds.','roulette','query',null,50,'(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',500,null,910,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'roulette-wins-50: %',SQLERRM; END $outer$;

-- ── Leaderboard ───────────────────────────────────────────────────────────────
DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('lb-top10-credits','Elite','Be in the top 10 players by current credit balance.','general','query',null,1,'(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 10) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',500,null,1000,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lb-top10-credits: %',SQLERRM; END $outer$;

DO $outer$ BEGIN EXECUTE $q$ INSERT INTO public.achievement_defs (code,name,description,category,cond_type,cond_column,cond_target,cond_query,reward_credits,reward_item_slug,sort_order,is_active) VALUES ('lb-top3-credits','Podium','Be in the top 3 players by current credit balance.','general','query',null,1,'(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 3) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',1500,'frame-galaxy',1010,true) ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,cond_target=excluded.cond_target,cond_query=excluded.cond_query,reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,sort_order=excluded.sort_order,is_active=excluded.is_active $q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lb-top3-credits: %',SQLERRM; END $outer$;


-- ============================================================================
-- Done.
-- ============================================================================
