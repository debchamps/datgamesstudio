// Twenty-Nine (29) rules engine and computer players, ported from the Android app
// (twentynine-rules: GameEngine.kt, GameState.kt, LegalMoves.kt, TrickRules.kt,
// ComputerBidder.kt). Double/Redouble and Single Hand included; no 7th-card or
// No-Trump options, and no optional house rules (all off by default in the app).
// Pure functions over plain objects; no DOM, so it runs under Node for tests.

export const SEATS = ["SOUTH", "EAST", "NORTH", "WEST"]; // anticlockwise play order
export const SUITS = ["S", "H", "C", "D"];
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
export const MATCH_SCORE = 6;
export const MIN_BID = 16;
export const MAX_BID = 28;

const TN_ORDER = { J: 13, 9: 12, A: 11, 10: 10, K: 9, Q: 8, 8: 7, 7: 6 };
const POINTS = { J: 3, 9: 2, A: 1, 10: 1, Q: 0, K: 0, 8: 0, 7: 0 };
export const tn = (card) => TN_ORDER[card.rank];
export const pts = (card) => POINTS[card.rank];
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const cardId = (c) => c.suit + c.rank;
export const nextSeat = (s) => SEATS[(SEATS.indexOf(s) + 1) % 4];
export const opposite = (s) => SEATS[(SEATS.indexOf(s) + 2) % 4];
export const isUs = (s) => s === "SOUTH" || s === "NORTH";
export const sameTeam = (a, b) => isUs(a) === isUs(b);

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
  return hand.slice().sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || tn(b) - tn(a));
}

const DEAL_ORDER = ["NORTH", "EAST", "SOUTH", "WEST"];
function dealFour(cards) {
  const hands = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  cards.forEach((c, i) => hands[DEAL_ORDER[i % 4]].push(c));
  return hands;
}

export const firstBidder = (dealer) => nextSeat(dealer);

/** New round: 4 cards each, auction opens with the player after the dealer. */
export function startRound(dealer = "WEST", rng = Math.random, deck = null) {
  const d = deck || shuffle(makeDeck(), rng);
  const initial = dealFour(d.slice(0, 16));
  for (const s of SEATS) initial[s] = sortHand(initial[s]);
  return {
    phase: "BIDDING",
    dealer,
    hands: initial,
    remainingDeck: d.slice(16),
    turn: firstBidder(dealer),
    bidding: { highest: 15, highestBidder: null, passed: [], lastWasDitto: false, dittoEligible: null },
    trump: null,
    trumpSetter: null,
    trumpReveal: null, // { player, trickNumber, playIndex }
    currentTrick: [],
    completedTricks: [],
    tricksWon: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    pointsWon: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    pairDeclaredBy: null,
    challenge: null, // { step, asked, calls } while phase is CHALLENGE
    multiplier: 1, // 1 normal, 2 doubled, 4 redoubled
    doubler: null,
    redoubler: null,
    isSingleHand: false,
    singleHandPlayer: null,
    lastCompletedTrick: null,
    lastTrickWinner: null,
    roundResult: null,
  };
}

// ── Bidding ──────────────────────────────────────────────────────────────────

const active = (b) => SEATS.filter((s) => !b.passed.includes(s));
const biddingComplete = (b) => active(b).length <= 1;
const biddingWinner = (b) => {
  const a = active(b);
  return a.length === 1 ? a[0] : a.length === 0 ? b.highestBidder : null;
};
export const winningBid = (b) => Math.max(b.highest, 16);

export function minimumLegalBid(state, seat) {
  const b = state.bidding;
  if (b.highestBidder && seat === b.dittoEligible && !b.lastWasDitto) return b.highest;
  return Math.max(MIN_BID, b.highest + 1);
}

function nextActiveBidder(from, b) {
  let c = nextSeat(from);
  for (let i = 0; i < 4; i++) {
    if (!b.passed.includes(c)) return c;
    c = nextSeat(c);
  }
  return from;
}

function enterTrumpSelection(state, winner, bidding) {
  return { ...state, bidding, phase: "TRUMP_SELECTION", turn: winner };
}

