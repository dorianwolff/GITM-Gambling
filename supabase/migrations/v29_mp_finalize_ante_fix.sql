-- v29_mp_finalize_ante_fix.sql
-- Fix "record 'g' has no field 'bet'" that fires when a player wins a TTT game.
--
-- Root cause: v5 recreated _mp_finalize with `g.bet` instead of `g.ante`.
-- The mp_games table uses the column `ante`, not `bet`.  The error is raised
-- inside the PL/pgSQL record field-access at runtime (only when a winner is
-- determined) so it was never hit during join or normal moves.
--
-- Fix: replace g.bet → g.ante everywhere in _mp_finalize.

create or replace function public._mp_finalize(p_id uuid, p_winner smallint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g      public.mp_games%rowtype;
  pot    integer;
  win_uid uuid;
  net    integer;
begin
  select * into g from public.mp_games where id = p_id for update;
  if not found or g.status <> 'active' then return; end if;

  pot := g.ante * 2;   -- was g.bet — the column is 'ante'

  if p_winner = -1 then
    -- Draw: refund both players their stake.
    if g.player_x is not null then
      perform public._apply_credit_delta(g.player_x, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason', 'draw'));
    end if;
    if g.player_o is not null then
      perform public._apply_credit_delta(g.player_o, g.ante, 'mp_refund',
        jsonb_build_object('mp_id', p_id, 'reason', 'draw'));
    end if;
  elsif p_winner = 0 or p_winner = 1 then
    -- Winner takes the whole pot.
    net     := pot;
    win_uid := case when p_winner = 0 then g.player_x else g.player_o end;
    if win_uid is not null then
      perform public._apply_credit_delta(win_uid, net, 'game_mp',
        jsonb_build_object('mp_id', p_id, 'reason', p_reason, 'pot', pot));
    end if;
  end if;

  update public.mp_games
     set status       = 'finished',
         winner       = p_winner,
         ended_at     = now(),
         result_reason = p_reason
   where id = p_id;
end; $$;

grant execute on function public._mp_finalize(uuid, smallint, text) to authenticated;
