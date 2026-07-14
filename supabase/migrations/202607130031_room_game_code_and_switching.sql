-- Salas: cÃ³digo limitado al juego correcto y cambio de sala sin bloquear el perfil.
-- - join_casino_room_for_game valida que el cÃ³digo pertenezca al juego abierto.
-- - Si el perfil estaba en otra sala, guarda sus puntos y lo saca antes de entrar.
-- - Si ese perfil era anfitriÃ³n de otra sala, la sala anterior se cierra y se guardan los puntos de todos.

create or replace function public.casino_detach_profile_from_other_rooms(p_profile_id uuid,p_keep_room_id uuid default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_membership record;
  v_member record;
begin
  for v_membership in
    select m.room_id,m.profile_id,m.user_id,m.member_role,m.credits,r.host_id,r.status
    from public.casino_room_members m
    join public.casino_rooms r on r.id=m.room_id
    where m.profile_id=p_profile_id
      and (p_keep_room_id is null or m.room_id<>p_keep_room_id)
    for update
  loop
    if v_membership.member_role='host' or v_membership.user_id=v_membership.host_id then
      for v_member in
        select m.profile_id,m.credits
        from public.casino_room_members m
        where m.room_id=v_membership.room_id and m.profile_id is not null
      loop
        update public.casino_player_profiles p
        set points=v_member.credits,updated_at=now()
        where p.id=v_member.profile_id;
      end loop;

      update public.casino_rooms r
      set status='closed',state_version=r.state_version+1,updated_at=now()
      where r.id=v_membership.room_id and r.status<>'closed';

      delete from public.casino_room_members m
      where m.room_id=v_membership.room_id;

      if to_regclass('public.casino_domino_hands') is not null then
        execute 'delete from public.casino_domino_hands where room_id=$1' using v_membership.room_id;
      end if;

      if to_regclass('public.casino_domino_bot_hands') is not null then
        execute 'delete from public.casino_domino_bot_hands where room_id=$1' using v_membership.room_id;
      end if;
    else
      update public.casino_player_profiles p
      set points=v_membership.credits,updated_at=now()
      where p.id=v_membership.profile_id;

      delete from public.casino_room_members m
      where m.room_id=v_membership.room_id and m.profile_id=v_membership.profile_id;

      update public.casino_rooms r
      set state_version=r.state_version+1,updated_at=now()
      where r.id=v_membership.room_id;
    end if;
  end loop;
end;
$$;

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 0)
returns table(room_id uuid,invite_code text)
language plpgsql
security definer
set search_path=public
as $$
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

  perform public.casino_detach_profile_from_other_rooms(v_profile.id,null);

  select p.* into v_profile
  from public.casino_player_profiles p
  where p.id=v_profile.id;

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
end;
$$;

create or replace function public.join_casino_room_for_game(p_invite_code text,p_display_name text,p_game_type text)
returns table(room_id uuid,invite_code text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_room public.casino_rooms%rowtype;
  v_seat smallint;
  v_max smallint;
  v_profile public.casino_player_profiles%rowtype;
  v_phase text;
  v_role text;
begin
  if v_user is null then raise exception 'Login required';end if;

  select p.* into v_profile
  from public.casino_profile_sessions s
  join public.casino_player_profiles p on p.id=s.profile_id
  where s.user_id=v_user;

  if not found then raise exception 'PROFILE_REQUIRED';end if;
  if p_game_type not in('blackjack','roulette','tres-y-dos','domino','poker','dados') then raise exception 'Invalid game';end if;
  if length(trim(p_invite_code))<>6 then raise exception 'INVALID_INVITE_CODE';end if;

  select r.* into v_room
  from public.casino_rooms r
  where r.invite_code=upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'INVITE_CODE_NOT_FOUND';end if;
  if v_room.game_type<>p_game_type then raise exception 'INVITE_CODE_WRONG_GAME';end if;
  if v_room.status='closed' then raise exception 'ROOM_CLOSED';end if;
  if v_room.is_locked then raise exception 'ROOM_LOCKED';end if;

  if exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.profile_id=v_profile.id) then
    update public.casino_room_members m
    set user_id=v_user,display_name=v_profile.display_name
    where m.room_id=v_room.id and m.profile_id=v_profile.id;
    return query select v_room.id,v_room.invite_code::text;
    return;
  end if;

  perform public.casino_detach_profile_from_other_rooms(v_profile.id,v_room.id);

  select p.* into v_profile
  from public.casino_player_profiles p
  where p.id=v_profile.id;

  v_max:=case v_room.game_type
    when 'blackjack' then 6
    when 'roulette' then 8
    when 'tres-y-dos' then 5
    when 'domino' then 4
    when 'poker' then 6
    when 'dados' then 8
  end;

  v_phase:=coalesce(v_room.game_state->>'phase','');
  if not(v_room.game_type='domino' and v_phase in('playing','round-over','match-over')) then
    select s into v_seat
    from generate_series(0,v_max-1) s
    where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s)
    order by s
    limit 1;
  end if;

  v_role:=case when v_seat is null then 'spectator' else 'player' end;

  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,join_number,credits)
  values(
    v_room.id,
    v_user,
    v_profile.id,
    v_profile.display_name,
    v_role,
    v_seat,
    case when v_room.game_type='domino' and v_seat is not null then v_seat+1 else null end,
    greatest(0,v_profile.points)
  );

  return query select v_room.id,v_room.invite_code::text;
end;
$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_room_game text;
begin
  select r.game_type into v_room_game
  from public.casino_rooms r
  where r.invite_code=upper(trim(p_invite_code));

  if v_room_game is null then raise exception 'INVITE_CODE_NOT_FOUND';end if;

  return query
  select *
  from public.join_casino_room_for_game(p_invite_code,p_display_name,v_room_game);
end;
$$;

revoke all on function public.casino_detach_profile_from_other_rooms(uuid,uuid),public.create_casino_room(text,text,text,integer),public.join_casino_room_for_game(text,text,text),public.join_casino_room(text,text) from public,anon;
grant execute on function public.create_casino_room(text,text,text,integer),public.join_casino_room_for_game(text,text,text),public.join_casino_room(text,text) to authenticated;
notify pgrst,'reload schema';
