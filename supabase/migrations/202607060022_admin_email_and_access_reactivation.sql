-- El administrador inicia sesión con correo; los jugadores continúan usando invitaciones privadas.
alter table public.casino_admins add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists casino_admins_auth_user_unique on public.casino_admins(auth_user_id) where auth_user_id is not null;

create or replace function public.is_casino_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.casino_admins a where a.auth_user_id=auth.uid());
$$;

create or replace function public.current_casino_profile_id()
returns uuid language sql stable security definer set search_path=public as $$
  select x.profile_id from (
    select s.profile_id,0 as priority from public.casino_profile_sessions s where s.user_id=auth.uid()
    union all
    select a.profile_id,1 as priority from public.casino_admins a where a.auth_user_id=auth.uid()
  ) x order by x.priority limit 1;
$$;

create or replace function public.get_casino_access_status()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((
    select jsonb_build_object(
      'authorized',true,'profile_id',p.id,'player_code',p.player_code,
      'display_name',p.display_name,'points',p.points
    )
    from public.casino_player_profiles p
    join public.casino_trusted_profiles t on t.profile_id=p.id and t.enabled
    where p.id=public.current_casino_profile_id()
  ),jsonb_build_object('authorized',false));
$$;

create or replace function public.link_casino_admin_email(p_player_code text,p_recovery_key text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_profile public.casino_player_profiles%rowtype;
  v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  select u.email into v_email from auth.users u where u.id=v_user and not u.is_anonymous;
  if v_user is null or v_email is null then raise exception 'EMAIL_SESSION_REQUIRED';end if;
  select p.* into v_profile
  from public.casino_player_profiles p
  join public.casino_admins a on a.profile_id=p.id
  where p.player_code=upper(trim(p_player_code));
  if not found or extensions.crypt(v_key,v_profile.recovery_hash)<>v_profile.recovery_hash then
    raise exception 'INVALID_ADMIN_CREDENTIALS';
  end if;
  if exists(select 1 from public.casino_admins a where a.profile_id=v_profile.id and a.auth_user_id is not null and a.auth_user_id<>v_user) then
    raise exception 'ADMIN_EMAIL_ALREADY_LINKED';
  end if;
  update public.casino_admins a set auth_user_id=v_user where a.profile_id=v_profile.id;
  delete from public.casino_profile_sessions s where s.user_id=v_user;
  insert into public.casino_profile_sessions(user_id,profile_id,linked_at) values(v_user,v_profile.id,now());
end;$$;

drop function if exists public.admin_list_trusted_access();
create function public.admin_list_trusted_access()
returns table(player_code text,enabled boolean,last_invite_at timestamptz,last_code_hint text,last_redeemed_at timestamptz,last_expires_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  return query
  select p.player_code::text,coalesce(t.enabled,false),i.created_at,i.code_hint,i.redeemed_at,i.expires_at
  from public.casino_player_profiles p
  left join public.casino_trusted_profiles t on t.profile_id=p.id
  left join lateral (
    select x.created_at,x.code_hint,x.redeemed_at,x.expires_at
    from public.casino_access_invites x where x.profile_id=p.id order by x.created_at desc limit 1
  ) i on true
  order by p.created_at desc;
end;$$;

revoke all on function public.link_casino_admin_email(text,text),public.admin_list_trusted_access() from public,anon;
grant execute on function public.link_casino_admin_email(text,text),public.admin_list_trusted_access() to authenticated;
notify pgrst,'reload schema';
