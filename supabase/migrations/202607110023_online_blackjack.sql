-- Blackjack en línea: todos los jugadores sentados en la sala comparten la misma mesa,
-- el mismo mazo y el mismo turno en tiempo real (vía game_state + Supabase Realtime).

create table if not exists public.casino_blackjack_decks(
  room_id uuid primary key references public.casino_rooms(id) on delete cascade,
  deck jsonb not null default '[]',
  dealer_hole text
);
alter table public.casino_blackjack_decks enable row level security;
revoke all on public.casino_blackjack_decks from anon,authenticated;

create or replace function public.blackjack_card_value(p_rank text) returns integer
language sql immutable as $$
  select case when p_rank='A' then 11 when p_rank in ('J','Q','K') then 10 else p_rank::int end;
$$;

create or replace function public.blackjack_score(p_cards jsonb) returns integer
language plpgsql immutable as $$
declare v_total int:=0;v_aces int:=0;v_card text;v_rank text;
begin
  for v_card in select jsonb_array_elements_text(p_cards) loop
    v_rank:=split_part(v_card,'-',1);
    v_total:=v_total+public.blackjack_card_value(v_rank);
    if v_rank='A' then v_aces:=v_aces+1; end if;
  end loop;
  while v_total>21 and v_aces>0 loop v_total:=v_total-10;v_aces:=v_aces-1; end loop;
  return v_total;
end;$$;

