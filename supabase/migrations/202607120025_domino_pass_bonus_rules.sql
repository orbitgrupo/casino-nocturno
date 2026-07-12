-- Dominó: bono de pase inmediato y pase redondo sin cerrar la partida.
-- - Si un jugador coloca ficha y el siguiente pasa: +25 al jugador que colocó.
-- - Si el jugador siguiente también pasa: esos 25 se anulan.
-- - Pase redondo sigue valiendo 25 si el trancador puede jugar al volver su turno.
-- - Pase inmediato y pase redondo no cuentan para llegar a la meta final.
-- - Capicúa sí cuenta para cerrar la partida.

create or replace function public.start_online_domino(p_room_id uuid,p_mode text default 'partners',p_target integer default 100) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_tiles text[]:='{}';v_tmp text;v_i int;v_j int;v_profile uuid;v_round int:=1;
  v_scores jsonb:='{"team0":0,"team1":0,"p0":0,"p1":0,"p2":0,"p3":0}';
  v_closing_scores jsonb:='{"team0":0,"team1":0,"p0":0,"p1":0,"p2":0,"p3":0}';
  v_starter int;v_old jsonb;v_lineup jsonb;v_value text;v_hand jsonb;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  if p_mode not in('partners','pintintin') or p_target not between 25 and 1000 then raise exception 'Invalid configuration';end if;
  select r.game_state,r.domino_lineup into v_old,v_lineup from public.casino_rooms r where r.id=p_room_id for update;
  if jsonb_array_length(coalesce(v_lineup,'[]'::jsonb))<>4 then raise exception 'Assign the four table places first';end if;
  if v_old->>'phase'='round-over' then
    v_round:=coalesce((v_old->>'round')::int,0)+1;
    v_scores:=coalesce(v_old->'scores',v_scores);
    v_closing_scores:=coalesce(v_old->'closing_scores',v_scores);
    v_starter:=(v_old->>'next_starter')::int;
  end if;
  for v_i in 0..6 loop for v_j in v_i..6 loop v_tiles:=array_append(v_tiles,v_i||'-'||v_j);end loop;end loop;
  for v_i in reverse array_length(v_tiles,1)..2 loop
    v_j:=1+floor(random()*v_i)::int;v_tmp:=v_tiles[v_i];v_tiles[v_i]:=v_tiles[v_j];v_tiles[v_j]:=v_tmp;
  end loop;
  delete from public.casino_domino_hands h where h.room_id=p_room_id;
  delete from public.casino_domino_bot_hands b where b.room_id=p_room_id;
  for v_i in 0..3 loop
    v_value:=v_lineup->>v_i;v_hand:=to_jsonb(v_tiles[v_i*7+1:v_i*7+7]);
    if upper(v_value)='BOT' then
      insert into public.casino_domino_bot_hands(room_id,seat,tiles) values(p_room_id,v_i,v_hand);
    else
      select m.profile_id into v_profile from public.casino_room_members m where m.room_id=p_room_id and m.user_id=v_value::uuid and m.seat=v_i;
      if v_profile is null then raise exception 'A selected player is unavailable';end if;
      insert into public.casino_domino_hands(room_id,profile_id,seat,tiles) values(p_room_id,v_profile,v_i,v_hand);
    end if;
    if v_round=1 and '6-6'=any(v_tiles[v_i*7+1:v_i*7+7]) then v_starter:=v_i;end if;
  end loop;
  update public.casino_rooms r set game_state=jsonb_build_object(
    'kind','domino','phase','playing','mode',p_mode,'target',p_target,'round',v_round,
    'scores',v_scores,'closing_scores',v_closing_scores,
    'chain','[]'::jsonb,'left',null,'right',null,'current_seat',v_starter,'last_player',null,
    'passes',0,'pending_all_pass',null,'pending_single_pass_bonus',null,
    'opening_required',v_round=1,'next_starter',v_starter,'message','Comienza la mano'
  ),state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

