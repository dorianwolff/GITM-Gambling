-- ============================================================================
-- v50_bigint_admin_grant.sql
--
-- Widens admin_grant_credits from integer → bigint so large balances
-- (above the 2.1 B int32 limit) can be granted without overflow.
-- ============================================================================

-- Drop old integer overload so the new bigint signature is unambiguous
drop function if exists public.admin_grant_credits(integer, uuid, boolean, boolean, text);

create or replace function public.admin_grant_credits(
  p_amount      bigint,
  p_target_user uuid    default null,
  p_all         boolean default false,
  p_zero_only   boolean default false,
  p_note        text    default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid    := auth.uid();
  rec     record;
  touched bigint  := 0;
begin
  perform public._admin_assert();

  if p_amount is null or p_amount < 1 then
    raise exception 'Amount must be positive';
  end if;
  if p_all and p_zero_only then
    raise exception 'Choose either all users or zero-credit users';
  end if;
  if p_target_user is null and not p_all and not p_zero_only then
    raise exception 'No target specified';
  end if;

  if p_target_user is not null then
    perform public._admin_apply_credit_delta(
      p_target_user,
      p_amount,
      'admin_grant',
      jsonb_build_object('admin_id', uid, 'scope', 'single', 'note', coalesce(p_note, ''))
    );
    return 1;
  end if;

  for rec in
    select id
      from public.profiles
     where case when p_zero_only then credits = 0 else true end
  loop
    perform public._admin_apply_credit_delta(
      rec.id,
      p_amount,
      'admin_grant',
      jsonb_build_object(
        'admin_id', uid,
        'scope', case when p_zero_only then 'zero_credit' else 'all_users' end,
        'note', coalesce(p_note, '')
      )
    );
    touched := touched + 1;
  end loop;

  return touched;
end;
$$;

revoke all  on function public.admin_grant_credits(bigint, uuid, boolean, boolean, text) from public;
grant execute on function public.admin_grant_credits(bigint, uuid, boolean, boolean, text) to authenticated;

-- ============================================================================
-- Done.
-- ============================================================================
