alter table public.casino_room_members add column if not exists team_no smallint check(team_no in(0,1));

create or replace function public.host_set_domino_teams(p_room_id uuid,p_assignments jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_room public.casino_rooms%rowtype;v_item jsonb;v_user uuid;v_team smallint;v_position integer;v_count integer;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  select r.* into v_room from public.casino_rooms r where r.id=p_room_id for update;
  if not found or v_room.game_type<>'domino' then raise exception 'Domino room required';end if;
  if coalesce(v_room.game_state->>'phase','') in('playing','round-over','match-over') then raise exception 'Teams are locked after dealing';end if;
  if jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)<>4 then raise exception 'Four team assignments are required';end if;
  select count(distinct item->>'user_id') into v_count from jsonb_array_elements(p_assignments) item;
  if v_count<>4 then raise exception 'Each player can appear only once';end if;
  for v_team in 0..1 loop select count(*) into v_count from jsonb_array_elements(p_assignments) item where (item->>'team_no')::int=v_team;if v_count<>2 then raise exception 'Each team needs two players';end if;end loop;
  select count(*) into v_count from public.casino_room_members m where m.room_id=p_room_id and m.seat is not null and exists(select 1 from jsonb_array_elements(p_assignments) item where (item->>'user_id')::uuid=m.user_id);
  if v_count<>4 then raise exception 'Assignments must contain the four seated players';end if;
  update public.casino_room_members m set seat=m.seat+4,team_no=null where m.room_id=p_room_id and m.seat between 0 and 3;
  for v_team in 0..1 loop
    v_position:=0;
    for v_item in select value from jsonb_array_elements(p_assignments) where (value->>'team_no')::int=v_team loop
      v_user:=(v_item->>'user_id')::uuid;
      update public.casino_room_members m set team_no=v_team,seat=case when v_team=0 then case when v_position=0 then 0 else 2 end else case when v_position=0 then 1 else 3 end end where m.room_id=p_room_id and m.user_id=v_user;
      v_position:=v_position+1;
    end loop;
  end loop;
  update public.casino_rooms r set state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

revoke all on function public.host_set_domino_teams(uuid,jsonb) from public,anon;
grant execute on function public.host_set_domino_teams(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
