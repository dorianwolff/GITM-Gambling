-- ============================================================================
-- v23_plinko_batch_flow_fix.sql
--   Restore the client/server batch flow for plinko.
--   The client animates balls locally and settles later using the actual
--   landed bins. This override restores play_plinko_batch() to reserve-only
--   behavior and return the real batch_id for settlement.
-- ============================================================================

drop function if exists public.play_plinko_batch(integer, integer, text, integer);

create or replace function public.play_plinko_batch(
  p_bet   integer,
  p_rows  integer default 8,
  p_risk  text    default 'medium',
  p_count integer default 1
) returns table (
  batch_id     uuid,
  new_balance  integer
)
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  prof       public.profiles%rowtype;
  rows_      int := coalesce(p_rows, 8);
  risk_      text := coalesce(p_risk, 'medium');
  cnt        int := coalesce(p_count, 1);
  total_bet  integer;
  batch_     uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public._txn_user_lock('plinko');

  if not public.is_game_active('plinko') then
    raise exception 'Plinko is currently out of rotation';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'bet must be >= 1'; end if;
  if p_bet > 100000 then raise exception 'bet too large'; end if;
  if rows_ < 4 or rows_ > 12 then raise exception 'rows must be 4..12'; end if;
  if risk_ not in ('low','medium','high') then raise exception 'risk must be low/medium/high'; end if;
  if cnt < 1 or cnt > 50 then raise exception 'count must be 1..50'; end if;

  total_bet := p_bet * cnt;
  select * into prof from public.profiles where id = uid for update;
  if prof.credits < total_bet then
    raise exception 'Not enough credits (need %)', total_bet;
  end if;

  perform public._apply_credit_delta(uid, -total_bet, 'plinko',
    jsonb_build_object('phase','wager','rows',rows_,'risk',risk_,'count',cnt,'per_bet',p_bet));

  insert into public.plinko_batches (user_id, bet, rows_used, risk, count, total_bet)
    values (uid, p_bet, rows_, risk_, cnt, total_bet)
    returning id into batch_;

  select credits into new_balance from public.profiles where id = uid;
  return query select batch_, new_balance;
end; $$;

grant execute on function public.play_plinko_batch(integer, integer, text, integer) to authenticated;
