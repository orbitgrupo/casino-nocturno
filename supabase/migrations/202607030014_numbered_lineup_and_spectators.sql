alter table public.casino_room_members drop constraint if exists casino_room_members_room_id_seat_key;
drop index if exists public.casino_room_members_room_id_seat_key;
create unique index if not exists casino_room_members_unique_seat on public.casino_room_members(room_id,seat) where seat is not null;
alter table public.casino_room_members drop constraint if exists casino_room_members_member_role_check;
alter table public.casino_room_members add constraint casino_room_members_member_role_check check(member_role in('host','player','spectator'));
alter table public.casino_room_members add column if not exists join_number smallint check(join_number between 1 and 4);
alter table public.casino_rooms add column if not exists domino_lineup jsonb not null default '[]'::jsonb;
update public.casino_room_members m set join_number=m.seat+1 where m.seat between 0 and 3 and m.join_number is null;

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
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 end;
  v_phase:=coalesce(v_room.game_state->>'phase','');
  if not(v_room.game_type='domino' and v_phase in('playing','round-over','match-over')) then select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;end if;
  v_role:=case when v_seat is null then 'spectator' else 'player' end;
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,join_number,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,v_role,v_seat,case when v_room.game_type='domino' and v_seat is not null then v_seat+1 else null end,v_profile.points);
  return query select v_room.id,v_room.invite_code::text;
end;$$;

create or replace function public.host_set_domino_lineup(p_room_id uuid,p_slots jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_room public.casino_rooms%rowtype;v_players integer;v_bots integer;v_member record;v_seen integer;v_slot integer;v_value text;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found or v_room.game_type<>'domino' then raise exception 'Domino room required';end if;
  if coalesce(v_room.game_state->>'phase','') in('playing','round-over','match-over') then raise exception 'Lineup is locked after dealing';end if;
  if jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)<>4 then raise exception 'Four table places are required';end if;
  select count(*) into v_players from public.casino_room_members m where m.room_id=p_room_id and m.seat is not null and m.member_role<>'spectator';
  if v_players not in(2,4) then raise exception 'The room needs two or four players';end if;
  select count(*) into v_bots from jsonb_array_elements_text(p_slots) value where upper(value)='BOT';
  if (v_players=2 and v_bots<>2) or (v_players=4 and v_bots<>0) then raise exception 'Use two bots with two players, or no bots with four players';end if;
  for v_member in select m.user_id,m.join_number from public.casino_room_members m where m.room_id=p_room_id and m.seat is not null and m.member_role<>'spectator' loop select count(*) into v_seen from jsonb_array_elements_text(p_slots) value where value=v_member.join_number::text;if v_seen<>1 then raise exception 'Each player number must appear exactly once';end if;end loop;
  update public.casino_room_members m set seat=m.seat+4,team_no=null where m.room_id=p_room_id and m.seat between 0 and 3;
  for v_slot in 0..3 loop v_value:=upper(p_slots->>v_slot);if v_value<>'BOT' then update public.casino_room_members m set seat=v_slot,team_no=v_slot%2 where m.room_id=p_room_id and m.join_number=v_value::smallint;end if;end loop;
  update public.casino_rooms r set domino_lineup=p_slots,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

revoke all on function public.join_casino_room(text,text),public.host_set_domino_lineup(uuid,jsonb) from public,anon;
grant execute on function public.join_casino_room(text,text),public.host_set_domino_lineup(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
