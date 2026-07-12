alter table public.casino_rooms add column if not exists is_locked boolean not null default false;

drop function if exists public.admin_list_casino_rooms();
create function public.admin_list_casino_rooms()
returns table(room_id uuid,invite_code text,game_type text,status text,host_name text,host_mode text,member_count bigint,is_locked boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  return query select r.id,r.invite_code::text,r.game_type,r.status,coalesce(h.display_name,'Sin anfitrión'),r.host_mode,count(m.user_id),r.is_locked,r.created_at,r.updated_at
  from public.casino_rooms r
  left join public.casino_room_members h on h.room_id=r.id and h.user_id=r.host_id
  left join public.casino_room_members m on m.room_id=r.id
  group by r.id,h.display_name order by r.created_at desc;
end;$$;

create or replace function public.admin_kick_casino_room_member(p_room_id uuid,p_player_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_member record;
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  select m.profile_id,m.user_id,m.credits,p.points old_points,p.display_name,r.game_type,r.invite_code,r.host_id into v_member
  from public.casino_room_members m join public.casino_player_profiles p on p.id=m.profile_id join public.casino_rooms r on r.id=m.room_id
  where m.room_id=p_room_id and p.player_code=upper(trim(p_player_code)) for update of m,p,r;
  if not found then raise exception 'Player is not in this room';end if;
  if v_member.user_id=v_member.host_id then raise exception 'Terminate the room to remove its host';end if;
  update public.casino_player_profiles set points=v_member.credits,updated_at=now() where id=v_member.profile_id;
  insert into public.casino_point_transactions(profile_id,transaction_type,amount,balance_after,description) values(v_member.profile_id,'admin_room_removal',v_member.credits-v_member.old_points,v_member.credits,'Saldo guardado al ser expulsado por administración');
  insert into public.casino_game_history(profile_id,game_type,room_code,result,points_delta) values(v_member.profile_id,v_member.game_type,v_member.invite_code,'Expulsado por administración',v_member.credits-v_member.old_points);
  insert into public.casino_notifications(profile_id,notification_type,title,message) values(v_member.profile_id,'admin_room_removal','Saliste de una sala','Administración te expulsó de la sala '||v_member.invite_code||'. Tu saldo quedó guardado.');
  delete from public.casino_domino_hands where room_id=p_room_id and profile_id=v_member.profile_id;
  delete from public.casino_room_members where room_id=p_room_id and profile_id=v_member.profile_id;
end;$$;

create or replace function public.admin_manage_casino_room(p_room_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public as $$
declare rec record;
begin
  if not public.is_casino_admin() then raise exception 'Administrator access required';end if;
  if p_action='lock' then update public.casino_rooms set is_locked=true,updated_at=now() where id=p_room_id and status<>'closed';
  elsif p_action='unlock' then update public.casino_rooms set is_locked=false,updated_at=now() where id=p_room_id and status<>'closed';
  elsif p_action='terminate' then
    for rec in select m.profile_id,m.credits,p.points old_points,r.game_type,r.invite_code from public.casino_room_members m join public.casino_player_profiles p on p.id=m.profile_id join public.casino_rooms r on r.id=m.room_id where m.room_id=p_room_id loop
      update public.casino_player_profiles set points=rec.credits,updated_at=now() where id=rec.profile_id;
      insert into public.casino_point_transactions(profile_id,transaction_type,amount,balance_after,description) values(rec.profile_id,'admin_room_termination',rec.credits-rec.old_points,rec.credits,'Saldo guardado al cerrar la sala por administración');
      insert into public.casino_game_history(profile_id,game_type,room_code,result,points_delta) values(rec.profile_id,rec.game_type,rec.invite_code,'Sala terminada por administración',rec.credits-rec.old_points);
      insert into public.casino_notifications(profile_id,notification_type,title,message) values(rec.profile_id,'admin_room_termination','Sala terminada','Administración cerró la sala '||rec.invite_code||'. Tu saldo quedó guardado.');
    end loop;
    delete from public.casino_domino_hands where room_id=p_room_id;
    delete from public.casino_room_members where room_id=p_room_id;
    update public.casino_rooms set status='closed',is_locked=true,updated_at=now() where id=p_room_id;
  else raise exception 'Invalid room action';end if;
  if not found then raise exception 'Room not found or already closed';end if;
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
  if v_room.is_locked then raise exception 'Room is locked by administration';end if;
  if exists(select 1 from public.casino_room_members where room_id=v_room.id and profile_id=v_profile.id) then update public.casino_room_members set user_id=v_user,credits=v_profile.points where room_id=v_room.id and profile_id=v_profile.id;return query select v_room.id,v_room.invite_code;return;end if;
  if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in another room';end if;
  v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 end;
  select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
  if v_seat is null then raise exception 'Room is full';end if;
  insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,'player',v_seat,v_profile.points);
  return query select v_room.id,v_room.invite_code;
end;$$;

revoke all on function public.admin_list_casino_rooms(),public.admin_kick_casino_room_member(uuid,text),public.admin_manage_casino_room(uuid,text) from public,anon;
grant execute on function public.admin_list_casino_rooms(),public.admin_kick_casino_room_member(uuid,text),public.admin_manage_casino_room(uuid,text),public.join_casino_room(text,text) to authenticated;
notify pgrst,'reload schema';
