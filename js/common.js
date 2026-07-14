(function(global){'use strict';
 function ensurePrivateAccess(){
  if(document.querySelector('script[src="js/access-gate.js"]'))return;
  document.documentElement.classList.add('casino-access-pending');
  if(!document.querySelector('link[href="css/access-gate.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='css/access-gate.css';document.head.appendChild(css)}
  const gate=()=>{if(document.querySelector('script[src="js/access-gate.js"]'))return;const script=document.createElement('script');script.src='js/access-gate.js';document.head.appendChild(script)};
  if(global.CASINO_SUPABASE_CONFIG)gate();else{const config=document.createElement('script');config.src='js/supabase-config.js';config.onload=gate;config.onerror=gate;document.head.appendChild(config)}
 }
 ensurePrivateAccess();
 const KEY='casino.profile.v1'; let profile={wallet:1000,theme:'casino'};
 const favicon=document.createElement('link');favicon.rel='icon';favicon.type='image/png';favicon.href='assets/casino-favicon.png?v=2';document.head.appendChild(favicon);
 const brandCss=document.createElement('link');brandCss.rel='stylesheet';brandCss.href='css/branding-motion.css';document.head.appendChild(brandCss);
 const motionCss=document.createElement('link');motionCss.rel='stylesheet';motionCss.href='css/smooth-game-motion.css';document.head.appendChild(motionCss);
 const revealCss=document.createElement('link');revealCss.rel='stylesheet';revealCss.href='css/smooth-card-reveal.css';document.head.appendChild(revealCss);
 const motionScript=document.createElement('script');motionScript.src='js/smooth-motion.js';motionScript.defer=true;document.head.appendChild(motionScript);
 const mobileCss=document.createElement('link');mobileCss.rel='stylesheet';mobileCss.href='css/mobile-experience.css?v=20260712mobile';document.head.appendChild(mobileCss);
 const mobileScript=document.createElement('script');mobileScript.src='js/mobile-experience.js?v=20260712mobile';mobileScript.defer=true;document.head.appendChild(mobileScript);
 try{profile={...profile,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){ }
 if(!['casino','elegant','night'].includes(profile.theme))profile.theme='casino';
 function save(){localStorage.setItem(KEY,JSON.stringify(profile));}
 function applyTheme(theme){profile.theme=theme;document.body.classList.remove('theme-casino','theme-elegant','theme-night');document.body.classList.add(`theme-${theme}`);document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));save();}
 function setWallet(value){profile.wallet=Math.max(0,Number(value)||0);save();document.querySelectorAll('[data-global-wallet],#globalWallet').forEach(e=>e.textContent=profile.wallet.toLocaleString('es-ES',{maximumFractionDigits:1}));}
 global.CasinoStore={get wallet(){return profile.wallet},setWallet,applyTheme,get theme(){return profile.theme},reset(){setWallet(1000)}};
 applyTheme(profile.theme);setWallet(profile.wallet);document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.theme)));
 const page=(location.pathname.split('/').filter(Boolean).pop()||'index').toLowerCase().replace(/\.html$/,'');
 if(page==='index'){const adminLink=document.createElement('a');adminLink.href='admin.html?v=20260712';adminLink.textContent='♠ ADMINISTRACIÓN';adminLink.setAttribute('aria-label','Abrir administración general');adminLink.style.cssText='position:fixed;z-index:70;left:16px;bottom:16px;padding:10px 14px;border:1px solid rgba(232,189,104,.35);border-radius:10px;color:#e8bd68;background:rgba(5,23,17,.92);font:800 8px sans-serif;letter-spacing:.12em;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.35)';document.body.appendChild(adminLink)}
 if(page==='index'){const profileLink=document.createElement('a');profileLink.href='profile.html?v=20260712';profileLink.textContent='MI PERFIL Y PUNTOS';profileLink.style.cssText='position:fixed;z-index:70;right:16px;bottom:16px;padding:10px 14px;border:1px solid rgba(232,189,104,.35);border-radius:10px;color:#e8bd68;background:rgba(5,23,17,.92);font:800 8px sans-serif;letter-spacing:.12em;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.35)';document.body.appendChild(profileLink)}
 if(['blackjack','roulette','tres-y-dos','domino','poker','dados'].includes(page)){
   const css=document.createElement('link');css.rel='stylesheet';css.href='css/rooms.css';document.head.appendChild(css);
   const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.appendChild(script)});
   load('js/supabase-config.js?v=20260713rooms')
    .then(()=>load('js/room-lobby.js?v=20260713sync'))
    .then(()=>page==='domino'?load('js/domino-online.js?v=20260712pass'):page==='blackjack'?load('js/blackjack-online.js?v=20260712pass'):['roulette','dados','tres-y-dos','poker'].includes(page)?load('js/casino-online-engines.js?v=20260713sync'):null)
    .catch(()=>{});
 }
})(window);
