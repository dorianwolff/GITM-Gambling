-- ============================================================================
-- v34_multi_badge_achievements.sql
--
-- Fix 1: claim_achievement() — "column 'code' does not exist"
--   The ON CONFLICT (user_id, code) clause occasionally fails to resolve the
--   unique constraint in some Supabase/PG environments.  Replaced with an
--   explicit IF-FOUND branch (SELECT INTO → UPDATE or INSERT) so no
--   constraint inference is needed.  Also wrapped the cond_query EXECUTE in
--   a BEGIN…EXCEPTION block mirroring the safety added in v33.
--
-- Fix 2: market_equip() — allow up to 3 badges simultaneously
--   Previously a single UPDATE unequipped ALL other items in the same
--   category before equipping the chosen one (one-per-category rule).
--   Badges are now special-cased: if < 3 badges are already equipped the
--   new one is added without touching the others; a 4th attempt raises an
--   exception that surfaces as a toast on the client.
--
-- New: 2 achievement-reward-only market items
--   badge-godlike    — legendary, achievement-only (pinball GODLIKE combo)
--   title-pinball-wizard — epic, achievement-only (pinball 30 k score)
--
-- New: 28 achievement definitions across 8 categories
--   Pinball   (8), Warfront additional (9), Dice (2),
--   Blackjack (3), Coinflip (2), Roulette (2), Leaderboard (2)
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ============================================================================
-- FIX 1: Recreate claim_achievement() without ON CONFLICT
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid  uuid := auth.uid();
  adef public.achievement_defs%ROWTYPE;
  ua   public.user_achievements%ROWTYPE;
  ua_found boolean;
  cv   bigint;
  it   public.market_items%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load achievement definition
  SELECT * INTO adef
    FROM public.achievement_defs
   WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive achievement: %', p_code;
  END IF;

  -- Check for existing claim row
  SELECT * INTO ua
    FROM public.user_achievements
   WHERE user_id = uid AND code = p_code;
  ua_found := FOUND;

  -- Reject if already claimed
  IF ua_found AND COALESCE(ua.is_claimed, false) THEN
    RAISE EXCEPTION 'Achievement already claimed';
  END IF;

  -- ── Evaluate condition ────────────────────────────────────────────────────
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
    RAISE EXCEPTION 'Could not evaluate achievement condition: %', SQLERRM;
  END;

  cv := COALESCE(cv, 0);

  IF cv < COALESCE(adef.cond_target, 1) THEN
    RAISE EXCEPTION 'Achievement condition not met (% / %)',
      cv, COALESCE(adef.cond_target, 1);
  END IF;

  -- ── Upsert unlock+claim row (explicit branch, no ON CONFLICT) ─────────────
  IF ua_found THEN
    UPDATE public.user_achievements
       SET is_claimed = true,
           claimed_at = now()
     WHERE user_id = uid AND code = p_code;
  ELSE
    INSERT INTO public.user_achievements
      (user_id, code, awarded_at, meta, is_claimed, claimed_at)
    VALUES
      (uid, p_code, now(), '{}', true, now());
  END IF;

  -- ── Grant credit reward ───────────────────────────────────────────────────
  IF adef.reward_credits > 0 THEN
    PERFORM public._apply_credit_delta(
      uid,
      adef.reward_credits,
      'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- ── Grant item reward ─────────────────────────────────────────────────────
  IF adef.reward_item_slug IS NOT NULL THEN
    SELECT * INTO it
      FROM public.market_items
     WHERE slug = adef.reward_item_slug;

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
-- FIX 2: market_equip() — 3-badge multi-equip
-- ============================================================================

CREATE OR REPLACE FUNCTION public.market_equip(p_item uuid, p_equipped boolean)
RETURNS SETOF public.user_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  cat text;
  badge_count integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT category INTO cat FROM public.market_items WHERE id = p_item;
  IF cat IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;

  IF p_equipped THEN
    IF cat = 'badge' THEN
      -- Count currently equipped badges (excluding the one we're equipping in
      -- case it is already equipped and being re-equipped).
      SELECT COUNT(*) INTO badge_count
        FROM public.user_items ui
        JOIN public.market_items mi ON mi.id = ui.item_id
       WHERE ui.user_id = uid
         AND ui.equipped = true
         AND mi.category = 'badge'
         AND ui.item_id <> p_item;

      IF badge_count >= 3 THEN
        RAISE EXCEPTION 'You can only equip up to 3 badges at a time — unequip one first';
      END IF;
      -- No unequip of others; just add this one to the active set.
    ELSE
      -- All other categories: one-per-slot rule.
      UPDATE public.user_items u
         SET equipped = false
       WHERE u.user_id = uid
         AND u.item_id <> p_item
         AND u.item_id IN (SELECT id FROM public.market_items WHERE category = cat);
    END IF;
  END IF;

  UPDATE public.user_items
     SET equipped = p_equipped
   WHERE user_id = uid AND item_id = p_item;

  RETURN QUERY SELECT * FROM public.user_items WHERE user_id = uid AND item_id = p_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.market_equip(uuid, boolean) TO authenticated;


-- ============================================================================
-- New reward-only market items
-- ============================================================================

INSERT INTO public.market_items
  (slug, name, description, category, rarity, shop_price, source, metadata, gacha_only)
VALUES
  ('badge-godlike',
   'GODLIKE',
   'Awarded to pinball players who hit a 16-hit combo.',
   'badge', 'legendary', null, 'achievement', '{"emoji":"⚡"}', false),

  ('title-pinball-wizard',
   'Pinball Wizard',
   'Score 30,000 or more in a single pinball round.',
   'title', 'epic', null, 'achievement', '{"text":"Pinball Wizard"}', false)

ON CONFLICT (slug) DO NOTHING;


-- ============================================================================
-- New achievement definitions — 28 achievements
-- ============================================================================

INSERT INTO public.achievement_defs
  (code, name, description, category, cond_type, cond_column, cond_target,
   cond_query, reward_credits, reward_item_slug, sort_order)
VALUES

  -- ── Pinball ──────────────────────────────────────────────────────────────

  ('pinball-first-round',
   'Plunger Pulled',
   'Complete your first pinball round.',
   'pinball', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   50, null, 400),

  ('pinball-score-5k',
   'High Score',
   'Score at least 5,000 points in a single pinball round.',
   'pinball', 'query', null, 5000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   150, null, 410),

  ('pinball-score-10k',
   'Pinball Pro',
   'Score at least 10,000 points in a single pinball round.',
   'pinball', 'query', null, 10000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   300, null, 420),

  ('pinball-score-30k',
   'Pinball Wizard',
   'Score at least 30,000 points in a single pinball round.',
   'pinball', 'query', null, 30000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   800, 'title-pinball-wizard', 430),

  ('pinball-combo-10',
   'Chain Reaction',
   'Achieve a 10-hit combo in a single pinball round.',
   'pinball', 'query', null, 10,
   '(SELECT COALESCE(MAX(combo_max), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   200, null, 440),

  ('pinball-godlike',
   'GODLIKE',
   'Achieve a 16-hit combo (GODLIKE) in a single pinball round.',
   'pinball', 'query', null, 16,
   '(SELECT COALESCE(MAX(combo_max), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   500, 'badge-godlike', 450),

  ('pinball-all-maps',
   'World Tour',
   'Play at least one round on each of the 5 pinball maps.',
   'pinball', 'query', null, 5,
   '(SELECT COUNT(DISTINCT map_key)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   200, null, 460),

  ('pinball-galaxy',
   'Stargazer',
   'Play 5 rounds on the Galaxy Drift map.',
   'pinball', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'' AND map_key = ''galaxy_drift'')',
   100, null, 470),

  -- ── Warfront (additional) ─────────────────────────────────────────────────

  ('warfront-legend-fantasy',
   'Fantasy Overlord',
   'Beat Legendary difficulty in Fantasy mode.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND collection = ''fantasy'' AND enemy_difficulty = ''Legendary'')',
   500, null, 500),

  ('warfront-impossible',
   'The Impossible',
   'Beat Impossible difficulty in any Warfront mode.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND enemy_difficulty = ''Impossible'')',
   1500, 'badge-gambler', 510),

  ('warfront-budget-8',
   'Peasant King',
   'Win a Fantasy Warfront battle spending 8 gold or less total.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games wg WHERE wg.user_id = $uid AND wg.payout > 0 AND wg.collection = ''fantasy'' AND (SELECT COALESCE(SUM((e->>''cost'')::int), 0) FROM jsonb_array_elements(wg.player_picks) e) <= 8)',
   300, null, 520),

  ('warfront-big-bettor',
   'All In',
   'Wager at least 2,000 credits on a single Warfront game.',
   'warfront', 'query', null, 2000,
   '(SELECT COALESCE(MAX(bet), 0)::bigint FROM public.warfront_games WHERE user_id = $uid)',
   250, null, 530),

  ('warfront-wins-50',
   'Warlord',
   'Win 50 Warfront battles.',
   'warfront', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',
   1000, null, 540),

  ('warfront-pvp-wins-5',
   'PvP Veteran',
   'Win 5 Warfront PvP matches.',
   'pvp', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.mp_warfront_games WHERE (player_x = $uid AND winner = 0) OR (player_o = $uid AND winner = 1))',
   600, null, 550),

  ('warfront-troop-golem',
   'Rock Solid',
   'Deploy Golem in 10 Fantasy battles.',
   'warfront', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"golem"}]''::jsonb)',
   200, null, 560),

  ('warfront-troop-whale',
   'Big Fish',
   'Deploy Whale in 10 Animals battles.',
   'warfront', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''animals'' AND player_picks @> ''[{"id":"whale"}]''::jsonb)',
   200, null, 570),

  ('warfront-troop-phoenix',
   'From the Ashes',
   'Deploy Phoenix in 25 Fantasy battles.',
   'warfront', 'query', null, 25,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"phoenix"}]''::jsonb)',
   300, null, 580),

  ('warfront-troop-bombgoblin',
   'Boom Boom',
   'Deploy Bomb Goblin in 50 Fantasy battles.',
   'warfront', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"bombgoblin"}]''::jsonb)',
   350, null, 590),

  -- ── Dice ─────────────────────────────────────────────────────────────────

  ('dice-daredevil',
   'Daredevil',
   'Win a dice bet where your win chance was under 5.2% (multiplier ≥ 19×).',
   'dice', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 19)',
   400, 'badge-gambler', 600),

  ('dice-madman',
   'The Madman',
   'Win a dice bet where your win chance was under 3.3% (multiplier ≥ 30×).',
   'dice', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 30)',
   1000, null, 610),

  -- ── Blackjack ─────────────────────────────────────────────────────────────

  ('bj-natural-5',
   'Natural Born Winner',
   'Get a natural blackjack (Ace + face card) 5 times.',
   'blackjack', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') = ''blackjack'')',
   300, null, 700),

  ('bj-double-win-3',
   'Double Trouble',
   'Win 3 blackjack hands where you doubled down.',
   'blackjack', 'query', null, 3,
   '(SELECT COUNT(*)::bigint FROM (SELECT bh.id FROM public.blackjack_hands bh, jsonb_array_elements(bh.hands) h WHERE bh.user_id = $uid AND bh.status = ''done'' AND COALESCE((h->>''doubled'')::bool, false) = true AND (h->>''result'') IN (''win'', ''blackjack'')) sq)',
   200, null, 710),

  ('bj-wins-20',
   'Card Shark',
   'Win 20 blackjack hands (excludes pushes and surrenders).',
   'blackjack', 'query', null, 20,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') IN (''win'', ''blackjack''))',
   250, null, 720),

  -- ── Coinflip ──────────────────────────────────────────────────────────────

  ('coinflip-wins-10',
   'Lucky Flip',
   'Win 10 coinflips.',
   'coinflip', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
   100, null, 800),

  ('coinflip-wins-50',
   'Heads I Win',
   'Win 50 coinflips.',
   'coinflip', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
   300, null, 810),

  -- ── Roulette ──────────────────────────────────────────────────────────────

  ('roulette-wins-10',
   'Lucky Spin',
   'Win 10 roulette rounds.',
   'roulette', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
   150, null, 900),

  ('roulette-wins-50',
   'Wheel of Fortune',
   'Win 50 roulette rounds.',
   'roulette', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
   500, null, 910),

  -- ── Leaderboard ──────────────────────────────────────────────────────────

  ('lb-top10-credits',
   'Elite',
   'Be in the top 10 players by current credit balance.',
   'general', 'query', null, 1,
   '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 10) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
   500, null, 1000),

  ('lb-top3-credits',
   'Podium',
   'Be in the top 3 players by current credit balance.',
   'general', 'query', null, 1,
   '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 3) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
   1500, 'frame-galaxy', 1010)

ON CONFLICT (code) DO UPDATE
  SET name             = excluded.name,
      description      = excluded.description,
      category         = excluded.category,
      cond_type        = excluded.cond_type,
      cond_column      = excluded.cond_column,
      cond_target      = excluded.cond_target,
      cond_query       = excluded.cond_query,
      reward_credits   = excluded.reward_credits,
      reward_item_slug = excluded.reward_item_slug,
      sort_order       = excluded.sort_order;


-- ============================================================================
-- Add new achievement categories to the frontend colour map
-- (stored in achievement_defs.category — no schema change needed, the client
-- already falls back to cyan for unknown categories)
-- ============================================================================

-- Update list_my_achievements() to include the new categories in its STABLE
-- function so callers get fresh data.  No body change needed — the v33 version
-- is still correct; we just bump it to force a replan.
-- (Re-running CREATE OR REPLACE is idempotent.)

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
     WHERE is_active = true
     ORDER BY sort_order
  LOOP
    SELECT * INTO ua
      FROM public.user_achievements
     WHERE user_id = uid AND code = adef.code;
    ua_found := FOUND;

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
-- Done.
-- ============================================================================
