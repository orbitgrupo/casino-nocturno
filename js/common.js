(function(global){'use strict';
 const KEY='casino.profile.v1'; let profile={wallet:1000,theme:'casino'};
 const favicon=document.createElement('link');favicon.rel='icon';favicon.type='image/png';favicon.href='assets/casino-favicon.png?v=2';document.head.appendChild(favicon);
 try{profile={...profile,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){ }
 if(!['casino','elegant','night'].includes(profile.theme))profile.theme='casino';
 function save(){localStorage.setItem(KEY,JSON.stringify(profile));}
 function applyTheme(theme){profile.theme=theme;document.body.classList.remove('theme-casino','theme-elegant','theme-night');document.body.classList.add(`theme-${theme}`);document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));save();}
 function setWallet(value){profile.wallet=Math.max(0,Number(value)||0);save();document.querySelectorAll('[data-global-wallet],#globalWallet').forEach(e=>e.textContent=profile.wallet.toLocaleString('es-ES',{maximumFractionDigits:1}));}
 global.CasinoStore={get wallet(){return profile.wallet},setWallet,applyTheme,get theme(){return profile.theme},reset(){setWallet(1000)}};
 applyTheme(profile.theme);setWallet(profile.wallet);document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.theme)));
 const page=location.pathname.split('/').pop()||'index.html';
 if(['blackjack.html','roulette.html','tres-y-dos.html','domino.html'].includes(page)){
   const css=document.createElement('link');css.rel='stylesheet';css.href='css/rooms.css';document.head.appendChild(css);
   const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.appendChild(script)});
   load('js/supabase-config.js').then(()=>load('js/room-lobby.js')).catch(()=>{});
 }
})(window);
