create table if not exists public.casino_admins (
  profile_id uuid primary key references public.casino_player_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.casino_admins enable row level security;
revoke all on public.casino_admins from anon,authenticated;

create or replace function public.is_casino_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.casino_profile_sessions s
    join public.casino_admins a on a.profile_id=s.profile_id
    where s.user_id=auth.uid()
  );
$$;

create or replace function public.admin_casino_summary()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  select jsonb_build_object(
    'players',(select count(*) from public.casino_player_profiles),
    'total_points',(select coalesce(sum(points),0) from public.casino_player_profiles),
    'rooms',(select count(*) from public.casino_rooms),
    'waiting_rooms',(select count(*) from public.casino_rooms where status='waiting'),
    'active_rooms',(select count(*) from public.casino_rooms where status='active'),
    'connected_members',(select count(*) from public.casino_room_members),
    'games',(select coalesce(jsonb_object_agg(game_type,amount),'{}'::jsonb) from (select game_type,count(*) amount from public.casino_rooms group by game_type) g)
  ) into v_result;
  return v_result;
end;$$;

create or replace function public.admin_list_casino_players()
returns table(player_code text,display_name text,points integer,room_code text,game_type text,room_credits integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  return query
  select p.player_code::text,p.display_name,p.points,r.invite_code::text,r.game_type,m.credits,p.created_at,p.updated_at
  from public.casino_player_profiles p
  left join public.casino_room_members m on m.profile_id=p.id
  left join public.casino_rooms r on r.id=m.room_id
  order by p.created_at desc;
end;$$;

create or replace function public.admin_list_casino_rooms()
returns table(room_id uuid,invite_code text,game_type text,status text,host_name text,host_mode text,member_count bigint,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  return query
  select r.id,r.invite_code::text,r.game_type,r.status,coalesce(h.display_name,'Sin anfitrión'),r.host_mode,count(m.user_id),r.created_at,r.updated_at
  from public.casino_rooms r
  left join public.casino_room_members h on h.room_id=r.id and h.user_id=r.host_id
  left join public.casino_room_members m on m.room_id=r.id
  group by r.id,h.display_name
  order by r.created_at desc;
end;$$;

revoke all on function public.is_casino_admin(),public.admin_casino_summary(),public.admin_list_casino_players(),public.admin_list_casino_rooms() from public;
grant execute on function public.is_casino_admin(),public.admin_casino_summary(),public.admin_list_casino_players(),public.admin_list_casino_rooms() to authenticated;

-- Después de crear tu perfil, ejecuta una sola vez en SQL Editor:
-- insert into public.casino_admins(profile_id)
-- select id from public.casino_player_profiles where player_code='ORBIT-TU-CODIGO';

notify pgrst,'reload schema';
