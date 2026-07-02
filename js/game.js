(function (global) {
  'use strict';

  const SUITS = [
    { name: 'spades', symbol: '♠', color: 'black' },
    { name: 'hearts', symbol: '♥', color: 'red' },
    { name: 'diamonds', symbol: '♦', color: 'red' },
    { name: 'clubs', symbol: '♣', color: 'black' }
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  class Deck {
    constructor(random = Math.random) {
      this.random = random;
      this.reset();
    }

    reset() {
      this.cards = [];
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.cards.push({
            rank,
            suit: suit.name,
            symbol: suit.symbol,
            color: suit.color,
            value: rank === 'A' ? 11 : (['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank))
          });
        }
      }
      this.shuffle();
    }

    shuffle() {
      for (let i = this.cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
      }
    }

    draw() {
      if (!this.cards.length) this.reset();
      return this.cards.pop();
    }
  }

  class Hand {
    constructor() { this.cards = []; }
    add(card) { this.cards.push(card); return card; }

    getScore() {
      let total = this.cards.reduce((sum, card) => sum + card.value, 0);
      let aces = this.cards.filter((card) => card.rank === 'A').length;
      while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
      return total;
    }

    isBlackjack() { return this.cards.length === 2 && this.getScore() === 21; }
    isBust() { return this.getScore() > 21; }
  }

  class BlackjackGame {
    constructor(options = {}) {
      this.initialWallet = options.initialWallet || 1000;
      this.minimumBet = options.minimumBet || 10;
      this.wallet = Number.isFinite(options.wallet) ? options.wallet : this.initialWallet;
      this.deck = new Deck(options.random);
      this.state = 'betting';
      this.bet = 0;
      this.playerHand = new Hand();
      this.dealerHand = new Hand();
      this.outcome = null;
      this.canSurrender = false;
    }

    startRound(bet) {
      if (this.state === 'playing') throw new Error('Ya hay una ronda en curso.');
      if (!Number.isFinite(bet) || !Number.isInteger(bet)) throw new Error('La apuesta debe ser un número entero.');
      if (bet < this.minimumBet) throw new Error(`La apuesta mínima es ${this.minimumBet}.`);
      if (bet > this.wallet) throw new Error('No tienes créditos suficientes.');
      if (this.deck.cards.length < 15) this.deck.reset();

      this.bet = bet;
      this.wallet -= bet;
      this.state = 'playing';
      this.outcome = null;
      this.canSurrender = true;
      this.playerHand = new Hand();
      this.dealerHand = new Hand();
      this.playerHand.add(this.deck.draw());
      this.dealerHand.add(this.deck.draw());
      this.playerHand.add(this.deck.draw());
      this.dealerHand.add(this.deck.draw());

      if (this.playerHand.isBlackjack() || this.dealerHand.isBlackjack()) this.resolveNaturals();
      return this.snapshot();
    }

    resolveNaturals() {
      const player = this.playerHand.isBlackjack();
      const dealer = this.dealerHand.isBlackjack();
      if (player && dealer) return this.finish('push', 'Ambos tienen Blackjack. Empate.', this.bet);
      if (player) return this.finish('blackjack', '¡Blackjack! Ganaste con pago 3:2.', this.bet * 2.5);
      return this.finish('lose', 'El dealer tiene Blackjack.', 0);
    }

    hit() {
      this.assertPlaying();
      this.canSurrender = false;
      this.playerHand.add(this.deck.draw());
      if (this.playerHand.isBust()) this.finish('lose', 'Te pasaste de 21. Pierdes la apuesta.', 0);
      else if (this.playerHand.getScore() === 21) this.stand();
      return this.snapshot();
    }

    stand() {
      this.assertPlaying();
      this.canSurrender = false;
      while (this.dealerHand.getScore() < 17) this.dealerHand.add(this.deck.draw());
      const playerScore = this.playerHand.getScore();
      const dealerScore = this.dealerHand.getScore();
      if (this.dealerHand.isBust()) this.finish('win', 'El dealer se pasó. ¡Ganaste!', this.bet * 2);
      else if (playerScore > dealerScore) this.finish('win', 'Tu mano es mayor. ¡Ganaste!', this.bet * 2);
      else if (playerScore < dealerScore) this.finish('lose', 'El dealer tiene la mano mayor.', 0);
      else this.finish('push', 'Empate. Recuperas tu apuesta.', this.bet);
      return this.snapshot();
    }

    surrender() {
      this.assertPlaying();
      if (!this.canSurrender || this.playerHand.cards.length !== 2) throw new Error('Ya no puedes rendirte en esta ronda.');
      this.finish('surrender', 'Te rendiste. Recuperas la mitad de la apuesta.', this.bet / 2);
      return this.snapshot();
    }

    finish(type, message, payout) {
      this.wallet += payout;
      this.state = 'resolved';
      this.canSurrender = false;
      this.outcome = { type, message, payout };
      return this.outcome;
    }

    newRound() {
      if (this.state === 'playing') throw new Error('Termina la ronda actual primero.');
      this.state = 'betting';
      this.bet = 0;
      this.outcome = null;
      this.playerHand = new Hand();
      this.dealerHand = new Hand();
      return this.snapshot();
    }

    resetWallet() {
      this.wallet = this.initialWallet;
      this.state = 'betting';
      this.bet = 0;
      this.outcome = null;
      this.canSurrender = false;
      this.playerHand = new Hand();
      this.dealerHand = new Hand();
      this.deck.reset();
      return this.snapshot();
    }

    assertPlaying() {
      if (this.state !== 'playing') throw new Error('No hay una ronda activa.');
    }

    snapshot() {
      return {
        wallet: this.wallet,
        bet: this.bet,
        state: this.state,
        canSurrender: this.canSurrender,
        playerCards: [...this.playerHand.cards],
        dealerCards: [...this.dealerHand.cards],
        playerScore: this.playerHand.getScore(),
        dealerScore: this.dealerHand.getScore(),
        outcome: this.outcome
      };
    }
  }

  global.Blackjack = { Deck, Hand, BlackjackGame, SUITS, RANKS };
})(window);
