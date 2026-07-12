create extension if not exists pgcrypto;

create table if not exists public.casino_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.casino_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code varchar(6) not null unique,
  game_type text not null check (game_type in ('blackjack','roulette','tres-y-dos','domino')),
  host_id uuid not null references auth.users(id) on delete cascade,
  host_mode text not null default 'playing' check (host_mode in ('playing','moderator')),
  status text not null default 'waiting' check (status in ('waiting','active','closed')),
  initial_credits integer not null default 1000 check (initial_credits between 0 and 1000000),
  game_state jsonb not null default '{}'::jsonb,
  state_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.casino_room_members (
  room_id uuid not null references public.casino_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  member_role text not null default 'player' check (member_role in ('host','player')),
  seat smallint check (seat between 0 and 7),
  credits integer not null default 1000 check (credits between 0 and 1000000),
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id,user_id),
  unique nulls not distinct (room_id,seat)
);

create or replace function public.is_casino_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.casino_room_members where room_id=p_room_id and user_id=auth.uid());
$$;

create or replace function public.is_casino_room_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.casino_rooms where id=p_room_id and host_id=auth.uid());
$$;

alter table public.casino_profiles enable row level security;
alter table public.casino_rooms enable row level security;
alter table public.casino_room_members enable row level security;

create policy "users read own casino profile" on public.casino_profiles for select to authenticated using (user_id=auth.uid());
create policy "users update own casino profile" on public.casino_profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "room members read their room" on public.casino_rooms for select to authenticated using (public.is_casino_room_member(id));
create policy "room members read participants" on public.casino_room_members for select to authenticated using (public.is_casino_room_member(room_id));

grant select on public.casino_profiles,public.casino_rooms,public.casino_room_members to authenticated;
revoke insert,update,delete on public.casino_rooms,public.casino_room_members from anon,authenticated;

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 1000)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room uuid:=gen_random_uuid();v_code text;v_seat smallint;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_game_type not in ('blackjack','roulette','tres-y-dos','domino') then raise exception 'Invalid game';end if;
  if p_host_mode not in ('playing','moderator') then raise exception 'Invalid host mode';end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception 'Invalid display name';end if;
  if p_initial_credits not between 0 and 1000000 then raise exception 'Invalid credits';end if;
  loop v_code:=upper(substr(md5(gen_random_uuid()::text),1,6));exit when not exists(select 1 from public.casino_rooms where casino_rooms.invite_code=v_code);end loop;
  v_seat:=case when p_host_mode='playing' then 0 else null end;
  insert into public.casino_profiles(user_id,display_name) values(v_user,trim(p_display_name)) on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits) values(v_room,v_code,p_game_type,v_user,p_host_mode,p_initial_credits);
  insert into public.casino_room_members(room_id,user_id,display_name,member_role,seat,credits) values(v_room,v_user,trim(p_display_name),'host',v_seat,p_initial_credits);
  return query select v_room,v_code;
end;$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception 'Invalid display name';end if;
  select * into v_room from public.casino_rooms where casino_rooms.invite_code=upper(trim(p_invite_code)) for update;
  if not found or v_room.status<>'waiting' then raise exception 'Room unavailable';end if;
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 end;
  select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
  if v_seat is null then raise exception 'Room is full';end if;
  insert into public.casino_profiles(user_id,display_name) values(v_user,trim(p_display_name)) on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into public.casino_room_members(room_id,user_id,display_name,member_role,seat,credits) values(v_room.id,v_user,trim(p_display_name),'player',v_seat,v_room.initial_credits) on conflict(room_id,user_id) do update set display_name=excluded.display_name;
  return query select v_room.id,v_room.invite_code;
end;$$;

create or replace function public.host_set_member_credits(p_room_id uuid,p_user_id uuid,p_credits integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  if p_credits not between 0 and 1000000 then raise exception 'Invalid credits';end if;
  update public.casino_room_members set credits=p_credits where room_id=p_room_id and user_id=p_user_id;
  if not found then raise exception 'Member not found';end if;
end;$$;

create or replace function public.host_remove_room_member(p_room_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  if p_user_id=auth.uid() then raise exception 'Host cannot remove self';end if;
  delete from public.casino_room_members where room_id=p_room_id and user_id=p_user_id;
end;$$;

create or replace function public.host_update_casino_room(p_room_id uuid,p_host_mode text default null,p_status text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_max smallint;v_seat smallint;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  if p_host_mode is not null and p_host_mode not in ('playing','moderator') then raise exception 'Invalid host mode';end if;
  if p_status is not null and p_status not in ('waiting','active','closed') then raise exception 'Invalid status';end if;
  if p_host_mode='moderator' then update public.casino_room_members set seat=null where room_id=p_room_id and user_id=auth.uid();end if;
  if p_host_mode='playing' then
    select case game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 end into v_max from public.casino_rooms where id=p_room_id;
    select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=p_room_id and m.seat=s and m.user_id<>auth.uid()) order by s limit 1;
    if v_seat is null then raise exception 'No seat available';end if;
    update public.casino_room_members set seat=v_seat where room_id=p_room_id and user_id=auth.uid();
  end if;
  update public.casino_rooms set host_mode=coalesce(p_host_mode,host_mode),status=coalesce(p_status,status),updated_at=now() where id=p_room_id;
end;$$;

create or replace function public.leave_casino_room(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.is_casino_room_host(p_room_id) then
    update public.casino_rooms set status='closed',updated_at=now() where id=p_room_id;
    delete from public.casino_room_members where room_id=p_room_id;
  else delete from public.casino_room_members where room_id=p_room_id and user_id=auth.uid();
  end if;
end;$$;

revoke all on function public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text),public.host_set_member_credits(uuid,uuid,integer),public.host_remove_room_member(uuid,uuid),public.host_update_casino_room(uuid,text,text),public.leave_casino_room(uuid) from public;
grant execute on function public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text),public.host_set_member_credits(uuid,uuid,integer),public.host_remove_room_member(uuid,uuid),public.host_update_casino_room(uuid,text,text),public.leave_casino_room(uuid) to authenticated;

do $$begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='casino_rooms') then alter publication supabase_realtime add table public.casino_rooms;end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='casino_room_members') then alter publication supabase_realtime add table public.casino_room_members;end if;
end$$;
