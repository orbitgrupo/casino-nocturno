-- Da al anfitrión control de quién está "en la mesa" (jugando) vs en la banca (espectador),
-- sin tener que expulsarlo de la sala. Aplica a los juegos que no usan el selector propio de
-- Dominó (que ya administra sus 4 lugares con host_set_domino_lineup).

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
    v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'poker' then 6 end;
    select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=p_room_id and m.seat=s) order by s limit 1;
    if v_seat is null then raise exception 'ROOM_FULL';end if;
    update public.casino_room_members set seat=v_seat,member_role='player' where room_id=p_room_id and user_id=p_user_id;
  else
    if v_member.user_id=v_room.host_id and v_room.host_mode='playing' then raise exception 'Host must switch to moderator mode first';end if;
    update public.casino_room_members set seat=null,member_role='spectator' where room_id=p_room_id and user_id=p_user_id;
  end if;
  update public.casino_rooms set state_version=state_version+1,updated_at=now() where id=p_room_id;
end;$$;

revoke all on function public.host_set_room_seat(uuid,uuid,boolean) from public,anon;
grant execute on function public.host_set_room_seat(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
