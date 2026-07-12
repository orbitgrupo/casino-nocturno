const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname, '..', 'js', 'game.js'), 'utf8'), context);
const { Hand, BlackjackGame } = context.window.Blackjack;
const card = (rank, value) => ({ rank, value, suit: 'spades', symbol: '♠', color: 'black' });

function rig(game, player, dealer) {
  game.playerHand = new Hand(); player.forEach((c) => game.playerHand.add(c));
  game.dealerHand = new Hand(); dealer.forEach((c) => game.dealerHand.add(c));
  game.state = 'playing'; game.bet = 100; game.wallet = 900; game.canSurrender = true;
}

const soft = new Hand();
[card('A', 11), card('A', 11), card('9', 9)].forEach((c) => soft.add(c));
assert.equal(soft.getScore(), 21, 'varios ases deben ajustarse correctamente');

let game = new BlackjackGame();
rig(game, [card('A', 11), card('K', 10)], [card('10', 10), card('9', 9)]);
game.resolveNaturals(); assert.equal(game.outcome.type, 'blackjack'); assert.equal(game.wallet, 1150);

game = new BlackjackGame();
rig(game, [card('K', 10), card('9', 9)], [card('10', 10), card('8', 8)]);
game.stand(); assert.equal(game.outcome.type, 'win'); assert.equal(game.wallet, 1100);

game = new BlackjackGame();
rig(game, [card('10', 10), card('8', 8)], [card('K', 10), card('8', 8)]);
game.stand(); assert.equal(game.outcome.type, 'push'); assert.equal(game.wallet, 1000);

game = new BlackjackGame();
rig(game, [card('10', 10), card('8', 8)], [card('K', 10), card('9', 9)]);
game.stand(); assert.equal(game.outcome.type, 'lose'); assert.equal(game.wallet, 900);

game = new BlackjackGame();
rig(game, [card('K', 10), card('5', 5)], [card('10', 10), card('8', 8)]);
game.deck.cards.push(card('K', 10));
game.hit(); assert.equal(game.outcome.type, 'lose'); assert.equal(game.playerHand.isBust(), true);

game = new BlackjackGame();
rig(game, [card('10', 10), card('8', 8)], [card('10', 10), card('6', 6)]);
game.deck.cards.push(card('K', 10));
game.stand(); assert.equal(game.outcome.type, 'win'); assert.equal(game.dealerHand.isBust(), true);

game = new BlackjackGame();
rig(game, [card('10', 10), card('8', 8)], [card('K', 10), card('7', 7)]);
game.surrender(); assert.equal(game.outcome.type, 'surrender'); assert.equal(game.wallet, 950);

game = new BlackjackGame();
assert.throws(() => game.startRound(0));
assert.throws(() => game.startRound(1001));

console.log('Todas las pruebas de lógica pasaron.');
