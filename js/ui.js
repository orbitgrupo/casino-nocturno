(function () {
  'use strict';
  const STORAGE = { table: 'blackjack.table.v2', animations: 'blackjack.animations.v1', theme: 'blackjack.theme.v1' };
  const $ = (id) => document.getElementById(id);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE.table) || '{}'); } catch (_) { saved = {}; }
  const table = new BlackjackTable.LocalTable(saved);
  const gateway = new BlackjackTable.LocalTableGateway(table);
  const seenCards = new WeakSet(); const hiddenCards = new WeakMap();
  const els = { status:$('status'), dealerHand:$('dealerHand'), dealerScore:$('dealerScore'), seats:$('seats'), roster:$('roster'), count:$('playerCount'), bet:$('tableBet'), deal:$('dealBtn'), hit:$('hitBtn'), stand:$('standBtn'), surrender:$('surrenderBtn'), next:$('newRoundBtn'), turn:$('turnName'), add:$('openAddPlayer'), dialog:$('playerDialog'), form:$('playerForm'), name:$('playerName'), wallet:$('playerWallet'), error:$('formError'), cancel:$('cancelPlayer'), reset:$('resetTableBtn'), animations:$('animationsToggle'), dealerMode:$('dealerMode'), dealerActions:$('dealerActions'), dealerHit:$('dealerHitBtn'), dealerStand:$('dealerStandBtn') };
  let botTimer = null;

  els.animations.checked = localStorage.getItem(STORAGE.animations) !== 'false';
  document.body.classList.toggle('reduce-motion', !els.animations.checked);
  const savedTheme = window.CasinoStore ? CasinoStore.theme : (['casino','elegant','night'].includes(localStorage.getItem(STORAGE.theme)) ? localStorage.getItem(STORAGE.theme) : 'casino');
  function applyTheme(theme) {
    document.body.classList.remove('theme-casino','theme-elegant','theme-night');
    document.body.classList.add(`theme-${theme}`);
    document.querySelectorAll('[data-theme]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
    localStorage.setItem(STORAGE.theme, theme);
    if (window.CasinoStore && CasinoStore.theme !== theme) CasinoStore.applyTheme(theme);
  }
  applyTheme(savedTheme);
  const money = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const suitName = (s) => ({ hearts:'corazones',diamonds:'diamantes',clubs:'tréboles',spades:'picas' })[s];

  function cardElement(card, hidden, index) {
    const el = document.createElement('div'); el.className = `playing-card mini-card ${hidden ? 'face-down' : 'face-up'}`; el.style.setProperty('--delay', `${index*70}ms`); el.setAttribute('aria-label', hidden ? 'Carta oculta' : `${card.rank} de ${suitName(card.suit)}`);
    el.style.setProperty('--motion-index',String(index)); if (!seenCards.has(card)) { seenCards.add(card); el.classList.add('fresh-card'); } else if (hiddenCards.get(card)===true&&!hidden) el.classList.add('card-reveal'); hiddenCards.set(card,hidden);
    el.innerHTML = `<div class="card-inner"><div class="card-face card-back"><span>21</span></div><div class="card-face card-front ${card.color}"><div class="corner top"><b>${card.rank}</b><span>${card.symbol}</span></div><span class="suit-center">${card.symbol}</span><div class="corner bottom"><b>${card.rank}</b><span>${card.symbol}</span></div></div></div>`; return el;
  }
  function hand(cards, hideHole=false) { const f=document.createDocumentFragment(); cards.forEach((c,i)=>f.appendChild(cardElement(c,hideHole&&i===1,i))); return f; }
  function typeLabel(type) { return type === 'bot' ? 'BOT' : 'PERSONA'; }
  function seatPlacement(index, total) {
    const spread = total <= 1 ? 0 : (total === 2 ? 86 : total === 3 ? 120 : 140);
    const angle = total <= 1 ? 90 : 90 + spread / 2 - (spread * index / (total - 1));
    const radians = angle * Math.PI / 180;
    const x = 50 + Math.cos(radians) * 41;
    const y = 43 + Math.sin(radians) * 43;
    const tilt = (90 - angle) * 0.09;
    return `--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%;--seat-tilt:${tilt.toFixed(2)}deg;--seat-order:${index};`;
  }

  function render(state) {
    const playing = state.state === 'playing'; const dealerTurn = state.state === 'dealer-turn'; const roundActive = playing || dealerTurn; const current = state.players.find((p)=>p.id===state.currentPlayerId);
    els.status.textContent = state.message; els.status.className = 'status';
    els.dealerHand.replaceChildren(hand(state.dealerCards, playing));
    els.dealerScore.textContent = state.dealerCards.length ? (playing ? '?' : state.dealerScore) : '—';
    els.count.textContent = `${state.players.length} / 6`;
    els.roster.replaceChildren(...state.players.map((p) => {
      const row=document.createElement('div'); row.className='roster-row'; row.innerHTML=`<span class="avatar ${p.type}">${p.type==='bot'?'⚙':p.name[0].toUpperCase()}</span><span><strong>${p.name}</strong><small>${typeLabel(p.type)} · ${money(p.wallet)} créditos</small></span><button type="button" data-remove="${p.id}" aria-label="Eliminar a ${p.name}" ${roundActive?'disabled':''}>×</button>`; return row;
    }));
    els.seats.replaceChildren(...state.players.map((p, index) => {
      const seat=document.createElement('article'); seat.className=`player-seat ${p.id===state.currentPlayerId?'active-seat':''} ${p.outcome?.type||''}`;
      seat.style.cssText = seatPlacement(index, state.players.length);
      const result=p.outcome?`<span class="seat-result">${p.outcome.label}</span>`:'';
      seat.innerHTML=`<header><span class="avatar ${p.type}">${p.type==='bot'?'⚙':p.name[0].toUpperCase()}</span><span><strong>${p.name}</strong><small>${typeLabel(p.type)} · ${money(p.wallet)}</small></span><output>${p.cards.length?p.score:'—'}</output></header><div class="seat-play-zone"><div class="seat-cards"></div><div class="betting-circle ${p.bet?'has-bet':''}" aria-label="Apuesta de ${p.name}"><span class="casino-chip"><b>${p.bet?money(p.bet):''}</b></span></div></div><footer>${p.bet?`Apuesta: ${money(p.bet)}`:'Esperando apuesta'}${result}</footer>`;
      const cards = seat.querySelector('.seat-cards');
      cards.appendChild(hand(p.cards));
      cards.querySelectorAll('.mini-card').forEach((card, cardIndex) => {
        const midpoint = (p.cards.length - 1) / 2;
        card.style.setProperty('--fan-angle', `${(cardIndex - midpoint) * 7}deg`);
        card.style.setProperty('--fan-lift', `${Math.abs(cardIndex - midpoint) * 2}px`);
      });
      return seat;
    }));
    els.turn.textContent=current?`${current.name}${current.type==='bot'?' está pensando…':''}`:(dealerTurn?`Dealer · ${state.dealerScore}`:(state.state==='resolved'?'Ronda terminada':'Esperando ronda'));
    els.hit.disabled=!current||current.type==='bot'; els.stand.disabled=!current||current.type==='bot'; els.surrender.disabled=!current||current.type==='bot'||current.cards.length!==2;
    els.dealerActions.hidden=!dealerTurn; els.dealerHit.disabled=!dealerTurn; els.dealerStand.disabled=!dealerTurn;
    els.dealerMode.value=state.dealerMode; els.dealerMode.disabled=roundActive;
    els.deal.disabled=roundActive||!state.players.length; els.bet.disabled=roundActive; els.add.disabled=roundActive||state.players.length>=6; els.next.hidden=state.state!=='resolved'; els.deal.hidden=state.state==='resolved';
    localStorage.setItem(STORAGE.table, JSON.stringify(table.serialize()));
    clearTimeout(botTimer);
    if (current?.type === 'bot') botTimer=setTimeout(()=>command('botMove'), 750);
  }

  function command(name, args) { try { gateway.command(name,args); } catch(e) { els.status.textContent=e.message; els.status.className='status error'; } }
  gateway.subscribe(render);
  els.deal.addEventListener('click',()=>command('startRound',[Math.floor(Number(els.bet.value))]));
  els.hit.addEventListener('click',()=>command('hit')); els.stand.addEventListener('click',()=>command('stand')); els.surrender.addEventListener('click',()=>command('surrender')); els.next.addEventListener('click',()=>command('newRound'));
  els.dealerHit.addEventListener('click',()=>command('dealerHit')); els.dealerStand.addEventListener('click',()=>command('dealerStand'));
  els.dealerMode.addEventListener('change',()=>command('setDealerMode',[els.dealerMode.value]));
  $('betMinus').addEventListener('click',()=>{els.bet.value=Math.max(10,Number(els.bet.value||10)-10);}); $('betPlus').addEventListener('click',()=>{els.bet.value=Number(els.bet.value||0)+10;});
  els.add.addEventListener('click',()=>{els.error.textContent='';els.form.reset();els.wallet.value=1000;els.dialog.hidden=false;els.name.focus();});
  els.cancel.addEventListener('click',()=>{els.dialog.hidden=true;els.add.focus();});
  els.form.addEventListener('submit',(e)=>{e.preventDefault();const type=new FormData(els.form).get('playerType');try{gateway.command('addPlayer',[els.name.value,type,Number(els.wallet.value)]);els.dialog.hidden=true;}catch(err){els.error.textContent=err.message;}});
  els.roster.addEventListener('click',(e)=>{const btn=e.target.closest('[data-remove]');if(btn)command('removePlayer',[btn.dataset.remove]);});
  els.reset.addEventListener('click',()=>{if(confirm('¿Restablecer jugadores y saldos de toda la mesa?')){table.reset();localStorage.removeItem(STORAGE.table);render(table.snapshot());}});
  els.animations.addEventListener('change',()=>{document.body.classList.toggle('reduce-motion',!els.animations.checked);localStorage.setItem(STORAGE.animations,String(els.animations.checked));});
  document.querySelectorAll('[data-theme]').forEach((button)=>button.addEventListener('click',()=>applyTheme(button.dataset.theme)));
  els.dialog.addEventListener('click',(e)=>{if(e.target===els.dialog)els.cancel.click();}); document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!els.dialog.hidden)els.cancel.click();});
})();
