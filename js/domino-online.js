(function(){
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  let ctx=null,snapshot=null,pendingTile=null,busy=false,lineupDraft=[],lineupRoom='',botTimer=null;

  const css=document.createElement('link');
  css.rel='stylesheet';
  css.href='css/domino-online.css?v=20260712sync';
  document.head.appendChild(css);

  function spots(n){
    const map={0:[],1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]}[n];
    let html='';
    for(let i=1;i<=9;i++)html+=`<i class="${map.includes(i)?'pip':''}"></i>`;
    return `<span class="domino-half">${html}</span>`;
  }

  function tileEl(value,hidden=false,playable=false){
    const [a,b]=value.split('-').map(Number),el=document.createElement(playable?'button':'div');
    el.className=`domino-tile-piece ${a===b?'is-double':''} ${hidden?'tile-back':''} ${playable?'playable':''}`;
    el.innerHTML=hidden?'<b>◆</b>':spots(a)+spots(b);
    if(playable)el.onclick=()=>choose(value);
    return el;
  }

  function legal(value){
    const s=snapshot?.state||{},[a,b]=value.split('-').map(Number);
    if(!s.chain?.length)return s.opening_required?(value==='6-6'?['right']:[]):['right'];
    const ends=[];
    if(a===Number(s.left)||b===Number(s.left))ends.push('left');
    if(a===Number(s.right)||b===Number(s.right))ends.push('right');
    return ends;
  }

  async function call(name,params){
    if(busy)return;
    busy=true;
    try{await ctx.rpc(name,params)}
    catch(e){alert(e.message||String(e))}
    finally{busy=false;await refresh()}
  }

  function choose(value){
    const ends=legal(value);
    if(!ends.length)return;
    if(ends.length===1)return call('play_online_domino',{p_room_id:ctx.room.id,p_tile:value,p_end:ends[0]});
    pendingTile=value;
    $('pendingTile').replaceChildren(tileEl(value));
    $('endChooser').hidden=false;
    $('dominoStatus').textContent='Elige el extremo para colocar la ficha.';
  }

  async function startOnline(){
    if(busy)return;
    busy=true;
    try{
      await ctx.rpc('host_set_domino_seats',{p_room_id:ctx.room.id,p_slots:lineupDraft});
      await ctx.rpc('host_update_casino_room',{p_room_id:ctx.room.id,p_host_mode:null,p_status:'active'});
      await ctx.rpc('start_online_domino',{p_room_id:ctx.room.id,p_mode:$('dominoMode').value,p_target:Number($('targetScore').value)});
    }catch(e){alert(e.message||String(e))}
    finally{busy=false;await refresh()}
  }

  async function saveOnlineSeats(){
    if(busy)return;
    busy=true;
    try{
      await ctx.rpc('host_set_domino_seats',{p_room_id:ctx.room.id,p_slots:lineupDraft});
      $('dominoStatus').textContent='Lugares actualizados en la mesa online.';
    }catch(e){alert(e.message||String(e))}
    finally{busy=false}
  }

  function applyDraftToTable(){
    ctx.room.domino_lineup=[...lineupDraft];
    ctx.members.forEach(member=>{
      member.seat=null;
      member.team_no=null;
      if(member.user_id!==ctx.room.host_id)member.member_role='spectator';
    });
    lineupDraft.forEach((value,seat)=>{
      if(value==='BOT')return;
      const member=ctx.members.find(item=>item.user_id===value);
      if(member){
        member.seat=seat;
        member.team_no=seat%2;
        member.join_number=seat+1;
        member.member_role=member.user_id===ctx.room.host_id?'host':'player';
      }
    });
  }

  function renderScores(s){
    const box=$('scoreBoard'),mode=s.mode||$('dominoMode')?.value||'partners',scores=s.scores||{};
    if(mode==='partners')box.innerHTML=`<div><span>Equipo 1</span><b>${scores.team0||0}</b><small>Asientos 1 y 3</small></div><div><span>Equipo 2</span><b>${scores.team1||0}</b><small>Asientos 2 y 4</small></div>`;
    else box.innerHTML=[0,1,2,3].map(i=>`<div><span>Asiento ${i+1}</span><b>${scores[`p${i}`]||0}</b></div>`).join('');
  }

  function renderOnlineLineup(started){
    const box=$('dominoSetup');
    if(started){box.hidden=true;return}
    box.hidden=false;
    if(!ctx.host){
      box.innerHTML='<p class="sync-notice">Esperando que el creador asigne los lugares e inicie la partida online.</p>';
      return;
    }

    const people=ctx.members;
    if(lineupRoom!==ctx.room.id){
      lineupRoom=ctx.room.id;
      const saved=Array.isArray(ctx.room.domino_lineup)?ctx.room.domino_lineup:[];
      lineupDraft=saved.length===4?saved:[...people.slice(0,4).map(m=>m.user_id)];
      while(lineupDraft.length<4)lineupDraft.push('BOT');
    }

    const memberName=value=>value==='BOT'?'Bot':people.find(m=>m.user_id===value)?.display_name||'Lugar disponible';
    const options=current=>`<option value="BOT" ${current==='BOT'?'selected':''}>Bot</option>${people.map(m=>`<option value="${m.user_id}" ${current===m.user_id?'selected':''}>${esc(m.display_name)}${m.member_role==='spectator'?' · disponible':''}</option>`).join('')}`;

    box.innerHTML=[0,1,2,3].map((_,i)=>`<div class="participant-row domino-person"><span>${i+1}</span><input data-online-name="${i}" value="${esc(memberName(lineupDraft[i]))}" readonly aria-label="Persona asignada al lugar ${i+1}"><select data-online-seat="${i}" aria-label="Seleccionar persona o bot para el lugar ${i+1}">${options(lineupDraft[i]||'BOT')}</select><b>${i%2===0?'E1':'E2'}</b></div>`).join('');
    box.querySelectorAll('[data-online-seat]').forEach(select=>select.onchange=()=>{
      const index=Number(select.dataset.onlineSeat),value=select.value;
      if(value!=='BOT')lineupDraft=lineupDraft.map((entry,slot)=>entry===value&&slot!==index?'BOT':entry);
      lineupDraft[index]=value;
      applyDraftToTable();
      render();
      saveOnlineSeats();
    });
  }

  function render(){
    if(!snapshot)return;
    clearTimeout(botTimer);
    const s=snapshot.state||{},started=s.kind==='domino',myTurn=started&&s.phase==='playing'&&Number(s.current_seat)===Number(snapshot.seat);
    document.body.classList.add('domino-online-active');
    $('dominoModeLabel').textContent='ONLINE · '+(s.mode==='pintintin'?'PINTINTÍN':'PAREJAS');
    $('dominoStatus').textContent=started?(s.message||`Turno del asiento ${Number(s.current_seat)+1}`):(ctx.host?'Asigna los cuatro lugares y comienza la partida online.':'Esperando que el creador asigne los lugares e inicie la partida online.');
    $('dominoChain').replaceChildren(...(s.chain||[]).map(v=>tileEl(v)));
    $('dominoChain').classList.add('online-chain');

    const members=ctx.members.filter(m=>m.seat!==null);
    $('dominoSeats').replaceChildren(...[0,1,2,3].map(seatNo=>{
      const member=members.find(m=>m.seat===seatNo),bot=!member&&ctx.room.domino_lineup?.[seatNo]==='BOT',own=seatNo===snapshot.seat;
      const count=own?snapshot.hand.length:Number(snapshot.hand_counts?.[seatNo]??(member||bot?7:0));
      const seat=document.createElement('article');
      seat.className=`domino-seat seat-${seatNo} ${Number(s.current_seat)===seatNo&&s.phase==='playing'?'active':''}`;
      seat.innerHTML=`<header><span>${bot?'⚙':own?'T':member?.display_name?.[0]||'?'}</span><div><b>${bot?'BOT':member?.display_name||`Lugar ${seatNo+1}`}</b><small>${own?'TU MANO · ':''}${count} fichas</small></div></header><div class="domino-hand"></div>`;
      const hand=seat.querySelector('.domino-hand');
      if(own)hand.append(...snapshot.hand.map(v=>tileEl(v,false,myTurn&&legal(v).length>0)));
      else for(let i=0;i<count;i++)hand.append(tileEl('0-0',true));
      return seat;
    }));

    $('passTurn').disabled=!myTurn||snapshot.hand.some(v=>legal(v).length);
    $('startDomino').hidden=started||!ctx.host;
    $('startDomino').textContent='GUARDAR LUGARES E INICIAR ONLINE';
    $('nextDominoRound').hidden=s.phase!=='round-over'||!ctx.host;
    $('nextDominoRound').textContent='SIGUIENTE MANO ONLINE';
    renderOnlineLineup(started);
    $('dominoMode').disabled=!ctx.host;
    $('targetScore').disabled=!ctx.host;
    $('resetDomino').hidden=true;
    renderScores(s);
    if(ctx.host&&s.phase==='playing'&&ctx.room.domino_lineup?.[Number(s.current_seat)]==='BOT')botTimer=setTimeout(()=>call('play_online_domino_bot',{p_room_id:ctx.room.id}),700);
  }

  async function refresh(){
    if(!ctx)return;
    try{
      snapshot=await ctx.rpc('get_online_domino_state',{p_room_id:ctx.room.id});
      ctx.members.forEach(member=>member.hand_count=Number(snapshot.hand_counts?.[member.seat]||0));
      render();
    }catch(e){$('dominoStatus').textContent=e.message||String(e)}
  }

  function activate(detail){
    if(detail.room?.game_type!=='domino'||detail.room?.status==='closed')return;
    ctx=detail;
    refresh();
  }

  window.addEventListener('casino:online-room',e=>activate(e.detail));
  if(window.CasinoOnlineRoom)activate(window.CasinoOnlineRoom);
  if(new URLSearchParams(location.search).has('previewLineup'))activate({room:{id:'preview',game_type:'domino',status:'active',host_id:'u1',domino_lineup:['u1','u2','BOT','BOT']},user:{id:'u1'},host:true,members:[{user_id:'u1',display_name:'Jugador 1',member_role:'host',seat:0},{user_id:'u2',display_name:'Manuel',member_role:'player',seat:1},{user_id:'u3',display_name:'Carla',member_role:'spectator',seat:null}],rpc:async name=>name==='get_online_domino_state'?{state:{},hand:[],seat:0,hand_counts:{}}:null});

  const local={start:$('startDomino').onclick,next:$('nextDominoRound').onclick,pass:$('passTurn').onclick,left:$('playLeft').onclick,right:$('playRight').onclick};
  $('startDomino').onclick=e=>ctx?startOnline():local.start?.call(e.currentTarget,e);
  $('nextDominoRound').onclick=e=>ctx?call('start_online_domino',{p_room_id:ctx.room.id,p_mode:snapshot.state.mode,p_target:Number(snapshot.state.target)}):local.next?.call(e.currentTarget,e);
  $('passTurn').onclick=e=>ctx?call('pass_online_domino',{p_room_id:ctx.room.id}):local.pass?.call(e.currentTarget,e);
  $('playLeft').onclick=e=>{if(!ctx)return local.left?.call(e.currentTarget,e);if(pendingTile)call('play_online_domino',{p_room_id:ctx.room.id,p_tile:pendingTile,p_end:'left'});pendingTile=null;$('endChooser').hidden=true};
  $('playRight').onclick=e=>{if(!ctx)return local.right?.call(e.currentTarget,e);if(pendingTile)call('play_online_domino',{p_room_id:ctx.room.id,p_tile:pendingTile,p_end:'right'});pendingTile=null;$('endChooser').hidden=true};
})();
