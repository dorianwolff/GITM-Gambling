-- ============================================================================
-- v46_fix_warfront_pool_array_order.sql
--
-- Bug: _warfront_active_pool has 'timewizard' at position 23 in its v_ids
-- array, but the JS client's WARFRONT_FANTASY_UNITS has it at position 14
-- (after voidwalker, before frostwitch).  Fisher-Yates shuffle is
-- order-dependent, so the server and client produce completely different
-- 12-unit pools — any unit from position 14 onward may appear on the client
-- but get rejected by the server, and vice-versa.
--
-- Fix: rewrite _warfront_active_pool with the correct fantasy array order
-- (matching WARFRONT_FANTASY_UNITS in warfront-api.js exactly):
--
--   peasant footman bombgoblin archer assassin shaman lumberjack angel
--   brute cavalry harpy troll voidwalker timewizard frostwitch mage
--   mirrormage necromancer genie phoenix warlord siege stormdrake golem
--
-- The animals array is unchanged (already matches the client).
-- ============================================================================

create or replace function public._warfront_active_pool(
  p_collection text,
  p_n int default 12
) returns text[] language plpgsql stable as $$
declare
  v_epoch       timestamptz := '2026-01-01 00:00:00+00';
  v_game_pool_n int         := 12;
  v_wf_idx      int         := 11;
  v_h_index     bigint      := floor(extract(epoch from (now() - v_epoch)) / 3600)::bigint;
  v_generation  bigint      := floor((v_h_index - (v_wf_idx + 5))::numeric / v_game_pool_n)::bigint;
  v_seed        bigint      := v_generation # (case when p_collection = 'animals' then 1515870810 else 2779096485 end);
  v_ids         text[];
  v_n int; i int; j int; tmp text;
  v_s bigint;
begin
  v_ids := case when p_collection = 'animals'
    then array[
      'rat','wolfpack','squirrel','tortoise','eagle','bee','bat','kangaroo',
      'viper','bear','chameleon','jellyfish','mantisshrimp','scorpion','skunk',
      'zebra','rhino','crocodile','giraffe','tiger','gorilla','shark','elephant','whale'
    ]
    else array[
      -- Order must match WARFRONT_FANTASY_UNITS in warfront-api.js exactly.
      'peasant','footman','bombgoblin','archer','assassin','shaman','lumberjack',
      'angel','brute','cavalry','harpy','troll','voidwalker',
      'timewizard',   -- was incorrectly at position 23; belongs here (cost-3, after voidwalker)
      'frostwitch','mage','mirrormage','necromancer','genie',
      'phoenix','warlord','siege','stormdrake','golem'
    ]
  end;

  v_n := array_length(v_ids, 1);
  -- Fisher-Yates with seeded LCG (same constants as JS client seededShuffle)
  v_s := v_seed & 4294967295;
  for i in reverse v_n..2 loop
    v_s := ((v_s * 1664525) + 1013904223) & 4294967295;
    j   := 1 + (v_s % i)::int;
    tmp := v_ids[i]; v_ids[i] := v_ids[j]; v_ids[j] := tmp;
  end loop;

  return v_ids[1:least(p_n, v_n)];
end;
$$;

grant execute on function public._warfront_active_pool(text, int) to authenticated;
