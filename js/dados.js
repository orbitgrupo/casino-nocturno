(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const bets=[],history=[];
  let point=null,rolling=false;

  const options=[
    {type:'pass',name:'Pass Line',short:'PASS LINE',group:'line',desc:'Salida: gana 7/11, pierde 2/3/12. Con punto: gana si sale el punto antes del 7.',pay:'1:1'},
    {type:'dont',name:"Don’t Pass Bar",short:"DON’T PASS",group:'line',desc:'Salida: gana 2/3, empata 12, pierde 7/11. Con punto: gana si sale 7 antes del punto.',pay:'1:1'},
    {type:'come',name:'Come',short:'COME',group:'line',desc:'Como Pass Line, pero se activa después de tu próxima tirada y viaja a 4/5/6/8/9/10.',pay:'1:1'},
    {type:'dontCome',name:"Don’t Come Bar",short:"DON’T COME",group:'line',desc:'Como Don’t Pass, pero se activa después de tu próxima tirada.',pay:'1:1'},
    {type:'field',name:'Field',short:'FIELD',group:'field',desc:'Una tirada: 3,4,9,10,11 pagan 1:1. 2 y 12 pagan 2:1.',pay:'1:1 / 2:1'},
    {type:'place4',name:'Place 4',short:'4',group:'place',desc:'Gana si sale 4 antes del 7.',pay:'9:5'},
    {type:'place5',name:'Place 5',short:'5',group:'place',desc:'Gana si sale 5 antes del 7.',pay:'7:5'},
    {type:'place6',name:'Place 6',short:'SIX',group:'place',desc:'Gana si sale 6 antes del 7.',pay:'7:6'},
    {type:'place8',name:'Place 8',short:'8',group:'place',desc:'Gana si sale 8 antes del 7.',pay:'7:6'},
    {type:'place9',name:'Place 9',short:'NINE',group:'place',desc:'Gana si sale 9 antes del 7.',pay:'7:5'},
    {type:'place10',name:'Place 10',short:'10',group:'place',desc:'Gana si sale 10 antes del 7.',pay:'9:5'},
    {type:'hard4',name:'Hard 4',short:'2+2',group:'hardway',desc:'Gana 2+2 antes de 4 fácil o 7.',pay:'7:1'},
    {type:'hard6',name:'Hard 6',short:'3+3',group:'hardway',desc:'Gana 3+3 antes de 6 fácil o 7.',pay:'9:1'},
    {type:'hard8',name:'Hard 8',short:'4+4',group:'hardway',desc:'Gana 4+4 antes de 8 fácil o 7.',pay:'9:1'},
    {type:'hard10',name:'Hard 10',short:'5+5',group:'hardway',desc:'Gana 5+5 antes de 10 fácil o 7.',pay:'7:1'},
    {type:'any7',name:'Any Seven',short:'ANY 7',group:'prop',desc:'Una tirada: gana si sale 7.',pay:'4:1'},
    {type:'craps',name:'Any Craps',short:'ANY CRAPS',group:'prop',desc:'Una tirada: gana con 2, 3 o 12.',pay:'7:1'},
    {type:'yo',name:'Yo / Once',short:'YO 11',group:'prop',desc:'Una tirada: gana si sale 11.',pay:'15:1'},
    {type:'aces2',name:'Aces',short:'2',group:'prop',desc:'Una tirada: gana con 1+1.',pay:'30:1'},
    {type:'aceDeuce3',name:'Ace-Deuce',short:'3',group:'prop',desc:'Una tirada: gana con 1+2.',pay:'15:1'},
    {type:'boxcars12',name:'Boxcars',short:'12',group:'prop',desc:'Una tirada: gana con 6+6.',pay:'30:1'}
  ];
  const optionMap=Object.fromEntries(options.map(x=>[x.type,x]));

  function chip(){return Number($('diceChip').value)||10}
  function total(){return bets.reduce((sum,bet)=>sum+Number(bet.amount||0),0)}
  function money(value){return Number(value||0).toLocaleString('es-ES',{maximumFractionDigits:1})}
  function status(text){$('diceStatus').textContent=text}
  function labelFor(bet){return bet.comePoint?`${bet.name} (${bet.comePoint})`:bet.name}

  function addBet(type){
    if(rolling)return;
    const def=optionMap[type],amount=chip();
    if(!def)return;
    if(total()+amount>CasinoStore.wallet)return status('Créditos insuficientes para esa apuesta.');
    bets.push({type,name:def.name,amount});
    renderBets();
    status(`Apuesta agregada: ${def.name}.`);
  }

  function renderBets(){
    $('diceTotalBet').textContent=`${money(total())} créditos`;
    $('diceBetList').replaceChildren(...bets.map((bet,index)=>{
      const row=document.createElement('div');
      row.innerHTML=`<span>${labelFor(bet)}</span><b>${money(bet.amount)}</b><button aria-label="Quitar apuesta">×</button>`;
      row.querySelector('button').onclick=()=>{if(!rolling){bets.splice(index,1);renderBets()}};
      return row;
    }));
    document.querySelectorAll('.dice-bet').forEach(button=>{
      const active=bets.filter(bet=>bet.type===button.dataset.betType).length;
      button.classList.toggle('has-bet',active>0);
      button.dataset.count=active?String(active):'';
    });
  }

  function betButton(type,extra=''){
    const option=optionMap[type],button=document.createElement('button');
    button.type='button';
    button.className=`dice-bet ${option.group} ${extra}`;
    button.dataset.betType=type;
    button.innerHTML=`<b>${option.short}</b><span>${option.name}</span><small>${option.pay}</small>`;
    button.title=option.desc;
    button.onclick=()=>addBet(type);
    return button;
  }

  function renderBoard(){
    const board=$('diceBoard'),left=document.createElement('section'),right=document.createElement('section'),center=document.createElement('section');
    left.className='craps-side left-side';
    right.className='craps-side right-side';
    center.className='craps-center-bets';
    const place=['place4','place5','place6','place8','place9','place10'];
    for(const side of [left,right]){
      const pointRow=document.createElement('div');pointRow.className='place-row';pointRow.append(...place.map(type=>betButton(type,'place-box')));
      const come=betButton('come','come-box');
      const field=betButton('field','field-box');
      const dont=betButton('dont','dont-box');
      const pass=betButton('pass','pass-box');
      const dontCome=betButton('dontCome','dont-come-box');
      side.append(pointRow,dontCome,come,field,dont,pass);
    }
    center.append(
      betButton('any7','prop-wide'),
      betButton('craps','prop-wide'),
      betButton('yo'),
      betButton('aces2'),
      betButton('aceDeuce3'),
      betButton('boxcars12'),
      betButton('hard4'),
      betButton('hard6'),
      betButton('hard8'),
      betButton('hard10')
    );
    const title=document.createElement('div');title.className='craps-title';title.innerHTML='<strong>DADOS</strong><span>Pass Line · Come · Field · Place · Hardways</span>';
    board.replaceChildren(title,left,center,right);
  }

  function renderRules(){
    $('diceRules').innerHTML=`
      <p><b>Salida:</b> cuando no hay punto activo. Pass gana con 7 u 11 y pierde con 2, 3 o 12. Don’t Pass gana con 2 o 3, empata con 12 y pierde con 7 u 11.</p>
      <p><b>Punto:</b> si en la salida cae 4, 5, 6, 8, 9 o 10, ese número queda marcado. Pass gana si se repite antes del 7; Don’t Pass gana si sale 7 primero.</p>
      <p><b>Come / Don’t Come:</b> funcionan como Pass y Don’t Pass, pero la apuesta viaja al número que salga después de colocarla.</p>
      <p><b>Field:</b> se resuelve en una sola tirada. 3, 4, 9, 10 y 11 pagan 1:1; 2 y 12 pagan 2:1.</p>
      <p><b>Place:</b> 4/10 pagan 9:5, 5/9 pagan 7:5 y 6/8 pagan 7:6. Pierden si sale 7 antes del número.</p>
      <p><b>Centro:</b> Any 7 paga 4:1; Any Craps paga 7:1; Yo 11 paga 15:1; 2 y 12 pagan 30:1; 3 paga 15:1. Hardways ganan si sale el doble antes del 7 o antes del número fácil.</p>`;
  }

  function dieClass(el,value,tilt){el.className=`die show-${value}`;el.style.setProperty('--tilt',`${tilt}deg`)}
  function setDice(a,b){dieClass($('dieOne'),a,-8);dieClass($('dieTwo'),b,9)}
  function addHistory(total){history.unshift(total);history.splice(14);$('diceHistory').innerHTML=history.map(x=>`<i>${x}</i>`).join('')}
  function placePayout(type,amount){
    const target=Number(type.replace('place','')),ratio={4:9/5,5:7/5,6:7/6,8:7/6,9:7/5,10:9/5}[target];
    return amount*(1+ratio);
  }
  function hardwayPayout(target,amount){return amount*({4:8,6:10,8:10,10:8}[target])}

  function resolveBet(bet,a,b,sum,comeOut){
    const amount=Number(bet.amount)||0,type=bet.type;
    if(type==='field')return [3,4,9,10,11].includes(sum)?{payout:amount*2}:[2,12].includes(sum)?{payout:amount*3}:{payout:0};
    if(type==='any7')return{payout:sum===7?amount*5:0};
    if(type==='craps')return{payout:[2,3,12].includes(sum)?amount*8:0};
    if(type==='yo')return{payout:sum===11?amount*16:0};
    if(type==='aces2')return{payout:sum===2?amount*31:0};
    if(type==='aceDeuce3')return{payout:sum===3?amount*16:0};
    if(type==='boxcars12')return{payout:sum===12?amount*31:0};
    if(type.startsWith('place')){const target=Number(type.replace('place',''));if(sum===target)return{payout:placePayout(type,amount)};if(sum===7)return{payout:0};return{keep:true,bet}}
    if(type.startsWith('hard')){const target=Number(type.replace('hard',''));if(sum===target&&a===b)return{payout:hardwayPayout(target,amount)};if(sum===7||sum===target)return{payout:0};return{keep:true,bet}}
    if(type==='pass'){if(comeOut)return[7,11].includes(sum)?{payout:amount*2}:[2,3,12].includes(sum)?{payout:0}:{keep:true,bet};return sum===point?{payout:amount*2}:sum===7?{payout:0}:{keep:true,bet}}
    if(type==='dont'){if(comeOut)return[2,3].includes(sum)?{payout:amount*2}:sum===12?{payout:amount}:[7,11].includes(sum)?{payout:0}:{keep:true,bet};return sum===7?{payout:amount*2}:sum===point?{payout:0}:{keep:true,bet}}
    if(type==='come'){
      if(!bet.comePoint)return[7,11].includes(sum)?{payout:amount*2}:[2,3,12].includes(sum)?{payout:0}:{keep:true,bet:{...bet,comePoint:sum}};
      return sum===bet.comePoint?{payout:amount*2}:sum===7?{payout:0}:{keep:true,bet};
    }
    if(type==='dontCome'){
      if(!bet.comePoint)return[2,3].includes(sum)?{payout:amount*2}:sum===12?{payout:amount}:[7,11].includes(sum)?{payout:0}:{keep:true,bet:{...bet,comePoint:sum}};
      return sum===7?{payout:amount*2}:sum===bet.comePoint?{payout:0}:{keep:true,bet};
    }
    return{payout:0};
  }

  function resolve(a,b){
    const sum=a+b,comeOut=point===null,stake=total(),keep=[],messages=[];let returns=0;
    for(const bet of bets){
      const result=resolveBet(bet,a,b,sum,comeOut);
      if(result.keep){keep.push(result.bet);if(result.bet!==bet&&result.bet.comePoint)messages.push(`${bet.name} viaja al ${result.bet.comePoint}`);continue}
      returns+=Number(result.payout)||0;
      if(result.payout>0)messages.push(`${labelFor(bet)} cobra ${money(result.payout)}`);
    }
    bets.splice(0,bets.length,...keep);
    if(comeOut&&[4,5,6,8,9,10].includes(sum))point=sum;
    else if(!comeOut&&(sum===point||sum===7))point=null;
    const kept=total(),net=returns+kept-stake;
    CasinoStore.setWallet(CasinoStore.wallet-stake+returns+kept);
    $('pointMarker').textContent=`PUNTO: ${point||'—'}`;
    addHistory(sum);
    renderBets();
    status(`${a} + ${b} = ${sum}. ${messages.join(' · ')||'Sin cobro.'} ${net>0?`Ganancia neta +${money(net)}`:net<0?`Resultado ${money(net)}`:'Sin cambio neto'}.`);
  }

  function roll(){
    if(rolling)return;
    if(!bets.length)return status('Coloca al menos una apuesta en el tablero.');
    rolling=true;$('rollDice').disabled=true;
    const d1=$('dieOne'),d2=$('dieTwo');
    d1.classList.add('rolling');d2.classList.add('rolling');
    let ticks=0;
    const shake=setInterval(()=>{setDice(1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6));if(++ticks>8)clearInterval(shake)},65);
    setTimeout(()=>{const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);setDice(a,b);d1.classList.remove('rolling');d2.classList.remove('rolling');resolve(a,b);rolling=false;$('rollDice').disabled=false},820);
  }

  $('rollDice').onclick=roll;
  $('clearDiceBets').onclick=()=>{if(!rolling){bets.length=0;renderBets();status('Apuestas limpiadas.')}};
  renderBoard();renderRules();renderBets();setDice(1,1);
})();
