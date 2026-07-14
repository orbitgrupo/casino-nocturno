-- Motores sincronizados base para Ruleta, Dados, Tres y Dos y Póker.
-- Ejecutar completo en Supabase SQL Editor.
--
-- Diseño:
-- - El estado visible de la partida vive en casino_rooms.game_state.
-- - Los jugadores sentados pueden registrar apuestas/acciones.
-- - Solo el creador de la sala puede iniciar/reiniciar y aplicar cambios de puntos.
-- - Esto deja los cuatro juegos sincronizados ahora y mantiene un punto único para
--   endurecer reglas servidor por servidor en futuras iteraciones.

create or replace function public.casino_sync_room_member(p_room_id uuid)
returns public.casino_room_members
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_profile uuid:=public.current_casino_profile_id();
  v_member public.casino_room_members%rowtype;
begin
  select *
  into v_member
  from public.casino_room_members m
  where m.room_id=p_room_id and m.profile_id=v_profile;

  if not found then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;

  return v_member;
end;
$$;

create or replace function public.start_sync_game(p_room_id uuid,p_kind text,p_state jsonb)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_room public.casino_rooms%rowtype;
  v_allowed boolean;
begin
  if not public.is_casino_room_host(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;

  select *
  into v_room
  from public.casino_rooms
  where id=p_room_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_allowed:=
    (v_room.game_type='roulette' and p_kind='roulette')
    or (v_room.game_type='dados' and p_kind='dados')
    or (v_room.game_type='tres-y-dos' and p_kind='tres-y-dos')
    or (v_room.game_type='poker' and p_kind='poker');

  if not v_allowed then
    raise exception 'WRONG_SYNC_ENGINE';
  end if;

  update public.casino_rooms r
  set game_state=coalesce(p_state,'{}'::jsonb) || jsonb_build_object(
      'kind',p_kind,
      'updated_by','host',
      'updated_at',extract(epoch from now())
    ),
    status='active',
    state_version=r.state_version+1,
    updated_at=now()
  where r.id=p_room_id;
end;
$$;

create or replace function public.update_sync_game(p_room_id uuid,p_state jsonb)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_member public.casino_room_members%rowtype;
begin
  v_member:=public.casino_sync_room_member(p_room_id);

  update public.casino_rooms r
  set game_state=coalesce(p_state,'{}'::jsonb) || jsonb_build_object(
      'updated_by',v_member.profile_id,
      'updated_at',extract(epoch from now())
    ),
    state_version=r.state_version+1,
    updated_at=now()
  where r.id=p_room_id
    and r.status<>'closed';
end;
$$;

create or replace function public.place_sync_bet(p_room_id uuid,p_bet jsonb)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_member public.casino_room_members%rowtype;
  v_room public.casino_rooms%rowtype;
  v_amount integer;
  v_current_total integer;
  v_bets jsonb;
  v_key text;
begin
  v_member:=public.casino_sync_room_member(p_room_id);
  if v_member.seat is null then
    raise exception 'SEATED_PLAYER_REQUIRED';
  end if;

  select *
  into v_room
  from public.casino_rooms
  where id=p_room_id
  for update;

  if not found or v_room.status='closed' then
    raise exception 'ROOM_UNAVAILABLE';
  end if;

  if coalesce(v_room.game_state->>'phase','') not in('betting','waiting','') then
    raise exception 'BETTING_CLOSED';
  end if;

  v_amount:=coalesce((p_bet->>'amount')::integer,0);
  if v_amount<=0 then
    raise exception 'INVALID_BET';
  end if;

  v_key:=v_member.profile_id::text;
  v_bets:=coalesce(v_room.game_state->'bets','{}'::jsonb);

  select coalesce(sum((x->>'amount')::integer),0)
  into v_current_total
  from jsonb_array_elements(coalesce(v_bets->v_key,'[]'::jsonb)) x;

  if v_current_total+v_amount>v_member.credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_bets:=jsonb_set(
    v_bets,
    array[v_key],
    coalesce(v_bets->v_key,'[]'::jsonb) || jsonb_build_array(
      p_bet || jsonb_build_object(
        'profile_id',v_member.profile_id,
        'seat',v_member.seat,
        'display_name',v_member.display_name,
        'created_at',extract(epoch from now())
      )
    ),
    true
  );

  update public.casino_rooms r
  set game_state=jsonb_set(
      coalesce(r.game_state,'{}'::jsonb) || jsonb_build_object('phase','betting'),
      '{bets}',
      v_bets,
      true
    ),
    state_version=r.state_version+1,
    updated_at=now()
  where r.id=p_room_id;
end;
$$;

create or replace function public.clear_sync_bets(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_member public.casino_room_members%rowtype;
  v_room public.casino_rooms%rowtype;
  v_bets jsonb;
begin
  v_member:=public.casino_sync_room_member(p_room_id);

  select *
  into v_room
  from public.casino_rooms
  where id=p_room_id
  for update;

  if coalesce(v_room.game_state->>'phase','') not in('betting','waiting','') then
    raise exception 'BETTING_CLOSED';
  end if;

  v_bets:=coalesce(v_room.game_state->'bets','{}'::jsonb) - v_member.profile_id::text;

  update public.casino_rooms r
  set game_state=jsonb_set(coalesce(r.game_state,'{}'::jsonb),'{bets}',v_bets,true),
    state_version=r.state_version+1,
    updated_at=now()
  where r.id=p_room_id;
end;
$$;

create or replace function public.commit_sync_game(p_room_id uuid,p_state jsonb,p_credit_deltas jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_key text;
  v_delta integer;
begin
  if not public.is_casino_room_host(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;

  for v_key,v_delta in
    select key,(value#>>'{}')::integer
    from jsonb_each(coalesce(p_credit_deltas,'{}'::jsonb))
  loop
    update public.casino_room_members m
    set credits=greatest(0,m.credits+v_delta)
    where m.room_id=p_room_id and m.profile_id=v_key::uuid;
  end loop;

  update public.casino_rooms r
  set game_state=coalesce(p_state,'{}'::jsonb) || jsonb_build_object(
      'updated_by','host',
      'updated_at',extract(epoch from now())
    ),
    state_version=r.state_version+1,
    updated_at=now()
  where r.id=p_room_id
    and r.status<>'closed';
end;
$$;

revoke all on function
  public.casino_sync_room_member(uuid),
  public.start_sync_game(uuid,text,jsonb),
  public.update_sync_game(uuid,jsonb),
  public.place_sync_bet(uuid,jsonb),
  public.clear_sync_bets(uuid),
  public.commit_sync_game(uuid,jsonb,jsonb)
from public,anon;

grant execute on function
  public.start_sync_game(uuid,text,jsonb),
  public.update_sync_game(uuid,jsonb),
  public.place_sync_bet(uuid,jsonb),
  public.clear_sync_bets(uuid),
  public.commit_sync_game(uuid,jsonb,jsonb)
to authenticated;

notify pgrst,'reload schema';
