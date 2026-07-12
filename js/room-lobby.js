(function(){
  'use strict';
  const PAGE=(location.pathname.split('/').filter(Boolean).pop()||'').toLowerCase().replace(/\.html$/,'');
  const GAME_MAP={blackjack:'blackjack',roulette:'roulette','tres-y-dos':'tres-y-dos',domino:'domino',poker:'poker',dados:'dados'};
  const GAME_LABEL={blackjack:'Blackjack',roulette:'Ruleta','tres-y-dos':'Tres y Dos',domino:'Dominó',poker:'Póker',dados:'Dados'};
  const game=GAME_MAP[PAGE];if(!game)return;
  if(game==='domino'){for(const href of ['css/domino-teams.css','css/domino-numbered-lineup.css','css/domino-lineup-select.css']){const teamCss=document.createElement('link');teamCss.rel='stylesheet';teamCss.href=href;document.head.appendChild(teamCss)}}
  const ROOM_KEY=`casino.onlineRoom.${game}`;
  let client=null,user=null,profile=null,room=null,members=[],channel=null;
  const config=window.CASINO_SUPABASE_CONFIG||{};
  const escape=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

  const button=document.createElement('button');button.className='room-launcher';button.type='button';button.innerHTML='<span>⌁</span><b>SALA ONLINE</b><small>Crear o unirse</small>';document.body.appendChild(button);
  const quickExit=document.createElement('button');quickExit.className='room-quick-exit';quickExit.type='button';quickExit.hidden=true;quickExit.textContent='SALIR DE ESTA SALA';document.body.appendChild(quickExit);
  const modal=document.createElement('div');modal.className='room-modal';modal.hidden=true;modal.innerHTML=`
    <section class="room-card" role="dialog" aria-modal="true" aria-labelledby="roomTitle">
      <header><div><small>ANTESALA DE ${escape(GAME_LABEL[game]).toUpperCase()}</small><h2 id="roomTitle">Sala por invitación</h2></div><button type="button" data-close aria-label="Cerrar">×</button></header>
      <div id="profileGate" class="room-setup">
        <p class="guest-note"><strong>Primer paso: identifica tu perfil.</strong> La clave de recuperación es privada y solo sirve para recuperar tus puntos en tus propios dispositivos. Nunca se comparte para entrar a una sala.</p>
        <div class="room-tabs"><button type="button" data-profile-tab="create" class="active">CREAR PERFIL</button><button type="button" data-profile-tab="recover">RECUPERAR PERFIL</button></div>
        <form id="createProfileForm" class="room-form">
          <label>Nombre visible<input name="displayName" maxlength="20" required placeholder="Tu nombre en el casino"></label>
          <p class="guest-note">Generaremos un código de jugador y una clave privada. No necesitas correo ni teléfono.</p>
          <button class="primary-btn" type="submit">CREAR PERFIL SEGURO</button>
        </form>
        <form id="recoverProfileForm" class="room-form" hidden>
          <label>Código de jugador<input name="playerCode" maxlength="14" required placeholder="ORBIT-1A2B3C4D" autocomplete="username"></label>
          <label>Clave de recuperación<input name="recoveryKey" maxlength="39" required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="current-password"></label>
          <button class="primary-btn" type="submit">RECUPERAR MIS PUNTOS</button>
        </form>
        <div id="profileCreated" class="room-code" hidden><span>CÓDIGO DE JUGADOR</span><strong id="createdPlayerCode"></strong><span>CLAVE DE RECUPERACIÓN · GUÁRDALA AHORA</span><strong id="createdRecoveryKey" style="font-size:17px;letter-spacing:.08em"></strong><button type="button" data-copy-profile>Copiar credenciales</button><button type="button" data-profile-ready class="primary-btn">YA GUARDÉ MI CLAVE</button></div>
      </div>
      <div id="roomSetup" class="room-setup" hidden>
        <div class="room-tabs"><button type="button" data-tab="create" class="active">CREAR SALA</button><button type="button" data-tab="join">UNIRME CON CÓDIGO</button></div>
        <form id="createRoomForm" class="room-form">
          <label>Tu nombre<input name="displayName" maxlength="20" required placeholder="Nombre del anfitrión"></label>
          <label>Rol del anfitrión<select name="hostMode"><option value="playing">Jugar y administrar</option><option value="moderator">Solo moderar</option></select></label>
          <p class="guest-note">Cada jugador usará los puntos otorgados a su perfil por el administrador general.</p>
          <button class="primary-btn" type="submit">CREAR CÓDIGO DE INVITACIÓN</button>
        </form>
        <form id="joinRoomForm" class="room-form" hidden>
          <label>Tu nombre<input name="displayName" maxlength="20" required placeholder="Nombre del jugador"></label>
          <label>Código de invitación<input name="inviteCode" maxlength="6" required placeholder="ABC123" autocomplete="off"></label>
          <p class="guest-note">Pide al anfitrión únicamente este código de 6 caracteres. No escribas aquí tu clave privada de recuperación.</p>
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
  function generateRecoveryKey(){const bytes=crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{1,4}/g).join('-')}
  function activateProfile(value){profile=value;$('#profileGate').hidden=true;$('#roomSetup').hidden=false;modal.querySelectorAll('#createRoomForm [name="displayName"],#joinRoomForm [name="displayName"]').forEach(input=>{input.value=profile.display_name;input.readOnly=true});const invite=new URLSearchParams(location.search).get('invite');if(invite){$('[data-tab="join"]').click();$('#joinRoomForm [name="inviteCode"]').value=invite.toUpperCase()}message(`Perfil ${profile.player_code} · ${Number(profile.points).toLocaleString('es-ES')} puntos`)}
  async function ensureProfileState(){if(profile)return profile;const existing=await rpc('get_my_casino_profile');if(existing)activateProfile(existing);else{$('#profileGate').hidden=false;$('#roomSetup').hidden=true}return existing}
  async function createRoom(form){const values=new FormData(form);const result=await rpc('create_casino_room',{p_game_type:game,p_host_mode:values.get('hostMode'),p_display_name:values.get('displayName'),p_initial_credits:0});await openRoom(result.room_id)}
  async function joinRoom(form){const values=new FormData(form);const result=await rpc('join_casino_room',{p_invite_code:String(values.get('inviteCode')).trim().toUpperCase(),p_display_name:values.get('displayName')});await openRoom(result.room_id)}
  async function openRoom(id){room={id};await refresh();localStorage.setItem(ROOM_KEY,room.id);subscribe();history.replaceState(null,'',`${location.pathname}?room=${room.invite_code}`)}
  async function resumeSavedRoom(){const id=localStorage.getItem(ROOM_KEY);if(!id)return;try{await openRoom(id)}catch(error){localStorage.removeItem(ROOM_KEY);room=null;throw error}}
  async function leaveCurrentRoom(){const wasHost=room?.host_id===user?.id;if(!room?.id)return;await rpc('leave_casino_room',{p_room_id:room.id});localStorage.removeItem(ROOM_KEY);if(channel)client.removeChannel(channel);clearInterval(pollTimer);room=null;members=[];quickExit.hidden=true;document.body.classList.remove('domino-online-active','blackjack-online-active');profile=await rpc('get_my_casino_profile');$('#roomView').hidden=true;activateProfile(profile);history.replaceState(null,'',location.pathname);button.innerHTML='<span>⌁</span><b>SALA ONLINE</b><small>Crear o unirse</small>';message(wasHost?'Cerraste la sala. Ya puedes crear o entrar a otra.':'Saliste de la sala. Ya puedes crear o entrar a otra.')}
  async function refresh(){
    if(!room?.id)return;await ensureClient();
    const [{data:roomData,error:roomError},{data:memberData,error:memberError}]=await Promise.all([client.from('casino_rooms').select('*').eq('id',room.id).single(),client.from('casino_room_members').select('*').eq('room_id',room.id).order('seat',{ascending:true,nullsFirst:false})]);
    if(roomError)throw roomError;if(memberError)throw memberError;room=roomData;members=memberData||[];renderRoom();
  }
  let pollTimer=null;
  function subscribe(){
    if(channel)client.removeChannel(channel);
    channel=client.channel(`casino-room-${room.id}`).on('postgres_changes',{event:'*',schema:'public',table:'casino_rooms',filter:`id=eq.${room.id}`},refresh).on('postgres_changes',{event:'*',schema:'public',table:'casino_room_members',filter:`room_id=eq.${room.id}`},refresh).subscribe();
    // Red de seguridad: si el navegador pierde momentáneamente la conexión de Realtime (pestaña en segundo
    // plano, wifi inestable, etc.) esta partida sigue quedando sincronizada porque igual se refresca sola.
    clearInterval(pollTimer);pollTimer=setInterval(()=>{if(room?.id&&room.status==='active')refresh().catch(()=>{})},4000);
  }
  function dominoTeamsMarkup(host){if(room.game_type!=='domino')return'';const lineup=Array.isArray(room.domino_lineup)?room.domino_lineup:[];if(host)return'<p class="sync-notice">Asigna personas y BOT desde los cuatro selectores de la mesa principal de dominó.</p>';if(lineup.length!==4)return'';const name=value=>String(value).toUpperCase()==='BOT'?'BOT':members.find(m=>m.user_id===value)?.display_name||'Jugador';return`<div class="domino-pair-summary"><span><b>PAREJA A</b>${escape(name(lineup[0]))} + ${escape(name(lineup[2]))}</span><span><b>PAREJA B</b>${escape(name(lineup[1]))} + ${escape(name(lineup[3]))}</span></div>`}
  function setupDominoTeamBuilder(){const builder=$('.domino-team-builder');if(!builder)return;const players=members.filter(m=>m.member_role!=='spectator'&&m.seat!==null).sort((a,b)=>(a.join_number||99)-(b.join_number||99)),fields=[...builder.querySelectorAll('[data-lineup-slot]')];builder.querySelector('[data-auto-pairs]')?.addEventListener('click',()=>{const values=players.length===2?[players[0].join_number,players[1].join_number,'BOT','BOT']:players.map(p=>p.join_number);fields.forEach((field,index)=>field.value=String(values[index]||''))});builder.querySelector('[data-save-pairs]')?.addEventListener('click',()=>{const slots=fields.map(field=>field.value);if(slots.some(value=>!value))return message('Selecciona los cuatro lugares.','error');run(async()=>{await rpc('host_set_domino_lineup',{p_room_id:room.id,p_slots:slots});message('Lugares y parejas guardados.')})})}
  function renderRoom(){
    const host=room.host_id===user.id,me=members.find(member=>member.user_id===user.id),status={waiting:'Esperando jugadores',active:'Partida iniciada',closed:'Sala cerrada'}[room.status]||room.status;
    $('#roomSetup').hidden=true;const view=$('#roomView');view.hidden=false;
    view.innerHTML=`<div class="room-code"><span>CÓDIGO DE INVITACIÓN</span><strong>${escape(room.invite_code)}</strong><button type="button" data-copy>Copiar invitación</button></div>
      <div class="room-meta"><span>${escape(GAME_LABEL[room.game_type])}</span><span>${escape(status)}</span><span>${members.length} conectados</span></div>
      ${host?`<label class="host-mode-control">Tu función<select id="onlineHostMode" ${room.status!=='waiting'?'disabled':''}><option value="playing" ${room.host_mode==='playing'?'selected':''}>Jugar y moderar</option><option value="moderator" ${room.host_mode==='moderator'?'selected':''}>Solo moderar</option></select></label>`:`<p class="guest-note">El anfitrión modera la sala. Solo el administrador general puede otorgar o editar puntos.</p>`}
      <div class="online-members">${members.map(member=>`<article class="online-member ${member.user_id===room.host_id?'host':''} ${member.member_role==='spectator'?'spectator':''}"><span class="online-avatar">${member.member_role==='spectator'?'◉':escape(member.join_number||member.display_name.charAt(0).toUpperCase())}</span><div><b>${escape(member.display_name)}</b><small>${member.user_id===room.host_id?'ANFITRIÓN · ':''}${member.member_role==='spectator'?'ESPECTADOR':member.seat===null?'MODERADOR':`JUGADOR #${member.join_number||member.seat+1}`}${room.game_type==='domino'&&member.team_no!==null&&member.team_no!==undefined?` · PAREJA ${Number(member.team_no)===0?'A':'B'}`:''}</small></div><strong>${member.credits.toLocaleString('es-ES')} puntos</strong>${host&&member.user_id!==user.id&&room.game_type!=='domino'?`<button type="button" class="seat-toggle" data-seat="${member.user_id}" data-seated="${member.seat!==null}">${member.seat!==null?'Enviar a la banca':'Sentar en la mesa'}</button>`:''}${host&&member.user_id!==user.id?`<button type="button" class="kick" data-kick="${member.user_id}">Expulsar</button>`:''}</article>`).join('')}</div>
      ${host&&room.game_type!=='domino'?'<p class="guest-note">Solo tú puedes repartir/manejar la mesa. Usa “Sentar en la mesa” o “Enviar a la banca” para decidir quién juega esta ronda.</p>':''}
      ${dominoTeamsMarkup(host)}
      <div class="room-actions">${host&&room.status==='waiting'?'<button type="button" class="primary-btn" data-start>INICIAR SALA</button>':''}${host?'<button type="button" class="outline-btn" data-reset-room>RESTABLECER JUEGO / MARCADOR</button>':''}<button type="button" class="outline-btn" data-exit>SALIR Y VOLVER DESPUÉS</button><button type="button" class="outline-btn room-abandon" data-abandon>${host?'ABANDONAR Y CERRAR SALA':'ABANDONAR SALA'}</button></div>
      ${room.status==='active'?'<p class="sync-notice">La sala está activa y preparada para sincronizar la partida.</p>':''}`;
    button.innerHTML=`<span>${host?'♛':'●'}</span><b>${escape(room.invite_code)}</b><small>${me?'Sala conectada':'Reconectando…'}</small>`;
    quickExit.hidden=!me;quickExit.textContent=host?'CERRAR Y SALIR DE LA SALA':'SALIR DE ESTA SALA';
    window.CasinoOnlineRoom={client,user,room,members,host,rpc};window.dispatchEvent(new CustomEvent('casino:online-room',{detail:window.CasinoOnlineRoom}));
    view.querySelector('#onlineHostMode')?.addEventListener('change',event=>run(()=>rpc('host_update_casino_room',{p_room_id:room.id,p_host_mode:event.target.value,p_status:null})));
    setupDominoTeamBuilder();
  }
  function friendlyError(error){const raw=error?.message||String(error),known={INVITE_CODE_NOT_FOUND:'Ese código de invitación no existe. Verifica los 6 caracteres.',ROOM_CLOSED:'La sala ya fue cerrada.',ROOM_LOCKED:'La sala está bloqueada temporalmente por administración.',ROOM_FULL:'La sala está llena.',DOMINO_ALREADY_DEALT:'La mano de dominó ya comenzó y las fichas fueron repartidas.',PROFILE_IN_ANOTHER_ROOM:'Tu perfil ya está en otra sala. Usa “Salir de esta sala” antes de entrar aquí.',PROFILE_REQUIRED:'Primero crea o recupera tu perfil.',INVALID_INVITE_CODE:'El código debe tener exactamente 6 caracteres.',TWO_OR_FOUR_PLAYERS_REQUIRED:'Se necesitan exactamente 2 o 4 jugadores para acomodar la mesa.',TWO_BOTS_REQUIRED:'Con dos jugadores debes seleccionar exactamente dos BOT.',BOTS_NOT_ALLOWED_WITH_FOUR_PLAYERS:'Con cuatro jugadores no se utilizan BOT.',PLAYER_NUMBER_MUST_APPEAR_ONCE:'Cada número de jugador debe aparecer exactamente una vez.',FOUR_PLACES_REQUIRED:'Selecciona los cuatro lugares de la mesa.',HOST_ONLY:'Solo el creador de la sala puede administrar esta mesa.',HOST_ONLY_OR_ROOM_CLOSED:'Solo el creador puede restablecer una sala abierta.',USE_TWO_OR_FOUR_PEOPLE:'Selecciona cuatro personas o dos personas y dos BOT.',PLAYER_SELECTED_TWICE:'Una persona no puede ocupar dos lugares.',PLAYER_NOT_IN_ROOM:'Una de las personas seleccionadas ya no está en la sala.'};return known[Object.keys(known).find(key=>raw.includes(key))]||raw}
  async function run(action){try{message('Procesando…');await action();message('')}catch(error){message(friendlyError(error),'error')}}
  button.onclick=()=>{modal.hidden=false;run(()=>ensureProfileState())};
  quickExit.onclick=()=>{const host=room?.host_id===user?.id;if(confirm(host?'Cerrarás la sala para todos. ¿Continuar?':'Saldrás de esta sala y podrás entrar a otra. ¿Continuar?'))run(leaveCurrentRoom)};
  modal.addEventListener('click',event=>{if(event.target===modal||event.target.closest('[data-close]'))modal.hidden=true});
  modal.querySelectorAll('[data-tab]').forEach(tab=>tab.onclick=()=>{modal.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===tab));$('#createRoomForm').hidden=tab.dataset.tab!=='create';$('#joinRoomForm').hidden=tab.dataset.tab!=='join';message('')});
  modal.querySelectorAll('[data-profile-tab]').forEach(tab=>tab.onclick=()=>{modal.querySelectorAll('[data-profile-tab]').forEach(item=>item.classList.toggle('active',item===tab));$('#createProfileForm').hidden=tab.dataset.profileTab!=='create';$('#recoverProfileForm').hidden=tab.dataset.profileTab!=='recover';message('')});
  $('#createProfileForm').onsubmit=event=>{event.preventDefault();run(async()=>{const values=new FormData(event.currentTarget),key=generateRecoveryKey(),result=await rpc('create_casino_player_profile',{p_display_name:values.get('displayName'),p_recovery_key:key});profile=result;$('#createdPlayerCode').textContent=result.player_code;$('#createdRecoveryKey').textContent=key;$('#createProfileForm').hidden=true;$('#recoverProfileForm').hidden=true;modal.querySelectorAll('[data-profile-tab]').forEach(item=>item.hidden=true);$('#profileCreated').hidden=false})};
  $('#recoverProfileForm').onsubmit=event=>{event.preventDefault();run(async()=>{const values=new FormData(event.currentTarget),result=await rpc('recover_casino_player_profile',{p_player_code:String(values.get('playerCode')).trim().toUpperCase(),p_recovery_key:String(values.get('recoveryKey')).trim().toUpperCase()});activateProfile(result)})};
  $('[data-copy-profile]').onclick=()=>navigator.clipboard?.writeText(`${$('#createdPlayerCode').textContent}\n${$('#createdRecoveryKey').textContent}`).then(()=>message('Credenciales copiadas.')).catch(()=>message('Copia manualmente el código y la clave.'));
  $('[data-profile-ready]').onclick=()=>activateProfile(profile);
  $('#createRoomForm').onsubmit=event=>{event.preventDefault();run(()=>createRoom(event.currentTarget))};$('#joinRoomForm').onsubmit=event=>{event.preventDefault();run(()=>joinRoom(event.currentTarget))};
  $('#roomView').addEventListener('click',event=>{
    const copy=event.target.closest('[data-copy]'),kick=event.target.closest('[data-kick]'),seatToggle=event.target.closest('[data-seat]');
    if(copy){const url=`${location.origin}${location.pathname}?invite=${room.invite_code}`;navigator.clipboard?.writeText(url).then(()=>message('Invitación copiada.')).catch(()=>message(`Código: ${room.invite_code}`));}
    if(kick)run(()=>rpc('host_remove_room_member',{p_room_id:room.id,p_user_id:kick.dataset.kick}));
    if(seatToggle)run(()=>rpc('host_set_room_seat',{p_room_id:room.id,p_user_id:seatToggle.dataset.seat,p_seated:seatToggle.dataset.seated!=='true'}));
    if(event.target.closest('[data-start]'))run(async()=>{await rpc('host_update_casino_room',{p_room_id:room.id,p_host_mode:null,p_status:'active'});modal.hidden=true;message('Sala activa. Ya puedes usar los controles del juego.')});
    if(event.target.closest('[data-reset-room]')&&confirm('Esto reinicia el estado del juego y el marcador de esta sala. Solo el creador puede hacerlo. ¿Continuar?'))run(async()=>{await rpc('host_reset_casino_game',{p_room_id:room.id});await refresh();message('Juego y marcador restablecidos.')});
    if(event.target.closest('[data-exit]')){modal.hidden=true;message('Puedes volver a esta sala desde el botón Sala online.');}
    if(event.target.closest('[data-abandon]')&&confirm(host?'Al abandonar, la sala se cerrará para todos. ¿Continuar?':'Saldrás de esta sala y podrás entrar a otra. ¿Continuar?'))run(leaveCurrentRoom);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)modal.hidden=true});
  ensureProfileState().then(existing=>existing?resumeSavedRoom():null).catch(()=>{});
})();
