-- ============================================================================
-- v54_drop_integer_delta_overloads.sql
--
-- Root cause of "integer out of range" on game losses:
--
-- v47 recreated _apply_credit_delta and _admin_apply_credit_delta with bigint
-- parameters using CREATE OR REPLACE, which creates a NEW bigint overload
-- alongside the original integer overload — it does NOT replace it.
--
-- PostgreSQL type resolution prefers an EXACT match over an implicit cast.
-- Literal `0` is type integer (exact match), so any `perform _apply_credit_delta(uid, 0, ...)`
-- call resolves to the OLD integer overload, which has `new_balance integer`
-- internally. Reading profiles.credits (bigint > 2.1 B) into an integer
-- variable → "integer out of range".
--
-- Win paths pass a typed bigint variable (pay/payout), so they correctly
-- resolve to the new bigint overload — explaining why wins work but losses fail.
--
-- Fix: drop the stale integer overloads. All callers will auto-cast to bigint.
-- ============================================================================

drop function if exists public._apply_credit_delta(uuid, integer, text, jsonb);
drop function if exists public._admin_apply_credit_delta(uuid, integer, text, jsonb);

-- ============================================================================
-- Done.
-- ============================================================================
