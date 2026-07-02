(function(){
  'use strict';
  const SUITS=[['spades','♠','black'],['hearts','♥','red'],['diamonds','♦','red'],['clubs','♣','black']];
  const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const RANK_VALUE={A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
  const $=id=>document.getElementById(id),KEY='casino.tresydos.v2',TURN_KEY='casino.tresydos.nextStarter.v1';
  let state={phase:'setup',players:[],deck:[],discard:[],current:0,pot:0,drawn:false,lockedCard:null,winner:null,claimable:[],sidePots:emptySidePots(),sideWinners:emptySideWinners()};
  let botTimer,config,nextStarter=Math.max(0,Math.min(4,Number(localStorage.getItem(TURN_KEY))||0));
  try{config=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem('casino.tresydos.v1')||'null')}catch(_){config=null}
  if(!Array.isArray(config)||config.length!==5)config=Array.from({length:5},(_,i)=>({name:i?`Bot ${i}`:'Jugador 1',type:i?'bot':'human',wallet:1000,side:false}));
  config=config.map((p,i)=>({name:String(p.name||`Jugador ${i+1}`),type:p.type==='human'?'human':'bot',wallet:Number.isFinite(Number(p.wallet))?Number(p.wallet):1000,side:p.side===true}));

  function emptySidePots(){return{threePairs:0,blackPair:0}}
  function emptySideWinners(){return{threePairs:null,blackPair:null}}
  function save(){localStorage.setItem(KEY,JSON.stringify(config))}
  function syncConfig(){config=state.players.map(({name,type,wallet,side})=>({name,type,wallet,side}));save()}
  function setup(){
    const box=$('participantSetup');
    box.replaceChildren(...config.map((p,i)=>{
      const row=document.createElement('div');row.className='participant-row';
      row.innerHTML=`<span>${i+1}</span><input maxlength="14"><select><option value="human">Persona</option><option value="bot">Bot</option></select><label class="side-entry" title="Participar en los tres premios secundarios"><input type="checkbox"><span>Premios</span></label>`;
      const name=row.querySelector('input[type="text"],input:not([type])'),type=row.querySelector('select'),side=row.querySelector('input[type="checkbox"]');
      name.value=p.name;type.value=p.type;side.checked=p.side;
      name.onchange=e=>{config[i].name=e.target.value.trim()||`Jugador ${i+1}`;save()};
      type.onchange=e=>{config[i].type=e.target.value;save()};
      side.onchange=e=>{config[i].side=e.target.checked;save()};
      return row;
    }));
  }
  function freshDeck(){const d=[];SUITS.forEach(([suit,symbol,color])=>RANKS.forEach(rank=>d.push({rank,suit,symbol,color,id:`${rank}-${suit}`})));for(let i=d.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]]}return d}
  function counts(hand){const out={};hand.forEach(c=>out[c.rank]=(out[c.rank]||0)+1);return out}
  function fullHouse(hand){return hand.length===5&&Object.values(counts(hand)).sort().join(',')==='2,3'}
  function threePairs(hand){return hand.length===6&&Object.values(counts(hand)).sort().join(',')==='2,2,2'}
  function highestPair(hand){const values=Object.entries(counts(hand)).filter(([,n])=>n===2).map(([rank])=>RANK_VALUE[rank]);return values.length?Math.max(...values):0}
  function highestBlackPair(hand){const byRank={};hand.forEach(c=>{if(c.suit==='spades'||c.suit==='clubs')(byRank[c.rank]||(byRank[c.rank]=new Set())).add(c.suit)});const values=Object.entries(byRank).filter(([,s])=>s.has('spades')&&s.has('clubs')).map(([r])=>RANK_VALUE[r]);return values.length?Math.max(...values):0}
  function rankName(value){return Object.keys(RANK_VALUE).find(r=>RANK_VALUE[r]===value)||''}

  function start(){
    const ante=Number($('ante').value),sideAnte=Number($('sideAnte').value);
    config.forEach(p=>p.wallet=Math.max(0,Number(p.wallet)||0));
    const active=config.filter(p=>p.wallet>=ante);if(active.length<2)return status('Se necesitan al menos dos participantes con saldo.');
    state={phase:'draw',players:config.map(p=>({...p,hand:[],outcome:p.wallet>=ante?'playing':'no-funds',sideActive:false})),deck:freshDeck(),discard:[],current:0,pot:active.length*ante,drawn:false,lockedCard:null,winner:null,claimable:[],sidePots:emptySidePots(),sideWinners:emptySideWinners(),sideAnte};
    state.players.forEach(p=>{if(p.outcome!=='playing')return;p.wallet-=ante;if(p.side&&p.wallet>=sideAnte*2){p.sideActive=true;p.wallet-=sideAnte*2;state.sidePots.threePairs+=sideAnte;state.sidePots.blackPair+=sideAnte}});
    for(let n=0;n<5;n++)state.players.filter(p=>p.outcome==='playing').forEach(p=>p.hand.push(state.deck.pop()));state.discard.push(state.deck.pop());
    awardInitialBlackPair();
    const initial=state.players.find(p=>p.outcome==='playing'&&fullHouse(p.hand));if(initial)return win(initial);
    advanceToActive((nextStarter-1+state.players.length)%state.players.length);render();scheduleBot();
  }
  function eligible(){return state.players.filter(p=>p.outcome==='playing'&&p.sideActive)}
  function awardInitialBlackPair(){const candidates=eligible().map(p=>({p,value:highestBlackPair(p.hand)})).filter(x=>x.value);if(!candidates.length)return;const high=Math.max(...candidates.map(x=>x.value));awardSide('blackPair',candidates.filter(x=>x.value===high).map(x=>x.p),`Par negro de ${rankName(high)}`)}
  function completesBlackPair(card,hand){if(card.suit!=='spades'&&card.suit!=='clubs')return false;const other=card.suit==='spades'?'clubs':'spades';return hand.some(c=>c.rank===card.rank&&c.suit===other)}
  function updateClaimable(player,source,drawnCard){state.claimable=[];if(!player.sideActive)return;if(!state.sideWinners.threePairs&&state.sidePots.threePairs&&threePairs(player.hand))state.claimable.push('threePairs');if(source==='stock'&&!state.sideWinners.blackPair&&state.sidePots.blackPair&&completesBlackPair(drawnCard,player.hand))state.claimable.push('blackPair')}
  function claimPrizes(player){if(!state.claimable.length)return false;const claims=[...state.claimable];claims.forEach(kind=>{if(kind==='threePairs')awardSide(kind,[player],'Tres pares');else{const value=highestBlackPair(player.hand);awardSide(kind,[player],`Par negro de ${rankName(value)}`)}});state.claimable=[];status(`${player.name} reclamó ${claims.map(k=>k==='threePairs'?'Tres Pares':'Par Negro').join(' y ')}.`);return true}
  function awardSide(kind,winners,label){if(state.sideWinners[kind]||!state.sidePots[kind])return;const amount=state.sidePots[kind],share=amount/winners.length;winners.forEach(p=>p.wallet+=share);state.sideWinners[kind]={names:winners.map(p=>p.name),label,amount};state.sidePots[kind]=0;syncConfig()}
  function refundSide(kind,label){const entrants=eligible();entrants.forEach(p=>p.wallet+=state.sideAnte);state.sideWinners[kind]={names:[],label,amount:0};state.sidePots[kind]=0;syncConfig()}
  function advanceToActive(from){for(let step=1;step<=state.players.length;step++){const i=(from+step)%state.players.length;if(state.players[i].outcome==='playing'){state.current=i;state.phase='draw';state.drawn=false;state.lockedCard=null;state.claimable=[];return}}}
  function replenish(){if(state.deck.length)return;const top=state.discard.pop();state.deck=state.discard.splice(0);for(let i=state.deck.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[state.deck[i],state.deck[j]]=[state.deck[j],state.deck[i]]}state.discard=[top]}
  function draw(source){if(state.phase!=='draw')return;replenish();const p=state.players[state.current],card=source==='discard'?state.discard.pop():state.deck.pop();p.hand.push(card);state.drawn=true;state.lockedCard=source==='discard'?card.id:null;state.phase='discard';updateClaimable(p,source,card);if(p.type==='bot')claimPrizes(p);render();scheduleBot()}
  function discard(index){if(state.phase!=='discard')return;const p=state.players[state.current],card=p.hand[index];if(card.id===state.lockedCard)return status('No puedes devolver la misma carta que tomaste del descarte.');state.discard.push(p.hand.splice(index,1)[0]);state.claimable=[];if(fullHouse(p.hand))return win(p);advanceToActive(state.current);render();scheduleBot()}
  function win(p){state.phase='resolved';state.winner=p.name;p.wallet+=state.pot;const winnerIndex=state.players.indexOf(p);nextStarter=(winnerIndex+1)%state.players.length;localStorage.setItem(TURN_KEY,String(nextStarter));refundUnclaimed();syncConfig();status(`¡${p.name} formó Tres y Dos y ganó ${state.pot} créditos! La próxima mano comienza ${state.players[nextStarter].name}.`);render()}
  function refundUnclaimed(){['threePairs','blackPair'].forEach(kind=>{if(!state.sideWinners[kind]&&state.sidePots[kind])refundSide(kind,'Sin ganador · devuelto')})}
  function botMove(){const p=state.players[state.current];if(p.type!=='bot'||state.phase==='resolved')return;if(state.phase==='draw'){const top=state.discard[state.discard.length-1],rankCounts=counts(p.hand);draw(rankCounts[top.rank]?'discard':'stock')}else{const rankCounts=counts(p.hand);const choices=p.hand.map((c,i)=>({i,c,count:rankCounts[c.rank]})).filter(x=>x.c.id!==state.lockedCard).sort((a,b)=>a.count-b.count||RANK_VALUE[a.c.rank]-RANK_VALUE[b.c.rank]);discard(choices[0].i)}}
  let dragFrom=null;
  function reorderHand(player,from,to){if(from===to||from<0||to<0)return;const [card]=player.hand.splice(from,1);player.hand.splice(to,0,card);render()}
  function sortCurrentHand(){const p=state.players[state.current];if(!p||p.type==='bot')return;const rankCounts=counts(p.hand);p.hand.sort((a,b)=>rankCounts[b.rank]-rankCounts[a.rank]||RANK_VALUE[b.rank]-RANK_VALUE[a.rank]||a.suit.localeCompare(b.suit));render()}
  function cardEl(c,hidden,index,owner){const el=document.createElement('button');el.className=`tyd-card ${hidden?'hidden-card':c.color}`;const currentHuman=owner===state.current&&state.players[owner]?.type==='human';el.disabled=hidden||!currentHuman;el.innerHTML=hidden?'<span>3+2</span>':`<b>${c.rank}</b><i>${c.symbol}</i>`;if(!hidden){el.onclick=()=>{if(state.phase==='discard')discard(index)};el.draggable=currentHuman&&state.phase!=='resolved';el.ondragstart=e=>{dragFrom=index;el.classList.add('dragging');e.dataTransfer.effectAllowed='move'};el.ondragover=e=>{if(currentHuman){e.preventDefault();e.dataTransfer.dropEffect='move'}};el.ondrop=e=>{e.preventDefault();if(currentHuman&&dragFrom!==null)reorderHand(state.players[owner],dragFrom,index)};el.ondragend=()=>{dragFrom=null;el.classList.remove('dragging')}}return el}
  function prizeText(kind){const w=state.sideWinners[kind];return w?(w.names.length?`${w.names.join(' / ')} · ${w.label}`:w.label):'Disponible'}
  function render(){
    clearTimeout(botTimer);$('pot').textContent=state.pot.toLocaleString('es-ES');$('stockCount').textContent=state.deck.length;
    ['threePairs','blackPair'].forEach(kind=>{$(`${kind}Prize`).textContent=(state.sideWinners[kind]?.amount||state.sidePots[kind]).toLocaleString('es-ES');$(`${kind}Winner`).textContent=prizeText(kind)});
    const top=state.discard[state.discard.length-1];$('discardCard').className=`pile ${top?top.color:'empty'}`;$('discardCard').innerHTML=top?`<b>${top.rank}</b><i>${top.symbol}</i>`:'—';
    const current=state.players[state.current];$('tresTurn').textContent=state.phase==='resolved'?'Mano terminada':current?`${current.name} · ${state.phase==='draw'?'debe robar':'debe descartar'}`:'Esperando';
    $('drawStock').disabled=state.phase!=='draw'||current?.type==='bot';$('drawDiscard').disabled=state.phase!=='draw'||current?.type==='bot';$('startTres').hidden=state.phase!=='setup';$('nextTres').hidden=state.phase!=='resolved';$('sortHand').disabled=!current||current.type==='bot'||!['draw','discard'].includes(state.phase);$('claimPrize').disabled=!current||current.type==='bot'||state.phase!=='discard'||!state.claimable.length;$('claimPrize').textContent=state.claimable.length?`★ RECLAMAR ${state.claimable.map(k=>k==='threePairs'?'TRES PARES':'PAR NEGRO').join(' + ')}`:'★ RECLAMAR PREMIO';
    $('participantSetup').querySelectorAll('input,select').forEach(e=>e.disabled=state.phase!=='setup');$('ante').disabled=state.phase!=='setup';$('sideAnte').disabled=state.phase!=='setup';
    $('tresSeats').replaceChildren(...state.players.map((p,i)=>{const seat=document.createElement('article');seat.className=`tyd-seat ${i===state.current&&state.phase!=='resolved'?'active':''}`;seat.innerHTML=`<header><span>${p.type==='bot'?'⚙':p.name[0]}</span><div><b>${p.name}</b><small>${p.type==='bot'?'BOT':'PERSONA'} · ${p.wallet}${p.sideActive?' · PREMIOS':''}</small></div></header><div class="tyd-hand"></div>`;const hide=p.type==='bot'&&state.phase!=='resolved';seat.querySelector('.tyd-hand').append(...p.hand.map((c,n)=>cardEl(c,hide,n,i)));return seat}));
  }
  function status(text){$('tresStatus').textContent=text}
  function scheduleBot(){const p=state.players[state.current];if(p?.type==='bot'&&state.phase!=='resolved')botTimer=setTimeout(botMove,650)}
  $('drawStock').onclick=()=>draw('stock');$('drawDiscard').onclick=()=>draw('discard');$('startTres').onclick=start;$('sortHand').onclick=sortCurrentHand;$('claimPrize').onclick=()=>{const p=state.players[state.current];if(p&&claimPrizes(p)){render()}};
  $('nextTres').onclick=()=>{state={phase:'setup',players:[],deck:[],discard:[],current:0,pot:0,drawn:false,lockedCard:null,winner:null,claimable:[],sidePots:emptySidePots(),sideWinners:emptySideWinners()};status('Configura cinco participantes');setup();render()};
  setup();render();
})();
