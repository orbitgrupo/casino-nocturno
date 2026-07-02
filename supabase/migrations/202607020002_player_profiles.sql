create extension if not exists pgcrypto;

create table if not exists public.casino_player_profiles (
  id uuid primary key default gen_random_uuid(),
  player_code varchar(14) not null unique,
  display_name text not null check (char_length(display_name) between 1 and 20),
  recovery_hash text not null,
  points integer not null default 0 check (points between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.casino_profile_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_id uuid not null references public.casino_player_profiles(id) on delete cascade,
  linked_at timestamptz not null default now()
);

alter table public.casino_player_profiles enable row level security;
alter table public.casino_profile_sessions enable row level security;
revoke all on public.casino_player_profiles,public.casino_profile_sessions from anon,authenticated;

alter table public.casino_room_members add column if not exists profile_id uuid references public.casino_player_profiles(id) on delete restrict;
create unique index if not exists casino_one_room_per_profile on public.casino_room_members(profile_id) where profile_id is not null;

create or replace function public.get_my_casino_profile()
returns table(profile_id uuid,player_code text,display_name text,points integer)
language sql stable security definer set search_path=public as $$
  select p.id,p.player_code::text,p.display_name,p.points
  from public.casino_profile_sessions s
  join public.casino_player_profiles p on p.id=s.profile_id
  where s.user_id=auth.uid();
$$;

create or replace function public.create_casino_player_profile(p_display_name text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();v_id uuid:=gen_random_uuid();v_code text;v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if exists(select 1 from public.casino_profile_sessions where user_id=v_user) then raise exception 'This session already has a profile';end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception 'Invalid display name';end if;
  if char_length(v_key)<24 then raise exception 'Recovery key is too short';end if;
  loop
    v_code:='ORBIT-'||upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
    exit when not exists(select 1 from public.casino_player_profiles where casino_player_profiles.player_code=v_code);
  end loop;
  insert into public.casino_player_profiles(id,player_code,display_name,recovery_hash)
  values(v_id,v_code,trim(p_display_name),crypt(v_key,gen_salt('bf',11)));
  insert into public.casino_profile_sessions(user_id,profile_id) values(v_user,v_id);
  return query select v_id,v_code,trim(p_display_name),0;
end;$$;

create or replace function public.recover_casino_player_profile(p_player_code text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();v_profile public.casino_player_profiles%rowtype;v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_profile from public.casino_player_profiles
  where casino_player_profiles.player_code=upper(trim(p_player_code));
  if not found or crypt(v_key,v_profile.recovery_hash)<>v_profile.recovery_hash then raise exception 'Invalid player code or recovery key';end if;
  insert into public.casino_profile_sessions(user_id,profile_id) values(v_user,v_profile.id)
  on conflict(user_id) do update set profile_id=excluded.profile_id,linked_at=now();
  update public.casino_room_members set user_id=v_user where profile_id=v_profile.id;
  return query select v_profile.id,v_profile.player_code::text,v_profile.display_name,v_profile.points;
end;$$;

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 1000)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room uuid:=gen_random_uuid();v_code text;v_seat smallint;v_profile public.casino_player_profiles%rowtype;v_credits integer;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'Create or recover a player profile first';end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in a room';end if;
  if p_game_type not in ('blackjack','roulette','tres-y-dos','domino') then raise exception 'Invalid game';end if;
  if p_host_mode not in ('playing','moderator') then raise exception 'Invalid host mode';end if;
  if p_initial_credits not between 0 and 1000000 then raise exception 'Invalid credits';end if;
  loop v_code:=upper(substr(md5(gen_random_uuid()::text),1,6));exit when not exists(select 1 from public.casino_rooms where casino_rooms.invite_code=v_code);end loop;
  v_seat:=case when p_host_mode='playing' then 0 else null end;v_credits:=greatest(v_profile.points,p_initial_credits);
  insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits) values(v_room,v_code,p_game_type,v_user,p_host_mode,p_initial_credits);
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room,v_user,v_profile.id,v_profile.display_name,'host',v_seat,v_credits);
  return query select v_room,v_code;
end;$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;v_profile public.casino_player_profiles%rowtype;v_credits integer;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'Create or recover a player profile first';end if;
  select * into v_room from public.casino_rooms where casino_rooms.invite_code=upper(trim(p_invite_code)) for update;
  if not found or v_room.status<>'waiting' then raise exception 'Room unavailable';end if;
  if exists(select 1 from public.casino_room_members where room_id=v_room.id and profile_id=v_profile.id) then
    update public.casino_room_members set user_id=v_user where room_id=v_room.id and profile_id=v_profile.id;
    return query select v_room.id,v_room.invite_code;return;
  end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in another room';end if;
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 end;
  select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
  if v_seat is null then raise exception 'Room is full';end if;v_credits:=greatest(v_profile.points,v_room.initial_credits);
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,'player',v_seat,v_credits);
  return query select v_room.id,v_room.invite_code;
end;$$;

create or replace function public.host_remove_room_member(p_room_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  if p_user_id=auth.uid() then raise exception 'Host cannot remove self';end if;
  update public.casino_player_profiles p set points=m.credits,updated_at=now() from public.casino_room_members m where m.room_id=p_room_id and m.user_id=p_user_id and p.id=m.profile_id;
  delete from public.casino_room_members where room_id=p_room_id and user_id=p_user_id;
end;$$;

create or replace function public.leave_casino_room(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.is_casino_room_host(p_room_id) then
    update public.casino_player_profiles p set points=m.credits,updated_at=now() from public.casino_room_members m where m.room_id=p_room_id and p.id=m.profile_id;
    update public.casino_rooms set status='closed',updated_at=now() where id=p_room_id;
    delete from public.casino_room_members where room_id=p_room_id;
  else
    update public.casino_player_profiles p set points=m.credits,updated_at=now() from public.casino_room_members m where m.room_id=p_room_id and m.user_id=auth.uid() and p.id=m.profile_id;
    delete from public.casino_room_members where room_id=p_room_id and user_id=auth.uid();
  end if;
end;$$;

revoke all on function public.get_my_casino_profile(),public.create_casino_player_profile(text,text),public.recover_casino_player_profile(text,text) from public;
grant execute on function public.get_my_casino_profile(),public.create_casino_player_profile(text,text),public.recover_casino_player_profile(text,text) to authenticated;
notify pgrst,'reload schema';
