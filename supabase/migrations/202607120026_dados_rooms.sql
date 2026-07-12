-- Habilita salas online para el juego de Dados.
-- Ejecutar este contenido completo en el SQL Editor de Supabase y luego publicar los archivos.

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public'
      and t.relname='casino_rooms'
      and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%game_type%'
  loop
    execute format('alter table public.casino_rooms drop constraint %I', v_name);
  end loop;
end $$;

alter table public.casino_rooms
  add constraint casino_rooms_game_type_check
  check(game_type in('blackjack','roulette','tres-y-dos','domino','poker','dados'));

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 0)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room uuid:=gen_random_uuid();v_code text;v_profile public.casino_player_profiles%rowtype;v_credits integer;
begin
  if v_user is null then raise exception 'Login required';end if;
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'PROFILE_REQUIRED';end if;
  if p_game_type not in('blackjack','roulette','tres-y-dos','domino','poker','dados') then raise exception 'Invalid game';end if;
  if p_host_mode not in('playing','moderator') then raise exception 'Invalid host mode';end if;
  v_credits:=greatest(0,v_profile.points);
  loop v_code:=upper(substr(md5(random()::text||clock_timestamp()::text),1,6));exit when not exists(select 1 from public.casino_rooms where invite_code=v_code);end loop;
  insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits) values(v_room,v_code,p_game_type,v_user,p_host_mode,0);
  if p_host_mode='playing' then insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room,v_user,v_profile.id,v_profile.display_name,'host',0,v_credits);
  else insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room,v_user,v_profile.id,v_profile.display_name,'host',null,v_credits);end if;
  return query select v_room,v_code;
end;$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;v_profile public.casino_player_profiles%rowtype;v_phase text;v_role text;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'PROFILE_REQUIRED';end if;
  if length(trim(p_invite_code))<>6 then raise exception 'INVALID_INVITE_CODE';end if;
  select r.* into v_room from public.casino_rooms r where r.invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'INVITE_CODE_NOT_FOUND';end if;
  if v_room.status='closed' then raise exception 'ROOM_CLOSED';end if;
  if v_room.is_locked then raise exception 'ROOM_LOCKED';end if;
  if exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.profile_id=v_profile.id) then update public.casino_room_members m set user_id=v_user,credits=v_profile.points where m.room_id=v_room.id and m.profile_id=v_profile.id;return query select v_room.id,v_room.invite_code::text;return;end if;
  if exists(select 1 from public.casino_room_members m where m.profile_id=v_profile.id) then raise exception 'PROFILE_IN_ANOTHER_ROOM';end if;
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 when 'dados' then 8 end;
  v_phase:=coalesce(v_room.game_state->>'phase','');
  if not(v_room.game_type='domino' and v_phase in('playing','round-over','match-over')) then select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;end if;
  v_role:=case when v_seat is null then 'spectator' else 'player' end;
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,join_number,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,v_role,v_seat,case when v_room.game_type='domino' and v_seat is not null then v_seat+1 else null end,v_profile.points);
  return query select v_room.id,v_room.invite_code::text;
end;$$;

create or replace function public.host_set_room_seat(p_room_id uuid,p_user_id uuid,p_seated boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_room public.casino_rooms%rowtype;v_max smallint;v_seat smallint;v_member public.casino_room_members%rowtype;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  select * into v_room from public.casino_rooms where id=p_room_id for update;
  if not found then raise exception 'Room not found';end if;
  if v_room.game_type='domino' then raise exception 'Use host_set_domino_lineup for domino';end if;
  select * into v_member from public.casino_room_members where room_id=p_room_id and user_id=p_user_id for update;
  if not found then raise exception 'Player not in room';end if;

  if p_seated then
    if v_member.seat is not null then return;end if;
    v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'poker' then 6 when 'dados' then 8 end;
    select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=p_room_id and m.seat=s) order by s limit 1;
    if v_seat is null then raise exception 'ROOM_FULL';end if;
    update public.casino_room_members set seat=v_seat,member_role='player' where room_id=p_room_id and user_id=p_user_id;
  else
    if v_member.user_id=v_room.host_id and v_room.host_mode='playing' then raise exception 'Host must switch to moderator mode first';end if;
    update public.casino_room_members set seat=null,member_role='spectator' where room_id=p_room_id and user_id=p_user_id;
  end if;
  update public.casino_rooms set state_version=state_version+1,updated_at=now() where id=p_room_id;
end;$$;

revoke all on function public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text),public.host_set_room_seat(uuid,uuid,boolean) from public,anon;
grant execute on function public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text),public.host_set_room_seat(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
