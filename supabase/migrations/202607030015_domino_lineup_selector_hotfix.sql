-- Refuerza la asignación numerada y permite corregir una mesa antes de repartir fichas.
update public.casino_room_members m set join_number=m.seat+1 where m.join_number is null and m.seat between 0 and 3;

create or replace function public.host_set_domino_lineup(p_room_id uuid,p_slots jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_room public.casino_rooms%rowtype;v_players integer;v_bots integer;v_member record;v_seen integer;v_slot integer;v_value text;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'HOST_ONLY';end if;
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found or v_room.game_type<>'domino' then raise exception 'DOMINO_ROOM_REQUIRED';end if;
  if exists(select 1 from public.casino_domino_hands h where h.room_id=p_room_id and jsonb_array_length(h.tiles)>0) then raise exception 'DOMINO_ALREADY_DEALT';end if;
  if p_slots is null or jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)<>4 then raise exception 'FOUR_PLACES_REQUIRED';end if;
  select count(*) into v_players from public.casino_room_members m where m.room_id=p_room_id and m.seat is not null and m.member_role<>'spectator';
  if v_players<>2 and v_players<>4 then raise exception 'TWO_OR_FOUR_PLAYERS_REQUIRED';end if;
  select count(*) into v_bots from jsonb_array_elements_text(p_slots) as slot(value) where upper(trim(slot.value))='BOT';
  if v_players=2 and v_bots<>2 then raise exception 'TWO_BOTS_REQUIRED';end if;
  if v_players=4 and v_bots<>0 then raise exception 'BOTS_NOT_ALLOWED_WITH_FOUR_PLAYERS';end if;
  for v_member in select m.join_number from public.casino_room_members m where m.room_id=p_room_id and m.seat is not null and m.member_role<>'spectator' loop
    select count(*) into v_seen from jsonb_array_elements_text(p_slots) as slot(value) where trim(slot.value)=v_member.join_number::text;
    if v_seen<>1 then raise exception 'PLAYER_NUMBER_MUST_APPEAR_ONCE';end if;
  end loop;
  update public.casino_room_members m set seat=m.seat+4,team_no=null where m.room_id=p_room_id and m.seat between 0 and 3;
  for v_slot in 0..3 loop
    v_value:=upper(trim(p_slots->>v_slot));
    if v_value<>'BOT' then update public.casino_room_members m set seat=v_slot,team_no=v_slot%2 where m.room_id=p_room_id and m.join_number=v_value::smallint;end if;
  end loop;
  update public.casino_rooms r set domino_lineup=p_slots,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

revoke all on function public.host_set_domino_lineup(uuid,jsonb) from public,anon;
grant execute on function public.host_set_domino_lineup(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
