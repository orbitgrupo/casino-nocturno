-- Corrige referencias ambiguas causadas por la columna de salida `profile_id`.
create or replace function public.recover_casino_player_profile(p_player_code text,p_recovery_key text)
returns table(profile_id uuid,player_code text,display_name text,points integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_profile public.casino_player_profiles%rowtype;
  v_key text:=upper(replace(trim(p_recovery_key),'-',''));
begin
  if v_user is null then raise exception 'Authentication required';end if;

  select p.* into v_profile
  from public.casino_player_profiles as p
  where p.player_code=upper(trim(p_player_code));

  if not found or extensions.crypt(v_key,v_profile.recovery_hash)<>v_profile.recovery_hash then
    raise exception 'Invalid player code or recovery key';
  end if;

  -- Evita ON CONFLICT y referencias sin alias a profile_id.
  delete from public.casino_profile_sessions as s
  where s.user_id=v_user;

  insert into public.casino_profile_sessions(user_id,profile_id,linked_at)
  values(v_user,v_profile.id,now());

  update public.casino_room_members as m
  set user_id=v_user
  where m.profile_id=v_profile.id;

  return query
  select v_profile.id,v_profile.player_code::text,v_profile.display_name,v_profile.points;
end;$$;

revoke all on function public.recover_casino_player_profile(text,text) from public,anon;
grant execute on function public.recover_casino_player_profile(text,text) to authenticated;
notify pgrst,'reload schema';
