// Tarneeb rules engine and computer players, ported from the Android app
// (tarneeb-rules: TarneebEngine.kt, TarneebCards.kt, ai/TarneebBot.kt HeuristicBot,
// ai/SmartBidderBot.kt with the BALANCED persona). Standard Tarneeb only: no
// Egyptian (double/redouble) or Syrian 41 variants. Pure functions, no DOM.

export const SEATS = ["SOUTH", "EAST", "NORTH", "WEST"]; // anticlockwise play order
export const SUITS = ["S", "H", "C", "D"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const MIN_BID = 7;
export const MAX_BID = 13;
export const TARGET = 41;

const ord = (c) => RANKS.indexOf(c.rank) + 1; // 2 = 1 ... A = 13
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const cardId = (c) => c.suit + c.rank;
export const nextSeat = (s) => SEATS[(SEATS.indexOf(s) + 1) % 4];
export const opposite = (s) => SEATS[(SEATS.indexOf(s) + 2) % 4];
export const teamOf = (s) => (s === "SOUTH" || s === "NORTH" ? 1 : 2); // 1 = you + partner

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

export function sortHand(hand) {
  return hand.slice().sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || ord(b) - ord(a));
}

const DEAL_ORDER = ["NORTH", "EAST", "SOUTH", "WEST"];

function dealRound({ dealer, gameNumber, teamScores, redeals = 0, rng }) {
  const deck = shuffle(makeDeck(), rng);
  const hands = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  deck.forEach((c, i) => hands[DEAL_ORDER[i % 4]].push(c));
  for (const s of SEATS) hands[s] = sortHand(hands[s]);
  const eldest = nextSeat(dealer); // opens the auction and leads trick one
  return {
    phase: "BIDDING",
    dealer,
    leadStarter: eldest,
    turn: eldest,
    hands,
    highBid: null,
    highBidder: null,
    passed: [],
    bidLog: {}, // seat -> "Pass" | number, for the table bubbles
    contractBid: null,
    bidder: null,
    trump: null,
    currentTrick: [],
    completedTricks: [],
    tricksWon: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    lastCompletedTrick: null,
    lastTrickWinner: null,
    gameNumber,
    teamScores,
    redeals,
    roundResult: null,
    matchWinnerTeam: null,
  };
}

export function startGame(dealer = "WEST", rng = Math.random) {
  return dealRound({ dealer, gameNumber: 1, teamScores: { 1: 0, 2: 0 }, rng });
}

// ── Auction ──────────────────────────────────────────────────────────────────

export const minAllowedBid = (state) => (state.highBid === null ? MIN_BID : state.highBid + 1);

function nextActiveBidder(from, passed) {
  let n = nextSeat(from);
  for (let i = 0; i < 4; i++) {
    if (!passed.includes(n)) return n;
    n = nextSeat(n);
  }
  throw new Error("No active bidders remain");
}

