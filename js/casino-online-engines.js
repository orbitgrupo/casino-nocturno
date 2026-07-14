(function(){
  'use strict';

  const PAGE=(location.pathname.split('/').filter(Boolean).pop()||'').toLowerCase().replace(/\.html$/,'');
  const SUPPORTED=new Set(['roulette','dados','tres-y-dos','poker']);
  if(!SUPPORTED.has(PAGE))return;

  let ctx=null,enabled=false,lastVersion=0;
  const $=id=>document.getElementById(id);
  const money=value=>Number(value||0).toLocaleString('es-ES');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const room=()=>ctx?.room;
  const state=()=>room()?.game_state||{};
  const me=()=>ctx?.members?.find(member=>member.user_id===ctx.user?.id);
  const members=()=>[...(ctx?.members||[])].filter(member=>member.seat!==null).sort((a,b)=>a.seat-b.seat);
  const host=()=>!!ctx?.host;
  const ownKey=()=>me()?.profile_id;
  const rpc=(name,params)=>ctx.rpc(name,params);
  const commit=(next,deltas={})=>rpc('commit_sync_game',{p_room_id:room().id,p_state:next,p_credit_deltas:deltas});
  const update=next=>rpc('update_sync_game',{p_room_id:room().id,p_state:next});
  const start=(kind,next)=>rpc('start_sync_game',{p_room_id:room().id,p_kind:kind,p_state:next});
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};

  function activate(detail){
    ctx=detail;
    enabled=!!ctx?.room&&ctx.room.game_type===PAGE&&ctx.room.status==='active';
    if(!enabled)return;
    document.body.classList.add('casino-sync-active',`${PAGE}-sync-active`);
    if((room().state_version||0)!==lastVersion){
      lastVersion=room().state_version||0;
      render();
    }
  }

  window.addEventListener('casino:online-room',event=>activate(event.detail));
  if(window.CasinoOnlineRoom)setTimeout(()=>activate(window.CasinoOnlineRoom),0);

  document.addEventListener('click',event=>{
    if(!enabled)return;
    if(PAGE==='roulette')handleRouletteClick(event);
    if(PAGE==='dados')handleDadosClick(event);
    if(PAGE==='tres-y-dos')handleTresClick(event);
    if(PAGE==='poker')handlePokerClick(event);
  },true);

  function render(){
    if(PAGE==='roulette')renderRoulette();
    if(PAGE==='dados')renderDados();
    if(PAGE==='tres-y-dos')renderTres();
    if(PAGE==='poker')renderPoker();
  }

  function syncNotice(text){
    let notice=document.querySelector('.online-engine-notice');
    if(!notice){
      notice=document.createElement('div');
      notice.className='online-engine-notice';
      notice.style.cssText='position:fixed;z-index:80;left:16px;top:86px;max-width:360px;padding:10px 12px;border:1px solid rgba(232,189,104,.35);border-radius:12px;background:rgba(3,20,14,.92);color:#f8e7b0;font:700 11px/1.4 sans-serif;letter-spacing:.04em;box-shadow:0 14px 34px rgba(0,0,0,.35)';
      document.body.appendChild(notice);
    }
    notice.textContent=text;
  }

  const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const suits=['S','H','D','C'];
  const suitSymbol={S:'♠',H:'♥',D:'♦',C:'♣'};
  const suitColor=suit=>suit==='H'||suit==='D'?'red':'black';
  function deck(){
    const cards=[];
    suits.forEach(suit=>ranks.forEach(rank=>cards.push(`${rank}-${suit}`)));
    for(let i=cards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]]}
    return cards;
  }
  function cardHtml(card,hidden=false,cls='card'){
    if(hidden)return `<span class="${cls} card back casino-card-back">★</span>`;
    const [rank,suit]=String(card).split('-');
    return `<span class="${cls} ${suitColor(suit)}"><b>${rank}</b><i>${suitSymbol[suit]||suit}</i></span>`;
  }
  function tresCardButton(card,hidden,canDiscard,index){
    if(hidden)return `<button class="tyd-card hidden-card" disabled style="--motion-index:${index}"><span>3+2</span></button>`;
    const [rank,suit]=String(card).split('-');
    return `<button class="tyd-card ${suitColor(suit)} ${canDiscard?'online-playable':''}" ${canDiscard?`data-tres-card="${card}"`:'disabled'} style="--motion-index:${index}"><b>${rank}</b><i>${suitSymbol[suit]||suit}</i></button>`;
  }
  function valueRank(card){const rank=String(card).split('-')[0];return ranks.indexOf(rank)+1}

  // RULETA
  const redNums=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const odds={straight:35,split:17,street:11,corner:8,sixline:5,trio:11,firstfour:8,topline:6,dozen:2,column:2,red:1,black:1,even:1,odd:1,low:1,high:1};
  const european=['0','32','15','19','4','21','2','25','17','34','6','27','13','36','11','30','8','23','10','5','24','16','33','1','20','14','31','9','22','18','29','7','28','12','35','3','26'];
  const american=['0','28','9','26','30','11','7','20','32','17','5','22','34','15','3','24','36','13','1','00','27','10','25','29','12','8','19','31','18','6','21','33','16','4','23','35','14','2'];
  const rouletteColor=n=>n==='0'||n==='00'?'green':redNums.has(Number(n))?'red':'black';
  function rouletteWin(bet,result){
    const t=bet.type,target=bet.target;
    if(['straight','split','street','corner','sixline','trio','firstfour','topline'].includes(t))return (Array.isArray(target)?target:[String(target)]).map(String).includes(String(result));
    const n=Number(result); if(!Number.isFinite(n)||n===0)return false;
    if(t==='red'||t==='black')return rouletteColor(result)===t;
    if(t==='even')return n%2===0;
    if(t==='odd')return n%2===1;
    if(t==='low')return n>=1&&n<=18;
    if(t==='high')return n>=19&&n<=36;
    if(t==='dozen')return Math.ceil(n/12)===Number(target);
    if(t==='column')return ((n-1)%3)+1===Number(target);
    return false;
  }
  function rouletteBetFromTarget(target){
    const chip=Number($('chipValue')?.value)||10;
    const number=target.closest('.number-cell');
    if(number){
      const value=number.textContent.trim();
      return {type:'straight',target:[value],amount:chip,label:`Pleno ${value}`};
    }
    const outside=target.closest('.outside-cell,.outside-bet,button[data-bet]');
    if(outside){
      const text=outside.textContent.trim().toLowerCase();
      if(text.includes('rojo'))return {type:'red',target:'red',amount:chip,label:'Rojo'};
      if(text.includes('negro'))return {type:'black',target:'black',amount:chip,label:'Negro'};
      if(text.includes('par'))return {type:'even',target:'even',amount:chip,label:'Par'};
      if(text.includes('impar'))return {type:'odd',target:'odd',amount:chip,label:'Impar'};
      if(text.includes('1-18'))return {type:'low',target:'low',amount:chip,label:'1-18'};
      if(text.includes('19-36'))return {type:'high',target:'high',amount:chip,label:'19-36'};
      if(text.includes('1ª')||text.includes('1ra'))return {type:'dozen',target:1,amount:chip,label:'1ª docena'};
      if(text.includes('2ª')||text.includes('2da'))return {type:'dozen',target:2,amount:chip,label:'2ª docena'};
      if(text.includes('3ª')||text.includes('3ra'))return {type:'dozen',target:3,amount:chip,label:'3ª docena'};
      if(text.includes('columna 1'))return {type:'column',target:1,amount:chip,label:'Columna 1'};
      if(text.includes('columna 2'))return {type:'column',target:2,amount:chip,label:'Columna 2'};
      if(text.includes('columna 3'))return {type:'column',target:3,amount:chip,label:'Columna 3'};
    }
    return null;
  }
  async function handleRouletteClick(event){
    const s=state();
    if(event.target.closest('#spinBtn')){block(event);if(!host())return syncNotice('Solo el creador gira la ruleta online.');return spinRoulette();}
    if(event.target.closest('#clearBets')){block(event);return rpc('clear_sync_bets',{p_room_id:room().id});}
    if(event.target.closest('#addAdvanced')){
      block(event);
      const amount=Number($('chipValue')?.value)||10,type=$('betType')?.value||'straight',target=($('betTarget')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(!target.length)return syncNotice('Escribe los números de la apuesta.');
      return rpc('place_sync_bet',{p_room_id:room().id,p_bet:{type,target,amount,label:`${type}: ${target.join(', ')}`}});
    }
    const bet=rouletteBetFromTarget(event.target);
    if(bet){block(event);if(s.kind!=='roulette'&&host())await startRoulette();return rpc('place_sync_bet',{p_room_id:room().id,p_bet:bet});}
  }
  async function startRoulette(){
    await start('roulette',{phase:'betting',mode:$('wheelMode')?.value||'european',bets:{},history:[],message:'Mesa online lista para apostar'});
  }
  async function spinRoulette(){
    let s=state();
    if(s.kind!=='roulette')await startRoulette();
    s=state().kind==='roulette'?state():{phase:'betting',mode:$('wheelMode')?.value||'european',bets:{},history:[]};
    const mode=$('wheelMode')?.value||s.mode||'european', pockets=mode==='american'?american:european;
    const result=pockets[Math.floor(Math.random()*pockets.length)];
    const deltas={},summary=[];
    Object.entries(s.bets||{}).forEach(([profileId,list])=>{
      let stake=0,returns=0;
      (list||[]).forEach(bet=>{stake+=Number(bet.amount)||0;if(rouletteWin(bet,result))returns+=(Number(bet.amount)||0)*(1+(odds[bet.type]||1));});
      deltas[profileId]=returns-stake;
      if(stake)summary.push(`${list[0]?.display_name||'Jugador'} ${returns>stake?`cobra ${returns}`:'pierde'}`);
    });
    const next={...s,kind:'roulette',phase:'betting',mode,result,color:rouletteColor(result),bets:{},history:[result,...(s.history||[])].slice(0,12),message:`Salió ${result}. ${summary.join(' · ')||'Sin apuestas.'}`};
    animateRoulette(result,pockets);
    await sleep(900);
    await commit(next,deltas);
  }
  function animateRoulette(result,pockets){
    const rotor=$('wheelRotor'),ball=$('wheelBall'),idx=pockets.indexOf(String(result)),angle=360*4+(idx>=0?idx*(360/pockets.length):0);
    if(rotor)rotor.style.transform=`rotate(${angle}deg)`;
    if(ball){ball.style.transition='transform 1.1s cubic-bezier(.15,.8,.2,1)';ball.style.transform=`rotate(${-angle*1.35}deg) translateY(-44%)`;}
  }
  function renderRoulette(){
    const s=state();
    if(s.kind!=='roulette'){syncNotice(host()?'Ruleta online activa. Presiona GIRAR o coloca una apuesta para inicializar.':'Esperando que el creador inicie la ruleta online.');return;}
    const allBets=Object.values(s.bets||{}).flat(),own=(s.bets||{})[ownKey()]||[];
    if($('wheelResult'))$('wheelResult').textContent=s.result||'—';
    if($('resultNumber'))$('resultNumber').textContent=s.result||'—';
    if($('resultLabel'))$('resultLabel').textContent=s.message||'Mesa online sincronizada';
    if($('history'))$('history').innerHTML=(s.history||[]).map(n=>`<i class="${rouletteColor(n)}">${n}</i>`).join('');
    if($('totalBet'))$('totalBet').textContent=`${own.reduce((a,b)=>a+Number(b.amount||0),0)} créditos propios`;
    if($('betList'))$('betList').innerHTML=allBets.map(b=>`<div><span>${b.display_name||'Jugador'} · ${b.label||b.type}</span><b>${b.amount}</b></div>`).join('')||'<small>Sin apuestas.</small>';
    if($('spinBtn'))$('spinBtn').disabled=!host();
    syncNotice(host()?'Ruleta online: tú giras, todos pueden apostar.':'Ruleta online: coloca apuestas y espera el giro del creador.');
  }

  // DADOS
  const diceNames={pass:'Línea de pase',dont:'No pase',field:'Campo',craps:'Any Craps',yo:'Yo / Once',hard4:'Hard 4',hard6:'Hard 6',hard8:'Hard 8',hard10:'Hard 10'};
  function dicePayout(bet,a,b,point){
    const sum=a+b,amount=Number(bet.amount)||0,comeOut=point==null,type=bet.type;
    if(type==='field')return [3,4,9,10,11].includes(sum)?amount*2:[2,12].includes(sum)?amount*3:0;
    if(type==='craps')return [2,3,12].includes(sum)?amount*8:0;
    if(type==='yo')return sum===11?amount*16:0;
    if(type?.startsWith('hard')){const target=Number(type.replace('hard',''));if(sum===target&&a===b)return amount*({4:8,6:10,8:10,10:8}[target]);if(sum===7||sum===target)return 0;return null}
    if(type==='pass'){if(comeOut)return [7,11].includes(sum)?amount*2:[2,3,12].includes(sum)?0:null;return sum===point?amount*2:sum===7?0:null}
    if(type==='dont'){if(comeOut)return [2,3].includes(sum)?amount*2:sum===12?amount:[7,11].includes(sum)?0:null;return sum===7?amount*2:sum===point?0:null}
    return 0;
  }
  async function handleDadosClick(event){
    if(event.target.closest('#rollDice')){block(event);if(!host())return syncNotice('Solo el creador lanza los dados online.');return rollDados();}
    if(event.target.closest('#clearDiceBets')){block(event);return rpc('clear_sync_bets',{p_room_id:room().id});}
    const betButton=event.target.closest('.dice-bet');
    if(betButton){
      block(event);
      const index=[...document.querySelectorAll('.dice-bet')].indexOf(betButton),type=Object.keys(diceNames)[index],amount=Number($('diceChip')?.value)||10;
      if(!type)return;
      if(state().kind!=='dados'&&host())await startDados();
      return rpc('place_sync_bet',{p_room_id:room().id,p_bet:{type,amount,label:diceNames[type]}});
    }
  }
  async function startDados(){
    await start('dados',{phase:'betting',point:null,bets:{},history:[],message:'Mesa de dados online lista'});
  }
  async function rollDados(){
    let s=state(); if(s.kind!=='dados')await startDados();
    s=state().kind==='dados'?state():{phase:'betting',point:null,bets:{},history:[]};
    const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6),sum=a+b,deltas={},nextBets={},summary=[];
    Object.entries(s.bets||{}).forEach(([profileId,list])=>{
      let stake=0,returns=0,keep=[];
      (list||[]).forEach(bet=>{
        const payout=dicePayout(bet,a,b,s.point);
        if(payout===null){keep.push(bet);return;}
        stake+=Number(bet.amount)||0;returns+=payout;
      });
      if(keep.length)nextBets[profileId]=keep;
      if(stake){deltas[profileId]=returns-stake;summary.push(`${list[0]?.display_name||'Jugador'} ${returns>stake?`cobra ${returns}`:'pierde'}`)}
    });
    let point=s.point??null;
    if(point==null&&[4,5,6,8,9,10].includes(sum))point=sum;
    else if(point!=null&&(sum===point||sum===7))point=null;
    setDiceFaces(a,b);
    await sleep(700);
    await commit({...s,kind:'dados',phase:'betting',point,bets:nextBets,lastRoll:[a,b],history:[sum,...(s.history||[])].slice(0,12),message:`${a} + ${b} = ${sum}. ${summary.join(' · ')||'Sin cobros.'}`},deltas);
  }
  function setDiceFaces(a,b){if($('dieOne'))$('dieOne').className=`die show-${a}`;if($('dieTwo'))$('dieTwo').className=`die show-${b}`;}
  function renderDados(){
    const s=state(); if(s.kind!=='dados'){syncNotice(host()?'Dados online activo. Lanza o coloca apuesta para inicializar.':'Esperando al creador en dados online.');return;}
    if(s.lastRoll)setDiceFaces(s.lastRoll[0],s.lastRoll[1]);
    if($('diceStatus'))$('diceStatus').textContent=s.message||'Dados online sincronizados';
    if($('pointMarker'))$('pointMarker').textContent=`PUNTO: ${s.point||'—'}`;
    if($('diceHistory'))$('diceHistory').innerHTML=(s.history||[]).map(x=>`<i>${x}</i>`).join('');
    const all=Object.values(s.bets||{}).flat(),own=(s.bets||{})[ownKey()]||[];
    if($('diceTotalBet'))$('diceTotalBet').textContent=`${own.reduce((a,b)=>a+Number(b.amount||0),0)} créditos propios`;
    if($('diceBetList'))$('diceBetList').innerHTML=all.map(b=>`<div><span>${b.display_name||'Jugador'} · ${b.label||b.type}</span><b>${b.amount}</b></div>`).join('')||'<small>Sin apuestas.</small>';
    if($('rollDice'))$('rollDice').disabled=!host();
    syncNotice(host()?'Dados online: tú lanzas, todos pueden apostar.':'Dados online: apuesta y espera el lanzamiento del creador.');
  }

  // TRES Y DOS
  function isFullHouse(hand){
    const counts={};hand.forEach(c=>counts[String(c).split('-')[0]]=(counts[String(c).split('-')[0]]||0)+1);
    return Object.values(counts).some(v=>v>=3)&&Object.values(counts).some(v=>v>=2);
  }
  async function handleTresClick(event){
    const s=state();
    if(event.target.closest('#startTres,#nextTres')){block(event);if(!host())return syncNotice('Solo el creador reparte en 3 y 2 online.');return startTres();}
    if(event.target.closest('#drawStock')){block(event);return tresDraw('stock');}
    if(event.target.closest('#drawDiscard')){block(event);return tresDraw('discard');}
    if(event.target.closest('#claimPrize')){block(event);return tresClaim();}
    if(event.target.closest('#sortHand')){block(event);return tresSort();}
    const card=event.target.closest('[data-tres-card]');
    if(card){block(event);return tresDiscard(card.dataset.tresCard);}
  }
  async function startTres(){
    const d=deck(),players={};let pot=0;
    members().slice(0,5).forEach(member=>{players[member.seat]={profile_id:member.profile_id,name:member.display_name,hand:d.splice(0,5),status:'playing'};pot+=20;});
    if(!Object.keys(players).length)return syncNotice('No hay jugadores sentados en esta sala.');
    const deltas={};Object.values(players).forEach(p=>deltas[p.profile_id]=-20);
    await commit({kind:'tres-y-dos',phase:'playing',deck:d,discard:[d.shift()],players,currentSeat:Number(Object.keys(players)[0]||0),drawn:false,pot,message:'Mano online repartida'},deltas);
  }
  async function tresDraw(source){
    const s=state(),m=me(); if(s.kind!=='tres-y-dos'||s.phase!=='playing'||m?.seat!==s.currentSeat||s.drawn)return;
    const p=s.players[String(m.seat)],d=[...(s.deck||[])],discard=[...(s.discard||[])],card=source==='discard'?discard.shift():d.shift();
    if(!card)return;
    p.hand=[...p.hand,card];
    await update({...s,deck:d,discard,players:{...s.players,[m.seat]:p},drawn:true,message:`${m.display_name} tomó del ${source==='discard'?'descarte':'mazo'}`});
  }
  async function tresDiscard(card){
    const s=state(),m=me(); if(s.kind!=='tres-y-dos'||s.phase!=='playing'||m?.seat!==s.currentSeat||!s.drawn)return;
    const p=s.players[String(m.seat)],hand=[...(p.hand||[])],idx=hand.indexOf(card); if(idx<0)return;
    hand.splice(idx,1);p.hand=hand;
    const seats=Object.keys(s.players).map(Number).sort((a,b)=>a-b),next=seats[(seats.indexOf(m.seat)+1)%seats.length];
    await update({...s,players:{...s.players,[m.seat]:p},discard:[card,...(s.discard||[])],drawn:false,currentSeat:next,message:`${m.display_name} descartó. Turno del asiento ${next+1}`});
  }
  async function tresClaim(){
    const s=state(),m=me(); if(s.kind!=='tres-y-dos'||s.phase!=='playing'||m?.seat!==s.currentSeat)return;
    const p=s.players[String(m.seat)]; if(!isFullHouse(p.hand))return syncNotice('No tienes 3 y 2 en la mano.');
    await commit({...s,phase:'round-over',winnerSeat:m.seat,message:`${m.display_name} reclamó 3 y 2 y ganó el pozo de ${s.pot}`},{[m.profile_id]:Number(s.pot)||0});
  }
  function tresSort(){
    const s=state(),m=me(),p=s.players?.[String(m?.seat)];if(!p)return;
    p.hand=[...p.hand].sort((a,b)=>valueRank(a)-valueRank(b));
    update({...s,players:{...s.players,[m.seat]:p}});
  }
  function renderTres(){
    const s=state();
    if(s.kind!=='tres-y-dos'){
      if($('tresStatus'))$('tresStatus').textContent=host()?'Sala online activa. Presiona REPARTIR CINCO CARTAS.':'Esperando que el creador reparta la mano online.';
      if($('startTres')){$('startTres').hidden=false;$('startTres').disabled=!host();$('startTres').textContent='REPARTIR CINCO CARTAS ONLINE';}
      if($('nextTres'))$('nextTres').hidden=true;
      ['drawStock','drawDiscard','sortHand','claimPrize'].forEach(id=>{if($(id))$(id).disabled=true});
      syncNotice(host()?'3 y 2 online: reparte para que todos vean la misma mano.':'3 y 2 online: espera el reparto del creador.');
      return;
    }
    const mySeat=me()?.seat,myTurn=mySeat===s.currentSeat&&s.phase==='playing',mustDraw=myTurn&&!s.drawn,mustDiscard=myTurn&&!!s.drawn;
    if($('pot'))$('pot').textContent=money(s.pot);
    if($('tresStatus'))$('tresStatus').textContent=s.message||'3 y 2 online';
    if($('stockCount'))$('stockCount').textContent=(s.deck||[]).length;
    if($('discardCard'))$('discardCard').outerHTML=`<span id="discardCard" class="pile">${cardHtml((s.discard||[])[0],false,'mini-card')}</span>`;
    if($('tresTurn'))$('tresTurn').textContent=s.currentSeat!=null?`${s.players?.[String(s.currentSeat)]?.name||`Asiento ${s.currentSeat+1}`} · ${s.drawn?'debe descartar':'debe robar'}`:'Esperando';
    if($('tresSeats'))$('tresSeats').innerHTML=Object.entries(s.players||{}).map(([seat,p])=>{
      const own=Number(seat)===mySeat,turn=Number(seat)===s.currentSeat&&s.phase==='playing',canDiscard=own&&mustDiscard;
      return `<article class="tyd-seat ${own?'own-seat':''} ${turn?'active':''}"><header><span>${(p.name||'?').charAt(0).toUpperCase()}</span><div><b>${p.name}</b><small>${own?'TU MANO':`${(p.hand||[]).length} CARTAS`} · ${turn?(s.drawn?'DEBE DESCARTAR':'DEBE ROBAR'):'EN MESA'}</small></div></header><div class="tyd-hand">${(p.hand||[]).map((c,i)=>tresCardButton(c,!own,canDiscard,i)).join('')}</div></article>`;
    }).join('');
    if($('drawStock'))$('drawStock').disabled=!mustDraw;
    if($('drawDiscard'))$('drawDiscard').disabled=!mustDraw||!(s.discard||[]).length;
    if($('sortHand'))$('sortHand').disabled=!(mySeat!=null&&s.players?.[String(mySeat)]?.hand?.length);
    if($('claimPrize')){$('claimPrize').disabled=!(myTurn&&isFullHouse(s.players?.[String(mySeat)]?.hand||[]));$('claimPrize').textContent='★ RECLAMAR 3 Y 2';}
    if($('startTres')){$('startTres').hidden=s.phase==='playing';$('startTres').disabled=!host();}
    if($('nextTres')){$('nextTres').hidden=s.phase!=='round-over';$('nextTres').disabled=!host();$('nextTres').textContent='NUEVA MANO ONLINE';}
    syncNotice(myTurn?(s.drawn?'Tu turno: toca una carta de tu mano para descartar.':'Tu turno: toma del mazo o del descarte.'):'3 y 2 online sincronizado: espera tu turno.');
  }

  // POKER
  const pokerStages=['preflop','flop','turn','river','showdown'];
  function nextPokerTurn(s,fromSeat){
    const active=Object.entries(s.players||{}).filter(([,p])=>!p.folded).map(([seat])=>Number(seat)).sort((a,b)=>a-b);
    if(active.length<=1)return null;
    const idx=active.indexOf(fromSeat);
    return active[(idx+1+active.length)%active.length];
  }
  function activePlayers(s){return Object.entries(s.players||{}).filter(([,p])=>!p.folded)}
  async function handlePokerClick(event){
    if(event.target.closest('#startPoker')){block(event);if(!host())return syncNotice('Solo el creador reparte en póker online.');return startPoker();}
    const action=event.target.closest('#foldPoker')?'fold':event.target.closest('#checkPoker')?'check':event.target.closest('#callPoker')?'call':event.target.closest('#raisePoker')?'raise':null;
    if(action){block(event);return pokerAct(action);}
  }
  async function startPoker(){
    const d=deck(),players={},deltas={};let pot=0;
    members().slice(0,6).forEach(member=>{players[member.seat]={profile_id:member.profile_id,name:member.display_name,cards:d.splice(0,2),folded:false,acted:false,bet:20};deltas[member.profile_id]=-20;pot+=20;});
    await commit({kind:'poker',phase:'playing',stage:'preflop',deck:d,community:[],players,currentSeat:Number(Object.keys(players)[0]||0),pot,message:'Mano de póker online repartida'},deltas);
  }
  async function pokerAct(action){
    const s=state(),m=me(); if(s.kind!=='poker'||s.phase!=='playing'||m?.seat!==s.currentSeat)return;
    const p=s.players[String(m.seat)]; if(action==='fold')p.folded=true; p.acted=true;
    if(action==='raise'){p.bet=(p.bet||0)+20;s.pot=(s.pot||0)+20}
    let next={...s,players:{...s.players,[m.seat]:p},message:`${m.display_name}: ${action}`};
    const active=activePlayers(next);
    if(active.length===1){
      const winner=active[0][1];
      return commit({...next,phase:'round-over',currentSeat:null,message:`${winner.name} gana el pozo de ${next.pot}`},{[winner.profile_id]:Number(next.pot)||0});
    }
    const everyoneActed=active.every(([,player])=>player.acted);
    if(everyoneActed){
      Object.values(next.players).forEach(player=>player.acted=false);
      const stageIndex=pokerStages.indexOf(next.stage),newStage=pokerStages[Math.min(stageIndex+1,pokerStages.length-1)];
      next.stage=newStage;
      if(newStage==='flop')next.community=[...next.community,...next.deck.splice(0,3)];
      if(newStage==='turn'||newStage==='river')next.community=[...next.community,next.deck.shift()];
      if(newStage==='showdown'){
        const winner=active.map(([,player])=>player).sort((a,b)=>bestPokerScore(b.cards,next.community)-bestPokerScore(a.cards,next.community))[0];
        return commit({...next,phase:'round-over',currentSeat:null,message:`Showdown: ${winner.name} gana ${next.pot}`},{[winner.profile_id]:Number(next.pot)||0});
      }
      next.message=`Nueva ronda: ${newStage}`;
    }
    next.currentSeat=nextPokerTurn(next,m.seat);
    await update(next);
  }
  function bestPokerScore(cards,community){
    return [...cards,...community].reduce((best,card)=>Math.max(best,valueRank(card)),0);
  }
  function renderPoker(){
    const s=state(); if(s.kind!=='poker'){syncNotice(host()?'Póker online: presiona COMENZAR MANO.':'Esperando al creador del póker.');return;}
    if($('pokerPot'))$('pokerPot').textContent=money(s.pot);
    if($('pokerStatus'))$('pokerStatus').textContent=s.message||'Póker online';
    if($('communityCards'))$('communityCards').innerHTML=(s.community||[]).map(c=>cardHtml(c,false,'poker-card')).join('');
    if($('pokerSeats'))$('pokerSeats').innerHTML=Object.entries(s.players||{}).map(([seat,p])=>{
      const own=Number(seat)===me()?.seat;
      return `<article class="poker-seat ${own?'own-seat':''} ${p.folded?'folded':''} ${Number(seat)===s.currentSeat?'turn':''}"><h3>${p.name}</h3><small>${own?'TU MANO':`${(p.cards||[]).length} CARTAS`} · ${p.folded?'RETIRADO':Number(seat)===s.currentSeat?'TURNO':'EN MESA'}</small><div class="poker-cards">${(p.cards||[]).map(c=>cardHtml(c,!own,'poker-card')).join('')}</div></article>`;
    }).join('');
    if($('pokerActions'))$('pokerActions').hidden=me()?.seat!==s.currentSeat||s.phase!=='playing';
    if($('startPoker'))$('startPoker').disabled=!host();
    if($('pokerLog'))$('pokerLog').innerHTML=`<p>${s.stage||''} · ${s.message||''}</p>`;
  }
})();
