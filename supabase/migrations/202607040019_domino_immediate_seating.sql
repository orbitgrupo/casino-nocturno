-- Cada cambio del selector actualiza inmediatamente el lugar visible en la mesa.
create or replace function public.host_set_domino_seats(p_room_id uuid,p_slots jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_room public.casino_rooms%rowtype;v_slot integer;v_value text;v_humans integer;v_bots integer;v_valid integer;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'HOST_ONLY';end if;
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found or v_room.game_type<>'domino' then raise exception 'DOMINO_ROOM_REQUIRED';end if;
  if exists(select 1 from public.casino_domino_hands h where h.room_id=p_room_id and jsonb_array_length(h.tiles)>0) then raise exception 'DOMINO_ALREADY_DEALT';end if;
  if p_slots is null or jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)<>4 then raise exception 'FOUR_PLACES_REQUIRED';end if;
  select count(*) filter(where upper(value)='BOT'),count(*) filter(where upper(value)<>'BOT'),count(distinct value) filter(where upper(value)<>'BOT') into v_bots,v_humans,v_valid from jsonb_array_elements_text(p_slots) slot(value);
  if v_humans<1 or v_humans>4 or v_bots<>4-v_humans then raise exception 'INVALID_DOMINO_LINEUP';end if;
  if v_valid<>v_humans then raise exception 'PLAYER_SELECTED_TWICE';end if;
  select count(*) into v_valid from jsonb_array_elements_text(p_slots) slot(value) where upper(value)<>'BOT' and exists(select 1 from public.casino_room_members m where m.room_id=p_room_id and m.user_id=value::uuid);
  if v_valid<>v_humans then raise exception 'PLAYER_NOT_IN_ROOM';end if;
  update public.casino_room_members m set seat=case when m.seat between 0 and 3 then m.seat+4 else m.seat end,team_no=null where m.room_id=p_room_id;
  update public.casino_room_members m set member_role=case when m.user_id=v_room.host_id then 'host' else 'spectator' end,join_number=null where m.room_id=p_room_id;
  for v_slot in 0..3 loop v_value:=p_slots->>v_slot;if upper(v_value)<>'BOT' then update public.casino_room_members m set seat=v_slot,join_number=v_slot+1,team_no=v_slot%2,member_role=case when m.user_id=v_room.host_id then 'host' else 'player' end where m.room_id=p_room_id and m.user_id=v_value::uuid;end if;end loop;
  update public.casino_rooms r set domino_lineup=p_slots,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;
revoke all on function public.host_set_domino_seats(uuid,jsonb) from public,anon;
grant execute on function public.host_set_domino_seats(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