/** value = number of tricks (7..13) or null to pass. */
export function applyBid(state, seat, value, rng = Math.random) {
  if (state.phase !== "BIDDING") throw new Error("Not in BIDDING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn to bid`);
  if (state.passed.includes(seat)) throw new Error(`${seat} has already passed`);
  const pass = value === null;
  if (!pass && !(value >= minAllowedBid(state) && value <= MAX_BID)) throw new Error("Bid out of range");

  const passed = pass ? [...state.passed, seat] : state.passed;
  const highBid = pass ? state.highBid : value;
  const highBidder = pass ? state.highBidder : seat;
  const bidLog = { ...state.bidLog, [seat]: pass ? "Pass" : value };
  const withBid = { ...state, passed, highBid, highBidder, bidLog };

  if (passed.length === 4) {
    // Nobody bid: throw the hand in and redeal with the same dealer.
    return dealRound({ dealer: state.dealer, gameNumber: state.gameNumber, teamScores: state.teamScores, redeals: state.redeals + 1, rng });
  }
  if (highBidder !== null && (passed.length === 3 || highBid === MAX_BID)) {
    return { ...withBid, phase: "TRUMP_SELECT", contractBid: highBid, bidder: highBidder, turn: highBidder };
  }
  return { ...withBid, turn: nextActiveBidder(seat, passed) };
}

export function selectTrump(state, seat, suit) {
  if (state.phase !== "TRUMP_SELECT") throw new Error("Not in TRUMP_SELECT phase");
  if (seat !== state.bidder) throw new Error("Only the winning bidder may pick trump");
  return { ...state, trump: suit, phase: "PLAYING", turn: state.leadStarter, currentTrick: [] };
}

// ── Play ─────────────────────────────────────────────────────────────────────

export function trickRank(card, lead, trump) {
  if (trump && card.suit === trump) return 100 + ord(card);
  if (card.suit === lead) return 50 + ord(card);
  return ord(card);
}

const winningPlay = (plays, trump) => {
  const lead = plays[0].card.suit;
  return plays.reduce((b, p) => (trickRank(p.card, lead, trump) > trickRank(b.card, lead, trump) ? p : b));
};

export function legalMoves(state, seat) {
  if (state.phase !== "PLAYING" || state.turn !== seat) return [];
  const hand = state.hands[seat];
  if (!hand.length) return [];
  if (!state.currentTrick.length) return hand;
  const lead = state.currentTrick[0].card.suit;
  const following = hand.filter((c) => c.suit === lead);
  return following.length ? following : hand;
}

export const isLegal = (state, seat, card) => legalMoves(state, seat).some((c) => sameCard(c, card));
const teamTricksOf = (state, team) => SEATS.filter((s) => teamOf(s) === team).reduce((n, s) => n + state.tricksWon[s], 0);

function scoreRound(state) {
  const contractTeam = teamOf(state.bidder);
  const other = contractTeam === 1 ? 2 : 1;
  const tricks = { 1: teamTricksOf(state, 1), 2: teamTricksOf(state, 2) };
  const bid = state.contractBid;
  const made = tricks[contractTeam] >= bid;
  const delta = made
    ? { [contractTeam]: tricks[contractTeam], [other]: 0 }
    : { [contractTeam]: -bid, [other]: tricks[other] };
  return {
    contractTeam,
    bidder: state.bidder,
    contractBid: bid,
    trump: state.trump,
    made,
    teamTricks: tricks,
    delta,
    teamScores: { 1: state.teamScores[1] + delta[1], 2: state.teamScores[2] + delta[2] },
  };
}

export function play(state, seat, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in PLAYING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn`);
  if (!isLegal(state, seat, card)) throw new Error(`Illegal card ${cardId(card)} for ${seat}`);

  const hands = { ...state.hands, [seat]: state.hands[seat].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { player: seat, card }];
  if (trick.length < 4) return { ...state, hands, currentTrick: trick, turn: nextSeat(seat) };

  const winner = winningPlay(trick, state.trump).player;
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const base = {
    ...state,
    hands,
    currentTrick: [],
    completedTricks: [...state.completedTricks, trick],
    lastCompletedTrick: trick,
    lastTrickWinner: winner,
    tricksWon,
    turn: winner,
  };
  if (base.completedTricks.length < 13) return base;

  const result = scoreRound(base);
  const scored = { ...base, phase: "ROUND_OVER", roundResult: result, teamScores: result.teamScores };
  if (Math.max(result.teamScores[1], result.teamScores[2]) >= TARGET) {
    return { ...scored, phase: "MATCH_OVER", matchWinnerTeam: result.teamScores[1] >= result.teamScores[2] ? 1 : 2 };
  }
  return scored;
}

export function nextRound(prev, rng = Math.random) {
  if (prev.phase !== "ROUND_OVER") throw new Error("Not in ROUND_OVER phase");
  return dealRound({ dealer: nextSeat(prev.dealer), gameNumber: prev.gameNumber + 1, teamScores: prev.teamScores, rng });
}

// ── Computer bidding: SmartBidderBot with the BALANCED persona ───────────────

const hasCard = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const count = (cards, suit) => cards.filter((c) => c.suit === suit).length;

function suitQualityScore(cards) {
  const w = { A: 4.0, K: 3.0, Q: 2.0, J: 1.0 };
  return cards.reduce((n, c) => n + (w[c.rank] || 0), 0) + Math.max(0, (cards.length - 4) * 0.5);
}

export function bestTrumpSuit(hand) {
  let best = SUITS[0];
  let score = -Infinity;
  for (const suit of SUITS) {
    const s = suitQualityScore(hand.filter((c) => c.suit === suit));
    if (s > score) { best = suit; score = s; }
  }
  return best;
}

// Combination-aware honour scorer (honorCombination = true).
function honourCombo(card, all) {
  const n = count(all, card.suit);
  const A = hasCard(all, card.suit, "A");
  const K = hasCard(all, card.suit, "K");
  const Q = hasCard(all, card.suit, "Q");
  const J = hasCard(all, card.suit, "J");
  if (card.rank === "A") return 1.0;
  if (card.rank === "K") {
    if (A) return n === 2 ? 1.0 : n === 3 ? 0.9 : n === 4 ? 0.5 : n >= 5 ? 0.2 : 1.0;
    if (Q) return n === 1 ? 0.0 : n === 2 ? 0.7 : n === 3 ? 0.65 : n === 4 ? 0.4 : n >= 5 ? 0.15 : 1.0;
    return n === 1 ? 0.0 : n === 2 ? 0.35 : n === 3 ? 0.5 : n === 4 ? 0.25 : n >= 5 ? 0.1 : 1.0;
  }
  if (card.rank === "Q") {
    if (A && K) return n >= 1 && n <= 3 ? 0.85 : n === 4 ? 0.65 : 0.4;
    if (K && J) return n >= 2 && n <= 3 ? 0.65 : n === 4 ? 0.45 : 0.2;
    if (K) return n === 2 ? 0.5 : n === 3 ? 0.4 : n === 4 ? 0.2 : 0.0;
    if (A && J) return n >= 2 && n <= 3 ? 0.65 : n === 4 ? 0.35 : 0.0;
    if (A) return n === 2 ? 0.5 : n === 3 ? 0.45 : n === 4 ? 0.2 : 0.0;
    return 0.0;
  }
  return 0.0;
}

function pointTrump(cards, trump) {
  const t = count(cards, trump);
  const trumpable = SUITS.filter((s) => s !== trump).reduce((n, s) => n + Math.max(0, 3 - count(cards, s)), 0);
  if (t <= 1) return 0;
  if (t === 2) return Math.min(1, trumpable);
  if (t === 3) return Math.min(2, trumpable);
  return Math.min(3, trumpable);
}

function extraTrump(cards, trump) {
  const trumps = cards.filter((c) => c.suit === trump);
  const ace = trumps.some((c) => c.rank === "A");
  const king = trumps.some((c) => c.rank === "K");
  const limit = ace && king ? 4.0 : ace ? 4.5 : 5.0;
  return Math.max(0.0, trumps.length - limit);
}

function shapeBonus(hand, trump) {
  const trumps = hand.filter((c) => c.suit === trump);
  if (trumps.length < 4) return 0.0;
  const scale = Math.min(1.0, (trumps.length - 3) / 2.0);
  const raw = SUITS.filter((s) => s !== trump).reduce((n, s) => {
    const c = count(hand, s);
    return n + (c === 0 ? 2.0 : c === 1 ? 1.0 : c === 2 ? 0.5 : 0.0);
  }, 0) * scale;
  return raw * 0.25; // BALANCED: shapeScale 0.25
}

function trumpControl(hand, trump) {
  const trumps = hand.filter((c) => c.suit === trump);
  const ace = trumps.some((c) => c.rank === "A");
  const king = trumps.some((c) => c.rank === "K");
  return ace && king ? 0.5 : ace ? 0.3 : king ? 0.1 : 0.0;
}

export function chooseBid(state, seat) {
  const minBid = minAllowedBid(state);
  if (minBid > MAX_BID) return null;
  if (state.highBidder === opposite(seat)) return null; // never overbid your partner
  const hand = state.hands[seat];
  const trump = bestTrumpSuit(hand);
  const honour = hand.reduce((n, c) => n + honourCombo(c, hand), 0);
  const shape = shapeBonus(hand, trump);
  const control = trumpControl(hand, trump);
  const own = honour + pointTrump(hand, trump) + extraTrump(hand, trump) + shape + control;
  const partnerExpected = Math.max(0, 13.0 - own) / 3.0;
  const ceiling = Math.min(MAX_BID, Math.max(0, Math.ceil(own + partnerExpected)));
  if (ceiling < MIN_BID || minBid >= ceiling) return null;

  // smartJump: only step +2 when headroom comes from control or shape.
  const headroom = ceiling - minBid;
  const canJump2 = control > 0.0 || shape > 0.5;
  const stepUp = headroom >= 4 && canJump2 ? 2 : headroom >= 2 ? 1 : 0;
  return Math.min(ceiling, MAX_BID, minBid + stepUp);
}

export function chooseTrump(state, seat) {
  return bestTrumpSuit(state.hands[seat]);
}

// ── Computer card play: HeuristicBot ─────────────────────────────────────────

const highest = (cards) => cards.reduce((b, c) => (ord(c) > ord(b) ? c : b));
const lowest = (cards) => cards.reduce((b, c) => (ord(c) < ord(b) ? c : b));
const highToLow = (cards) =>
  cards.slice().sort((a, b) => ord(b) - ord(a) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
const higherThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) > ord(base)));
const lowerThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) < ord(base)));

function highestRemaining(state, suit) {
  const inPlay = [...Object.values(state.hands).flat(), ...state.currentTrick.map((p) => p.card)];
  const ofSuit = inPlay.filter((c) => c.suit === suit);
  return ofSuit.length ? highest(ofSuit) : null;
}

function suitLeadCounts(state) {
  const counts = { S: 0, H: 0, C: 0, D: 0 };
  for (const t of state.completedTricks) counts[t[0].card.suit]++;
  return counts;
}

function trumpDoneMap(state, trump) {
  const out = { S: [], H: [], C: [], D: [] };
  for (const t of state.completedTricks) {
    const lead = t[0].card.suit;
    if (lead === trump) continue;
    for (const p of t.slice(1)) if (p.card.suit === trump) out[lead].push(p.player);
  }
  return out;
}

function shouldPlayToWin(state) {
  return teamTricksOf(state, teamOf(state.bidder)) < state.contractBid;
}

function minByGroup(groups) {
  // Smallest suit group first, ties broken by the lowest card inside it (first wins ties).
  return groups.reduce((best, g) => {
    if (g.length !== best.length) return g.length < best.length ? g : best;
    return ord(lowest(g)) < ord(lowest(best)) ? g : best;
  });
}

function groupBySuit(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.suit, [...(m.get(c.suit) || []), c]);
  return [...m.values()];
}

function playLeadToLose(legal, trump) {
  const nonTrump = legal.filter((c) => c.suit !== trump);
  if (nonTrump.length) return lowest(minByGroup(groupBySuit(nonTrump)));
  return lowest(legal);
}

export function playLeadToWin(state, seat, legal, trump) {
  // aceMove
  const ace = legal.find((c) => c.rank === "A" && (!hasCard(legal, c.suit, "Q") || hasCard(legal, c.suit, "K")));
  if (ace) return ace;
  // partnerCanTrumpCard
  const done = trumpDoneMap(state, trump);
  const partner = opposite(seat);
  for (const suit of SUITS.filter((s) => s !== trump)) {
    if (done[suit].includes(partner)) {
      const cards = legal.filter((c) => c.suit === suit);
      if (cards.length) return highest(cards);
    }
  }
  // playWinningTrump
  const trickNumber = Object.values(state.tricksWon).reduce((a, b) => a + b, 0) + 1;
  if (trickNumber >= 3) {
    const trumps = legal.filter((c) => c.suit === trump);
    if (trumps.length && !(trumps.length < Math.trunc(legal.length / 2) - 1)) {
      const top = highestRemaining(state, trump);
      if (top && trumps.some((c) => sameCard(c, top))) return top;
    }
  }
  // playKqStrategy
  const led = suitLeadCounts(state);
  for (const card of legal.filter((c) => c.rank === "K" || c.rank === "Q")) {
    if (led[card.suit] === 0 && !hasCard(legal, card.suit, "A")) {
      const suited = legal.filter((c) => c.suit === card.suit);
      if (suited.length >= 2) {
        const lower = lowerThan(suited, card);
        if (lower.length) return highest(lower);
      }
    }
  }
  // playHighestSuitLowCard
  const nonTrump = legal.filter((c) => c.suit !== trump);
  if (nonTrump.length) return lowest(nonTrump);
  return highest(legal);
}

function suitedStrategy(state, seat, same, trump) {
  if (same.length === 1) return same[0];
  const winning = winningPlay(state.currentTrick, trump);
  const partnerWinning = opposite(seat) === winning.player;
  const sorted = highToLow(same);
  const higher = higherThan(same, winning.card);
  const position = state.currentTrick.length + 1;
  if (position === 4) {
    if (partnerWinning) return lowest(sorted);
    return higher.length ? lowest(higher) : lowest(sorted);
  }
  const top = highestRemaining(state, sorted[0].suit);
  const myHigh = sorted[0];
  const myLow = sorted[sorted.length - 1];
  const beats = trickRank(myHigh, myHigh.suit, trump) > trickRank(winning.card, myHigh.suit, trump);
  const standing = top !== null && trickRank(winning.card, myHigh.suit, trump) > trickRank(top, myHigh.suit, trump);
  const myHighIsTop = top !== null && sameCard(top, myHigh);
  if (partnerWinning) {
    if (standing) return myLow;
    if (myHighIsTop && beats) return myHigh;
    return myLow;
  }
  return myHighIsTop && beats ? myHigh : myLow;
}

function trumpMove(state, seat, legal, trump) {
  const winning = winningPlay(state.currentTrick, trump);
  if (opposite(seat) === winning.player) return null;
  const trumps = legal.filter((c) => c.suit === trump);
  if (!trumps.length) return null;
  if (winning.card.suit !== trump) return lowest(trumps);
  const over = higherThan(trumps, winning.card);
  return over.length ? lowest(over) : null;
}

export function playFollowToWin(state, seat, legal, trump) {
  const lead = state.currentTrick[0].card.suit;
  const same = legal.filter((c) => c.suit === lead);
  if (same.length) return suitedStrategy(state, seat, same, trump);
  if (lead !== trump) {
    const t = trumpMove(state, seat, legal, trump);
    if (t) return t;
  }
  const nonTrump = legal.filter((c) => c.suit !== trump);
  return lowest(nonTrump.length ? nonTrump : legal);
}

function playFollowToLose(state, legal, trump) {
  const lead = state.currentTrick[0].card.suit;
  const winningCard = winningPlay(state.currentTrick, trump).card;
  const same = legal.filter((c) => c.suit === lead);
  if (same.length) {
    const below = lowerThan(same, winningCard);
    return below.length ? highest(below) : lowest(same);
  }
  const nonTrump = legal.filter((c) => c.suit !== trump);
  return lowest(nonTrump.length ? nonTrump : legal);
}

export function chooseCard(state, seat) {
  const legal = legalMoves(state, seat);
  if (!legal.length) throw new Error(`No legal moves for ${seat}`);
  const trump = state.trump;
  const win = shouldPlayToWin(state);
  const chosen = !state.currentTrick.length
    ? win ? playLeadToWin(state, seat, legal, trump) : playLeadToLose(legal, trump)
    : win ? playFollowToWin(state, seat, legal, trump) : playFollowToLose(state, legal, trump);
  return legal.some((c) => sameCard(c, chosen)) ? chosen : lowest(legal);
}