export function applyBid(state, seat, value) {
  if (state.phase !== "BIDDING") throw new Error("Not in BIDDING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn to bid`);
  const b = state.bidding;
  if (b.passed.includes(seat)) throw new Error(`${seat} already passed`);
  if (value < minimumLegalBid(state, seat)) throw new Error("Bid too low");
  if (value > MAX_BID) throw new Error("Maximum bid is 28");

  const prev = b.highestBidder;
  const isDitto = prev !== null && value === b.highest;
  const prevCanReply = prev !== null && !b.passed.includes(prev);
  const nb = {
    ...b,
    highest: Math.max(b.highest, value),
    highestBidder: seat,
    lastWasDitto: isDitto,
    dittoEligible: !isDitto && prevCanReply ? prev : null,
  };
  if (biddingComplete(nb)) return enterTrumpSelection(state, seat, nb);
  return { ...state, bidding: nb, turn: prevCanReply ? prev : nextActiveBidder(seat, nb) };
}

export function applyPass(state, seat) {
  if (state.phase !== "BIDDING") throw new Error("Not in BIDDING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn to bid`);
  const b = state.bidding;
  if (b.passed.includes(seat)) throw new Error(`${seat} already passed`);
  const nb = { ...b, passed: [...b.passed, seat] };
  if (biddingComplete(nb)) {
    const winner = biddingWinner(nb) || state.dealer;
    const final = biddingWinner(nb) ? nb : { ...nb, highest: 16, highestBidder: winner };
    return enterTrumpSelection(state, winner, final);
  }
  const next = nextActiveBidder(nb.highestBidder || seat, nb);
  return { ...state, bidding: { ...nb, lastWasDitto: false, dittoEligible: null }, turn: next };
}

/** Bid winner names trump. Players keep their first four cards for the Double/Redouble decisions. */
export function selectTrump(state, suit) {
  if (state.phase !== "TRUMP_SELECTION") throw new Error("Not in TRUMP_SELECTION phase");
  return {
    ...state,
    trump: suit,
    trumpSetter: state.turn,
    phase: "CHALLENGE",
    turn: firstBidder(state.dealer), // the first bidder leads trick one (a single hand overrides this)
    currentTrick: [],
    challenge: { step: "DOUBLE", asked: [], calls: {} },
  };
}

// ── Challenge phase: Double, Redouble, Single Hand (GameEngine.kt) ───────────

const SINGLE_HAND_ASK_ORDER = ["EAST", "WEST", "NORTH", "SOUTH"];
const bidderSeat = (state) => state.trumpSetter;

/** Defenders are asked in this order; your side asks you first, then your partner. */
function defenderOrder(state) {
  return isUs(bidderSeat(state)) ? ["EAST", "WEST"] : ["SOUTH", "NORTH"];
}

/** Who must answer the current challenge question. */
export function challengeDecider(state) {
  const ch = state.challenge;
  if (state.phase !== "CHALLENGE" || !ch) return null;
  if (ch.step === "DOUBLE") return defenderOrder(state)[ch.asked.length];
  if (ch.step === "REDOUBLE") return isUs(bidderSeat(state)) ? "SOUTH" : bidderSeat(state);
  return SINGLE_HAND_ASK_ORDER.find((s) => !(s in ch.calls)) || null;
}

function dealSecondHand(state) {
  if (!state.remainingDeck.length) return state;
  const extra = dealFour(state.remainingDeck);
  const hands = {};
  for (const s of SEATS) hands[s] = sortHand([...state.hands[s], ...extra[s]]);
  return { ...state, hands, remainingDeck: [] };
}

function startSingleHandStep(state) {
  const dealt = dealSecondHand(state);
  return { ...dealt, challenge: { step: "SINGLE_HAND", asked: [], calls: {} } };
}

/** Answer the current challenge question: true = call it, false = decline. */
export function challengeAnswer(state, accepted) {
  const ch = state.challenge;
  const decider = challengeDecider(state);
  if (!ch || !decider) throw new Error("Not in CHALLENGE phase");

  if (ch.step === "DOUBLE") {
    if (accepted) {
      return { ...state, multiplier: 2, doubler: decider, challenge: { step: "REDOUBLE", asked: [], calls: {} } };
    }
    const asked = [...ch.asked, decider];
    if (asked.length < defenderOrder(state).length) return { ...state, challenge: { ...ch, asked } };
    return startSingleHandStep(state);
  }

  if (ch.step === "REDOUBLE") {
    return startSingleHandStep(accepted ? { ...state, multiplier: 4, redoubler: decider } : state);
  }

  const calls = { ...ch.calls, [decider]: accepted };
  if (SINGLE_HAND_ASK_ORDER.some((s) => !(s in calls))) return { ...state, challenge: { ...ch, calls } };
  // You win a tie for the call; otherwise the last seat in the ask order that called.
  const caller = calls.SOUTH ? "SOUTH" : [...SINGLE_HAND_ASK_ORDER].reverse().find((s) => calls[s]) || null;
  return {
    ...state,
    phase: "PLAYING",
    challenge: null,
    isSingleHand: !!caller,
    singleHandPlayer: caller,
    turn: caller || state.turn,
  };
}

/** The player sitting out a single hand: the caller's partner. */
export const sitOutSeat = (state) => (state.isSingleHand ? opposite(state.singleHandPlayer) : null);
export const roundBidder = (state) => (state.isSingleHand ? state.singleHandPlayer : biddingWinner(state.bidding) || state.dealer);
const nextActiveSeat = (state, from) => {
  let s = nextSeat(from);
  if (s === sitOutSeat(state)) s = nextSeat(s);
  return s;
};

// ── Trump reveal, legality ───────────────────────────────────────────────────

export const completedCount = (state) => state.completedTricks.length;
export const isTrumpRevealed = (state) => state.trumpReveal !== null;
const leadSuitOf = (state) => (state.currentTrick.length ? state.currentTrick[0].card.suit : null);

export function canRevealTrump(state, seat) {
  if (state.phase !== "PLAYING" || state.isSingleHand || state.trump === null || state.trumpReveal || state.turn !== seat) return false;
  const lead = leadSuitOf(state);
  if (!lead) return false;
  return state.hands[seat].every((c) => c.suit !== lead);
}

export function revealTrump(state, seat) {
  if (!canRevealTrump(state, seat)) throw new Error(`${seat} cannot reveal trump now`);
  return {
    ...state,
    trumpReveal: { player: seat, trickNumber: completedCount(state), playIndex: state.currentTrick.length },
  };
}

export function legalMoves(state, seat) {
  if (state.phase !== "PLAYING" || state.turn !== seat) return [];
  const hand = state.hands[seat];
  if (hand.length <= 1) return hand;
  const lead = leadSuitOf(state);
  if (!lead) return hand;
  const following = hand.filter((c) => c.suit === lead);
  if (following.length) return following;
  const r = state.trumpReveal;
  if (r && r.player === seat && r.trickNumber === completedCount(state) && r.playIndex === state.currentTrick.length) {
    const trumps = hand.filter((c) => c.suit === state.trump);
    if (trumps.length) return trumps;
  }
  return hand;
}

export const isLegal = (state, seat, card) => legalMoves(state, seat).some((c) => sameCard(c, card));

function trumpStartIndex(state, trickNumber) {
  const r = state.trumpReveal;
  if (!r) return null;
  if (r.trickNumber < trickNumber) return 0;
  if (r.trickNumber === trickNumber) return r.playIndex;
  return null;
}

/** Winner of a (complete or in-progress) trick, honouring the hidden-trump rule. */
export function trickWinner(state, plays, trickNumber = completedCount(state)) {
  const lead = plays[0].card.suit;
  const start = trumpStartIndex(state, trickNumber);
  const trump = start === null ? null : state.trump;
  const trumpPlays =
    trump && trump !== lead ? plays.filter((p, i) => i >= start && p.card.suit === trump) : [];
  const contenders = trumpPlays.length ? trumpPlays : plays.filter((p) => p.card.suit === lead);
  return contenders.reduce((best, p) => (tn(p.card) > tn(best.card) ? p : best));
}

// ── Pair (King + Queen of trump) ─────────────────────────────────────────────

function canDeclarePairWithCard(state, seat, card) {
  const t = state.trump;
  if (!t || state.phase !== "PLAYING" || state.isSingleHand || !state.trumpReveal || state.pairDeclaredBy) return false;
  if (card.suit !== t || (card.rank !== "K" && card.rank !== "Q")) return false;
  const teamWon = state.tricksWon[seat] + state.tricksWon[opposite(seat)] > 0;
  if (!teamWon) return false;
  const other = card.rank === "K" ? "Q" : "K";
  return state.hands[seat].some((c) => c.suit === t && c.rank === other);
}

function adjustedTarget(state, bidder, base) {
  const d = state.pairDeclaredBy;
  const delta = !d ? 0 : sameTeam(d, bidder) ? -4 : 4;
  return Math.min(MAX_BID, Math.max(MIN_BID, base + delta));
}

// ── Play ─────────────────────────────────────────────────────────────────────

export function play(state, seat, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in PLAYING phase");
  if (state.turn !== seat) throw new Error(`Not ${seat}'s turn`);
  if (!isLegal(state, seat, card)) throw new Error(`Illegal card ${cardId(card)} for ${seat}`);

  const pairDeclaredBy = canDeclarePairWithCard(state, seat, card) ? seat : state.pairDeclaredBy;
  const hands = { ...state.hands, [seat]: state.hands[seat].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { player: seat, card }];

  if (trick.length < (state.isSingleHand ? 3 : 4)) {
    return { ...state, hands, currentTrick: trick, turn: nextActiveSeat(state, seat), pairDeclaredBy };
  }

  const trickNumber = completedCount(state);
  const winner = trickWinner(state, trick, trickNumber).player;
  const trickPts = trick.reduce((n, p) => n + pts(p.card), 0);
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const pointsWon = { ...state.pointsWon, [winner]: state.pointsWon[winner] + trickPts };
  const completedTricks = [
    ...state.completedTricks,
    { plays: trick, winner, trumpActive: trumpStartIndex(state, trickNumber) !== null },
  ];
  const base = {
    ...state,
    hands,
    currentTrick: [],
    completedTricks,
    lastCompletedTrick: trick,
    lastTrickWinner: winner,
    turn: winner,
    tricksWon,
    pointsWon,
    pairDeclaredBy,
  };

  const bidder = roundBidder(state);
  const bidderUs = isUs(bidder);
  const ourPoints = pointsWon.SOUTH + pointsWon.NORTH;
  const theirPoints = pointsWon.EAST + pointsWon.WEST;
  const ourTricks = tricksWon.SOUTH + tricksWon.NORTH;
  const theirTricks = tricksWon.EAST + tricksWon.WEST;
  const common = { bidder, trump: state.trump, ourPoints, theirPoints, ourTricks, theirTricks, bidderUs, multiplier: state.multiplier };

  if (state.isSingleHand) {
    // The caller must take every trick: one lost trick ends the round (-3), eight won is +3.
    const lost = winner !== bidder;
    if (!lost && completedTricks.length < 8) return base;
    const succeeded = !lost;
    const delta = succeeded ? 3 : -3;
    return {
      ...base,
      phase: "ROUND_OVER",
      roundResult: {
        ...common,
        bidTarget: 28,
        effectiveTarget: 28,
        pairDeclaredBy: null,
        isSingleHand: true,
        succeeded,
        ourDelta: bidderUs ? delta : 0,
        theirDelta: bidderUs ? 0 : delta,
      },
    };
  }

  if (completedTricks.length < 8) return base;

  // All 8 tricks played: the bidding team needs its (pair-adjusted) target in card points.
  const bidTarget = winningBid(state.bidding);
  const effective = adjustedTarget(base, bidder, bidTarget);
  const bidderPoints = bidderUs ? ourPoints : theirPoints;
  const succeeded = bidderPoints >= effective;
  const delta = (succeeded ? 1 : -1) * state.multiplier;
  return {
    ...base,
    phase: "ROUND_OVER",
    roundResult: {
      ...common,
      bidTarget,
      effectiveTarget: effective,
      pairDeclaredBy,
      isSingleHand: false,
      succeeded,
      ourDelta: bidderUs ? delta : 0,
      theirDelta: bidderUs ? 0 : delta,
    },
  };
}

// ── Computer bidding (ComputerBidder.kt) ─────────────────────────────────────

const hasCard = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const controlValue = (r) => (r === "J" ? 1.0 : r === "9" ? 0.7 : r === "A" ? 0.4 : r === "K" ? 0.3 : 0.0);
const hasPairIn = (suitCards) => suitCards.some((c) => c.rank === "K") && suitCards.some((c) => c.rank === "Q");

function suitTrumpScore(hand, suit) {
  const cards = hand.filter((c) => c.suit === suit);
  const control = cards.reduce((n, c) => n + controlValue(c.rank), 0);
  return cards.length * 2.0 + control + (hasPairIn(cards) ? 1.5 : 0.0);
}

export function bestTrumpSuit(hand) {
  if (!hand.length) return "S";
  let best = null;
  let bestScore = -Infinity;
  for (const suit of ["S", "H", "C", "D"]) {
    const s = suitTrumpScore(hand, suit);
    if (s > bestScore) { best = suit; bestScore = s; }
  }
  return best;
}

function noTrumpScore(hand) {
  const control = hand.reduce((n, c) => n + controlValue(c.rank), 0);
  return control + new Set(hand.map((c) => c.suit)).size * 0.5;
}

function isNoTrumpOriented(hand) {
  if (!hand.length) return false;
  const best = Math.max(...SUITS.map((s) => suitTrumpScore(hand, s)));
  return noTrumpScore(hand) - best >= 1.0;
}

function pointProbNonsuit(card, hand) {
  const n = hand.filter((c) => c.suit === card.suit).length;
  const ace = hasCard(hand, card.suit, "A");
  const biddingHand = hand.length <= 4;
  const aceSupport = hand.some((c) => c.suit === card.suit && (c.rank === "J" || c.rank === "9"));
  switch (card.rank) {
    case "J": return n === 1 ? 0.65 : n === 2 ? 0.75 : 0.55;
    case "9": return n === 1 ? 0.45 : n === 2 ? 0.55 : 0.40;
    case "10": return n === 1 ? 0.25 : n === 2 ? 0.35 : 0.20;
    case "A": return biddingHand && !aceSupport ? 0.70 : 1.0;
    case "K":
      return ace
        ? n === 2 ? 1.0 : n === 3 ? 0.8 : n === 4 ? 0.3 : 0.1
        : n === 1 ? 0.0 : n === 2 ? 0.5 : n === 3 ? 0.6 : n === 4 ? 0.3 : 0.1;
    case "Q":
      return ace
        ? n === 2 ? 0.4 : n === 3 ? 0.4 : n === 4 ? 0.1 : 0.0
        : n === 1 ? 0.0 : n === 2 ? 0.4 : n === 3 ? 0.3 : 0.0;
    default: return pts(card) > 0 ? 0.15 : 0.0;
  }
}

function pointTrump(hand, trump) {
  const count = hand.filter((c) => c.suit === trump).length;
  const trumpable = SUITS.filter((s) => s !== trump).reduce(
    (n, s) => n + Math.max(0, 3 - hand.filter((c) => c.suit === s).length), 0);
  const bidding = hand.length <= 4;
  if (count <= 1) return 0;
  if (count === 2) return bidding ? 0 : Math.min(1, trumpable);
  if (count === 3) return Math.min(bidding ? 1 : 2, trumpable);
  return Math.min(bidding ? 2 : 3, trumpable);
}

function trumpControlPoint(hand, trump) {
  const trumps = hand.filter((c) => c.suit === trump);
  if (!trumps.length) return 0.0;
  const ranks = new Set(trumps.map((c) => c.rank));
  const w = { J: 0.8, 9: 0.6, A: 0.3, 10: 0.25, K: 0.15 };
  const control = trumps.reduce((n, c) => n + (w[c.rank] || 0), 0);
  const combo = ranks.has("J") && ranks.has("9") && ranks.has("10") ? 0.75 : ranks.has("J") && ranks.has("9") ? 0.4 : 0.0;
  return control + combo;
}

function extraTrump(hand, trump) {
  const trumps = hand.filter((c) => c.suit === trump);
  const ace = trumps.some((c) => c.rank === "A");
  const king = trumps.some((c) => c.rank === "K");
  const limit = ace && king ? 4.0 : ace ? 4.5 : 5.0;
  return Math.max(0.0, trumps.length - limit);
}

function evaluateHand(hand, trump) {
  const nonSuit = hand.filter((c) => c.suit !== trump).reduce((n, c) => n + pointProbNonsuit(c, hand), 0);
  const pairCushion = hasPairIn(hand.filter((c) => c.suit === trump)) ? 1.0 : 0.0;
  const total = nonSuit + pointTrump(hand, trump) + trumpControlPoint(hand, trump) + extraTrump(hand, trump) + pairCushion;
  const deduction = total >= 8 ? 2 : total >= 5 ? 1 : 0;
  return Math.max(0, Math.trunc(total - deduction));
}

export function totalBid(hand) {
  return isNoTrumpOriented(hand) ? Math.trunc(noTrumpScore(hand)) : evaluateHand(hand, bestTrumpSuit(hand));
}

export function bidCeiling(hand) {
  const s = totalBid(hand);
  const base = s <= 1 ? 16 : s <= 3 ? 16 + (s - 1) : s <= 5 ? 18 + (s - 3) : 21 + Math.min(s - 6, 4);
  return Math.min(MAX_BID, Math.max(MIN_BID, base));
}

/** Minimum legal raise while the hand backs it, else null (pass). */
export function chooseBid(state, seat) {
  const min = minimumLegalBid(state, seat);
  return min <= bidCeiling(state.hands[seat]) ? min : null;
}

export function chooseTrump(state, seat) {
  return bestTrumpSuit(state.hands[seat]);
}

// ── Computer card play ───────────────────────────────────────────────────────
// A compact heuristic player built for the web. It follows the same ideas as the
// app's SmartBot (win cheaply, feed your partner, keep point cards back, cut when
// trump is out) but is NOT a line-for-line port: SmartBot is ~1,500 lines.

function playedCards(state) {
  return [...state.completedTricks.flatMap((t) => t.plays), ...state.currentTrick].map((p) => p.card);
}

function outstanding(state, seat) {
  const seen = new Set(playedCards(state).map(cardId));
  for (const c of state.hands[seat]) seen.add(cardId(c));
  return makeDeck().filter((c) => !seen.has(cardId(c)));
}

function highestOut(state, seat, suit) {
  const out = outstanding(state, seat).filter((c) => c.suit === suit);
  return out.length ? out.reduce((b, c) => (tn(c) > tn(b) ? c : b)) : null;
}

const lowestBy = (cards, key) => cards.reduce((b, c) => (key(c) < key(b) ? c : b));
const highestBy = (cards, key) => cards.reduce((b, c) => (key(c) > key(b) ? c : b));

/** Would `card`, played now, be winning the trick (counting only what has happened so far)? */
function wouldWin(state, seat, card) {
  const plays = [...state.currentTrick, { player: seat, card }];
  return trickWinner(state, plays).player === seat;
}

function knownTrump(state, seat) {
  if (state.isSingleHand) return null; // trump is never revealed in a single hand
  return isTrumpRevealed(state) || state.trumpSetter === seat ? state.trump : null;
}

export function shouldRevealTrump(state, seat) {
  if (!canRevealTrump(state, seat)) return false;
  const plays = state.currentTrick;
  const lead = plays[0].card.suit;
  const current = trickWinner(state, plays).player;
  if (sameTeam(current, seat)) return false;
  const trickPts = plays.reduce((n, p) => n + pts(p.card), 0);
  const late = completedCount(state) >= 6;
  const hand = state.hands[seat];

  if (seat === state.trumpSetter) {
    const trumps = hand.filter((c) => c.suit === state.trump);
    if (!trumps.length) return false;
    // Cards already on the table do not turn into trump retroactively.
    const winning = trickWinner(state, plays).card;
    const beats = trumps.some((t) => {
      if (winning.suit === state.trump && lead !== state.trump) return false;
      return true;
    });
    if (!beats) return false;
    const highCard = plays.some((p) => p.card.rank === "J" || p.card.rank === "9");
    return trickPts >= 1 || highCard || late;
  }
  // Everyone else is guessing: they don't know the suit, so only gamble on a rich trick.
  return trickPts >= 2 || (late && trickPts >= 1);
}

export function chooseCard(state, seat) {
  const legal = legalMoves(state, seat);
  if (!legal.length) throw new Error(`No legal moves for ${seat}`);
  if (legal.length === 1) return legal[0];
  const partner = opposite(seat);
  const trump = knownTrump(state, seat);
  const plays = state.currentTrick;
  const key = (c) => pts(c) * 100 + tn(c); // point cards last to be thrown

  // ── Leading ──
  if (!plays.length) {
    const hand = state.hands[seat];
    const side = legal.filter((c) => c.suit !== trump);
    // A boss card (highest still out) in a side suit is a sure trick.
    const bosses = side.filter((c) => {
      const top = highestOut(state, seat, c.suit);
      return !top || tn(c) > tn(top);
    });
    const safe = bosses.filter((c) => {
      if (!trump) return true;
      // Don't lead into a suit a trump-holder could cut once trump is open.
      return !isTrumpRevealed(state) || completedCount(state) >= 5;
    });
    if (safe.length) return highestBy(safe, (c) => pts(c) * 100 + tn(c));
    if (trump && isTrumpRevealed(state) && sameTeam(seat, state.trumpSetter)) {
      const trumps = legal.filter((c) => c.suit === trump);
      if (trumps.length >= 2) return highestBy(trumps, tn);
    }
    // Otherwise lead low from the longest side suit, saving points.
    const pool = side.length ? side : legal;
    const lengths = {};
    for (const c of hand) lengths[c.suit] = (lengths[c.suit] || 0) + 1;
    const longest = Math.max(...pool.map((c) => lengths[c.suit]));
    return lowestBy(pool.filter((c) => lengths[c.suit] === longest), key);
  }

  // ── Following ──
  const winnerNow = trickWinner(state, plays);
  const trickPts = plays.reduce((n, p) => n + pts(p.card), 0);
  const last = plays.length === (state.isSingleHand ? 2 : 3);
  const winners = legal.filter((c) => wouldWin(state, seat, c));

  if (winnerNow.player === partner) {
    // Partner is ahead. Feed them points when they are safe, otherwise stay low.
    const lead = plays[0].card.suit;
    const top = highestOut(state, seat, lead);
    const partnerSafe = last || (winnerNow.card.suit === lead && (!top || tn(winnerNow.card) > tn(top)));
    if (partnerSafe) return highestBy(legal, (c) => pts(c) * 100 + tn(c) * -1);
    return lowestBy(legal, key);
  }

  // A single-hand caller must win every trick, so take it as cheaply as possible.
  if (state.isSingleHand && seat === state.singleHandPlayer && winners.length) return lowestBy(winners, tn);

  // An opponent is ahead.
  if (winners.length) {
    const cheapest = lowestBy(winners, (c) => (c.suit === trump && c.suit !== plays[0].card.suit ? 1000 : 0) + tn(c));
    const worthIt = trickPts + pts(cheapest) >= 1 || pts(cheapest) === 0 || last || completedCount(state) >= 6;
    if (worthIt) return cheapest;
  }
  return lowestBy(legal.filter((c) => c.suit !== trump).length ? legal.filter((c) => c.suit !== trump) : legal, key);
}

// ── Computer challenge decisions (ChallengeAdvisor.kt) ───────────────────────

const VERY_STRONG_DOUBLE_THRESHOLD = 8.5;

/** Coarse trick-winning power of a hand for a given trump suit. */
function defensiveStrength(hand, trump) {
  let score = 0;
  const trumps = hand.filter((c) => c.suit === trump);
  for (const c of trumps) score += c.rank === "J" ? 3 : c.rank === "9" ? 2 : c.rank === "A" ? 1.5 : c.rank === "K" ? 1 : 0.3;
  if (trumps.length > 3) score += trumps.length - 3;
  for (const suit of SUITS) {
    if (suit === trump) continue;
    const cards = hand.filter((c) => c.suit === suit);
    if (!cards.length) continue;
    if (cards.some((c) => c.rank === "A")) score += 1.5;
    if (cards.some((c) => c.rank === "K") && cards.length >= 2) score += 0.5;
    if (cards.length <= 1 && trumps.length) score += 0.5;
  }
  return score;
}

/** Who would own the match if the bidder makes (success) or misses (failure) at this stake. */
function projectedOwner(bidderUs, made, multiplier, ctx) {
  let our = ctx.ourSetScore;
  let their = ctx.theirSetScore;
  // Classic scoring: a miss subtracts from the bidding team.
  if (made) (bidderUs ? (our += multiplier) : (their += multiplier));
  else (bidderUs ? (our -= multiplier) : (their -= multiplier));
  our = Math.max(-MATCH_SCORE, Math.min(MATCH_SCORE, our));
  their = Math.max(-MATCH_SCORE, Math.min(MATCH_SCORE, their));
  const ourWins = our >= MATCH_SCORE || their <= -MATCH_SCORE;
  const theirWins = their >= MATCH_SCORE || our <= -MATCH_SCORE;
  if (bidderUs) return ourWins ? "BIDDER" : theirWins ? "DEFENDER" : "NONE";
  return theirWins ? "BIDDER" : ourWins ? "DEFENDER" : "NONE";
}

const stakeOutcome = (bidderUs, multiplier, ctx) => ({
  success: projectedOwner(bidderUs, true, multiplier, ctx),
  failure: projectedOwner(bidderUs, false, multiplier, ctx),
});

/** Should `decider` (a defender) call Double? Judged only on their own first four cards. */
export function shouldCallDouble(state, decider, ctx) {
  const hand = state.hands[decider];
  if (!hand.length || !state.trump) return false;
  const bidderUs = isUs(bidderSeat(state));
  const strength = defensiveStrength(hand, state.trump);
  const target = winningBid(state.bidding);
  let threshold = target >= 23 ? 3 : target >= 20 ? 4 : target >= 18 ? 5 : 6.5;
  const normal = stakeOutcome(bidderUs, 1, ctx);
  const doubled = stakeOutcome(bidderUs, 2, ctx);
  if (normal.success === "BIDDER" && doubled.success === "BIDDER") return true; // free double
  if (normal.failure === "DEFENDER" && doubled.failure === "DEFENDER") return strength >= VERY_STRONG_DOUBLE_THRESHOLD;
  if (normal.failure !== "DEFENDER" && doubled.failure === "DEFENDER") threshold -= 2;
  if (normal.success !== "BIDDER" && doubled.success === "BIDDER") threshold += 2;
  const defending = bidderUs ? ctx.theirSetScore : ctx.ourSetScore;
  if (defending >= 4 && doubled.failure !== "DEFENDER") threshold += defending >= 5 ? 1.5 : 1;
  return strength >= Math.max(threshold, 2.5);
}

/** Should the bidding team Redouble? Judged on the decider's first four cards. */
export function shouldCallRedouble(state, decider, ctx) {
  const hand = state.hands[decider];
  if (!hand.length || !state.trump) return false;
  const trumps = hand.filter((c) => c.suit === state.trump);
  const jack = trumps.some((c) => c.rank === "J");
  const handPoints = hand.reduce((n, c) => n + pts(c), 0);
  const strength = defensiveStrength(hand, state.trump);
  const strong = (trumps.length >= 3 && jack) || (trumps.length >= 2 && jack && handPoints >= 8) || (trumps.length >= 3 && strength >= 6);
  const veryStrong = (trumps.length >= 3 && jack) || (trumps.length >= 2 && jack && handPoints >= 10) || strength >= 7;
  const bidderUs = isUs(bidderSeat(state));
  const d2 = stakeOutcome(bidderUs, 2, ctx);
  const d4 = stakeOutcome(bidderUs, 4, ctx);
  if (d2.success === "BIDDER" && d4.success === "BIDDER") return false;
  if (d2.failure !== "DEFENDER" && d4.failure === "DEFENDER") return veryStrong;
  if (d2.failure === "DEFENDER" && d4.failure === "DEFENDER") return strong || strength >= 5.5 || (trumps.length >= 3 && jack);
  if (d2.success !== "BIDDER" && d4.success === "BIDDER") return strong || strength >= 6 || (trumps.length >= 3 && handPoints >= 7);
  return strong;
}

function singleHandSuitRisk(hand, suit, rng) {
  const cards = hand.filter((c) => c.suit === suit);
  if (!cards.length) return 0;
  const has = (r) => cards.some((c) => c.rank === r);
  const jack = has("J");
  const nine = has("9");
  const ace = has("A");
  if (!jack) return 8;
  switch (cards.length) {
    case 1: return 0;
    case 2: return nine ? 0 : 8;
    case 3: return nine && ace ? 0 : nine ? (rng() < 0.1 ? 2 : 8) : ace ? (rng() < 0.005 ? 1 : 8) : 8;
    case 4: return nine && ace ? 0 : nine ? 1 : ace ? (rng() < 0.05 ? 2 : 8) : 8;
    case 5: return nine ? 0 : ace ? 2 : 8;
    default: return 0;
  }
}

/** Should `seat` go it alone for all eight tricks? Judged on the full eight-card hand. */
export function shouldPlaySingleHand(state, seat, rng = Math.random) {
  const hand = state.hands[seat];
  if (!hand.length) return false;
  const risk = SUITS.reduce((n, suit) => n + singleHandSuitRisk(hand, suit, rng), 0);
  return risk <= 1 || (risk <= 2 && rng() < 0.9);
}

/** The computer's answer to the current challenge question. */
export function chooseChallenge(state, seat, ctx, rng = Math.random) {
  const ch = state.challenge;
  if (ch.step === "DOUBLE") return shouldCallDouble(state, seat, ctx);
  if (ch.step === "REDOUBLE") return shouldCallRedouble(state, seat, ctx);
  return shouldPlaySingleHand(state, seat, rng);
}
