create or replace function public.create_casino_player_profile(p_display_name text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();v_id uuid:=gen_random_uuid();v_code text;v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if exists(select 1 from public.casino_profile_sessions where user_id=v_user) then raise exception 'This session already has a profile';end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception 'Invalid display name';end if;
  if char_length(v_key)<24 then raise exception 'Recovery key is too short';end if;
  loop
    v_code:='ORBIT-'||upper(substr(md5(gen_random_uuid()::text),1,8));
    exit when not exists(select 1 from public.casino_player_profiles where casino_player_profiles.player_code=v_code);
  end loop;
  insert into public.casino_player_profiles(id,player_code,display_name,recovery_hash)
  values(v_id,v_code,trim(p_display_name),extensions.crypt(v_key,extensions.gen_salt('bf',11)));
  insert into public.casino_profile_sessions(user_id,profile_id) values(v_user,v_id);
  return query select v_id,v_code,trim(p_display_name),0;
end;$$;

revoke all on function public.create_casino_player_profile(text,text) from public;
grant execute on function public.create_casino_player_profile(text,text) to authenticated;

create or replace function public.recover_casino_player_profile(p_player_code text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();v_profile public.casino_player_profiles%rowtype;v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_profile from public.casino_player_profiles
  where casino_player_profiles.player_code=upper(trim(p_player_code));
  if not found or extensions.crypt(v_key,v_profile.recovery_hash)<>v_profile.recovery_hash then raise exception 'Invalid player code or recovery key';end if;
  insert into public.casino_profile_sessions(user_id,profile_id) values(v_user,v_profile.id)
  on conflict(user_id) do update set profile_id=excluded.profile_id,linked_at=now();
  update public.casino_room_members set user_id=v_user where profile_id=v_profile.id;
  return query select v_profile.id,v_profile.player_code::text,v_profile.display_name,v_profile.points;
end;$$;

revoke all on function public.recover_casino_player_profile(text,text) from public;
grant execute on function public.recover_casino_player_profile(text,text) to authenticated;
notify pgrst,'reload schema';
