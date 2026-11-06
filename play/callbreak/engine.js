// Callbreak rules engine and computer player, ported from the Android app
// (callbreak-rules: CallbreakEngine.kt, CallbreakCards.kt, ai/CallbreakBot.kt HeuristicBot).
// Pure functions over plain objects: no DOM, so it can run under Node for tests.

export const SEATS = ["SOUTH", "EAST", "NORTH", "WEST"]; // anticlockwise play order
export const SUITS = ["S", "H", "C", "D"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const TRUMP = "S";
export const TOTAL_DEALS = 5;
export const MIN_BID = 1;
export const MAX_BID = 8;

const order = (rank) => RANKS.indexOf(rank) + 1; // 2 = 1 ... A = 13
const cardId = (c) => c.suit + c.rank;
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const nextSeat = (seat) => SEATS[(SEATS.indexOf(seat) + 1) % 4];

export function makeDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Display sort: by suit, highest rank first (matches the app). */
export function sortHand(hand) {
  return hand.slice().sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || order(b.rank) - order(a.rank));
}

function trickRank(card, leadSuit) {
  if (card.suit === TRUMP) return 100 + order(card.rank);
  if (card.suit === leadSuit) return 50 + order(card.rank);
  return order(card.rank);
}

function winningPlay(trick) {
  const lead = trick[0].card.suit;
  return trick.reduce((best, p) => (trickRank(p.card, lead) > trickRank(best.card, lead) ? p : best));
}

function dealRound({ starter, gameNumber, matchScores, roundResults, rng, deck }) {
  const d = deck || shuffle(makeDeck(), rng);
  const hands = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  const dealOrder = ["NORTH", "EAST", "SOUTH", "WEST"];
  d.forEach((card, i) => hands[dealOrder[i % 4]].push(card));
  for (const s of SEATS) hands[s] = sortHand(hands[s]);
  return {
    hands,
    turn: starter,
    roundStarter: starter,
    phase: "BIDDING",
    bids: {},
    currentTrick: [],
    completedTricks: [],
    tricksWon: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    lastCompletedTrick: null,
    roundResult: null,
    gameNumber,
    totalGames: TOTAL_DEALS,
    matchScores,
    roundResults,
    matchWinner: null,
  };
}

export function startGame(starter = "SOUTH", rng = Math.random) {
  return dealRound({
    starter,
    gameNumber: 1,
    matchScores: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    roundResults: [],
    rng,
  });
}

