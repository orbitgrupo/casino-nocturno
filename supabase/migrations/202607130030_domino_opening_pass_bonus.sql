-- Dominó online: corrige el bono de pase.
-- Regla:
-- - El bono de pase solo aplica en la salida de cada mano.
-- - Si el salidor juega una ficha doble y el siguiente jugador pasa: +25 no cerrables.
-- - Si el salidor juega una ficha no doble y el siguiente jugador pasa: +50 no cerrables.
-- - Después de la salida no hay pase inmediato; solo cuentan paso redondo y capicúa.
-- - Los bonos no cerrables se descartan si alcanzan o sobrepasan la meta.

create or replace function public.domino_try_add_nonclosing_bonus(p_state jsonb,p_seat integer,p_points integer)
returns jsonb
language plpgsql
immutable
set search_path=public
as $$
declare
  v_key text;
  v_score integer;
  v_target integer;
  v_out jsonb:=p_state;
begin
  v_key:=case when v_out->>'mode'='partners' then 'team'||(p_seat%2) else 'p'||p_seat end;
  v_score:=coalesce((v_out->'scores'->>v_key)::int,0);
  v_target:=coalesce((v_out->>'target')::int,100);

  if v_score+p_points>=v_target then
    return jsonb_build_object('state',v_out,'applied',false);
  end if;

  v_out:=jsonb_set(v_out,array['scores',v_key],to_jsonb(v_score+p_points),true);
  return jsonb_build_object('state',v_out,'applied',true);
end;
$$;

