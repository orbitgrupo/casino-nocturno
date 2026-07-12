-- Círculo de confianza: perfiles autorizados y códigos de acceso de un solo uso.
create table if not exists public.casino_trusted_profiles (
  profile_id uuid primary key references public.casino_player_profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_by uuid references public.casino_player_profiles(id) on delete set null,
  trusted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.casino_access_invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.casino_player_profiles(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null,
  created_by uuid references public.casino_player_profiles(id) on delete set null,
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.casino_access_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts smallint not null default 0,
  window_started timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists casino_access_invites_profile_idx
  on public.casino_access_invites(profile_id,created_at desc);

alter table public.casino_trusted_profiles enable row level security;
alter table public.casino_access_invites enable row level security;
alter table public.casino_access_attempts enable row level security;
revoke all on public.casino_trusted_profiles,public.casino_access_invites,public.casino_access_attempts from anon,authenticated;

-- Conserva el acceso de los perfiles ya existentes durante la activación del candado.
insert into public.casino_trusted_profiles(profile_id,enabled)
select p.id,true from public.casino_player_profiles p
on conflict(profile_id) do nothing;

-- Las autorizaciones internas también respetan el círculo de confianza.
create or replace function public.current_casino_profile_id()
returns uuid language sql stable security definer set search_path=public as $$
  select s.profile_id
  from public.casino_profile_sessions s
  join public.casino_trusted_profiles t on t.profile_id=s.profile_id and t.enabled
  where s.user_id=auth.uid();
$$;

create or replace function public.is_casino_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_casino_profile_id() is not null and exists(
    select 1 from public.casino_room_members m where m.room_id=p_room_id and m.user_id=auth.uid()
  );
$$;

create or replace function public.is_casino_room_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_casino_profile_id() is not null and exists(
    select 1 from public.casino_rooms r where r.id=p_room_id and r.host_id=auth.uid()
  );
$$;

create or replace function public.casino_access_hash(p_code text)
returns text language sql immutable security definer set search_path=public,extensions as $$
  select encode(extensions.digest(convert_to(regexp_replace(upper(trim(p_code)),'[^A-Z0-9]','','g'),'UTF8'),'sha256'),'hex');
$$;

create or replace function public.get_casino_access_status()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((
    select jsonb_build_object(
      'authorized',true,
      'profile_id',p.id,
      'player_code',p.player_code,
      'display_name',p.display_name,
      'points',p.points
    )
    from public.casino_profile_sessions s
    join public.casino_player_profiles p on p.id=s.profile_id
    join public.casino_trusted_profiles t on t.profile_id=p.id and t.enabled
    where s.user_id=auth.uid()
  ),jsonb_build_object('authorized',false));
$$;

create or replace function public.redeem_casino_access_code(p_access_code text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_user uuid:=auth.uid();
  v_hash text:=public.casino_access_hash(p_access_code);
  v_attempt public.casino_access_attempts%rowtype;
  v_invite public.casino_access_invites%rowtype;
  v_profile public.casino_player_profiles%rowtype;
  v_failed smallint;
begin
  if v_user is null then return jsonb_build_object('authorized',false,'message','Sesión no disponible.');end if;

  insert into public.casino_access_attempts(user_id) values(v_user)
  on conflict(user_id) do nothing;
  select a.* into v_attempt from public.casino_access_attempts a where a.user_id=v_user for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until>now() then
    return jsonb_build_object('authorized',false,'locked',true,'retry_at',v_attempt.locked_until,'message','Demasiados intentos. Espera 15 minutos.');
  end if;
  if v_attempt.window_started<now()-interval '15 minutes' then
    update public.casino_access_attempts a set failed_attempts=0,window_started=now(),locked_until=null,updated_at=now() where a.user_id=v_user;
    v_attempt.failed_attempts:=0;
  end if;

  select i.* into v_invite
  from public.casino_access_invites i
  join public.casino_trusted_profiles t on t.profile_id=i.profile_id and t.enabled
  where i.code_hash=v_hash and i.redeemed_at is null and i.revoked_at is null and i.expires_at>now()
  for update of i;

  if not found then
    v_failed:=v_attempt.failed_attempts+1;
    update public.casino_access_attempts a
    set failed_attempts=v_failed,
        locked_until=case when v_failed>=5 then now()+interval '15 minutes' else null end,
        updated_at=now()
    where a.user_id=v_user;
    return jsonb_build_object('authorized',false,'locked',v_failed>=5,'attempts_left',greatest(0,5-v_failed),'message','Código inválido, vencido o utilizado.');
  end if;

  select p.* into v_profile from public.casino_player_profiles p where p.id=v_invite.profile_id;
  delete from public.casino_profile_sessions s where s.user_id=v_user;
  insert into public.casino_profile_sessions(user_id,profile_id,linked_at) values(v_user,v_profile.id,now());
  update public.casino_room_members m set user_id=v_user where m.profile_id=v_profile.id;
  update public.casino_access_invites i set redeemed_by=v_user,redeemed_at=now() where i.id=v_invite.id;
  delete from public.casino_access_attempts a where a.user_id=v_user;

  return jsonb_build_object('authorized',true,'profile_id',v_profile.id,'player_code',v_profile.player_code,'display_name',v_profile.display_name,'points',v_profile.points);
end;$$;

create or replace function public.recover_casino_player_profile(p_player_code text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_user uuid:=auth.uid();
  v_profile public.casino_player_profiles%rowtype;
  v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select p.* into v_profile
  from public.casino_player_profiles p
  join public.casino_trusted_profiles t on t.profile_id=p.id and t.enabled
  where p.player_code=upper(trim(p_player_code));
  if not found or extensions.crypt(v_key,v_profile.recovery_hash)<>v_profile.recovery_hash then
    raise exception 'Invalid player code or recovery key';
  end if;
  delete from public.casino_profile_sessions s where s.user_id=v_user;
  insert into public.casino_profile_sessions(user_id,profile_id,linked_at) values(v_user,v_profile.id,now());
  update public.casino_room_members m set user_id=v_user where m.profile_id=v_profile.id;
  return query select v_profile.id,v_profile.player_code::text,v_profile.display_name,v_profile.points;
end;$$;

create or replace function public.admin_create_trusted_profile(p_display_name text,p_initial_points integer default 0)
returns table(profile_id uuid,player_code text,display_name text,initial_points integer,access_code text,recovery_key text,access_expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_admin uuid:=public.current_casino_profile_id();
  v_id uuid:=gen_random_uuid();
  v_name text:=trim(p_display_name);
  v_player_code text;
  v_access_raw text;
  v_access_norm text;
  v_recovery_raw text;
  v_recovery_norm text;
  v_expires timestamptz:=now()+interval '7 days';
  v_seed text;
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  if length(v_name)<2 or length(v_name)>30 then raise exception 'El nombre debe tener entre 2 y 30 caracteres';end if;
  if p_initial_points not between 0 and 1000000 then raise exception 'Los puntos deben estar entre 0 y 1000000';end if;

  loop
    v_player_code:='ORBIT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.casino_player_profiles p where p.player_code=v_player_code);
  end loop;
  v_seed:=upper(replace(gen_random_uuid()::text,'-',''));
  v_recovery_raw:=substr(v_seed,1,4)||'-'||substr(v_seed,5,4)||'-'||substr(v_seed,9,4)||'-'||substr(v_seed,13,4)||'-'||substr(v_seed,17,4)||'-'||substr(v_seed,21,4)||'-'||substr(v_seed,25,4)||'-'||substr(v_seed,29,4);
  v_recovery_norm:=replace(v_recovery_raw,'-','');
  v_seed:=upper(replace(gen_random_uuid()::text,'-',''));
  v_access_raw:='CIRC-'||substr(v_seed,1,4)||'-'||substr(v_seed,5,4)||'-'||substr(v_seed,9,4)||'-'||substr(v_seed,13,4)||'-'||substr(v_seed,17,4)||'-'||substr(v_seed,21,4);
  v_access_norm:=regexp_replace(v_access_raw,'[^A-Z0-9]','','g');

  insert into public.casino_player_profiles(id,player_code,display_name,points,recovery_hash)
  values(v_id,v_player_code,v_name,p_initial_points,extensions.crypt(v_recovery_norm,extensions.gen_salt('bf',12)));
  insert into public.casino_trusted_profiles(profile_id,enabled,created_by) values(v_id,true,v_admin);
  insert into public.casino_access_invites(profile_id,code_hash,code_hint,created_by,expires_at)
  values(v_id,public.casino_access_hash(v_access_norm),right(v_access_norm,4),v_admin,v_expires);
  if p_initial_points>0 then
    insert into public.casino_point_transactions(profile_id,transaction_type,amount,balance_after,description)
    values(v_id,'admin_initial_grant',p_initial_points,p_initial_points,'Saldo inicial otorgado por administración');
  end if;

  return query select v_id,v_player_code,v_name,p_initial_points,v_access_raw,v_recovery_raw,v_expires;
end;$$;

create or replace function public.admin_issue_casino_access(p_player_code text)
returns table(player_code text,display_name text,access_code text,access_expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_admin uuid:=public.current_casino_profile_id();
  v_profile public.casino_player_profiles%rowtype;
  v_seed text;
  v_access_raw text;
  v_access_norm text;
  v_expires timestamptz:=now()+interval '7 days';
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  select p.* into v_profile from public.casino_player_profiles p where p.player_code=upper(trim(p_player_code));
  if not found then raise exception 'Player not found';end if;
  insert into public.casino_trusted_profiles(profile_id,enabled,created_by,updated_at)
  values(v_profile.id,true,v_admin,now())
  on conflict(profile_id) do update set enabled=true,updated_at=now();
  update public.casino_access_invites i set revoked_at=now() where i.profile_id=v_profile.id and i.redeemed_at is null and i.revoked_at is null;
  v_seed:=upper(replace(gen_random_uuid()::text,'-',''));
  v_access_raw:='CIRC-'||substr(v_seed,1,4)||'-'||substr(v_seed,5,4)||'-'||substr(v_seed,9,4)||'-'||substr(v_seed,13,4)||'-'||substr(v_seed,17,4)||'-'||substr(v_seed,21,4);
  v_access_norm:=regexp_replace(v_access_raw,'[^A-Z0-9]','','g');
  insert into public.casino_access_invites(profile_id,code_hash,code_hint,created_by,expires_at)
  values(v_profile.id,public.casino_access_hash(v_access_norm),right(v_access_norm,4),v_admin,v_expires);
  return query select v_profile.player_code::text,v_profile.display_name,v_access_raw,v_expires;
end;$$;

create or replace function public.admin_set_trusted_profile_enabled(p_player_code text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile uuid;
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  select p.id into v_profile from public.casino_player_profiles p where p.player_code=upper(trim(p_player_code));
  if v_profile is null then raise exception 'Player not found';end if;
  if not p_enabled and exists(select 1 from public.casino_admins a where a.profile_id=v_profile) then raise exception 'No puedes bloquear un perfil administrador';end if;
  insert into public.casino_trusted_profiles(profile_id,enabled,created_by,updated_at)
  values(v_profile,p_enabled,public.current_casino_profile_id(),now())
  on conflict(profile_id) do update set enabled=excluded.enabled,updated_at=now();
  if not p_enabled then
    update public.casino_access_invites i set revoked_at=now() where i.profile_id=v_profile and i.redeemed_at is null and i.revoked_at is null;
    delete from public.casino_profile_sessions s where s.profile_id=v_profile;
  end if;
end;$$;

create or replace function public.admin_list_trusted_access()
returns table(player_code text,enabled boolean,last_invite_at timestamptz,last_code_hint text,last_redeemed_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  return query
  select p.player_code::text,coalesce(t.enabled,false),i.created_at,i.code_hint,i.redeemed_at
  from public.casino_player_profiles p
  left join public.casino_trusted_profiles t on t.profile_id=p.id
  left join lateral (
    select x.created_at,x.code_hint,x.redeemed_at
    from public.casino_access_invites x where x.profile_id=p.id order by x.created_at desc limit 1
  ) i on true
  order by p.created_at desc;
end;$$;

revoke all on function public.casino_access_hash(text) from public,anon,authenticated;
revoke all on function public.create_casino_player_profile(text,text) from public,anon,authenticated;
revoke all on function public.get_casino_access_status(),public.redeem_casino_access_code(text),public.admin_create_trusted_profile(text,integer),public.admin_issue_casino_access(text),public.admin_set_trusted_profile_enabled(text,boolean),public.admin_list_trusted_access() from public,anon;
grant execute on function public.get_casino_access_status(),public.redeem_casino_access_code(text) to authenticated;
grant execute on function public.recover_casino_player_profile(text,text) to authenticated;
grant execute on function public.admin_create_trusted_profile(text,integer),public.admin_issue_casino_access(text),public.admin_set_trusted_profile_enabled(text,boolean),public.admin_list_trusted_access() to authenticated;
notify pgrst,'reload schema';