-- Termina la ronda: revela la carta oculta del dealer, el dealer pide hasta 17+,
-- calcula pagos y acredita los puntos de cada jugador sentado.
create or replace function public.blackjack_finish_round(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_state jsonb;v_deck jsonb;v_hole text;v_dealer_cards jsonb;v_dealer_score int;
  v_pkey text;v_player jsonb;v_status text;v_score int;v_bet int;v_payout int;v_result text;
  v_member public.casino_room_members%rowtype;v_natural_dealer boolean;
begin
  select game_state into v_state from public.casino_rooms where id=p_room_id for update;
  select deck,dealer_hole into v_deck,v_hole from public.casino_blackjack_decks where room_id=p_room_id for update;
  v_dealer_cards:=(v_state->'dealer_cards')||jsonb_build_array(v_hole);
  v_dealer_score:=public.blackjack_score(v_dealer_cards);
  v_natural_dealer:=jsonb_array_length(v_dealer_cards)=2 and v_dealer_score=21;
  while v_dealer_score<17 and jsonb_array_length(v_deck)>0 loop
    v_dealer_cards:=v_dealer_cards||jsonb_build_array(v_deck->>0);
    v_deck:=v_deck-0;
    v_dealer_score:=public.blackjack_score(v_dealer_cards);
  end loop;
  v_bet:=(v_state->>'bet')::int;
  for v_pkey in select jsonb_object_keys(v_state->'players') loop
    v_player:=v_state->'players'->v_pkey;
    v_status:=v_player->>'status';
    if v_status in ('sitting-out','surrender') then continue; end if;
    v_score:=public.blackjack_score(v_player->'cards');
    if v_status='bust' then v_payout:=0;v_result:='lose';
    elsif v_score=21 and jsonb_array_length(v_player->'cards')=2 and v_natural_dealer then v_payout:=v_bet;v_result:='push';
    elsif v_score=21 and jsonb_array_length(v_player->'cards')=2 then v_payout:=(v_bet*5)/2;v_result:='blackjack';
    elsif v_dealer_score>21 then v_payout:=v_bet*2;v_result:='win';
    elsif v_score>v_dealer_score then v_payout:=v_bet*2;v_result:='win';
    elsif v_score<v_dealer_score then v_payout:=0;v_result:='lose';
    else v_payout:=v_bet;v_result:='push';
    end if;
    v_player:=jsonb_set(v_player,'{result}',to_jsonb(v_result));
    v_player:=jsonb_set(v_player,'{payout}',to_jsonb(v_payout));
    v_state:=jsonb_set(v_state,array['players',v_pkey],v_player);
    if v_payout>0 then
      select * into v_member from public.casino_room_members where room_id=p_room_id and seat=v_pkey::int;
      if found then update public.casino_room_members set credits=credits+v_payout where room_id=p_room_id and user_id=v_member.user_id; end if;
    end if;
  end loop;
  update public.casino_blackjack_decks set deck=v_deck,dealer_hole=null where room_id=p_room_id;
  v_state:=jsonb_set(v_state,'{dealer_cards}',v_dealer_cards);
  v_state:=jsonb_set(v_state,'{dealer_hole_hidden}','false'::jsonb);
  v_state:=jsonb_set(v_state,'{phase}',to_jsonb('round-over'::text));
  v_state:=jsonb_set(v_state,'{current_seat}','null'::jsonb);
  v_state:=jsonb_set(v_state,'{message}',to_jsonb('Ronda terminada · Dealer '||v_dealer_score));
  update public.casino_rooms set game_state=v_state,state_version=state_version+1,updated_at=now() where id=p_room_id;
end;$$;

-- Pasa el turno al siguiente asiento que siga "playing"; si no queda ninguno, cierra la ronda.
create or replace function public.blackjack_advance_turn(p_room_id uuid,p_finished_seat int) returns void
language plpgsql security definer set search_path=public as $$
declare v_state jsonb;v_order int[];v_next int;v_seat int;v_started boolean:=false;
begin
  select game_state into v_state from public.casino_rooms where id=p_room_id for update;
  select array(select jsonb_array_elements_text(v_state->'turn_order')::int) into v_order;
  foreach v_seat in array v_order loop
    if v_started and (v_state->'players'->v_seat::text->>'status')='playing' then v_next:=v_seat;exit;end if;
    if v_seat=p_finished_seat then v_started:=true;end if;
  end loop;
  if v_next is null then
    foreach v_seat in array v_order loop
      if (v_state->'players'->v_seat::text->>'status')='playing' then v_next:=v_seat;exit;end if;
    end loop;
  end if;
  if v_next is not null then
    v_state:=jsonb_set(v_state,'{current_seat}',to_jsonb(v_next));
    v_state:=jsonb_set(v_state,'{message}',to_jsonb('Turno del asiento '||(v_next+1)));
    update public.casino_rooms set game_state=v_state,state_version=state_version+1,updated_at=now() where id=p_room_id;
  else
    perform public.blackjack_finish_round(p_room_id);
  end if;
end;$$;

-- El anfitrión reparte una ronda nueva a todos los jugadores sentados con crédito suficiente.
create or replace function public.start_online_blackjack(p_room_id uuid,p_bet integer default 50) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_suits text[]:=array['S','H','D','C'];v_ranks text[]:=array['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  v_deck text[]:='{}';v_tmp text;v_i int;v_j int;v_s text;v_r text;v_member public.casino_room_members%rowtype;
  v_players jsonb:='{}'::jsonb;v_order int[]:='{}';v_dealer_up text;v_dealer_hole text;v_room public.casino_rooms%rowtype;
  v_cards jsonb;v_score int;v_status text;v_first int;
begin
  if not public.is_casino_room_host(p_room_id) then raise exception 'Host only';end if;
  select * into v_room from public.casino_rooms where id=p_room_id for update;
  if v_room.game_type<>'blackjack' then raise exception 'Invalid room';end if;
  if p_bet not between 10 and 100000 then raise exception 'Invalid bet';end if;
  if not exists(select 1 from public.casino_room_members where room_id=p_room_id and seat is not null) then raise exception 'At least one seated player is required';end if;

  foreach v_s in array v_suits loop foreach v_r in array v_ranks loop
    v_deck:=array_append(v_deck,v_r||'-'||v_s);v_deck:=array_append(v_deck,v_r||'-'||v_s);
  end loop;end loop;
  for v_i in reverse array_length(v_deck,1)..2 loop
    v_j:=1+floor(random()*v_i)::int;v_tmp:=v_deck[v_i];v_deck[v_i]:=v_deck[v_j];v_deck[v_j]:=v_tmp;
  end loop;

  for v_member in select * from public.casino_room_members where room_id=p_room_id and seat is not null order by seat loop
    if v_member.credits>=p_bet then
      update public.casino_room_members set credits=credits-p_bet where room_id=p_room_id and user_id=v_member.user_id;
      v_cards:=jsonb_build_array(v_deck[array_length(v_deck,1)],v_deck[array_length(v_deck,1)-1]);
      v_deck:=v_deck[1:array_length(v_deck,1)-2];
      v_score:=public.blackjack_score(v_cards);
      v_status:=case when v_score=21 then 'stand' else 'playing' end;
      v_players:=v_players||jsonb_build_object(v_member.seat::text,jsonb_build_object('cards',v_cards,'status',v_status,'result',null,'payout',0));
    else
      v_players:=v_players||jsonb_build_object(v_member.seat::text,jsonb_build_object('cards','[]'::jsonb,'status','sitting-out','result',null,'payout',0));
    end if;
  end loop;
  -- orden de turnos = asientos que quedaron en "playing" (los naturales de 21 o sin crédito no juegan turno)
  for v_i in 0..7 loop
    if v_players ? v_i::text and (v_players->v_i::text->>'status')='playing' then v_order:=array_append(v_order,v_i);end if;
  end loop;

  v_dealer_up:=v_deck[array_length(v_deck,1)];v_dealer_hole:=v_deck[array_length(v_deck,1)-1];
  v_deck:=v_deck[1:array_length(v_deck,1)-2];
  insert into public.casino_blackjack_decks(room_id,deck,dealer_hole) values(p_room_id,to_jsonb(v_deck),v_dealer_hole)
  on conflict(room_id) do update set deck=excluded.deck,dealer_hole=excluded.dealer_hole;

  v_first:=v_order[1];
  update public.casino_rooms set game_state=jsonb_build_object(
    'kind','blackjack','phase','playing','bet',p_bet,
    'dealer_cards',jsonb_build_array(v_dealer_up),'dealer_hole_hidden',true,
    'turn_order',to_jsonb(v_order),'current_seat',v_first,
    'players',v_players,'message','Nueva ronda repartida'
  ),state_version=state_version+1,updated_at=now() where id=p_room_id;

  if v_first is null then perform public.blackjack_finish_round(p_room_id);end if;
end;$$;

create or replace function public.hit_online_blackjack(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_profile uuid:=public.current_casino_profile_id();v_seat int;v_state jsonb;v_deck jsonb;v_card text;v_pkey text;v_player jsonb;v_cards jsonb;v_score int;
begin
  select seat into v_seat from public.casino_room_members where room_id=p_room_id and profile_id=v_profile;
  if v_seat is null then raise exception 'Not seated';end if;
  select game_state into v_state from public.casino_rooms where id=p_room_id for update;
  if v_state->>'kind'<>'blackjack' or v_state->>'phase'<>'playing' then raise exception 'Game unavailable';end if;
  if coalesce((v_state->>'current_seat')::int,-1)<>v_seat then raise exception 'Not your turn';end if;
  select deck into v_deck from public.casino_blackjack_decks where room_id=p_room_id for update;
  if jsonb_array_length(v_deck)=0 then raise exception 'Deck exhausted';end if;
  v_card:=v_deck->>0;v_deck:=v_deck-0;
  update public.casino_blackjack_decks set deck=v_deck where room_id=p_room_id;
  v_pkey:=v_seat::text;v_player:=v_state->'players'->v_pkey;
  v_cards:=(v_player->'cards')||jsonb_build_array(v_card);
  v_score:=public.blackjack_score(v_cards);
  v_player:=jsonb_set(v_player,'{cards}',v_cards);
  if v_score>=21 then v_player:=jsonb_set(v_player,'{status}',to_jsonb(case when v_score>21 then 'bust' else 'stand' end));end if;
  v_state:=jsonb_set(v_state,array['players',v_pkey],v_player);
  update public.casino_rooms set game_state=v_state,state_version=state_version+1,updated_at=now() where id=p_room_id;
  if v_score>=21 then perform public.blackjack_advance_turn(p_room_id,v_seat);end if;
end;$$;

create or replace function public.stand_online_blackjack(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_profile uuid:=public.current_casino_profile_id();v_seat int;v_state jsonb;v_pkey text;v_player jsonb;
begin
  select seat into v_seat from public.casino_room_members where room_id=p_room_id and profile_id=v_profile;
  if v_seat is null then raise exception 'Not seated';end if;
  select game_state into v_state from public.casino_rooms where id=p_room_id for update;
  if v_state->>'kind'<>'blackjack' or v_state->>'phase'<>'playing' then raise exception 'Game unavailable';end if;
  if coalesce((v_state->>'current_seat')::int,-1)<>v_seat then raise exception 'Not your turn';end if;
  v_pkey:=v_seat::text;v_player:=jsonb_set(v_state->'players'->v_pkey,'{status}',to_jsonb('stand'::text));
  v_state:=jsonb_set(v_state,array['players',v_pkey],v_player);
  update public.casino_rooms set game_state=v_state,state_version=state_version+1,updated_at=now() where id=p_room_id;
  perform public.blackjack_advance_turn(p_room_id,v_seat);
end;$$;

create or replace function public.surrender_online_blackjack(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_profile uuid:=public.current_casino_profile_id();v_seat int;v_state jsonb;v_pkey text;v_player jsonb;v_bet int;v_member public.casino_room_members%rowtype;
begin
  select seat into v_seat from public.casino_room_members where room_id=p_room_id and profile_id=v_profile;
  if v_seat is null then raise exception 'Not seated';end if;
  select game_state into v_state from public.casino_rooms where id=p_room_id for update;
  if v_state->>'kind'<>'blackjack' or v_state->>'phase'<>'playing' then raise exception 'Game unavailable';end if;
  if coalesce((v_state->>'current_seat')::int,-1)<>v_seat then raise exception 'Not your turn';end if;
  v_pkey:=v_seat::text;v_player:=v_state->'players'->v_pkey;
  if jsonb_array_length(v_player->'cards')<>2 then raise exception 'Too late to surrender';end if;
  v_bet:=(v_state->>'bet')::int;
  v_player:=jsonb_set(v_player,'{status}',to_jsonb('surrender'::text));
  v_player:=jsonb_set(v_player,'{result}',to_jsonb('surrender'::text));
  v_player:=jsonb_set(v_player,'{payout}',to_jsonb(v_bet/2));
  v_state:=jsonb_set(v_state,array['players',v_pkey],v_player);
  update public.casino_rooms set game_state=v_state,state_version=state_version+1,updated_at=now() where id=p_room_id;
  select * into v_member from public.casino_room_members where room_id=p_room_id and seat=v_seat;
  if found then update public.casino_room_members set credits=credits+(v_bet/2) where room_id=p_room_id and user_id=v_member.user_id;end if;
  perform public.blackjack_advance_turn(p_room_id,v_seat);
end;$$;

revoke all on function public.blackjack_card_value(text),public.blackjack_score(jsonb),public.blackjack_finish_round(uuid),public.blackjack_advance_turn(uuid,int),public.start_online_blackjack(uuid,integer),public.hit_online_blackjack(uuid),public.stand_online_blackjack(uuid),public.surrender_online_blackjack(uuid) from public;
grant execute on function public.start_online_blackjack(uuid,integer),public.hit_online_blackjack(uuid),public.stand_online_blackjack(uuid),public.surrender_online_blackjack(uuid) to authenticated;
notify pgrst,'reload schema';
