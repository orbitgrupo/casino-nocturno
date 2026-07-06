(function(){
  'use strict';
  const page=(location.pathname.split('/').filter(Boolean).pop()||'index').toLowerCase().replace(/\.html$/,''),selectors={
    blackjack:['#dealBtn','.turn-actions','#dealerActions','#newRoundBtn'],
    roulette:['#clearBets','#spinBtn'],
    'tres-y-dos':['#startTres','#nextTres','.hand-tools'],
    domino:['#startDomino','#passTurn','#nextDominoRound'],
    poker:['#startPoker','#pokerActions']
  }[page];
  if(!selectors)return;
  const media=matchMedia('(max-width:760px)'),dock=document.createElement('nav'),placements=[];dock.className='mobile-action-dock';dock.setAttribute('aria-label','Acciones principales del juego');
  function mount(){
    if(!media.matches){restore();return}
    document.body.classList.add('mobile-game-active');
    if(!dock.isConnected)document.body.appendChild(dock);
    selectors.forEach(selector=>{const element=document.querySelector(selector);if(!element||placements.some(item=>item.element===element))return;const marker=document.createComment(`posición móvil ${selector}`);element.parentNode.insertBefore(marker,element);placements.push({element,marker});dock.appendChild(element)});
  }
  function restore(){placements.splice(0).forEach(({element,marker})=>{marker.parentNode?.insertBefore(element,marker);marker.remove()});dock.remove();document.body.classList.remove('mobile-game-active')}
  media.addEventListener?.('change',mount);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
