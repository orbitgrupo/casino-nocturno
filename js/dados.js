(function(){'use strict';
 const $=id=>document.getElementById(id);
 const bets=[],history=[];
 let point=null,rolling=false;
 const options=[
  {type:'pass',name:'Línea de pase',desc:'Salida: gana 7/11, pierde 2/3/12. Con punto, gana si repite punto antes del 7.',pay:'1:1'},
  {type:'dont',name:'No pase',desc:'Salida: gana 2/3, empata 12, pierde 7/11. Con punto, gana si sale 7 antes del punto.',pay:'1:1'},
  {type:'field',name:'Campo',desc:'Una tirada: 3,4,9,10,11 pagan 1:1; 2 y 12 pagan doble.',pay:'1:1 / 2:1'},
  {type:'craps',name:'Any Craps',desc:'Gana si sale 2, 3 o 12 en la próxima tirada.',pay:'7:1'},
  {type:'yo',name:'Yo / Once',desc:'Gana si sale 11 en la próxima tirada.',pay:'15:1'},
  {type:'hard4',name:'Hard 4',desc:'Gana 2+2 antes de 4 fácil o 7.',pay:'7:1'},
  {type:'hard6',name:'Hard 6',desc:'Gana 3+3 antes de 6 fácil o 7.',pay:'9:1'},
  {type:'hard8',name:'Hard 8',desc:'Gana 4+4 antes de 8 fácil o 7.',pay:'9:1'},
  {type:'hard10',name:'Hard 10',desc:'Gana 5+5 antes de 10 fácil o 7.',pay:'7:1'}
 ];
 function chip(){return Number($('diceChip').value)||10}
 function total(){return bets.reduce((sum,bet)=>sum+bet.amount,0)}
 function status(text){$('diceStatus').textContent=text}
 function renderBets(){
  $('diceTotalBet').textContent=`${total().toLocaleString('es-ES')} créditos`;
  $('diceBetList').replaceChildren(...bets.map((bet,index)=>{
   const row=document.createElement('div');
   row.innerHTML=`<span>${bet.name}</span><b>${bet.amount}</b><button aria-label="Quitar apuesta">×</button>`;
   row.querySelector('button').onclick=()=>{if(!rolling){bets.splice(index,1);renderBets()}};
   return row;
  }));
 }
 function addBet(type){
  if(rolling)return;
  const def=options.find(x=>x.type===type),amount=chip();
  if(total()+amount>CasinoStore.wallet)return status('Créditos insuficientes para esa apuesta.');
  bets.push({type,name:def.name,amount});
  renderBets();
  status(`Apuesta agregada: ${def.name}.`);
 }
 function renderOptions(){
  $('diceBets').replaceChildren(...options.map(option=>{
   const button=document.createElement('button');
   button.type='button';button.className='dice-bet';
   button.innerHTML=`<b>${option.name}</b><span>${option.desc}</span><small>PAGA ${option.pay}</small>`;
   button.onclick=()=>addBet(option.type);
   return button;
  }));
 }
 function dieClass(el,value,tilt){el.className=`die show-${value}`;el.style.setProperty('--tilt',`${tilt}deg`)}
 function setDice(a,b){dieClass($('dieOne'),a,-8);dieClass($('dieTwo'),b,9)}
 function addHistory(total){history.unshift(total);history.splice(12);$('diceHistory').innerHTML=history.map(x=>`<i>${x}</i>`).join('')}
 function oneRollPayout(bet,a,b,sum){
  if(bet.type==='field'){if([3,4,9,10,11].includes(sum))return bet.amount*2;if(sum===2||sum===12)return bet.amount*3;return 0}
  if(bet.type==='craps')return [2,3,12].includes(sum)?bet.amount*8:0;
  if(bet.type==='yo')return sum===11?bet.amount*16:0;
  return null;
 }
 function hardwayResult(bet,a,b,sum){
  const target=Number(bet.type.replace('hard',''));
  if(sum===target&&a===b)return {done:true,payout:bet.amount*({4:8,6:10,8:10,10:8}[target])};
  if(sum===7||sum===target)return {done:true,payout:0};
  return {done:false,payout:0};
 }
 function resolve(a,b){
  const sum=a+b,comeOut=point===null;
  let returns=0,messageParts=[];
  const keep=[];
  for(const bet of bets){
   const quick=oneRollPayout(bet,a,b,sum);
   if(quick!==null){returns+=quick;if(quick)messageParts.push(`${bet.name} cobra ${quick}`);continue}
   if(bet.type.startsWith('hard')){
    const result=hardwayResult(bet,a,b,sum);
    if(result.done){returns+=result.payout;if(result.payout)messageParts.push(`${bet.name} cobra ${result.payout}`)}
    else keep.push(bet);
    continue;
   }
   if(bet.type==='pass'){
    if(comeOut){if([7,11].includes(sum)){returns+=bet.amount*2;messageParts.push('Línea de pase gana')}else if([2,3,12].includes(sum))messageParts.push('Craps: pase pierde');else keep.push(bet)}
    else if(sum===point){returns+=bet.amount*2;messageParts.push(`Pase gana al repetir ${point}`)}else if(sum===7)messageParts.push('Siete fuera: pase pierde');else keep.push(bet);
   }
   if(bet.type==='dont'){
    if(comeOut){if([2,3].includes(sum)){returns+=bet.amount*2;messageParts.push('No pase gana')}else if(sum===12){returns+=bet.amount;messageParts.push('No pase empata con 12')}else if([7,11].includes(sum))messageParts.push('No pase pierde');else keep.push(bet)}
    else if(sum===7){returns+=bet.amount*2;messageParts.push('No pase gana con 7')}else if(sum===point)messageParts.push('No pase pierde al repetir punto');else keep.push(bet);
   }
  }
  const stake=total();
  bets.splice(0,bets.length,...keep);
  if(comeOut&&[4,5,6,8,9,10].includes(sum))point=sum;
  else if(!comeOut&&(sum===point||sum===7))point=null;
  CasinoStore.setWallet(CasinoStore.wallet-stake+returns+keep.reduce((sum,bet)=>sum+bet.amount,0));
  $('pointMarker').textContent=`PUNTO: ${point||'—'}`;
  addHistory(sum);
  renderBets();
  const net=returns+keep.reduce((sum,bet)=>sum+bet.amount,0)-stake;
  status(`${a} + ${b} = ${sum}. ${messageParts.join(' · ')||'Sin cobro.'} ${net>0?`Ganancia neta +${net}`:net<0?`Resultado ${net}`:'Sin cambio neto'}.`);
 }
 function roll(){
  if(rolling)return;
  if(!bets.length)return status('Coloca al menos una apuesta.');
  rolling=true;$('rollDice').disabled=true;
  const d1=$('dieOne'),d2=$('dieTwo');
  d1.classList.add('rolling');d2.classList.add('rolling');
  let ticks=0;
  const shake=setInterval(()=>{setDice(1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6));if(++ticks>7)clearInterval(shake)},70);
  setTimeout(()=>{const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);setDice(a,b);d1.classList.remove('rolling');d2.classList.remove('rolling');resolve(a,b);rolling=false;$('rollDice').disabled=false},760);
 }
 $('rollDice').onclick=roll;
 $('clearDiceBets').onclick=()=>{if(!rolling){bets.length=0;renderBets();status('Apuestas limpiadas.')}};
 renderOptions();renderBets();setDice(1,1);
})();
