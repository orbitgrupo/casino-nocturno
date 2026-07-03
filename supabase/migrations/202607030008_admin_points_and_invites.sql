-- Solo la administración general puede otorgar o corregir puntos.
create or replace function public.admin_set_player_points(p_player_code text,p_points integer,p_reason text default 'Ajuste administrativo')
returns integer language plpgsql security definer set search_path=public as $$
declare v_profile public.casino_player_profiles%rowtype;v_delta integer;v_reason text:=nullif(trim(p_reason),'');
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  if p_points not between 0 and 1000000 then raise exception 'Points must be between 0 and 1000000';end if;
  select * into v_profile from public.casino_player_profiles where player_code=upper(trim(p_player_code)) for update;
  if not found then raise exception 'Player not found';end if;
  v_delta:=p_points-v_profile.points;if v_delta=0 then return p_points;end if;v_reason:=coalesce(v_reason,'Ajuste administrativo');
  update public.casino_player_profiles set points=p_points,updated_at=now() where id=v_profile.id;
  update public.casino_room_members set credits=p_points where profile_id=v_profile.id;
  insert into public.casino_point_transactions(profile_id,transaction_type,amount,balance_after,description) values(v_profile.id,'admin_adjustment',v_delta,p_points,v_reason);
  insert into public.casino_notifications(profile_id,notification_type,title,message) values(v_profile.id,'admin_points','Puntos actualizados','Administración cambió tu saldo en '||case when v_delta>0 then '+' else '' end||v_delta||'. Nuevo saldo: '||p_points||' puntos. Motivo: '||v_reason);
  return p_points;
end;$$;

-- La sala siempre toma el saldo real del perfil. El anfitrión no crea puntos.
create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 0)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room uuid:=gen_random_uuid();v_code text;v_seat smallint;v_profile public.casino_player_profiles%rowtype;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'Create or recover a player profile first';end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in a room';end if;
  if p_game_type not in('blackjack','roulette','tres-y-dos','domino','poker') then raise exception 'Invalid game';end if;
  if p_host_mode not in('playing','moderator') then raise exception 'Invalid host mode';end if;
  loop v_code:=upper(substr(md5(gen_random_uuid()::text),1,6));exit when not exists(select 1 from public.casino_rooms where casino_rooms.invite_code=v_code);end loop;
  v_seat:=case when p_host_mode='playing' then 0 else null end;
  insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits) values(v_room,v_code,p_game_type,v_user,p_host_mode,0);
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room,v_user,v_profile.id,v_profile.display_name,'host',v_seat,v_profile.points);
  return query select v_room,v_code;
end;$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;v_profile public.casino_player_profiles%rowtype;
begin
  select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
  if not found then raise exception 'Create or recover a player profile first';end if;
  if length(trim(p_invite_code))<>6 then raise exception 'Invitation code must have 6 characters';end if;
  select * into v_room from public.casino_rooms where casino_rooms.invite_code=upper(trim(p_invite_code)) for update;
  if not found or v_room.status<>'waiting' then raise exception 'Room unavailable';end if;
  if exists(select 1 from public.casino_room_members where room_id=v_room.id and profile_id=v_profile.id) then update public.casino_room_members set user_id=v_user,credits=v_profile.points where room_id=v_room.id and profile_id=v_profile.id;return query select v_room.id,v_room.invite_code;return;end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in another room';end if;
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 end;
  select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
  if v_seat is null then raise exception 'Room is full';end if;
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,'player',v_seat,v_profile.points);
  return query select v_room.id,v_room.invite_code;
end;$$;

revoke all on function public.host_set_member_credits(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.admin_set_player_points(text,integer,text) from public,anon;
grant execute on function public.admin_set_player_points(text,integer,text),public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text) to authenticated;
notify pgrst,'reload schema';