create or replace function public.domino_apply_play(p_room_id uuid,p_seat integer,p_tile text,p_end text,p_bot boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_hand jsonb;
  v_state jsonb;
  v_a int:=split_part(p_tile,'-',1)::int;
  v_b int:=split_part(p_tile,'-',2)::int;
  v_left int;
  v_right int;
  v_chain jsonb;
  v_pa int;
  v_pb int;
  v_remaining int;
  v_points int;
  v_key text;
  v_score int;
  v_closing_score int;
  v_capicua boolean:=false;
  v_pending jsonb;
  v_msg text;
  v_bonus jsonb;
  v_is_opening boolean:=false;
  v_opening_bonus int:=25;
begin
  select r.game_state into v_state
  from public.casino_rooms r
  where r.id=p_room_id and r.game_type='domino'
  for update;

  if not found then raise exception 'DOMINO_ROOM_NOT_FOUND';end if;

  v_hand:=public.domino_hand_at_seat(p_room_id,p_seat);
  if v_state->>'phase'<>'playing' or p_seat<>(v_state->>'current_seat')::int then
    raise exception 'Not this seat turn';
  end if;
  if not v_hand ? p_tile then raise exception 'Tile not in hand';end if;

  v_chain:=coalesce(v_state->'chain','[]'::jsonb);
  v_is_opening:=jsonb_array_length(v_chain)=0;
  v_opening_bonus:=case when v_a=v_b then 25 else 50 end;
  v_msg:=case when p_bot then 'BOT jugó una ficha' else 'Ficha jugada' end;

  v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);

  if coalesce(v_state->>'pending_all_pass','')<>'' and (v_state->>'pending_all_pass')::int=p_seat then
    v_bonus:=public.domino_try_add_nonclosing_bonus(v_state,p_seat,25);
    v_state:=v_bonus->'state';
    v_state:=jsonb_set(v_state,'{pending_all_pass}','null'::jsonb,true);
    if coalesce((v_bonus->>'applied')::boolean,false) then
      v_msg:=v_msg||' · Pase redondo: +25 no cerrables';
    else
      v_msg:=v_msg||' · Pase redondo descartado por sobrepaso';
    end if;
  end if;

  if v_is_opening then
    if coalesce((v_state->>'opening_required')::boolean,false) and p_tile<>'6-6' then
      raise exception 'The first hand must open with double six';
    end if;
    v_pa:=v_a;
    v_pb:=v_b;
    v_left:=v_pa;
    v_right:=v_pb;
    v_chain:=jsonb_build_array(v_pa||'-'||v_pb);
  else
    v_left:=(v_state->>'left')::int;
    v_right:=(v_state->>'right')::int;
    v_capicua:=jsonb_array_length(v_hand)=1 and v_a<>v_b and (v_a=v_left or v_b=v_left) and (v_a=v_right or v_b=v_right);

    if p_end='left' and (v_a=v_left or v_b=v_left) then
      if v_b=v_left then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;
      v_left:=v_pa;
      v_chain:=jsonb_build_array(v_pa||'-'||v_pb)||v_chain;
    elsif p_end='right' and (v_a=v_right or v_b=v_right) then
      if v_a=v_right then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;
      v_right:=v_pb;
      v_chain:=v_chain||jsonb_build_array(v_pa||'-'||v_pb);
    else
      raise exception 'Tile does not fit that end';
    end if;
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb)
  into v_hand
  from jsonb_array_elements(v_hand)
  where value#>>'{}'<>p_tile;

  if p_bot then
    update public.casino_domino_bot_hands b set tiles=v_hand where b.room_id=p_room_id and b.seat=p_seat;
  else
    update public.casino_domino_hands h set tiles=v_hand where h.room_id=p_room_id and h.seat=p_seat;
  end if;

  v_remaining:=jsonb_array_length(v_hand);
  v_state:=jsonb_set(v_state,'{chain}',v_chain,true);
  v_state:=jsonb_set(v_state,'{left}',to_jsonb(v_left),true);
  v_state:=jsonb_set(v_state,'{right}',to_jsonb(v_right),true);
  v_state:=jsonb_set(v_state,'{last_player}',to_jsonb(p_seat),true);
  v_state:=jsonb_set(v_state,'{passes}','0'::jsonb,true);

  if v_remaining=0 then
    v_points:=public.domino_total_table_pips(p_room_id);
    v_key:=case when v_state->>'mode'='partners' then 'team'||(p_seat%2) else 'p'||p_seat end;
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+v_points+case when v_capicua then 25 else 0 end;
    v_closing_score:=coalesce((coalesce(v_state->'closing_scores',v_state->'scores')->>v_key)::int,0)+v_points+case when v_capicua then 25 else 0 end;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,array['closing_scores',v_key],to_jsonb(v_closing_score),true);
    v_state:=jsonb_set(v_state,'{phase}',to_jsonb(case when v_closing_score>=(v_state->>'target')::int then 'match-over' else 'round-over' end),true);
    v_state:=jsonb_set(v_state,'{next_starter}',to_jsonb(p_seat),true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{message}',to_jsonb('Mano terminada: '||v_points||case when v_capicua then ' + 25 de capicúa' else '' end),true);
  else
    if v_is_opening then
      v_pending:=jsonb_build_object('owner',p_seat,'next',(p_seat+1)%4,'awarded',false,'amount',v_opening_bonus,'label','Pase de salida');
      v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}',v_pending,true);
    else
      v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    end if;
    v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb((p_seat+1)%4),true);
    v_state:=jsonb_set(v_state,'{message}',to_jsonb(v_msg),true);
  end if;

  update public.casino_rooms r
  set game_state=v_state,state_version=r.state_version+1,updated_at=now()
  where r.id=p_room_id;
end;
$$;

create or replace function public.domino_apply_pass(p_room_id uuid,p_seat integer)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_state jsonb;
  v_hand jsonb;
  v_tile text;
  v_a int;
  v_b int;
  v_left int;
  v_right int;
  v_passes int;
  v_last int;
  v_next int;
  v_winner int;
  v_low int:=9999;
  v_total int;
  v_value int;
  v_i int;
  v_key text;
  v_score int;
  v_closing_score int;
  v_pending jsonb;
  v_owner int;
  v_bonus_amount int:=25;
  v_msg text:='Jugador pasa';
  v_chain jsonb;
  v_opening_required boolean;
  v_bonus jsonb;
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
    v_bonus_amount:=coalesce((v_pending->>'amount')::int,25);
    v_bonus:=public.domino_try_add_nonclosing_bonus(v_state,v_owner,v_bonus_amount);
    v_state:=v_bonus->'state';

    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    if coalesce((v_bonus->>'applied')::boolean,false) then
      v_msg:='Jugador pasa · Pase de salida: +'||v_bonus_amount||' no cerrables';
    else
      v_msg:='Jugador pasa · Pase de salida descartado por sobrepaso';
    end if;
  else
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
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
end;
$$;

revoke all on function public.domino_try_add_nonclosing_bonus(jsonb,integer,integer),public.domino_apply_play(uuid,integer,text,text,boolean),public.domino_apply_pass(uuid,integer) from public,anon;
notify pgrst,'reload schema';