export function applyBid(state, seat, bid) {
  if (state.phase !== "BIDDING") throw new Error("Not in BIDDING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn to bid`);
  if (seat in state.bids) throw new Error(`${seat} has already bid`);
  if (!(bid >= MIN_BID && bid <= MAX_BID)) throw new Error("Bid out of range");
  const bids = { ...state.bids, [seat]: bid };
  if (Object.keys(bids).length === 4) {
    return { ...state, bids, turn: state.roundStarter, phase: "PLAYING", currentTrick: [] };
  }
  return { ...state, bids, turn: nextSeat(seat) };
}

/** Legal plays: you must follow suit, beat the winning card if you can, and trump when void. */
export function legalMoves(state, seat) {
  if (state.phase !== "PLAYING" || state.turn !== seat) return [];
  const hand = state.hands[seat];
  if (!hand.length) return [];
  if (!state.currentTrick.length) return hand;

  const lead = state.currentTrick[0].card.suit;
  const winning = winningPlay(state.currentTrick).card;
  const follow = hand.filter((c) => c.suit === lead);
  if (follow.length) {
    if (winning.suit === lead) {
      const higher = follow.filter((c) => order(c.rank) > order(winning.rank));
      if (higher.length) return higher;
    }
    return follow;
  }

  const spades = hand.filter((c) => c.suit === TRUMP);
  const trumped = winning.suit === TRUMP && lead !== TRUMP;
  if (spades.length) {
    if (trumped) {
      const higher = spades.filter((c) => order(c.rank) > order(winning.rank));
      return higher.length ? higher : hand;
    }
    return spades;
  }
  return hand;
}

export function isLegal(state, seat, card) {
  return legalMoves(state, seat).some((c) => sameCard(c, card));
}

function getScore(target, achieved) {
  if (target === achieved) return target;
  if (achieved > target) return Math.round((target + (achieved - target) * 0.1) * 10) / 10;
  return -target;
}

function scoreRound(state) {
  const roundScores = {};
  const matchScores = {};
  for (const s of SEATS) {
    roundScores[s] = getScore(state.bids[s], state.tricksWon[s]);
    matchScores[s] = Math.round((state.matchScores[s] + roundScores[s]) * 10) / 10;
  }
  return {
    gameNumber: state.gameNumber,
    bids: state.bids,
    tricksWon: state.tricksWon,
    roundScores,
    matchScores,
  };
}

export function play(state, seat, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in PLAYING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn to play`);
  if (!isLegal(state, seat, card)) throw new Error(`Illegal card ${cardId(card)} for ${seat}`);

  const hands = { ...state.hands, [seat]: state.hands[seat].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { player: seat, card }];
  if (trick.length < 4) {
    return { ...state, hands, currentTrick: trick, turn: nextSeat(seat) };
  }

  const winner = winningPlay(trick).player;
  const base = {
    ...state,
    hands,
    turn: winner,
    currentTrick: [],
    completedTricks: [...state.completedTricks, trick],
    tricksWon: { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 },
    lastCompletedTrick: trick,
  };
  if (base.completedTricks.length < 13) return base;

  const result = scoreRound(base);
  return {
    ...base,
    phase: "ROUND_OVER",
    roundResult: result,
    roundResults: [...state.roundResults, result],
    matchScores: result.matchScores,
  };
}

export function nextRound(prev, rng = Math.random) {
  if (prev.phase === "MATCH_OVER") return prev;
  if (prev.phase !== "ROUND_OVER") throw new Error("Not in ROUND_OVER phase");
  if (prev.gameNumber >= prev.totalGames) {
    const winner = SEATS.reduce((best, s) => (prev.matchScores[s] > prev.matchScores[best] ? s : best));
    return { ...prev, phase: "MATCH_OVER", matchWinner: winner };
  }
  return dealRound({
    starter: nextSeat(prev.roundStarter),
    gameNumber: prev.gameNumber + 1,
    matchScores: prev.matchScores,
    roundResults: prev.roundResults,
    rng,
  });
}

// ── Computer player (HeuristicBot, the one the Android app ships) ─────────────

const has = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const highest = (cards) => cards.reduce((b, c) => (order(c.rank) > order(b.rank) ? c : b));
const lowest = (cards) => cards.reduce((b, c) => (order(c.rank) < order(b.rank) ? c : b));
const highToLow = (cards) => cards.slice().sort((a, b) => order(b.rank) - order(a.rank));

function nonSuitPoint(card, all) {
  const suited = all.filter((c) => c.suit === card.suit).length;
  if (card.rank === "A") return 1.0;
  if (card.rank === "K") {
    if (has(all, card.suit, "A")) {
      return suited === 2 ? 1.0 : suited === 3 ? 0.8 : suited === 4 ? 0.3 : suited >= 5 ? 0.1 : 1.0;
    }
    return suited === 1 ? 0.0 : suited === 2 ? 0.5 : suited === 3 ? 0.6 : suited === 4 ? 0.3 : suited >= 5 ? 0.1 : 1.0;
  }
  if (card.rank === "Q") {
    if (has(all, card.suit, "A")) return suited === 2 ? 0.4 : suited === 3 ? 0.4 : suited === 4 ? 0.1 : 0.0;
    return suited === 2 ? 0.4 : suited === 3 ? 0.3 : 0.0;
  }
  return 0.0;
}

function trumpPoint(cards) {
  const n = (suit) => cards.filter((c) => c.suit === suit).length;
  const pos = (v) => (v < 0 ? 0 : v);
  const trumpable = pos(3 - n("H")) + pos(3 - n("C")) + pos(3 - n("D"));
  const spades = n(TRUMP);
  if (spades <= 1) return 0;
  if (spades === 2) return Math.min(1, trumpable);
  if (spades === 3) return Math.min(2, trumpable);
  return Math.min(3, trumpable);
}

function extraTrumpPoint(cards) {
  const spades = cards.filter((c) => c.suit === TRUMP);
  const ace = spades.some((c) => c.rank === "A");
  const king = spades.some((c) => c.rank === "K");
  const limit = ace && king ? 4.0 : ace ? 4.5 : 5.0;
  return Math.max(0, spades.length - limit);
}

// Kotlin's Math.round rounds half up; JS Math.round does too for positives.
export function chooseBid(state, seat) {
  const cards = state.hands[seat];
  const raw = cards.reduce((sum, c) => sum + nonSuitPoint(c, cards), 0) + trumpPoint(cards) + extraTrumpPoint(cards);
  return Math.min(MAX_BID, Math.max(MIN_BID, Math.round(raw)));
}

function playedIds(state) {
  const plays = [...state.completedTricks.flat(), ...state.currentTrick];
  return new Set(plays.map((p) => cardId(p.card)));
}

function highestRemaining(state, suit) {
  const played = playedIds(state);
  const left = makeDeck().filter((c) => c.suit === suit && !played.has(cardId(c)));
  return left.length ? highest(left) : null;
}

function trumpedSuits(state) {
  const out = new Set();
  for (const trick of state.completedTricks) {
    const lead = trick[0].card.suit;
    if (lead === TRUMP) continue;
    if (trick.slice(1).some((p) => p.card.suit === TRUMP)) out.add(lead);
  }
  return out;
}

function suitLeadCounts(state) {
  const counts = { S: 0, H: 0, C: 0, D: 0 };
  for (const trick of state.completedTricks) counts[trick[0].card.suit]++;
  return counts;
}

function chooseLead(state, seat, rng) {
  const hand = state.hands[seat];

  // playWinningCardSpade
  if (state.completedTricks.length + 1 >= 3) {
    const spades = hand.filter((c) => c.suit === TRUMP);
    if (spades.length && spades.length >= Math.trunc(hand.length / 2) - 1) {
      const top = highestRemaining(state, TRUMP);
      if (top && spades.some((c) => sameCard(c, top))) return top;
    }
  }

  // playKqStrategy
  const led = suitLeadCounts(state);
  const kq = [...hand.filter((c) => c.rank === "K"), ...hand.filter((c) => c.rank === "Q")];
  for (const card of kq) {
    if (led[card.suit] === 0 && !has(hand, card.suit, "A")) {
      const suited = hand.filter((c) => c.suit === card.suit);
      if (suited.length >= 2) {
        const lower = suited.filter((c) => order(c.rank) < order(card.rank));
        if (lower.length) return highest(lower);
      }
    }
  }

  // playWinningCard
  const trumped = trumpedSuits(state);
  for (const suit of shuffle(["C", "D", "H"], rng)) {
    const suited = hand.filter((c) => c.suit === suit);
    if (!suited.length) continue;
    const mine = highest(suited);
    const top = highestRemaining(state, suit);
    if (top && sameCard(top, mine) && !trumped.has(suit) && mine.rank !== "A") return mine;
  }

  // playHighestSuitLowCard
  const nonSpades = hand.filter((c) => c.suit !== TRUMP);
  if (nonSpades.length) return lowest(nonSpades);

  // defaultLead
  for (const suit of ["S", "H", "C", "D"]) {
    const suited = hand.filter((c) => c.suit === suit);
    if (suited.length) return highest(suited);
  }
  return hand[0];
}

function chooseFollow(state, legal) {
  const lead = state.currentTrick[0].card.suit;
  const position = state.currentTrick.length + 1;
  const sameSuit = legal.filter((c) => c.suit === lead);

  if (sameSuit.length) {
    if (sameSuit.length === 1) return sameSuit[0];
    const sorted = highToLow(sameSuit);
    if (position === 4) return sorted[sorted.length - 1];
    const winning = winningPlay(state.currentTrick).card;
    const ace = sameSuit.find((c) => c.rank === "A");
    if (ace && winning.suit === lead) return ace;
    const myHigh = sorted[0];
    const myLow = sorted[sorted.length - 1];
    const top = highestRemaining(state, myHigh.suit);
    const beatsWinner = trickRank(myHigh, myHigh.suit) > trickRank(winning, myHigh.suit);
    return top && sameCard(top, myHigh) && beatsWinner ? myHigh : myLow;
  }
  if (lead === TRUMP && legal.every((c) => c.suit === TRUMP)) return lowest(legal);
  const nonTrump = legal.filter((c) => c.suit !== TRUMP);
  return lowest(nonTrump.length ? nonTrump : legal);
}

export function chooseCard(state, seat, rng = Math.random) {
  const legal = legalMoves(state, seat);
  if (!legal.length) throw new Error(`No legal moves for ${seat}`);
  const chosen = state.currentTrick.length ? chooseFollow(state, legal) : chooseLead(state, seat, rng);
  return legal.some((c) => sameCard(c, chosen)) ? chosen : lowest(legal);
}
