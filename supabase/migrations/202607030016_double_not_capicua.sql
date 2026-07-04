-- La capicúa online vale 25 solamente cuando la última ficha NO es doble.
create or replace function public.play_online_domino(p_room_id uuid,p_tile text,p_end text)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile uuid:=public.current_casino_profile_id();v_seat int;v_hand jsonb;v_state jsonb;v_a int:=split_part(p_tile,'-',1)::int;v_b int:=split_part(p_tile,'-',2)::int;v_left int;v_right int;v_chain jsonb;v_pa int;v_pb int;v_remaining int;v_points int;v_key text;v_score int;v_capicua boolean:=false;
begin
  select h.seat,h.tiles,r.game_state into v_seat,v_hand,v_state from public.casino_domino_hands h join public.casino_rooms r on r.id=h.room_id where h.room_id=p_room_id and h.profile_id=v_profile for update of h,r;
  if not found or v_state->>'phase'<>'playing' then raise exception 'Game unavailable';end if;
  if v_seat<>(v_state->>'current_seat')::int then raise exception 'Not your turn';end if;
  if not v_hand ? p_tile then raise exception 'Tile not in hand';end if;
  v_chain:=v_state->'chain';
  if jsonb_array_length(v_chain)=0 then
    if coalesce((v_state->>'opening_required')::boolean,false) and p_tile<>'6-6' then raise exception 'The first hand must open with double six';end if;
    v_pa:=v_a;v_pb:=v_b;v_left:=v_pa;v_right:=v_pb;v_chain:=jsonb_build_array(v_pa||'-'||v_pb);
  else
    v_left:=(v_state->>'left')::int;v_right:=(v_state->>'right')::int;
    v_capicua:=jsonb_array_length(v_hand)=1 and v_a<>v_b and (v_a=v_left or v_b=v_left) and (v_a=v_right or v_b=v_right);
    if p_end='left' and (v_a=v_left or v_b=v_left) then if v_b=v_left then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;v_left:=v_pa;v_chain:=jsonb_build_array(v_pa||'-'||v_pb)||v_chain;
    elsif p_end='right' and (v_a=v_right or v_b=v_right) then if v_a=v_right then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;v_right:=v_pb;v_chain:=v_chain||jsonb_build_array(v_pa||'-'||v_pb);
    else raise exception 'Tile does not fit that end';end if;
  end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_hand from jsonb_array_elements(v_hand) where value#>>'{}'<>p_tile;
  update public.casino_domino_hands h set tiles=v_hand where h.room_id=p_room_id and h.profile_id=v_profile;
  v_remaining:=jsonb_array_length(v_hand);v_state:=jsonb_set(v_state,'{chain}',v_chain);v_state:=jsonb_set(v_state,'{left}',to_jsonb(v_left));v_state:=jsonb_set(v_state,'{right}',to_jsonb(v_right));v_state:=jsonb_set(v_state,'{last_player}',to_jsonb(v_seat));v_state:=jsonb_set(v_state,'{passes}','0');
  if v_remaining=0 then
    select sum(public.domino_pips(h.tiles)) into v_points from public.casino_domino_hands h where h.room_id=p_room_id;
    v_key:=case when v_state->>'mode'='partners' then 'team'||(v_seat%2) else 'p'||v_seat end;v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+v_points+case when v_capicua then 25 else 0 end;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);v_state:=jsonb_set(v_state,'{phase}',to_jsonb(case when v_score>=(v_state->>'target')::int then 'match-over' else 'round-over' end));v_state:=jsonb_set(v_state,'{next_starter}',to_jsonb(v_seat));v_state:=jsonb_set(v_state,'{message}',to_jsonb('Mano terminada: '||v_points||' puntos'||case when v_capicua then ' + 25 de capicúa' else '' end));
  else v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb((v_seat+1)%4));v_state:=jsonb_set(v_state,'{message}',to_jsonb('Ficha jugada'));end if;
  update public.casino_rooms r set game_state=v_state,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;
revoke all on function public.play_online_domino(uuid,text,text) from public,anon;
grant execute on function public.play_online_domino(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