create or replace function public.domino_apply_play(p_room_id uuid,p_seat integer,p_tile text,p_end text,p_bot boolean) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_hand jsonb;v_state jsonb;v_a int:=split_part(p_tile,'-',1)::int;v_b int:=split_part(p_tile,'-',2)::int;
  v_left int;v_right int;v_chain jsonb;v_pa int;v_pb int;v_remaining int;v_points int;
  v_key text;v_score int;v_closing_score int;v_capicua boolean:=false;v_pending jsonb;v_msg text;
begin
  select r.game_state into v_state from public.casino_rooms r where r.id=p_room_id for update;
  v_hand:=public.domino_hand_at_seat(p_room_id,p_seat);
  if v_state->>'phase'<>'playing' or p_seat<>(v_state->>'current_seat')::int then raise exception 'Not this seat turn';end if;
  if not v_hand ? p_tile then raise exception 'Tile not in hand';end if;
  v_chain:=v_state->'chain';v_msg:=case when p_bot then 'BOT jugó una ficha' else 'Ficha jugada' end;

  -- Si había un bono de pase inmediato esperando y ahora alguien juega, el bono queda confirmado.
  v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);

  -- Si regresa el turno al trancador luego de hacer pasar a todos y puede jugar, gana 25 no cerrables.
  if coalesce(v_state->>'pending_all_pass','')<>'' and (v_state->>'pending_all_pass')::int=p_seat then
    v_key:=case when v_state->>'mode'='partners' then 'team'||(p_seat%2) else 'p'||p_seat end;
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+25;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,'{pending_all_pass}','null'::jsonb,true);
    v_msg:=v_msg||' · Pase a todos: +25 no cerrables';
  end if;

  if jsonb_array_length(v_chain)=0 then
    if coalesce((v_state->>'opening_required')::boolean,false) and p_tile<>'6-6' then raise exception 'The first hand must open with double six';end if;
    v_pa:=v_a;v_pb:=v_b;v_left:=v_pa;v_right:=v_pb;v_chain:=jsonb_build_array(v_pa||'-'||v_pb);
  else
    v_left:=(v_state->>'left')::int;v_right:=(v_state->>'right')::int;
    v_capicua:=jsonb_array_length(v_hand)=1 and v_a<>v_b and (v_a=v_left or v_b=v_left) and (v_a=v_right or v_b=v_right);
    if p_end='left' and (v_a=v_left or v_b=v_left) then
      if v_b=v_left then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;
      v_left:=v_pa;v_chain:=jsonb_build_array(v_pa||'-'||v_pb)||v_chain;
    elsif p_end='right' and (v_a=v_right or v_b=v_right) then
      if v_a=v_right then v_pa:=v_a;v_pb:=v_b;else v_pa:=v_b;v_pb:=v_a;end if;
      v_right:=v_pb;v_chain:=v_chain||jsonb_build_array(v_pa||'-'||v_pb);
    else
      raise exception 'Tile does not fit that end';
    end if;
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_hand from jsonb_array_elements(v_hand) where value#>>'{}'<>p_tile;
  if p_bot then
    update public.casino_domino_bot_hands b set tiles=v_hand where b.room_id=p_room_id and b.seat=p_seat;
  else
    update public.casino_domino_hands h set tiles=v_hand where h.room_id=p_room_id and h.seat=p_seat;
  end if;

  v_remaining:=jsonb_array_length(v_hand);
  v_state:=jsonb_set(v_state,'{chain}',v_chain);
  v_state:=jsonb_set(v_state,'{left}',to_jsonb(v_left));
  v_state:=jsonb_set(v_state,'{right}',to_jsonb(v_right));
  v_state:=jsonb_set(v_state,'{last_player}',to_jsonb(p_seat));
  v_state:=jsonb_set(v_state,'{passes}','0');

  if v_remaining=0 then
    v_points:=public.domino_total_table_pips(p_room_id);
    v_key:=case when v_state->>'mode'='partners' then 'team'||(p_seat%2) else 'p'||p_seat end;
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)+v_points+case when v_capicua then 25 else 0 end;
    v_closing_score:=coalesce((coalesce(v_state->'closing_scores',v_state->'scores')->>v_key)::int,0)+v_points+case when v_capicua then 25 else 0 end;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,array['closing_scores',v_key],to_jsonb(v_closing_score),true);
    v_state:=jsonb_set(v_state,'{phase}',to_jsonb(case when v_closing_score>=(v_state->>'target')::int then 'match-over' else 'round-over' end));
    v_state:=jsonb_set(v_state,'{next_starter}',to_jsonb(p_seat));
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{message}',to_jsonb('Mano terminada: '||v_points||case when v_capicua then ' + 25 de capicúa' else '' end));
  else
    v_pending:=jsonb_build_object('owner',p_seat,'next',(p_seat+1)%4,'awarded',false,'cancel',(p_seat+2)%4);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}',v_pending,true);
    v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb((p_seat+1)%4));
    v_state:=jsonb_set(v_state,'{message}',to_jsonb(v_msg));
  end if;
  update public.casino_rooms r set game_state=v_state,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

