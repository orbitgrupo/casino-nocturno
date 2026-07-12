(function (global) {
  'use strict';
  const { Deck, Hand } = global.Blackjack;

  class LocalTable {
    constructor(data = {}) {
      this.maxPlayers = 6;
      this.minimumBet = 10;
      this.deck = new Deck();
      this.players = [];
      this.dealerHand = new Hand();
      this.state = 'lobby';
      this.currentIndex = -1;
      this.message = 'Agrega jugadores o comienza la ronda.';
      this.nextId = 1;
      this.dealerMode = data.dealerMode === 'manual' ? 'manual' : 'automatic';
      (data.players || []).slice(0, this.maxPlayers).forEach((p) => {
        const name = String(p.name || '').trim();
        const type = ['human', 'bot'].includes(p.type) ? p.type : 'human';
        const wallet = Number(p.wallet);
        if (name && Number.isFinite(wallet) && wallet >= 0 && !this.players.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
          this.players.push({ id: `p${this.nextId++}`, name, type, wallet, bet: 0, hand: new Hand(), status: 'waiting', outcome: null });
        }
      });
    }

    addPlayer(name, type = 'human', wallet = 1000) {
      this.assertEditable();
      name = String(name || '').trim();
      wallet = Number(wallet);
      if (!name) throw new Error('Escribe el nombre del jugador.');
      if (!['human', 'bot'].includes(type)) throw new Error('Tipo de jugador inválido.');
      if (!Number.isFinite(wallet) || wallet < this.minimumBet) throw new Error('El saldo debe ser al menos 10.');
      if (this.players.length >= this.maxPlayers) throw new Error('La mesa admite hasta 6 jugadores.');
      if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('Ese nombre ya está en la mesa.');
      this.players.push({ id: `p${this.nextId++}`, name, type, wallet, bet: 0, hand: new Hand(), status: 'waiting', outcome: null });
      return this.snapshot();
    }

    removePlayer(id) {
      this.assertEditable();
      this.players = this.players.filter((p) => p.id !== id);
      return this.snapshot();
    }

    startRound(bet) {
      if (this.state === 'playing' || this.state === 'dealer-turn') throw new Error('Ya hay una ronda en curso.');
      bet = Number(bet);
      if (!Number.isInteger(bet) || bet < this.minimumBet) throw new Error('La apuesta mínima es 10 créditos.');
      const eligible = this.players.filter((p) => p.wallet >= bet);
      if (!eligible.length) throw new Error('Agrega un jugador con saldo suficiente.');
      if (this.deck.cards.length < this.players.length * 7 + 12) this.deck.reset();
      this.dealerHand = new Hand();
      this.players.forEach((p) => { p.bet = p.wallet >= bet ? bet : 0; p.hand = new Hand(); p.outcome = null; p.status = p.bet ? 'active' : 'no-funds'; if (p.bet) p.wallet -= p.bet; });
      for (let n = 0; n < 2; n += 1) {
        this.players.filter((p) => p.bet).forEach((p) => p.hand.add(this.deck.draw()));
        this.dealerHand.add(this.deck.draw());
      }
      this.state = 'playing';
      this.currentIndex = -1;
      if (this.dealerHand.isBlackjack()) {
        this.players.filter((p) => p.bet).forEach((p) => p.hand.isBlackjack() ? this.settle(p, 'push', 'Empate con Blackjack', p.bet) : this.settle(p, 'lose', 'Blackjack del dealer', 0));
        return this.finishRound('El dealer tiene Blackjack.');
      }
      this.players.filter((p) => p.bet && p.hand.isBlackjack()).forEach((p) => this.settle(p, 'blackjack', 'Blackjack 3:2', p.bet * 2.5));
      this.advanceTurn();
      return this.snapshot();
    }

    hit() {
      const p = this.currentPlayer();
      p.hand.add(this.deck.draw());
      if (p.hand.isBust()) { this.settle(p, 'lose', 'Se pasó de 21', 0); this.advanceTurn(); }
      else if (p.hand.getScore() === 21) { p.status = 'stood'; this.advanceTurn(); }
      else { p.status = 'active-hit'; this.message = `Turno de ${p.name}.`; }
      return this.snapshot();
    }

    stand() { const p = this.currentPlayer(); p.status = 'stood'; this.advanceTurn(); return this.snapshot(); }
    surrender() {
      const p = this.currentPlayer();
      if (p.hand.cards.length !== 2 || p.status === 'active-hit') throw new Error('Solo puede rendirse antes de pedir.');
      this.settle(p, 'surrender', 'Se rindió', p.bet / 2); this.advanceTurn(); return this.snapshot();
    }

    advanceTurn() {
      const next = this.players.findIndex((p, i) => i > this.currentIndex && ['active', 'active-hit'].includes(p.status));
      if (next >= 0) { this.currentIndex = next; this.message = `Turno de ${this.players[next].name}.`; return; }
      this.playDealer();
    }

    playDealer() {
      this.currentIndex = -1;
      if (this.dealerMode === 'manual') {
        this.state = 'dealer-turn';
        this.message = 'Turno del dealer: pide otra carta o plántalo.';
        return this.snapshot();
      }
      while (this.dealerHand.getScore() < 19) this.dealerHand.add(this.deck.draw());
      return this.resolveDealer();
    }

    dealerHit() {
      if (this.state !== 'dealer-turn') throw new Error('No es el turno del dealer.');
      this.dealerHand.add(this.deck.draw());
      if (this.dealerHand.isBust()) return this.resolveDealer();
      this.message = `Dealer: ${this.dealerHand.getScore()}. Puedes pedir otra carta o plantarlo.`;
      return this.snapshot();
    }

    dealerStand() {
      if (this.state !== 'dealer-turn') throw new Error('No es el turno del dealer.');
      return this.resolveDealer();
    }

    resolveDealer() {
      const dealerScore = this.dealerHand.getScore();
      this.players.filter((p) => p.status === 'stood').forEach((p) => {
        const score = p.hand.getScore();
        if (dealerScore > 21) this.settle(p, 'win', 'Dealer se pasó', p.bet * 2);
        else if (score > dealerScore) this.settle(p, 'win', 'Ganó', p.bet * 2);
        else if (score < dealerScore) this.settle(p, 'lose', 'Perdió', 0);
        else this.settle(p, 'push', 'Empate', p.bet);
      });
      this.finishRound('Ronda terminada. Revisa los resultados.');
      return this.snapshot();
    }

    botMove() {
      const p = this.currentPlayer();
      if (p.type !== 'bot') throw new Error('El jugador actual no es un bot.');
      return p.hand.getScore() < 17 ? this.hit() : this.stand();
    }

    settle(player, type, label, payout) { player.wallet += payout; player.status = 'done'; player.outcome = { type, label, payout }; }
    finishRound(message) { this.state = 'resolved'; this.currentIndex = -1; this.message = message; return this.snapshot(); }
    setDealerMode(mode) { this.assertEditable(); if (!['automatic','manual'].includes(mode)) throw new Error('Modo de dealer inválido.'); this.dealerMode = mode; return this.snapshot(); }
    newRound() { if (this.state === 'playing' || this.state === 'dealer-turn') throw new Error('Termina la ronda primero.'); this.state = 'lobby'; this.currentIndex = -1; this.dealerHand = new Hand(); this.players.forEach((p) => { p.bet = 0; p.hand = new Hand(); p.status = 'waiting'; p.outcome = null; }); this.message = 'Ajusta la mesa y comienza otra ronda.'; return this.snapshot(); }
    reset() { this.players = []; this.dealerHand = new Hand(); this.state = 'lobby'; this.currentIndex = -1; this.nextId = 1; this.message = 'Mesa restablecida. Agrega jugadores.'; }
    currentPlayer() { if (this.state !== 'playing' || this.currentIndex < 0) throw new Error('No hay un turno activo.'); return this.players[this.currentIndex]; }
    assertEditable() { if (this.state === 'playing' || this.state === 'dealer-turn') throw new Error('No puedes cambiar la mesa durante una ronda.'); }
    snapshot() { return { state: this.state, message: this.message, dealerMode:this.dealerMode, currentPlayerId: this.currentIndex >= 0 ? this.players[this.currentIndex].id : null, dealerCards: [...this.dealerHand.cards], dealerScore: this.dealerHand.getScore(), players: this.players.map((p) => ({ id:p.id,name:p.name,type:p.type,wallet:p.wallet,bet:p.bet,status:p.status,outcome:p.outcome,score:p.hand.getScore(),cards:[...p.hand.cards] })) }; }
    serialize() { return { dealerMode:this.dealerMode, players: this.players.map(({ name, type, wallet }) => ({ name, type, wallet })) }; }
  }

  // Esta interfaz será reemplazable por un gateway WebSocket cuando existan salas con código.
  class LocalTableGateway {
    constructor(table) { this.table = table; this.listeners = new Set(); }
    subscribe(listener) { this.listeners.add(listener); listener(this.table.snapshot()); return () => this.listeners.delete(listener); }
    command(name, payload) { const result = this.table[name](...(payload || [])); this.listeners.forEach((fn) => fn(this.table.snapshot())); return result; }
  }
  global.BlackjackTable = { LocalTable, LocalTableGateway };
})(window);
