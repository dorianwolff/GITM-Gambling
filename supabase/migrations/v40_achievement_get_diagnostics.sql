-- ============================================================================
-- v40_achievement_get_diagnostics.sql
--
-- ROOT CAUSE: `FOUND` after `EXECUTE ... INTO record` is unreliable on
-- Supabase's PostgreSQL environment.  Even when the EXECUTE returns a row,
-- `FOUND` can remain false.  The fix is to use
--   GET DIAGNOSTICS _rc = ROW_COUNT;
-- immediately after every EXECUTE, and branch on `_rc` instead of `FOUND`.
--
-- `GET DIAGNOSTICS ROW_COUNT` is always accurate after any EXECUTE statement
-- regardless of PostgreSQL version or environment.
--
-- Fixes both:
--   • claim_achievement()   — achievement_defs lookup always NOT FOUND
--   • list_my_achievements() — ua_found always false (so is_unlocked always false)
-- ============================================================================


-- ============================================================================
-- PART 1 — claim_achievement()
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_achievement(text);

CREATE FUNCTION public.claim_achievement(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid        uuid    := auth.uid();
  adef       record;
  ua         record;
  ua_found   boolean := false;
  cv         bigint  := 0;
  it         record;
  _rc        integer;          -- ROW_COUNT from GET DIAGNOSTICS — reliable always
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Load achievement definition ─────────────────────────────────────────
  EXECUTE 'SELECT * FROM public.achievement_defs WHERE code = $1'
    INTO adef USING p_code;
  GET DIAGNOSTICS _rc = ROW_COUNT;
  IF _rc = 0 THEN
    RAISE EXCEPTION 'Achievement not found: %', p_code;
  END IF;

  -- ── Check for existing claim row ────────────────────────────────────────
  -- Real column name is "achievement_id", not "code"
  EXECUTE 'SELECT * FROM public.user_achievements WHERE user_id = $1 AND achievement_id = $2'
    INTO ua USING uid, p_code;
  GET DIAGNOSTICS _rc = ROW_COUNT;
  ua_found := (_rc > 0);

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

  -- ── Upsert claim row ─────────────────────────────────────────────────────
  -- Real columns: achievement_id (not code), metadata (not meta)
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

  -- ── Credit reward ────────────────────────────────────────────────────────
  IF COALESCE(adef.reward_credits, 0) > 0 THEN
    PERFORM public._apply_credit_delta(
      uid,
      adef.reward_credits,
      'achievement_award',
      jsonb_build_object('achievement', p_code)
    );
  END IF;

  -- ── Item reward ──────────────────────────────────────────────────────────
  IF adef.reward_item_slug IS NOT NULL THEN
    EXECUTE 'SELECT * FROM public.market_items WHERE slug = $1'
      INTO it USING adef.reward_item_slug;
    GET DIAGNOSTICS _rc = ROW_COUNT;
    IF _rc > 0 THEN
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
-- PART 2 — list_my_achievements()
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
  adef     record;
  ua       record;
  ua_found boolean;
  cv       bigint;
  _rc      integer;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  FOR adef IN
    SELECT * FROM public.achievement_defs
     WHERE is_active
     ORDER BY sort_order
  LOOP
    -- GET DIAGNOSTICS instead of FOUND for reliable row detection
    EXECUTE
      'SELECT * FROM public.user_achievements
        WHERE user_id = $1 AND achievement_id = $2'
      INTO ua USING uid, adef.code;
    GET DIAGNOSTICS _rc = ROW_COUNT;
    ua_found := (_rc > 0);

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
