-- ============================================================================
-- v37_claim_achievement_scalar.sql  (rewritten)
--
-- Definitive fix after tracing the exact PL/pgSQL compile-time failure:
--
--   ANY static SQL inside a PL/pgSQL function or DO block that references
--   the column named "code" — whether in WHERE, ON CONFLICT, or elsewhere —
--   fails with "column 'code' does not exist" at COMPILE TIME in this
--   Supabase/PG environment.  This happens even though the column exists
--   and even though the same query works fine in plain SQL.
--
--   The pattern that triggered it in every prior migration attempt:
--     v32: ON CONFLICT (user_id, code) DO UPDATE          ← function body
--     v34: WHERE code = p_code  (static SQL, %ROWTYPE)    ← function body
--     v37: WHERE code = p_code  (static SQL, scalar INTO) ← function body
--     v36/v37: ON CONFLICT (code) DO UPDATE               ← DO $$ blocks
--
--   The only reliable fix: route ALL SQL that mentions "code" through
--   EXECUTE so PL/pgSQL never sees it at compile time.  Plain PostgreSQL
--   SQL (not inside a function or DO block) is fine — it's only the
--   PL/pgSQL compile-time pass that misbehaves.
--
-- CLAIM_ACHIEVEMENT: EXECUTE + individual scalar INTO variables.
--   EXECUTE avoids compile-time column resolution.
--   Scalar variables (not an untyped "record") keep the FOUND boolean
--   reliable — this is the regression introduced in v35/v36 which used
--   EXECUTE + record and found that FOUND was unreliable.
--
-- SEEDS: each achievement is inserted via a DO block where the INSERT
--   itself lives inside an EXECUTE $q$...$q$ string.  The dollar-quoted
--   string is opaque to PL/pgSQL's compiler; PostgreSQL's SQL engine
--   handles ON CONFLICT (code) at runtime with no trouble.
--   Each DO block has its own EXCEPTION handler so one bad row never
--   aborts the others.
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART 1 — claim_achievement(): EXECUTE everywhere code is referenced
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid              uuid    := auth.uid();

  -- Scalar targets for achievement_defs columns
  -- (scalar INTO keeps FOUND reliable; no %ROWTYPE, no record)
  adef_cond_type   text;
  adef_cond_col    text;
  adef_cond_target bigint;
  adef_cond_query  text;
  adef_reward_cr   integer;
  adef_reward_slug text;

  -- Scalar targets for user_achievements columns
  ua_found         boolean := false;
  ua_claimed_val   boolean := false;

  -- Progress counter
  cv               bigint  := 0;

  -- Item grant
  reward_item_id   uuid;