create or replace function public.domino_apply_pass(p_room_id uuid,p_seat integer) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_state jsonb;v_hand jsonb;v_tile text;v_a int;v_b int;v_left int;v_right int;v_passes int;
  v_last int;v_next int;v_winner int;v_low int:=9999;v_total int;v_value int;v_i int;
  v_key text;v_score int;v_closing_score int;v_pending jsonb;v_owner int;v_msg text:='Jugador pasa';
begin
  select r.game_state into v_state from public.casino_rooms r where r.id=p_room_id for update;
  v_hand:=public.domino_hand_at_seat(p_room_id,p_seat);
  if p_seat<>(v_state->>'current_seat')::int then raise exception 'Not this seat turn';end if;
  v_left:=(v_state->>'left')::int;v_right:=(v_state->>'right')::int;
  for v_tile in select jsonb_array_elements_text(v_hand) loop
    v_a:=split_part(v_tile,'-',1)::int;v_b:=split_part(v_tile,'-',2)::int;
    if v_a in(v_left,v_right) or v_b in(v_left,v_right) then raise exception 'Seat has a playable tile';end if;
  end loop;

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
    v_score:=coalesce((v_state->'scores'->>v_key)::int,0)-25;
    v_state:=jsonb_set(v_state,array['scores',v_key],to_jsonb(v_score),true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_msg:='Jugador pasa · Se anula el pase inmediato';
  end if;

  v_passes:=coalesce((v_state->>'passes')::int,0)+1;
  if v_passes<4 then
    v_state:=jsonb_set(v_state,'{passes}',to_jsonb(v_passes));
    v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb((p_seat+1)%4));
    if v_passes=3 and (p_seat+1)%4=(v_state->>'last_player')::int then
      v_state:=jsonb_set(v_state,'{pending_all_pass}',to_jsonb((v_state->>'last_player')::int),true);
      v_msg:=v_msg||' · si el trancador puede jugar ahora gana pase redondo';
    end if;
    v_state:=jsonb_set(v_state,'{message}',to_jsonb(v_msg));
  else
    v_state:=jsonb_set(v_state,'{pending_all_pass}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{pending_single_pass_bonus}','null'::jsonb,true);
    v_last:=(v_state->>'last_player')::int;
    if v_state->>'mode'='pintintin' then
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
    v_state:=jsonb_set(v_state,'{phase}',to_jsonb(case when v_closing_score>=(v_state->>'target')::int then 'match-over' else 'round-over' end));
    v_state:=jsonb_set(v_state,'{next_starter}',to_jsonb(v_winner));
    v_state:=jsonb_set(v_state,'{message}',to_jsonb('Tranca: '||v_total||' puntos'));
  end if;
  update public.casino_rooms r set game_state=v_state,state_version=r.state_version+1,updated_at=now() where r.id=p_room_id;
end;$$;

revoke all on function public.domino_apply_play(uuid,integer,text,text,boolean),public.domino_apply_pass(uuid,integer) from public,anon;
notify pgrst,'reload schema';
