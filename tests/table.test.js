const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','js','game.js'),'utf8'),context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','js','table.js'),'utf8'),context);
const { LocalTable, LocalTableGateway } = context.window.BlackjackTable;
const { Hand } = context.window.Blackjack;
const card = (rank,value) => ({rank,value,suit:'spades',symbol:'♠',color:'black'});

const table = new LocalTable();
table.addPlayer('Ana','human',1000);
table.addPlayer('Bot Uno','bot',1000);
assert.equal(table.players.length,2);
assert.throws(()=>table.addPlayer('Ana','human',1000));
table.startRound(50);
assert.equal(table.state,'playing');
assert.equal(table.players.every((p)=>p.hand.cards.length===2),true);
assert.throws(()=>table.removePlayer(table.players[0].id));

while(table.state==='playing') {
  const current=table.currentPlayer();
  if(current.type==='bot') table.botMove();
  else table.stand();
}
assert.equal(table.state,'resolved');
assert.equal(table.players.every((p)=>p.outcome),true);
table.newRound();
table.removePlayer(table.players[1].id);
assert.equal(table.players.length,1);

const restored = new LocalTable({players:[{name:'Sin saldo',type:'human',wallet:0}]});
assert.equal(restored.players[0].wallet,0);
const gateway = new LocalTableGateway(restored);
let updates=0; gateway.subscribe(()=>updates++); gateway.command('addPlayer',['Bot','bot',100]);
assert.equal(updates,2);

const manual = new LocalTable({dealerMode:'manual'});
manual.addPlayer('Admin','human',1000);
manual.state='playing'; manual.currentIndex=0; manual.players[0].bet=50; manual.players[0].wallet=950; manual.players[0].status='active';
manual.players[0].hand=new Hand(); manual.players[0].hand.add(card('10',10)); manual.players[0].hand.add(card('8',8));
manual.dealerHand=new Hand(); manual.dealerHand.add(card('10',10)); manual.dealerHand.add(card('6',6));
manual.stand(); assert.equal(manual.state,'dealer-turn');
manual.deck.cards.push(card('K',10)); manual.dealerHit(); assert.equal(manual.state,'resolved');

const automatic = new LocalTable({dealerMode:'automatic'});
automatic.addPlayer('Admin','human',1000);
automatic.state='playing'; automatic.currentIndex=0; automatic.players[0].bet=50; automatic.players[0].wallet=950; automatic.players[0].status='active';
automatic.players[0].hand=new Hand(); automatic.players[0].hand.add(card('10',10)); automatic.players[0].hand.add(card('8',8));
automatic.dealerHand=new Hand(); automatic.dealerHand.add(card('10',10)); automatic.dealerHand.add(card('8',8)); automatic.deck.cards.push(card('2',2));
automatic.stand(); assert.equal(automatic.dealerHand.getScore(),20); assert.equal(automatic.state,'resolved');
console.log('Todas las pruebas de mesa pasaron.');
