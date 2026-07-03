-- Permite entrar después de activar la sala, siempre que la partida real no haya comenzado.
create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;v_profile public.casino_player_profiles%rowtype;v_phase text;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'PROFILE_REQUIRED';end if;
  if length(trim(p_invite_code))<>6 then raise exception 'INVALID_INVITE_CODE';end if;
  select * into v_room from public.casino_rooms where casino_rooms.invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'INVITE_CODE_NOT_FOUND';end if;
  if v_room.status='closed' then raise exception 'ROOM_CLOSED';end if;
  if v_room.is_locked then raise exception 'ROOM_LOCKED';end if;

  -- Una reconexión conserva el asiento incluso si la partida ya está en curso.
  if exists(select 1 from public.casino_room_members where room_id=v_room.id and profile_id=v_profile.id) then
    update public.casino_room_members set user_id=v_user,credits=v_profile.points where room_id=v_room.id and profile_id=v_profile.id;
    return query select v_room.id,v_room.invite_code;return;
  end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'PROFILE_IN_ANOTHER_ROOM';end if;

  v_phase:=coalesce(v_room.game_state->>'phase','');
  if v_room.game_type='domino' and v_phase in('playing','round-over','match-over') then raise exception 'DOMINO_ALREADY_DEALT';end if;

  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 end;
  select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
  if v_seat is null then raise exception 'ROOM_FULL';end if;
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,'player',v_seat,v_profile.points);
  return query select v_room.id,v_room.invite_code;
end;$$;

revoke all on function public.join_casino_room(text,text) from public,anon;
grant execute on function public.join_casino_room(text,text) to authenticated;
notify pgrst,'reload schema';
