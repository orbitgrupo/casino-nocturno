-- Corrige y endurece el pase de turno online en Dominó.
-- Objetivo: que el jugador real pueda pasar cuando es su turno y no tiene jugada,
-- con validaciones claras y sin romper por campos nulos en game_state.

create or replace function public.domino_apply_pass(p_room_id uuid,p_seat integer)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_state jsonb;v_hand jsonb;v_tile text;v_a int;v_b int;v_left int;v_right int;v_passes int;
  v_last int;v_next int;v_winner int;v_low int:=9999;v_total int;v_value int;v_i int;
  v_key text;v_score int;v_closing_score int;v_pending jsonb;v_owner int;v_msg text:='Jugador pasa';
  v_chain jsonb;v_opening_required boolean;
begin
  select r.game_state into v_state
  from public.casino_rooms r
  where r.id=p_room_id and r.game_type='domino'
  for update;

  if not found then raise exception 'DOMINO_ROOM_NOT_FOUND';end if;
  if coalesce(v_state->>'phase','')<>'playing' then raise exception 'DOMINO_NOT_PLAYING';end if;
  if p_seat is null or p_seat<>(v_state->>'current_seat')::int then raise exception 'NOT_YOUR_TURN';end if;

  v_hand:=public.domino_hand_at_seat(p_room_id,p_seat);
  v_chain:=coalesce(v_state->'chain','[]'::jsonb);
  v_opening_required:=coalesce((v_state->>'opening_required')::boolean,false);

  if jsonb_array_length(v_chain)=0 then
    if v_opening_required and v_hand ? '6-6' then raise exception 'YOU_HAVE_PLAYABLE_TILE';end if;
    if not v_opening_required and jsonb_array_length(v_hand)>0 then raise exception 'YOU_HAVE_PLAYABLE_TILE';end if;
  else
    v_left:=(v_state->>'left')::int;
    v_right:=(v_state->>'right')::int;
    for v_tile in select jsonb_array_elements_text(v_hand) loop
      v_a:=split_part(v_tile,'-',1)::int;
      v_b:=split_part(v_tile,'-',2)::int;
      if v_a in(v_left,v_right) or v_b in(v_left,v_right) then
        raise exception 'YOU_HAVE_PLAYABLE_TILE';
      end if;
    end loop;
  end if;

  v_pending:=v_state->'pending_single_pass_bonus';
  if jsonb_typeof(v_pending)='object' and coalesce((v_pending->>'awarded')::boolean,false)=false and (v_pending->>'next')::int=p_seat then
    v_owner:=(v_pending->>'owner')::int;
    v_key:=case when v_state->>'mode'='partners' then 'team'||(v_owner%2) else 'p'||v_owner end;
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+25;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_pending:=jsonb_set(v_pending,'{awarded}','true'::jsonb,true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}',v_pending,true);
    v_msg:='Jugador pasa · Pase inmediato: +25 no cerrables';
  elsif jsonb_typeof(v_pending)='object' and coalesce((v_pending->>'awarded')::boolean,false)=true and (v_pending->>'cancel')::int=p_seat then
    v_owner:=(v_pending->>'owner')::int;
    v_key:=case when v_state->>'mode'='partners' then 'team'||(v_owner%2) else 'p'||v_owner end;
    v_score:=greatest(0,coalesce((v_state->'scores'->>v_key)::int,0)-25);
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_msg:='Jugador pasa · Se anula el pase inmediato';
  end if;

  v_passes:=coalesce((v_state->>'passes')::int,0)+1;
  if v_passes<4 then
    v_state:=jsonb_set(v_state,'{passes}',to_jsonb(v_passes),true);
    v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb((p_seat+1)%4),true);
    v_last:=nullif(v_state->>'last_player','')::int;
    if v_passes=3 and v_last is not null and (p_seat+1)%4=v_last then
      v_state:=jsonb_set(v_state,'{pending_all_pass}',to_jsonb(v_last),true);
      v_msg:=v_msg||' · si el trancador puede jugar ahora gana pase redondo';
    end if;
    v_state:=jsonb_set(v_state,'{message}',to_jsonb(v_msg),true);
  else
    v_state:=jsonb_set(v_state,'{pending_all_pass}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_last:=nullif(v_state->>'last_player','')::int;

    if v_last is null then
      v_winner:=p_seat;
    elsif v_state->>'mode'='pintintin' then
      for v_i in 0..3 loop
        v_value:=public.domino_pips(public.domino_hand_at_seat(p_room_id,v_i));
        if v_value<v_low then v_low:=v_value;v_winner:=v_i;end if;
      end loop;
    else
      v_next:=(v_last+1)%4;
      v_value:=public.domino_pips(public.domino_hand_at_seat(p_room_id,v_last));
      v_low:=public.domino_pips(public.domino_hand_at_seat(p_room_id,v_next));
      v_winner:=case when v_value<=v_low then v_last else v_next end;
    end if;

    v_total:=public.domino_total_table_pips(p_room_id);
    v_key:=case when v_state->>'mode'='partners' then 'team'||(v_winner%2) else 'p'||v_winner end;
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+v_total;
    v_closing_score:=coalesce((coalesce(v_state->'closing_scores',v_state->'scores')->>v_key)::int,0)+v_total;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,array['closing_scores',v_key],to_jsonb(v_closing_score),true);
    v_state:=jsonb_set(v_state,'{phase}',to_jsonb(case when v_closing_score>=(v_state->>'target')::int then 'match-over' else 'round-over' end),true);
    v_state:=jsonb_set(v_state,'{next_starter}',to_jsonb(v_winner),true);
    v_state:=jsonb_set(v_state,'{message}',to_jsonb('Tranca: '||v_total||' puntos'),true);
  end if;

  update public.casino_rooms r
  set game_state=v_state,state_version=r.state_version+1,updated_at=now()
  where r.id=p_room_id;
end;$$;

create or replace function public.pass_online_domino(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_profile uuid:=public.current_casino_profile_id();
  v_seat int;
begin
  if v_profile is null then raise exception 'PROFILE_REQUIRED';end if;

  select h.seat into v_seat
  from public.casino_domino_hands h
  where h.room_id=p_room_id and h.profile_id=v_profile;

  if v_seat is null then raise exception 'SEATED_PLAYER_REQUIRED';end if;

  perform public.domino_apply_pass(p_room_id,v_seat);
end;$$;

revoke all on function public.domino_apply_pass(uuid,integer),public.pass_online_domino(uuid) from public,anon;
grant execute on function public.pass_online_domino(uuid) to authenticated;
notify pgrst,'reload schema';
