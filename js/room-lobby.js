(function(){
  'use strict';
  const PAGE=(location.pathname.split('/').filter(Boolean).pop()||'').toLowerCase().replace(/\.html$/,'');
  const GAME_MAP={blackjack:'blackjack',roulette:'roulette','tres-y-dos':'tres-y-dos',domino:'domino'};
  const GAME_LABEL={blackjack:'Blackjack',roulette:'Ruleta','tres-y-dos':'Tres y Dos',domino:'Dominó'};
  const game=GAME_MAP[PAGE];if(!game)return;
  const ROOM_KEY=`casino.onlineRoom.${game}`;
  let client=null,user=null,room=null,members=[],channel=null;
  const config=window.CASINO_SUPABASE_CONFIG||{};
  const escape=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

  const button=document.createElement('button');button.className='room-launcher';button.type='button';button.innerHTML='<span>⌁</span><b>SALA ONLINE</b><small>Crear o unirse</small>';document.body.appendChild(button);
  const modal=document.createElement('div');modal.className='room-modal';modal.hidden=true;modal.innerHTML=`
    <section class="room-card" role="dialog" aria-modal="true" aria-labelledby="roomTitle">
      <header><div><small>ANTESALA DE ${escape(GAME_LABEL[game]).toUpperCase()}</small><h2 id="roomTitle">Sala por invitación</h2></div><button type="button" data-close aria-label="Cerrar">×</button></header>
      <div id="roomSetup" class="room-setup">
        <div class="room-tabs"><button type="button" data-tab="create" class="active">CREAR SALA</button><button type="button" data-tab="join">UNIRME CON CÓDIGO</button></div>
        <form id="createRoomForm" class="room-form">
          <label>Tu nombre<input name="displayName" maxlength="20" required placeholder="Nombre del anfitrión"></label>
          <label>Rol del anfitrión<select name="hostMode"><option value="playing">Jugar y administrar</option><option value="moderator">Solo moderar</option></select></label>
          <label>Créditos iniciales por jugador<input name="initialCredits" type="number" min="0" max="1000000" step="10" value="1000" required></label>
          <button class="primary-btn" type="submit">CREAR CÓDIGO DE INVITACIÓN</button>
        </form>
        <form id="joinRoomForm" class="room-form" hidden>
          <label>Tu nombre<input name="displayName" maxlength="20" required placeholder="Nombre del jugador"></label>
          <label>Código de invitación<input name="inviteCode" maxlength="6" required placeholder="ABC123" autocomplete="off"></label>
          <button class="primary-btn" type="submit">ENTRAR A LA SALA</button>
        </form>
      </div>
      <div id="roomView" hidden></div>
      <p id="roomMessage" class="room-message" role="status"></p>
    </section>`;document.body.appendChild(modal);
  const $=selector=>modal.querySelector(selector),message=(text,type='')=>{const el=$('#roomMessage');el.textContent=text;el.className=`room-message ${type}`};

  function loadLibrary(){if(window.supabase?.createClient)return Promise.resolve();return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo cargar Supabase. Revisa la conexión.'));document.head.appendChild(script)})}
  async function ensureClient(){
    if(client)return client;
    if(!config.url||!config.publishableKey)throw new Error('Supabase aún no está configurado. Completa js/supabase-config.js.');
    await loadLibrary();client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data:{session}}=await client.auth.getSession();
    if(session)user=session.user;else{const {data,error}=await client.auth.signInAnonymously();if(error)throw error;user=data.user}
    return client;
  }
  async function rpc(name,params){await ensureClient();const {data,error}=await client.rpc(name,params);if(error)throw error;return Array.isArray(data)?data[0]:data}
  async function createRoom(form){const values=new FormData(form);const result=await rpc('create_casino_room',{p_game_type:game,p_host_mode:values.get('hostMode'),p_display_name:values.get('displayName'),p_initial_credits:Number(values.get('initialCredits'))});await openRoom(result.room_id)}
  async function joinRoom(form){const values=new FormData(form);const result=await rpc('join_casino_room',{p_invite_code:String(values.get('inviteCode')).trim().toUpperCase(),p_display_name:values.get('displayName')});await openRoom(result.room_id)}
  async function openRoom(id){room={id};await refresh();localStorage.setItem(ROOM_KEY,room.id);subscribe();history.replaceState(null,'',`${location.pathname}?room=${room.invite_code}`)}
  async function resumeSavedRoom(){const id=localStorage.getItem(ROOM_KEY);if(!id)return;try{await openRoom(id)}catch(error){localStorage.removeItem(ROOM_KEY);room=null;throw error}}
  async function refresh(){
    if(!room?.id)return;await ensureClient();
    const [{data:roomData,error:roomError},{data:memberData,error:memberError}]=await Promise.all([client.from('casino_rooms').select('*').eq('id',room.id).single(),client.from('casino_room_members').select('*').eq('room_id',room.id).order('seat',{ascending:true,nullsFirst:false})]);
    if(roomError)throw roomError;if(memberError)throw memberError;room=roomData;members=memberData||[];renderRoom();
  }
  function subscribe(){if(channel)client.removeChannel(channel);channel=client.channel(`casino-room-${room.id}`).on('postgres_changes',{event:'*',schema:'public',table:'casino_rooms',filter:`id=eq.${room.id}`},refresh).on('postgres_changes',{event:'*',schema:'public',table:'casino_room_members',filter:`room_id=eq.${room.id}`},refresh).subscribe()}
  function renderRoom(){
    const host=room.host_id===user.id,me=members.find(member=>member.user_id===user.id),status={waiting:'Esperando jugadores',active:'Partida iniciada',closed:'Sala cerrada'}[room.status]||room.status;
    $('#roomSetup').hidden=true;const view=$('#roomView');view.hidden=false;
    view.innerHTML=`<div class="room-code"><span>CÓDIGO DE INVITACIÓN</span><strong>${escape(room.invite_code)}</strong><button type="button" data-copy>Copiar invitación</button></div>
      <div class="room-meta"><span>${escape(GAME_LABEL[room.game_type])}</span><span>${escape(status)}</span><span>${members.length} conectados</span></div>
      ${host?`<label class="host-mode-control">Tu función<select id="onlineHostMode" ${room.status!=='waiting'?'disabled':''}><option value="playing" ${room.host_mode==='playing'?'selected':''}>Jugar y administrar</option><option value="moderator" ${room.host_mode==='moderator'?'selected':''}>Solo moderar</option></select></label>`:`<p class="guest-note">El anfitrión administra los puntos y el inicio de la partida.</p>`}
      <div class="online-members">${members.map(member=>`<article class="online-member ${member.user_id===room.host_id?'host':''}"><span class="online-avatar">${escape(member.display_name.charAt(0).toUpperCase())}</span><div><b>${escape(member.display_name)}</b><small>${member.user_id===room.host_id?'ANFITRIÓN · ':''}${member.seat===null?'MODERADOR':`ASIENTO ${member.seat+1}`}</small></div>${host?`<label>Créditos<input type="number" min="0" max="1000000" step="10" value="${member.credits}" data-credit="${member.user_id}"></label><button type="button" data-save-credit="${member.user_id}">Guardar</button>${member.user_id!==user.id?`<button type="button" class="kick" data-kick="${member.user_id}">Expulsar</button>`:''}`:`<strong>${member.credits.toLocaleString('es-ES')} créditos</strong>`}</article>`).join('')}</div>
      <div class="room-actions">${host&&room.status==='waiting'?'<button type="button" class="primary-btn" data-start>INICIAR SALA</button>':''}<button type="button" class="outline-btn" data-exit>SALIR Y VOLVER DESPUÉS</button><button type="button" class="outline-btn room-abandon" data-abandon>${host?'ABANDONAR Y CERRAR SALA':'ABANDONAR SALA'}</button></div>
      ${room.status==='active'?'<p class="sync-notice">La sala está activa. La sincronización de jugadas será la siguiente etapa de la integración.</p>':''}`;
    button.innerHTML=`<span>${host?'♛':'●'}</span><b>${escape(room.invite_code)}</b><small>${me?'Sala conectada':'Reconectando…'}</small>`;
    view.querySelector('#onlineHostMode')?.addEventListener('change',event=>run(()=>rpc('host_update_casino_room',{p_room_id:room.id,p_host_mode:event.target.value,p_status:null})));
  }
  async function run(action){try{message('Procesando…');await action();message('')}catch(error){message(error.message||String(error),'error')}}
  button.onclick=()=>{modal.hidden=false;const invite=new URLSearchParams(location.search).get('invite');if(invite){$('[data-tab="join"]').click();$('#joinRoomForm [name="inviteCode"]').value=invite.toUpperCase()}};
  modal.addEventListener('click',event=>{if(event.target===modal||event.target.closest('[data-close]'))modal.hidden=true});
  modal.querySelectorAll('[data-tab]').forEach(tab=>tab.onclick=()=>{modal.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===tab));$('#createRoomForm').hidden=tab.dataset.tab!=='create';$('#joinRoomForm').hidden=tab.dataset.tab!=='join';message('')});
  $('#createRoomForm').onsubmit=event=>{event.preventDefault();run(()=>createRoom(event.currentTarget))};$('#joinRoomForm').onsubmit=event=>{event.preventDefault();run(()=>joinRoom(event.currentTarget))};
  $('#roomView').addEventListener('click',event=>{
    const copy=event.target.closest('[data-copy]'),save=event.target.closest('[data-save-credit]'),kick=event.target.closest('[data-kick]');
    if(copy){const url=`${location.origin}${location.pathname}?invite=${room.invite_code}`;navigator.clipboard?.writeText(url).then(()=>message('Invitación copiada.')).catch(()=>message(`Código: ${room.invite_code}`));}
    if(save){const id=save.dataset.saveCredit,input=$(`[data-credit="${id}"]`);run(()=>rpc('host_set_member_credits',{p_room_id:room.id,p_user_id:id,p_credits:Number(input.value)}));}
    if(kick)run(()=>rpc('host_remove_room_member',{p_room_id:room.id,p_user_id:kick.dataset.kick}));
    if(event.target.closest('[data-start]'))run(()=>rpc('host_update_casino_room',{p_room_id:room.id,p_host_mode:null,p_status:'active'}));
    if(event.target.closest('[data-exit]')){modal.hidden=true;message('Puedes volver a esta sala desde el botón Sala online.');}
    if(event.target.closest('[data-abandon]')&&confirm(host?'Al abandonar, la sala se cerrará para todos. ¿Continuar?':'Perderás tu lugar en esta sala. ¿Continuar?'))run(async()=>{await rpc('leave_casino_room',{p_room_id:room.id});localStorage.removeItem(ROOM_KEY);if(channel)client.removeChannel(channel);room=null;members=[];$('#roomView').hidden=true;$('#roomSetup').hidden=false;history.replaceState(null,'',location.pathname);button.innerHTML='<span>⌁</span><b>SALA ONLINE</b><small>Crear o unirse</small>';message('Has abandonado la sala.')});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)modal.hidden=true});
  resumeSavedRoom().catch(()=>{});
})();
