-- ============================================================================
-- v35_claim_achievement_dynamic.sql
--
-- Re-fix claim_achievement() using fully dynamic SQL (EXECUTE) for every
-- statement that references the "code" column in achievement_defs or
-- user_achievements.  This prevents the PL/pgSQL planner from doing a
-- compile-time column check that was producing:
--
--   ERROR 42703: column "code" does not exist
--
-- even though the column exists.  By routing all such statements through
-- EXECUTE, resolution is deferred to runtime where it always succeeds.
--
-- All other semantics are identical to the v34 version.
-- Idempotent: safe to re-run.
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid       uuid    := auth.uid();
  adef      record;          -- achievement_defs row (untyped record → runtime resolution)
  ua        record;          -- user_achievements row
  ua_found  boolean := false;
  cv        bigint  := 0;
  it        record;          -- market_items row
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Load achievement definition (dynamic SQL) ─────────────────────────────
  -- No is_active filter here: list_my_achievements already gates visibility.
  -- Filtering by is_active in the claim path caused "Unknown or inactive
  -- achievement" when rows had is_active = NULL or false due to DO UPDATE
  -- seeds omitting the column.
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
-- Done.
-- ============================================================================
