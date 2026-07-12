(function(){
  'use strict';
  const config=window.CASINO_SUPABASE_CONFIG||{};
  let client;
  function library(){
    if(window.supabase?.createClient)return Promise.resolve();
    return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo establecer la conexión segura.'));document.head.appendChild(script)});
  }
  async function connect(){
    if(client)return client;
    if(!config.url||!config.publishableKey)throw new Error('El acceso seguro no está configurado.');
    await library();
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data:{session}}=await client.auth.getSession();
    if(!session){const {error}=await client.auth.signInAnonymously();if(error)throw error}
    return client;
  }
  async function rpc(name,params){await connect();const {data,error}=await client.rpc(name,params);if(error)throw error;return data}
  function unlock(profile){document.documentElement.classList.remove('casino-access-pending');document.body.classList.remove('access-gate-active');document.querySelector('.casino-access-gate')?.remove();window.CASINO_TRUSTED_PROFILE=profile;window.dispatchEvent(new CustomEvent('casino:access-granted',{detail:profile}))}
  function cover(){
    document.body.classList.add('access-gate-active');
    const gate=document.createElement('main');gate.className='casino-access-gate';gate.setAttribute('aria-label','Acceso al Casino Nocturno');
    gate.innerHTML='<section class="access-vault"><div class="access-seal">♠</div><small>CÍRCULO DE CONFIANZA</small><h1>Casino Nocturno</h1><p>Este es un espacio privado. Introduce la invitación única proporcionada directamente por la administración.</p><form class="access-form"><label>CÓDIGO PRIVADO DE ACCESO<input name="accessCode" required autocomplete="one-time-code" maxlength="34" placeholder="CIRC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" spellcheck="false"></label><button type="submit">ABRIR EL CASINO</button><p class="access-message" role="status"></p></form><small class="access-security">ACCESO CIFRADO · INVITACIÓN DE UN SOLO USO · INTENTOS LIMITADOS</small></section>';
    document.body.appendChild(gate);document.documentElement.classList.remove('casino-access-pending');
    const form=gate.querySelector('form'),input=form.elements.accessCode,button=form.querySelector('button'),message=form.querySelector('.access-message');
    input.addEventListener('input',()=>{input.value=input.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')});
    form.onsubmit=async event=>{event.preventDefault();button.disabled=true;message.textContent='Verificando invitación…';try{const result=await rpc('redeem_casino_access_code',{p_access_code:input.value});if(result?.authorized){message.textContent='Acceso concedido.';unlock(result);return}message.textContent=result?.message||'No fue posible autorizar el acceso.';if(result?.locked)input.disabled=true}catch(error){message.textContent=error.message||String(error)}finally{button.disabled=false}};
    input.focus();
  }
  function failure(error){
    cover();const box=document.querySelector('.access-vault'),form=box.querySelector('form'),message=box.querySelector('.access-message');form.hidden=true;message.textContent=error.message||String(error);const retry=document.createElement('button');retry.className='access-retry';retry.textContent='REINTENTAR CONEXIÓN';retry.onclick=()=>location.reload();box.appendChild(retry);
  }
  async function start(){try{const status=await rpc('get_casino_access_status',{});if(status?.authorized)unlock(status);else cover()}catch(error){failure(error)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
