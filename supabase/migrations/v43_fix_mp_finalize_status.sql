-- ============================================================================
-- v43_fix_mp_finalize_status.sql
--
-- Bug: _mp_finalize (v29) sets status = 'finished', but the mp_games table
-- check constraint only allows ('waiting','active','done','cancelled').
-- Every resign/win/draw therefore throws:
--   "new row for relation 'mp_games' violates check constraint
--    'mp_games_status_check'"
--
-- Fix: change the UPDATE in _mp_finalize to use 'done' (the correct value).
-- ============================================================================

create or replace function public._mp_finalize(p_id uuid, p_winner smallint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g       public.mp_games%rowtype;
  pot     integer;
  win_uid uuid;
  net     integer;
begin
  select * into g from public.mp_games where id = p_id for update;
  if not found or g.status <> 'active' then return; end if;

  pot := g.ante * 2;

  if p_winner = -1 then
    if g.player_x is not null then
      perform public._apply_credit_delta(g.player_x, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason', 'draw'));
    end if;
    if g.player_o is not null then
      perform public._apply_credit_delta(g.player_o, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason', 'draw'));
    end if;
  elsif p_winner = 0 or p_winner = 1 then
    net     := pot;
    win_uid := case when p_winner = 0 then g.player_x else g.player_o end;
    if win_uid is not null then
      perform public._apply_credit_delta(win_uid, net, 'game_mp',
        jsonb_build_object('mp_id', p_id, 'reason', p_reason, 'pot', pot));
    end if;
  end if;

  update public.mp_games
     set status        = 'done',        -- was 'finished' in v29 — not in the check constraint
         winner        = p_winner,
         ended_at      = now(),
         result_reason = p_reason
   where id = p_id;
end; $$;

grant execute on function public._mp_finalize(uuid, smallint, text) to authenticated;
