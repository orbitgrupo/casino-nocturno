alter table public.casino_rooms drop constraint if exists casino_rooms_game_type_check;
alter table public.casino_rooms add constraint casino_rooms_game_type_check check(game_type in('blackjack','roulette','tres-y-dos','domino','poker'));

create or replace function public.create_casino_room(p_game_type text,p_host_mode text,p_display_name text,p_initial_credits integer default 1000)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room uuid:=gen_random_uuid();v_code text;v_seat smallint;v_profile public.casino_player_profiles%rowtype;v_credits integer;
begin
 select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
 if not found then raise exception 'Create or recover a player profile first';end if;
 if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in a room';end if;
 if p_game_type not in('blackjack','roulette','tres-y-dos','domino','poker') then raise exception 'Invalid game';end if;
 if p_host_mode not in('playing','moderator') then raise exception 'Invalid host mode';end if;
 if p_initial_credits not between 0 and 1000000 then raise exception 'Invalid credits';end if;
 loop v_code:=upper(substr(md5(gen_random_uuid()::text),1,6));exit when not exists(select 1 from public.casino_rooms where casino_rooms.invite_code=v_code);end loop;
 v_seat:=case when p_host_mode='playing' then 0 else null end;v_credits:=greatest(v_profile.points,p_initial_credits);
 insert into public.casino_rooms(id,invite_code,game_type,host_id,host_mode,initial_credits) values(v_room,v_code,p_game_type,v_user,p_host_mode,p_initial_credits);
 insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room,v_user,v_profile.id,v_profile.display_name,'host',v_seat,v_credits);
 return query select v_room,v_code;
end;$$;

create or replace function public.join_casino_room(p_invite_code text,p_display_name text)
returns table(room_id uuid,invite_code text) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_room public.casino_rooms%rowtype;v_seat smallint;v_max smallint;v_profile public.casino_player_profiles%rowtype;v_credits integer;
begin
 select p.* into v_profile from public.casino_profile_sessions s join public.casino_player_profiles p on p.id=s.profile_id where s.user_id=v_user;
 if not found then raise exception 'Create or recover a player profile first';end if;
 select * into v_room from public.casino_rooms where casino_rooms.invite_code=upper(trim(p_invite_code)) for update;
 if not found or v_room.status<>'waiting' then raise exception 'Room unavailable';end if;
 if exists(select 1 from public.casino_room_members where room_id=v_room.id and profile_id=v_profile.id) then update public.casino_room_members set user_id=v_user where room_id=v_room.id and profile_id=v_profile.id;return query select v_room.id,v_room.invite_code;return;end if;
 if exists(select 1 from public.casino_room_members where profile_id=v_profile.id) then raise exception 'This profile is already in another room';end if;
 v_max:=case v_room.game_type when 'blackjack' then 6 when 'roulette' then 8 when 'tres-y-dos' then 5 when 'domino' then 4 when 'poker' then 6 end;
 select s into v_seat from generate_series(0,v_max-1) s where not exists(select 1 from public.casino_room_members m where m.room_id=v_room.id and m.seat=s) order by s limit 1;
 if v_seat is null then raise exception 'Room is full';end if;v_credits:=greatest(v_profile.points,v_room.initial_credits);
 insert into public.casino_room_members(room_id,user_id,profile_id,display_name,member_role,seat,credits) values(v_room.id,v_user,v_profile.id,v_profile.display_name,'player',v_seat,v_credits);
 return query select v_room.id,v_room.invite_code;
end;$$;

grant execute on function public.create_casino_room(text,text,text,integer),public.join_casino_room(text,text) to authenticated;
notify pgrst,'reload schema';
