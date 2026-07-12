-- Corrige "column reference invite_code is ambiguous" al crear salas
-- y refuerza que solo el creador/anfitrión de la sala pueda administrar controles de mesa.

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 0)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_room uuid:=gen_random_uuid();
  v_code text;
  v_profile public.casino_player_profiles%rowtype;
  v_credits integer;
begin
  if v_user is null then raise exception 'Login required';end if;

  select p.* into v_profile
  from public.casino_profile_sessions s
  join public.casino_player_profiles p on p.id=s.profile_id
  where s.user_id=v_user;

  if not found then raise exception 'PROFILE_REQUIRED';end if;
  if p_game_type not in('blackjack','roulette','tres-y-dos','domino','poker','dados') then raise exception 'Invalid game';end if;
  if p_host_mode not in('playing','moderator') then raise exception 'Invalid host mode';end if;

  v_credits:=greatest(0,v_profile.points);

  loop
    v_code:=upper(substr(md5(random()::text||clock_timestamp()::text),1,6));
    exit when not exists(select 1 from public.casino_rooms r where r.invite_code=v_code);
  end loop;

  insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits)
  values(v_room,v_code,p_game_type,v_user,p_host_mode,0);

  if p_host_mode='playing' then
    insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits)
    values(v_room,v_user,v_profile.id,v_profile.display_name,'host',0,v_credits);
  else
    insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits)
    values(v_room,v_user,v_profile.id,v_profile.display_name,'host',null,v_credits);
  end if;

  return query select v_room,v_code;
end;$$;

create or replace function public.host_update_casino_room(p_room_id uuid,p_host_mode text default null,p_status text default null)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_room public.casino_rooms%rowtype;
  v_max smallint;
  v_seat smallint;
begin
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND';end if;
  if v_room.host_id<>auth.uid() then raise exception 'HOST_ONLY';end if;
  if v_room.status='closed' then raise exception 'ROOM_CLOSED';end if;
  if p_host_mode is not null and p_host_mode not in('playing','moderator') then raise exception 'INVALID_HOST_MODE';end if;
  if p_status is not null and p_status not in('waiting','active','closed') then raise exception 'INVALID_STATUS';end if;

  if p_host_mode='moderator' then
    update public.casino_room_members m set seat=null,member_role='host'
    where m.room_id=p_room_id and m.user_id=auth.uid();
  end if;

  if p_host_mode='playing' then
    v_max:=case v_room.game_type
      when 'blackjack' then 6
      when 'roulette' then 8
      when 'tres-y-dos' then 5
      when 'domino' then 4
      when 'poker' then 6
      when 'dados' then 8
    end;

    select s into v_seat
    from generate_series(0,v_max-1) s
    where not exists(
      select 1 from public.casino_room_members m
      where m.room_id=p_room_id and m.seat=s and m.user_id<>auth.uid()
    )
    order by s
    limit 1;

    if v_seat is null then raise exception 'NO_SEAT_AVAILABLE';end if;

    update public.casino_room_members m
    set seat=v_seat,member_role='host'
    where m.room_id=p_room_id and m.user_id=auth.uid();
  end if;

  update public.casino_rooms r
  set host_mode=coalesce(p_host_mode,r.host_mode),
      status=coalesce(p_status,r.status),
      state_version=r.state_version+1,
      updated_at=now()
  where r.id=p_room_id and r.host_id=auth.uid();
end;$$;

create or replace function public.host_set_room_seat(p_room_id uuid,p_user_id uuid,p_seated boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_room public.casino_rooms%rowtype;
  v_max smallint;
  v_seat smallint;
  v_member public.casino_room_members%rowtype;
begin
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND';end if;
  if v_room.host_id<>auth.uid() then raise exception 'HOST_ONLY';end if;
  if v_room.status='closed' then raise exception 'ROOM_CLOSED';end if;
  if v_room.game_type='domino' then raise exception 'USE_DOMINO_LINEUP';end if;

  select m.* into v_member
  from public.casino_room_members m
  where m.room_id=p_room_id and m.user_id=p_user_id
  for update;

  if not found then raise exception 'PLAYER_NOT_IN_ROOM';end if;

  if p_seated then
    if v_member.seat is not null then return;end if;

    v_max:=case v_room.game_type
      when 'blackjack' then 6
      when 'roulette' then 8
      when 'tres-y-dos' then 5
      when 'poker' then 6
      when 'dados' then 8
    end;

    select s into v_seat
    from generate_series(0,v_max-1) s
    where not exists(select 1 from public.casino_room_members m where m.room_id=p_room_id and m.seat=s)
    order by s
    limit 1;

    if v_seat is null then raise exception 'ROOM_FULL';end if;

    update public.casino_room_members m
    set seat=v_seat,member_role=case when m.user_id=v_room.host_id then 'host' else 'player' end
    where m.room_id=p_room_id and m.user_id=p_user_id;
  else
    if v_member.user_id=v_room.host_id and v_room.host_mode='playing' then raise exception 'HOST_MUST_SWITCH_TO_MODERATOR';end if;

    update public.casino_room_members m
    set seat=null,member_role=case when m.user_id=v_room.host_id then 'host' else 'spectator' end
    where m.room_id=p_room_id and m.user_id=p_user_id;
  end if;

  update public.casino_rooms r
  set state_version=r.state_version+1,updated_at=now()
  where r.id=p_room_id and r.host_id=auth.uid();
end;$$;

create or replace function public.host_reset_casino_game(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.casino_rooms r
  set game_state='{}'::jsonb,
      status='waiting',
      state_version=r.state_version+1,
      updated_at=now()
  where r.id=p_room_id
    and r.host_id=auth.uid()
    and r.status<>'closed';

  if not found then raise exception 'HOST_ONLY_OR_ROOM_CLOSED';end if;

  delete from public.casino_domino_hands h where h.room_id=p_room_id;
end;$$;

revoke all on function public.create_casino_room(text,text,text,integer),public.host_update_casino_room(uuid,text,text),public.host_set_room_seat(uuid,uuid,boolean),public.host_reset_casino_game(uuid) from public,anon;
grant execute on function public.create_casino_room(text,text,text,integer),public.host_update_casino_room(uuid,text,text),public.host_set_room_seat(uuid,uuid,boolean),public.host_reset_casino_game(uuid) to authenticated;
notify pgrst,'reload schema';
