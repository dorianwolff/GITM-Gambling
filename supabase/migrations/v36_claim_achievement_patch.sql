-- ============================================================================
-- v36_claim_achievement_patch.sql
--
-- Patch 1: Re-deploy claim_achievement() without the is_active filter.
--   The v35 version was deployed with AND is_active = true in the EXECUTE
--   query, which caused "Unknown or inactive achievement" errors even for
--   fully active achievements — because achievement_defs rows seeded via
--   ON CONFLICT DO UPDATE may have had is_active reset to NULL/false.
--   list_my_achievements() already gates by is_active, so the claim path
--   does not need to re-check it.
--
-- Patch 2: Ensure is_active = true for all achievement_defs rows.
--   Rows inserted by seeds that didn't include is_active in their
--   ON CONFLICT SET clause could retain a stale false/NULL value.
--   This UPDATE makes every existing definition claimable again.
--
-- Patch 3: Ensure the v34 market_items and achievement_defs seeds are
--   present (idempotent — safe even if v34 ran correctly).
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ============================================================================
-- PATCH 1: Redeploy claim_achievement() — no is_active filter, fully dynamic
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid       uuid    := auth.uid();
  adef      record;          -- untyped record → runtime column resolution
  ua        record;          -- user_achievements row
  ua_found  boolean := false;
  cv        bigint  := 0;
  it        record;          -- market_items row
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Load achievement definition (dynamic SQL, no is_active filter) ────────
  -- list_my_achievements() already gates by is_active; re-checking here
  -- caused "Achievement not found" when is_active was NULL/false on rows
  -- that were seeded without explicitly setting the column.
  EXECUTE 'SELECT * FROM public.achievement_defs WHERE code = $1'
    INTO adef USING p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Achievement not found: %', p_code;
  END IF;

  -- ── Check for existing unlock/claim row (dynamic SQL) ────────────────────
  EXECUTE 'SELECT * FROM public.user_achievements WHERE user_id = $1 AND code = $2'
    INTO ua USING uid, p_code;
  ua_found := FOUND;

  IF ua_found AND COALESCE(ua.is_claimed, false) THEN
    RAISE EXCEPTION 'Achievement already claimed';
  END IF;

  -- ── Evaluate condition ────────────────────────────────────────────────────
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

  -- ── Upsert unlock+claim row (dynamic SQL) ─────────────────────────────────
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

  -- ── Grant credit reward ───────────────────────────────────────────────────
  IF COALESCE(adef.reward_credits, 0) > 0 THEN
    PERFORM public._apply_credit_delta(
      uid,
      adef.reward_credits,
      'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- ── Grant item reward ─────────────────────────────────────────────────────
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
-- PATCH 2: Ensure all achievement_defs rows are active
-- ============================================================================
-- Rows seeded via ON CONFLICT DO UPDATE (without is_active in the SET list)
-- may have retained a stale is_active = false or NULL value.
-- Setting all rows to true here makes every definition claimable.

UPDATE public.achievement_defs
   SET is_active = true
 WHERE is_active IS DISTINCT FROM true;


-- ============================================================================
-- PATCH 3: Re-seed v34 market items (idempotent)
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
-- PATCH 4: Re-seed v34 achievement definitions (idempotent)
-- ============================================================================

INSERT INTO public.achievement_defs
  (code, name, description, category, cond_type, cond_column, cond_target,
   cond_query, reward_credits, reward_item_slug, sort_order, is_active)
VALUES

  -- ── Pinball ──────────────────────────────────────────────────────────────

  ('pinball-first-round',
   'Plunger Pulled',
   'Complete your first pinball round.',
   'pinball', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   50, null, 400, true),

  ('pinball-score-5k',
   'High Score',
   'Score at least 5,000 points in a single pinball round.',
   'pinball', 'query', null, 5000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   150, null, 410, true),

  ('pinball-score-10k',
   'Pinball Pro',
   'Score at least 10,000 points in a single pinball round.',
   'pinball', 'query', null, 10000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   300, null, 420, true),

  ('pinball-score-30k',
   'Pinball Wizard',
   'Score at least 30,000 points in a single pinball round.',
   'pinball', 'query', null, 30000,
   '(SELECT COALESCE(MAX(score), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   800, 'title-pinball-wizard', 430, true),

  ('pinball-combo-10',
   'Chain Reaction',
   'Achieve a 10-hit combo in a single pinball round.',
   'pinball', 'query', null, 10,
   '(SELECT COALESCE(MAX(combo_max), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   200, null, 440, true),

  ('pinball-godlike',
   'GODLIKE',
   'Achieve a 16-hit combo (GODLIKE) in a single pinball round.',
   'pinball', 'query', null, 16,
   '(SELECT COALESCE(MAX(combo_max), 0)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   500, 'badge-godlike', 450, true),

  ('pinball-all-maps',
   'World Tour',
   'Play at least one round on each of the 5 pinball maps.',
   'pinball', 'query', null, 5,
   '(SELECT COUNT(DISTINCT map_key)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'')',
   200, null, 460, true),

  ('pinball-galaxy',
   'Stargazer',
   'Play 5 rounds on the Galaxy Drift map.',
   'pinball', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.pinball_rounds WHERE user_id = $uid AND status = ''settled'' AND map_key = ''galaxy_drift'')',
   100, null, 470, true),

  -- ── Warfront (additional) ─────────────────────────────────────────────────

  ('warfront-legend-fantasy',
   'Fantasy Overlord',
   'Beat Legendary difficulty in Fantasy mode.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND collection = ''fantasy'' AND enemy_difficulty = ''Legendary'')',
   500, null, 500, true),

  ('warfront-impossible',
   'The Impossible',
   'Beat Impossible difficulty in any Warfront mode.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0 AND enemy_difficulty = ''Impossible'')',
   1500, 'badge-gambler', 510, true),

  ('warfront-budget-8',
   'Peasant King',
   'Win a Fantasy Warfront battle spending 8 gold or less total.',
   'warfront', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games wg WHERE wg.user_id = $uid AND wg.payout > 0 AND wg.collection = ''fantasy'' AND (SELECT COALESCE(SUM((e->>''cost'')::int), 0) FROM jsonb_array_elements(wg.player_picks) e) <= 8)',
   300, null, 520, true),

  ('warfront-big-bettor',
   'All In',
   'Wager at least 2,000 credits on a single Warfront game.',
   'warfront', 'query', null, 2000,
   '(SELECT COALESCE(MAX(bet), 0)::bigint FROM public.warfront_games WHERE user_id = $uid)',
   250, null, 530, true),

  ('warfront-wins-50',
   'Warlord',
   'Win 50 Warfront battles.',
   'warfront', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND payout > 0)',
   1000, null, 540, true),

  ('warfront-pvp-wins-5',
   'PvP Veteran',
   'Win 5 Warfront PvP matches.',
   'pvp', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.mp_warfront_games WHERE (player_x = $uid AND winner = 0) OR (player_o = $uid AND winner = 1))',
   600, null, 550, true),

  ('warfront-troop-golem',
   'Rock Solid',
   'Deploy Golem in 10 Fantasy battles.',
   'warfront', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"golem"}]''::jsonb)',
   200, null, 560, true),

  ('warfront-troop-whale',
   'Big Fish',
   'Deploy Whale in 10 Animals battles.',
   'warfront', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''animals'' AND player_picks @> ''[{"id":"whale"}]''::jsonb)',
   200, null, 570, true),

  ('warfront-troop-phoenix',
   'From the Ashes',
   'Deploy Phoenix in 25 Fantasy battles.',
   'warfront', 'query', null, 25,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"phoenix"}]''::jsonb)',
   300, null, 580, true),

  ('warfront-troop-bombgoblin',
   'Boom Boom',
   'Deploy Bomb Goblin in 50 Fantasy battles.',
   'warfront', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.warfront_games WHERE user_id = $uid AND collection = ''fantasy'' AND player_picks @> ''[{"id":"bombgoblin"}]''::jsonb)',
   350, null, 590, true),

  -- ── Dice ─────────────────────────────────────────────────────────────────

  ('dice-daredevil',
   'Daredevil',
   'Win a dice bet where your win chance was under 5.2% (multiplier ≥ 19×).',
   'dice', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 19)',
   400, 'badge-gambler', 600, true),

  ('dice-madman',
   'The Madman',
   'Win a dice bet where your win chance was under 3.3% (multiplier ≥ 30×).',
   'dice', 'query', null, 1,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_dice'' AND (meta->>''phase'') = ''win'' AND (meta->>''mult'')::numeric >= 30)',
   1000, null, 610, true),

  -- ── Blackjack ─────────────────────────────────────────────────────────────

  ('bj-natural-5',
   'Natural Born Winner',
   'Get a natural blackjack (Ace + face card) 5 times.',
   'blackjack', 'query', null, 5,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') = ''blackjack'')',
   300, null, 700, true),

  ('bj-double-win-3',
   'Double Trouble',
   'Win 3 blackjack hands where you doubled down.',
   'blackjack', 'query', null, 3,
   '(SELECT COUNT(*)::bigint FROM (SELECT bh.id FROM public.blackjack_hands bh, jsonb_array_elements(bh.hands) h WHERE bh.user_id = $uid AND bh.status = ''done'' AND COALESCE((h->>''doubled'')::bool, false) = true AND (h->>''result'') IN (''win'', ''blackjack'')) sq)',
   200, null, 710, true),

  ('bj-wins-20',
   'Card Shark',
   'Win 20 blackjack hands (excludes pushes and surrenders).',
   'blackjack', 'query', null, 20,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_blackjack'' AND (meta->>''phase'') = ''payout'' AND (meta->>''result'') IN (''win'', ''blackjack''))',
   250, null, 720, true),

  -- ── Coinflip ──────────────────────────────────────────────────────────────

  ('coinflip-wins-10',
   'Lucky Flip',
   'Win 10 coinflips.',
   'coinflip', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
   100, null, 800, true),

  ('coinflip-wins-50',
   'Heads I Win',
   'Win 50 coinflips.',
   'coinflip', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_coinflip'' AND (meta->>''phase'') = ''win'')',
   300, null, 810, true),

  -- ── Roulette ──────────────────────────────────────────────────────────────

  ('roulette-wins-10',
   'Lucky Spin',
   'Win 10 roulette rounds.',
   'roulette', 'query', null, 10,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
   150, null, 900, true),

  ('roulette-wins-50',
   'Wheel of Fortune',
   'Win 50 roulette rounds.',
   'roulette', 'query', null, 50,
   '(SELECT COUNT(*)::bigint FROM public.transactions WHERE user_id = $uid AND kind = ''game_roulette'' AND delta > 0)',
   500, null, 910, true),

  -- ── Leaderboard ──────────────────────────────────────────────────────────

  ('lb-top10-credits',
   'Elite',
   'Be in the top 10 players by current credit balance.',
   'general', 'query', null, 1,
   '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 10) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
   500, null, 1000, true),

  ('lb-top3-credits',
   'Podium',
   'Be in the top 3 players by current credit balance.',
   'general', 'query', null, 1,
   '(SELECT CASE WHEN EXISTS (SELECT 1 FROM (SELECT id FROM public.profiles WHERE credits > 0 ORDER BY credits DESC LIMIT 3) t WHERE t.id = $uid) THEN 1 ELSE 0 END)::bigint',
   1500, 'frame-galaxy', 1010, true)

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
      sort_order       = excluded.sort_order,
      is_active        = excluded.is_active;   -- ← ensure is_active is set


-- ============================================================================
-- Done.
-- ============================================================================
