(function(){
  'use strict';
  const VOICE_VERSION='20260715-livekit';
  const DEFAULT_ENDPOINT='/api/livekit/token';
  const LIB_SRC='vendor/livekit-client.umd.min.js';
  let room=null,current=null,micEnabled=false,connecting=false,libraryPromise=null;

  function escape(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function loadLibrary(){
    if(window.LivekitClient?.Room)return Promise.resolve(window.LivekitClient);
    if(libraryPromise)return libraryPromise;
    libraryPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector(`script[src="${LIB_SRC}"]`);
      const script=existing||document.createElement('script');
      script.src=LIB_SRC;
      script.onload=()=>window.LivekitClient?.Room?resolve(window.LivekitClient):reject(new Error('La librería de voz no está disponible.'));
      script.onerror=()=>reject(new Error('Falta vendor/livekit-client.umd.min.js. Instala el cliente de LiveKit localmente en el servidor.'));
      if(!existing)document.body.appendChild(script);
    });
    return libraryPromise;
  }
  function ensureDock(){
    let dock=document.getElementById('casinoVoiceDock');
    if(dock)return dock;
    dock=document.createElement('section');
    dock.id='casinoVoiceDock';
    dock.className='voice-dock';
    dock.hidden=true;
    dock.innerHTML=`<header><span class="voice-dot" data-voice-dot></span><div><b>Voz de la sala</b><small data-voice-status>Disponible en salas online</small></div></header>
      <div class="voice-actions">
        <button type="button" data-voice-join>ENTRAR A VOZ</button>
        <button type="button" data-voice-mic disabled>MIC APAGADO</button>
        <button type="button" data-voice-leave disabled>SALIR</button>
      </div>
      <div class="voice-speakers" data-voice-speakers></div>
      <audio data-voice-audio autoplay playsinline></audio>`;
    document.body.appendChild(dock);
    dock.querySelector('[data-voice-join]').onclick=()=>connect();
    dock.querySelector('[data-voice-mic]').onclick=()=>toggleMic();
    dock.querySelector('[data-voice-leave]').onclick=()=>disconnect();
    return dock;
  }
  function setStatus(text,state='idle'){
    const dock=ensureDock();
    dock.dataset.voiceState=state;
    dock.querySelector('[data-voice-status]').textContent=text;
    dock.querySelector('[data-voice-dot]').className=`voice-dot ${state}`;
  }
  function renderSpeakers(names=[]){
    const box=ensureDock().querySelector('[data-voice-speakers]');
    box.innerHTML=names.length?names.map(name=>`<span>${escape(name)}</span>`).join(''):'<small>Nadie está hablando ahora.</small>';
  }
  async function currentSessionToken(){
    const client=current?.client;
    if(!client?.auth?.getSession)return '';
    const {data}=await client.auth.getSession();
    return data?.session?.access_token||'';
  }
  async function requestToken(){
    const token=await currentSessionToken();
    const response=await fetch(window.CASINO_VOICE_TOKEN_ENDPOINT||DEFAULT_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      body:JSON.stringify({roomId:current.room.id})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo entrar a la voz.');
    return data;
  }
  async function connect(){
    if(connecting||room||!current?.room?.id)return;
    connecting=true;setStatus('Conectando micrófono…','connecting');
    try{
      const Livekit=await loadLibrary();
      const tokenData=await requestToken();
      room=new Livekit.Room({adaptiveStream:true,dynacast:true});
      room.on(Livekit.RoomEvent.TrackSubscribed,(track)=>{if(track.kind==='audio')track.attach(ensureDock().querySelector('[data-voice-audio]'))});
      room.on(Livekit.RoomEvent.TrackUnsubscribed,(track)=>track.detach?.());
      room.on(Livekit.RoomEvent.ActiveSpeakersChanged,(speakers)=>renderSpeakers(speakers.map(p=>p.name||p.identity)));
      room.on(Livekit.RoomEvent.Disconnected,()=>{room=null;micEnabled=false;updateButtons();setStatus('Voz desconectada','idle');renderSpeakers()});
      await room.connect(tokenData.url,tokenData.token,{autoSubscribe:true});
      await room.localParticipant.setMicrophoneEnabled(false);
      micEnabled=false;updateButtons();setStatus('Conectado · micrófono apagado','connected');renderSpeakers();
    }catch(error){setStatus(error.message||String(error),'error')}
    finally{connecting=false;updateButtons()}
  }
  async function toggleMic(){
    if(!room)return;
    micEnabled=!micEnabled;
    await room.localParticipant.setMicrophoneEnabled(micEnabled);
    setStatus(micEnabled?'Conectado · micrófono encendido':'Conectado · micrófono apagado','connected');
    updateButtons();
  }
  function disconnect(){room?.disconnect();room=null;micEnabled=false;updateButtons();setStatus('Voz desconectada','idle');renderSpeakers()}
  function updateButtons(){
    const dock=ensureDock(),join=dock.querySelector('[data-voice-join]'),mic=dock.querySelector('[data-voice-mic]'),leave=dock.querySelector('[data-voice-leave]');
    join.disabled=Boolean(room)||connecting||!current?.room?.id;
    mic.disabled=!room;leave.disabled=!room;
    mic.textContent=micEnabled?'MIC ENCENDIDO':'MIC APAGADO';
  }
  function sync(detail){
    current=detail;
    const dock=ensureDock();
    const active=Boolean(current?.room?.id&&current.room.status!=='closed');
    dock.hidden=!active;
    if(active){setStatus('Disponible · entra con micrófono apagado','idle');updateButtons()}
    else disconnect();
  }
  window.addEventListener('casino:online-room',event=>sync(event.detail));
  if(window.CasinoOnlineRoom)sync(window.CasinoOnlineRoom);
  window.CasinoVoice={version:VOICE_VERSION,connect,disconnect,toggleMic};
})();
