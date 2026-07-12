(function(){'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const SUIT={S:{symbol:'♠',color:'black'},H:{symbol:'♥',color:'red'},D:{symbol:'♦',color:'red'},C:{symbol:'♣',color:'black'}};
let ctx=null,busy=false;

function cardValue(rank){return rank==='A'?11:(['J','Q','K'].includes(rank)?10:Number(rank));}
function scoreOf(cards){let total=0,aces=0;cards.forEach(value=>{const rank=value.split('-')[0];total+=cardValue(rank);if(rank==='A')aces++;});while(total>21&&aces>0){total-=10;aces--;}return total;}

function cardEl(value,hidden,index){
  const el=document.createElement('div');
  el.className=`playing-card mini-card ${hidden?'face-down':'face-up'}`;
  el.style.setProperty('--delay',`${index*70}ms`);
  if(hidden){el.innerHTML='<div class="card-inner"><div class="card-face card-back"><span>21</span></div></div>';return el;}
  const [rank,suitKey]=value.split('-'),suit=SUIT[suitKey]||SUIT.S;
  el.setAttribute('aria-label',`${rank} de ${suitKey}`);
  el.innerHTML=`<div class="card-inner"><div class="card-face card-back"><span>21</span></div><div class="card-face card-front ${suit.color}"><div class="corner top"><b>${rank}</b><span>${suit.symbol}</span></div><span class="suit-center">${suit.symbol}</span><div class="corner bottom"><b>${rank}</b><span>${suit.symbol}</span></div></div></div>`;
  return el;
}
function handEl(cards,hideLast){const f=document.createDocumentFragment();cards.forEach((value,index)=>f.appendChild(cardEl(value,hideLast&&index===cards.length-1,index)));return f;}
function seatPlacement(index,total){
  const spread=total<=1?0:(total===2?86:total===3?120:total===4?140:total===5?155:165);
  const angle=total<=1?90:90+spread/2-(spread*index/(total-1));
  const radians=angle*Math.PI/180,x=50+Math.cos(radians)*41,y=43+Math.sin(radians)*43,tilt=(90-angle)*0.09;
  return `--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%;--seat-tilt:${tilt.toFixed(2)}deg;--seat-order:${index};`;
}

async function call(name,params){
  if(busy)return;busy=true;
  try{await ctx.rpc(name,params);}
  catch(e){const status=$('status');status.textContent=e.message||String(e);status.className='status error';}
  finally{busy=false;}
}

function hideLocalOnlyControls(){
  const add=$('openAddPlayer'),reset=$('resetTableBtn'),dealerActions=document.querySelector('.dealer-actions'),dealerMode=$('dealerMode');
  if(add)add.hidden=true;
  if(reset)reset.hidden=true;
  if(dealerActions)dealerActions.hidden=true;
  if(dealerMode)dealerMode.disabled=true;
  const badge=document.querySelector('.room-badge strong');
  if(badge)badge.textContent=ctx.host?'SALA ONLINE · ANFITRIÓN':'SALA ONLINE · JUGADOR';
}

function render(){
  if(!ctx)return;
  document.body.classList.add('blackjack-online-active');
  hideLocalOnlyControls();
  const s=ctx.room.game_state||{},started=s.kind==='blackjack';
  const seated=ctx.members.filter(m=>m.seat!==null).sort((a,b)=>a.seat-b.seat);
  const me=ctx.members.find(m=>m.user_id===ctx.user.id);
  const dealerCards=s.dealer_cards||[];

  $('dealerHand').replaceChildren(handEl(dealerCards,!!s.dealer_hole_hidden));
  $('dealerScore').textContent=dealerCards.length?(s.dealer_hole_hidden?'?':scoreOf(dealerCards)):'—';
  $('playerCount').textContent=`${seated.length} / 6`;

  $('roster').replaceChildren(...seated.map(member=>{
    const row=document.createElement('div');row.className='roster-row';
    row.innerHTML=`<span class="avatar human">${esc(member.display_name.charAt(0).toUpperCase())}</span><span><strong>${esc(member.display_name)}</strong><small>ASIENTO ${member.seat+1} · ${Number(member.credits).toLocaleString('es-ES')} puntos</small></span>`;
    return row;
  }));

  $('seats').replaceChildren(...seated.map((member,index)=>{
    const p=started?s.players?.[String(member.seat)]:null,cards=p?.cards||[],status=p?.status;
    const outcomeClass=status==='bust'?'lose':status==='blackjack'?'blackjack':p?.result==='win'?'win':p?.result==='lose'?'lose':p?.result==='blackjack'?'blackjack':'';
    const seat=document.createElement('article');
    seat.className=`player-seat ${started&&s.phase==='playing'&&s.current_seat===member.seat?'active-seat':''} ${outcomeClass}`;
    seat.style.cssText=seatPlacement(index,seated.length);
    const label=status==='sitting-out'?'SIN CRÉDITO ESTA RONDA':status==='bust'?'SE PASÓ':status==='blackjack'?'¡BLACKJACK!':status==='surrender'?'SE RINDIÓ':p?.result==='win'?'GANÓ LA RONDA':p?.result==='push'?'EMPATE':p?.result==='lose'?'PERDIÓ':'';
    seat.innerHTML=`<header><span class="avatar">${esc(member.display_name.charAt(0).toUpperCase())}</span><span><strong>${esc(member.display_name)}</strong><small>${Number(member.credits).toLocaleString('es-ES')} puntos</small></span><output>${cards.length?scoreOf(cards):'—'}</output></header><div class="seat-play-zone"><div class="seat-cards"></div></div><footer>${label}</footer>`;
    const seatCards=seat.querySelector('.seat-cards');
    seatCards.appendChild(handEl(cards,false));
    seatCards.querySelectorAll('.mini-card').forEach((card,cardIndex)=>{
      const midpoint=(cards.length-1)/2;
      card.style.setProperty('--fan-angle',`${(cardIndex-midpoint)*7}deg`);
      card.style.setProperty('--fan-lift',`${Math.abs(cardIndex-midpoint)*2}px`);
    });
    return seat;
  }));

  const myEntry=me&&started?s.players?.[String(me.seat)]:null;
  const myTurn=!!(started&&s.phase==='playing'&&me&&Number(s.current_seat)===Number(me.seat));
  const turnMember=started&&s.current_seat!==null&&s.current_seat!==undefined?seated.find(x=>x.seat===Number(s.current_seat)):null;
  $('turnName').textContent=started?(s.phase==='playing'?(myTurn?'¡Tu turno!':turnMember?`Turno de ${turnMember.display_name}`:'Esperando turno'):(s.phase==='round-over'?'Ronda terminada':'—')):'Esperando ronda';
  const status=$('status');
  status.textContent=s.message||(ctx.host?'Reparte una ronda para todos los jugadores sentados.':'Esperando a que el anfitrión reparta.');
  status.className='status';

  $('hitBtn').disabled=!myTurn;
  $('standBtn').disabled=!myTurn;
  $('surrenderBtn').disabled=!myTurn||(myEntry?.cards?.length!==2);
  $('dealBtn').hidden=!ctx.host||(started&&s.phase==='playing');
  $('dealBtn').textContent=started&&s.phase==='round-over'?'REPARTIR NUEVA RONDA':'REPARTIR CARTAS';
  $('dealBtn').disabled=!ctx.host||!seated.length;
  $('tableBet').disabled=started&&s.phase==='playing';
  $('newRoundBtn').hidden=true;
}

function activate(detail){
  if(detail.room?.game_type!=='blackjack'||detail.room?.status!=='active'){deactivate();return;}
  ctx=detail;render();
}
function deactivate(){
  if(!ctx)return;ctx=null;
  document.body.classList.remove('blackjack-online-active');
  const add=$('openAddPlayer'),reset=$('resetTableBtn'),dealerActions=document.querySelector('.dealer-actions'),dealerMode=$('dealerMode');
  if(add)add.hidden=false;
  if(reset)reset.hidden=false;
  if(dealerActions)dealerActions.hidden=false;
  if(dealerMode)dealerMode.disabled=false;
}

// Intercepta los clics en fase de captura para que, en modo online, la mesa
// no ejecute la lógica local de ui.js y en su lugar llame a las RPC compartidas.
document.addEventListener('click',event=>{
  if(!ctx)return;
  const button=event.target.closest('#dealBtn,#hitBtn,#standBtn,#surrenderBtn,#newRoundBtn');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(button.id==='dealBtn')call('start_online_blackjack',{p_room_id:ctx.room.id,p_bet:Math.max(10,Math.floor(Number($('tableBet').value)||50))});
  if(button.id==='hitBtn')call('hit_online_blackjack',{p_room_id:ctx.room.id});
  if(button.id==='standBtn')call('stand_online_blackjack',{p_room_id:ctx.room.id});
  if(button.id==='surrenderBtn')call('surrender_online_blackjack',{p_room_id:ctx.room.id});
},true);

window.addEventListener('casino:online-room',e=>activate(e.detail));
if(window.CasinoOnlineRoom)activate(window.CasinoOnlineRoom);
})();