BEGIN
  -- ── Auth guard ───────────────────────────────────────────────────────────
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Load achievement definition ───────────────────────────────────────────
  -- EXECUTE: PL/pgSQL never sees "code" at compile time → no column-not-found
  -- Scalar INTO: FOUND is set reliably (unlike untyped record INTO)
  EXECUTE
    'SELECT cond_type, cond_column, cond_target, cond_query,
            reward_credits, reward_item_slug
       FROM public.achievement_defs
      WHERE code = $1'
  INTO adef_cond_type, adef_cond_col, adef_cond_target, adef_cond_query,
       adef_reward_cr,  adef_reward_slug
  USING p_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Achievement not found: %', p_code;
  END IF;

  -- ── Check existing claim row ──────────────────────────────────────────────
  EXECUTE
    'SELECT is_claimed
       FROM public.user_achievements
      WHERE user_id = $1 AND code = $2'
  INTO ua_claimed_val
  USING uid, p_code;
  ua_found := FOUND;

  IF ua_found AND COALESCE(ua_claimed_val, false) THEN
    RAISE EXCEPTION 'Achievement already claimed';
  END IF;

  -- ── Evaluate progress condition ───────────────────────────────────────────
  BEGIN
    IF adef_cond_type = 'stat' THEN
      EXECUTE format(
        'SELECT (%I)::bigint FROM public.profiles WHERE id = $1',
        adef_cond_col
      ) INTO cv USING uid;

    ELSIF adef_cond_type = 'query' THEN
      EXECUTE replace(adef_cond_query, '$uid', quote_literal(uid))
        INTO cv;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Could not evaluate achievement condition: %', SQLERRM;
  END;

  cv := COALESCE(cv, 0);

  IF cv < COALESCE(adef_cond_target, 1) THEN
    RAISE EXCEPTION 'Achievement condition not met (% / %)',
      cv, COALESCE(adef_cond_target, 1);
  END IF;

  -- ── Upsert claim row (EXECUTE: "code" column stays out of PL/pgSQL compile)
  IF ua_found THEN
    EXECUTE
      'UPDATE public.user_achievements
          SET is_claimed = true, claimed_at = now()
        WHERE user_id = $1 AND code = $2'
    USING uid, p_code;
  ELSE
    EXECUTE
      'INSERT INTO public.user_achievements
         (user_id, code, awarded_at, meta, is_claimed, claimed_at)
       VALUES ($1, $2, now(), $3::jsonb, true, now())'
    USING uid, p_code, '{}';
  END IF;

  -- ── Credit reward ─────────────────────────────────────────────────────────
  IF COALESCE(adef_reward_cr, 0) > 0 THEN
    PERFORM public._apply_credit_delta(
      uid, adef_reward_cr, 'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- ── Item reward ───────────────────────────────────────────────────────────
  IF adef_reward_slug IS NOT NULL THEN
    SELECT id INTO reward_item_id
      FROM public.market_items
     WHERE slug = adef_reward_slug;

    IF FOUND THEN
      INSERT INTO public.user_items (user_id, item_id, qty, equipped, first_acquired_at)
        VALUES (uid, reward_item_id, 1, false, now())
      ON CONFLICT (user_id, item_id) DO UPDATE
        SET qty = user_items.qty + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code',             p_code,
    'reward_credits',   adef_reward_cr,
    'reward_item_slug', adef_reward_slug
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.claim_achievement(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_achievement(text) TO authenticated;


-- ============================================================================
-- PART 2 — Activate all achievement rows
-- ============================================================================
-- Plain SQL (not PL/pgSQL) — no compile-time column issues.

UPDATE public.achievement_defs
   SET is_active = true
 WHERE is_active IS DISTINCT FROM true;


-- ============================================================================
-- PART 3 — Re-seed market_items for achievement rewards (plain SQL)
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
-- PART 4 — Re-seed achievement definitions
--
-- Each achievement is a separate DO block.  The INSERT lives inside an
-- EXECUTE $q$...$q$ string so PL/pgSQL never compiles ON CONFLICT (code)
-- at the block level — PostgreSQL's SQL engine handles it at runtime where
-- it works correctly.  The EXCEPTION handler ensures one failure never
-- aborts the others.
-- ============================================================================

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-first-round','Plunger Pulled',
    'Complete your first pinball round.',
    'pinball','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    50,null,400,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-first-round: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-score-5k','High Score',
    'Score at least 5,000 points in a single pinball round.',
    'pinball','query',null,5000,
    '(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    150,null,410,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-5k: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-score-10k','Pinball Pro',
    'Score at least 10,000 points in a single pinball round.',
    'pinball','query',null,10000,
    '(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    300,null,420,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-10k: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-score-30k','Pinball Wizard',
    'Score at least 30,000 points in a single pinball round.',
    'pinball','query',null,30000,
    '(SELECT COALESCE(MAX(score),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    800,'title-pinball-wizard',430,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-score-30k: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-combo-10','Chain Reaction',
    'Achieve a 10-hit combo in a single pinball round.',
    'pinball','query',null,10,
    '(SELECT COALESCE(MAX(combo_max),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    200,null,440,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-combo-10: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-godlike','GODLIKE',
    'Achieve a 16-hit combo (GODLIKE) in a single pinball round.',
    'pinball','query',null,16,
    '(SELECT COALESCE(MAX(combo_max),0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    500,'badge-godlike',450,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-godlike: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-all-maps','World Tour',
    'Play at least one round on each of the 5 pinball maps.',
    'pinball','query',null,5,
    '(SELECT COUNT(DISTINCT map_key)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
    200,null,460,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-all-maps: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('pinball-galaxy','Stargazer',
    'Play 5 rounds on the Galaxy Drift map.',
    'pinball','query',null,5,
    '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'' AND map_key = ''galaxy_drift'')',
    100,null,470,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pinball-galaxy: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-legend-fantasy','Fantasy Overlord',
    'Beat Legendary difficulty in Fantasy mode.',
    'warfront','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND collection = ''fantasy'' AND enemy_difficulty = ''Legendary'')',
    500,null,500,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-legend-fantasy: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-impossible','The Impossible',
    'Beat Impossible difficulty in any Warfront mode.',
    'warfront','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND enemy_difficulty = ''Impossible'')',
    1500,'badge-gambler',510,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-impossible: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-budget-8','Peasant King',
    'Win a Fantasy Warfront battle spending 8 gold or less total.',
    'warfront','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games wg WHERE wg.user_id = $uid AND wg.payout > 0 AND wg.collection = ''fantasy'' AND (SELECT COALESCE(SUM((e->>''cost'')::int),0) FROM jsonb_array_elements(wg.player_picks) e) <= 8)',
    300,null,520,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-budget-8: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-big-bettor','All In',
    'Wager at least 2,000 credits on a single Warfront game.',
    'warfront','query',null,2000,
    '(SELECT COALESCE(MAX(bet),0)::bigint FROM public.warfront_games WHERE user_id = $uid)',
    250,null,530,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-big-bettor: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-wins-50','Warlord',
    'Win 50 Warfront battles.',
    'warfront','query',null,50,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',
    1000,null,540,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-wins-50: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-pvp-wins-5','PvP Veteran',
    'Win 5 Warfront PvP matches.',
    'pvp','query',null,5,
    '(SELECT COUNT(*)::bigint FROM public.mp_warfront_games WHERE (player_x = $uid AND winner = 0) OR (player_o = $uid AND winner = 1))',
    600,null,550,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-pvp-wins-5: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-troop-golem','Rock Solid',
    'Deploy Golem in 10 Fantasy battles.',
    'warfront','query',null,10,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"golem"}]''::jsonb)',
    200,null,560,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-golem: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-troop-whale','Big Fish',
    'Deploy Whale in 10 Animals battles.',
    'warfront','query',null,10,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''animals'' AND player_picks @> ''[{"id":"whale"}]''::jsonb)',
    200,null,570,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-whale: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-troop-phoenix','From the Ashes',
    'Deploy Phoenix in 25 Fantasy battles.',
    'warfront','query',null,25,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"phoenix"}]''::jsonb)',
    300,null,580,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-phoenix: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('warfront-troop-bombgoblin','Boom Boom',
    'Deploy Bomb Goblin in 50 Fantasy battles.',
    'warfront','query',null,50,
    '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"bombgoblin"}]''::jsonb)',
    350,null,590,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'warfront-troop-bombgoblin: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('dice-daredevil','Daredevil',
    'Win a dice bet where your win chance was under 5.2% (multiplier ≥ 19×).',
    'dice','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 19)',
    400,'badge-gambler',600,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dice-daredevil: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('dice-madman','The Madman',
    'Win a dice bet where your win chance was under 3.3% (multiplier ≥ 30×).',
    'dice','query',null,1,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 30)',
    1000,null,610,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dice-madman: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('bj-natural-5','Natural Born Winner',
    'Get a natural blackjack (Ace + face card) 5 times.',
    'blackjack','query',null,5,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') = ''blackjack'')',
    300,null,700,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-natural-5: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('bj-double-win-3','Double Trouble',
    'Win 3 blackjack hands where you doubled down.',
    'blackjack','query',null,3,
    '(SELECT COUNT(*)::bigint FROM (SELECT bh.id FROM public.blackjack_hands bh, jsonb_array_elements(bh.hands) h WHERE bh.user_id = $uid AND bh.status = ''done'' AND COALESCE((h->>''doubled'')::bool,false) = true AND (h->>''result'') IN (''win'',''blackjack'')) sq)',
    200,null,710,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-double-win-3: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('bj-wins-20','Card Shark',
    'Win 20 blackjack hands (excludes pushes and surrenders).',
    'blackjack','query',null,20,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') IN (''win'',''blackjack''))',
    250,null,720,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bj-wins-20: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('coinflip-wins-10','Lucky Flip',
    'Win 10 coinflips.',
    'coinflip','query',null,10,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
    100,null,800,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'coinflip-wins-10: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('coinflip-wins-50','Heads I Win',
    'Win 50 coinflips.',
    'coinflip','query',null,50,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
    300,null,810,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'coinflip-wins-50: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('roulette-wins-10','Lucky Spin',
    'Win 10 roulette rounds.',
    'roulette','query',null,10,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
    150,null,900,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'roulette-wins-10: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('roulette-wins-50','Wheel of Fortune',
    'Win 50 roulette rounds.',
    'roulette','query',null,50,
    '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
    500,null,910,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'roulette-wins-50: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('lb-top10-credits','Elite',
    'Be in the top 10 players by current credit balance.',
    'general','query',null,1,
    '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 10) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
    500,null,1000,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lb-top10-credits: %',SQLERRM;
END $outer$;

DO $outer$
BEGIN EXECUTE $q$
  INSERT INTO public.achievement_defs
    (code,name,description,category,cond_type,cond_column,cond_target,
     cond_query,reward_credits,reward_item_slug,sort_order,is_active)
  VALUES ('lb-top3-credits','Podium',
    'Be in the top 3 players by current credit balance.',
    'general','query',null,1,
    '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 3) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
    1500,'frame-galaxy',1010,true)
  ON CONFLICT (code) DO UPDATE SET
    name=excluded.name,description=excluded.description,
    cond_target=excluded.cond_target,cond_query=excluded.cond_query,
    reward_credits=excluded.reward_credits,reward_item_slug=excluded.reward_item_slug,
    sort_order=excluded.sort_order,is_active=excluded.is_active
$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lb-top3-credits: %',SQLERRM;
END $outer$;


-- ============================================================================
-- Done.
-- ============================================================================
