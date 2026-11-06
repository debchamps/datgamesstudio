// Spades rules engine and computer players, ported from the Android app
// (spades-rules: SpadesEngine.kt, SpadesCards.kt, ai/SpadesBot.kt HeuristicBot).
// Standard partnership Spades with the app's default settings: game to 500, Nil
// (+/-100), mercy rule at -200, sandbags off. No Cutthroat, Jokers (JJDD), Board
// rule or Blind Nil. Pure functions; no DOM.

export const POSITIONS = ["NORTH", "EAST", "SOUTH", "WEST"]; // clockwise
export const SUITS = ["S", "H", "C", "D"]; // Kotlin Suit enum order
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const TARGET = 500;
export const MERCY = -200;
export const NIL_BONUS = 100;
const TRUMP = "S";

const ord = (c) => RANKS.indexOf(c.rank) + 1; // 2 = 1 ... A = 13
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const cardId = (c) => c.suit + c.rank;
export const next = (p) => POSITIONS[(POSITIONS.indexOf(p) + 1) % 4];
export const opposite = (p) => POSITIONS[(POSITIONS.indexOf(p) + 2) % 4];
export const teamOf = (p) => (p === "NORTH" || p === "SOUTH" ? 1 : 2); // 1 = you + partner
const TEAM_PLAYERS = { 1: ["NORTH", "SOUTH"], 2: ["EAST", "WEST"] };
const zero = () => ({ NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 });

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

function dealRound({ dealer, gameNumber, teamScores, rng }) {
  const deck = shuffle(makeDeck(), rng);
  const hands = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  const order = ["NORTH", "EAST", "SOUTH", "WEST"];
  deck.forEach((c, i) => hands[order[i % 4]].push(c));
  for (const p of POSITIONS) hands[p] = sortHand(hands[p]);
  return {
    phase: "BIDDING",
    dealer,
    hands,
    turn: next(dealer),
    bids: {},
    currentTrick: [],
    completedTricks: [],
    tricksWon: zero(),
    lastCompletedTrick: null,
    lastTrickWinner: null,
    spadesBroken: false,
    gameNumber,
    teamScores,
    roundResult: null,
    matchWinnerTeam: null,
  };
}

export function startGame(dealer = "WEST", rng = Math.random) {
  return dealRound({ dealer, gameNumber: 1, teamScores: { 1: 0, 2: 0 }, rng });
}

// ── Bidding ──────────────────────────────────────────────────────────────────

/** Partners can't bid more than 13 between them. */
export function maxAllowedBid(state, pos) {
  const partnerBid = state.bids[opposite(pos)];
  return partnerBid === undefined ? 13 : Math.max(0, 13 - partnerBid);
}

function nextUnbidder(pos, bids) {
  let n = next(pos);
  for (let i = 0; i < 4; i++) {
    if (!(n in bids)) return n;
    n = next(n);
  }
  throw new Error("No unbid players remain");
}

export function applyBid(state, pos, bid) {
  if (state.phase !== "BIDDING") throw new Error("Not in BIDDING phase");
  if (state.turn !== pos) throw new Error(`Not ${pos}'s turn to bid`);
  if (pos in state.bids) throw new Error(`${pos} has already bid`);
  if (!(bid >= 0 && bid <= 13) || bid > maxAllowedBid(state, pos)) throw new Error("Bid out of range");
  const bids = { ...state.bids, [pos]: bid };
  if (Object.keys(bids).length === 4) {
    return { ...state, bids, turn: next(state.dealer), phase: "PLAYING", currentTrick: [] };
  }
  return { ...state, bids, turn: nextUnbidder(pos, bids) };
}

// ── Play ─────────────────────────────────────────────────────────────────────

export function trickRank(card, lead) {
  if (card.suit === TRUMP) return 100 + ord(card);
  if (card.suit === lead) return 50 + ord(card);
  return ord(card);
}

const winningPlayOf = (plays) => {
  const lead = plays[0].card.suit;
  return plays.reduce((b, p) => (trickRank(p.card, lead) > trickRank(b.card, lead) ? p : b));
};

export function legalMoves(state, pos) {
  if (state.phase !== "PLAYING" || state.turn !== pos) return [];
  const hand = state.hands[pos];
  if (!hand.length) return [];
  if (!state.currentTrick.length) {
    if (state.spadesBroken) return hand;
    const nonTrump = hand.filter((c) => c.suit !== TRUMP);
    return nonTrump.length ? nonTrump : hand;
  }
  const lead = state.currentTrick[0].card.suit;
  const following = hand.filter((c) => c.suit === lead);
  return following.length ? following : hand;
}

export const isLegal = (state, pos, card) => legalMoves(state, pos).some((c) => sameCard(c, card));

function contractScore(state, team, target, achieved) {
  let total = target === achieved ? target * 10 : target < achieved ? target * 10 + (achieved - target) : -10 * target;
  for (const p of TEAM_PLAYERS[team]) {
    if (state.bids[p] === 0) total += state.tricksWon[p] === 0 ? NIL_BONUS : -NIL_BONUS;
  }
  return total;
}

function scoreRound(state) {
  const teamBids = {};
  const teamTricks = {};
  const effective = {}; // a Nil bidder's tricks never count toward the partner's contract
  const delta = {};
  for (const t of [1, 2]) {
    teamBids[t] = TEAM_PLAYERS[t].reduce((n, p) => n + state.bids[p], 0);
    teamTricks[t] = TEAM_PLAYERS[t].reduce((n, p) => n + state.tricksWon[p], 0);
    effective[t] = TEAM_PLAYERS[t].reduce((n, p) => n + (state.bids[p] > 0 ? state.tricksWon[p] : 0), 0);
    delta[t] = contractScore(state, t, teamBids[t], effective[t]);
  }
  const nilStatus = {};
  for (const p of POSITIONS) nilStatus[p] = state.bids[p] > 0 ? "NA" : state.tricksWon[p] === 0 ? "MADE" : "BUSTED";
  return {
    bids: state.bids,
    tricksWon: state.tricksWon,
    teamBids,
    teamTricks,
    effective,
    delta,
    nilStatus,
    teamScores: { 1: state.teamScores[1] + delta[1], 2: state.teamScores[2] + delta[2] },
  };
}

export function play(state, pos, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in PLAYING phase");
  if (state.turn !== pos) throw new Error(`Not ${pos}'s turn`);
  if (!isLegal(state, pos, card)) throw new Error(`Illegal card ${cardId(card)} for ${pos}`);

  const hands = { ...state.hands, [pos]: state.hands[pos].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { player: pos, card }];
  const spadesBroken = state.spadesBroken || card.suit === TRUMP;
  if (trick.length < 4) return { ...state, hands, currentTrick: trick, turn: next(pos), spadesBroken };

  const winner = winningPlayOf(trick).player;
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const base = {
    ...state,
    hands,
    turn: winner,
    currentTrick: [],
    completedTricks: [...state.completedTricks, trick],
    tricksWon,
    lastCompletedTrick: trick,
    lastTrickWinner: winner,
    spadesBroken,
  };
  if (base.completedTricks.length < 13) return base;
  const result = scoreRound(base);
  return { ...base, phase: "ROUND_OVER", roundResult: result, teamScores: result.teamScores };
}

export function isMatchComplete(state) {
  const s = [state.teamScores[1], state.teamScores[2]];
  return Math.max(...s) >= TARGET || Math.min(...s) <= MERCY;
}

/** Next deal, or MATCH_OVER once a team reaches 500 or falls to the -200 mercy line. */
export function nextRound(prev, rng = Math.random) {
  if (prev.phase !== "ROUND_OVER") throw new Error("Not in ROUND_OVER phase");
  if (isMatchComplete(prev)) {
    return { ...prev, phase: "MATCH_OVER", matchWinnerTeam: prev.teamScores[1] > prev.teamScores[2] ? 1 : 2 };
  }
  return dealRound({ dealer: next(prev.dealer), gameNumber: prev.gameNumber + 1, teamScores: prev.teamScores, rng });
}

// ── Computer bidding (HeuristicBot.explainBid) ───────────────────────────────

const BRAY_SUITS = ["C", "S", "D", "H"];
const BID_ROUND_UP_THRESHOLD = 0.75;
const SIDE_SUIT_LENGTH_THRESHOLD = 4;
const SIDE_SUIT_LENGTH_BONUS_RATE = 0.55;
const SIDE_SUIT_LENGTH_BONUS_RATE_BEYOND_FIRST = 0.2;

const has = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const count = (cards, suit) => cards.filter((c) => c.suit === suit).length;

function canProceedWithNil(cards) {
  for (const suit of BRAY_SUITS) {
    const suited = cards.filter((c) => c.suit === suit);
    if (suit === TRUMP) {
      if (suited.length > 3) return false;
      if (suited.some((c) => ord(c) > 10)) return false; // nothing above the Jack
    } else {
      if (suited.some((c) => c.rank === "A")) return false;
      if (suited.length <= 3 && suited.some((c) => ord(c) > 10)) return false;
    }
  }
  return true;
}

function extraTrumpSuitPoint(cards) {
  const spades = cards.filter((c) => c.suit === TRUMP);
  const ace = spades.some((c) => c.rank === "A");
  const king = spades.some((c) => c.rank === "K");
  const limit = ace && king ? 4.0 : ace || king ? 4.5 : 5.0;
  return Math.max(0.0, spades.length - limit);
}

function pointProbabilityNonsuit(card, all) {
  const n = count(all, card.suit);
  if (card.rank === "A") return 1.0;
  if (card.rank === "K") {
    if (has(all, card.suit, "A")) return n === 2 ? 1.0 : n === 3 ? 0.8 : n === 4 ? 0.3 : n >= 5 ? 0.1 : 1.0;
    return n === 1 ? 0.0 : n === 2 ? 0.5 : n === 3 ? 0.6 : n === 4 ? 0.3 : n >= 5 ? 0.1 : 1.0;
  }
  if (card.rank === "Q") {
    if (has(all, card.suit, "A")) return n === 2 ? 0.4 : n === 3 ? 0.4 : n === 4 ? 0.1 : 0.0;
    return n === 2 ? 0.4 : n === 3 ? 0.3 : 0.0;
  }
  return 0.0;
}

function sideSuitLengthBonus(cards) {
  return ["H", "C", "D"].reduce((sum, s) => {
    const excess = Math.max(0, count(cards, s) - SIDE_SUIT_LENGTH_THRESHOLD);
    return sum + Math.min(excess, 1) * SIDE_SUIT_LENGTH_BONUS_RATE + Math.max(0, excess - 1) * SIDE_SUIT_LENGTH_BONUS_RATE_BEYOND_FIRST;
  }, 0);
}

function pointTrump(cards) {
  const pos = (v) => (v < 0 ? 0 : v);
  const trumpable = pos(3 - count(cards, "H")) + pos(3 - count(cards, "C")) + pos(3 - count(cards, "D"));
  const spades = count(cards, TRUMP);
  const longSpadeFloor = spades >= 4 ? Math.min(spades - 3, 2) : 0;
  if (spades <= 1) return 0;
  if (spades === 2) return Math.min(1, trumpable);
  if (spades === 3) return Math.min(2, trumpable);
  return Math.max(longSpadeFloor, Math.min(3, trumpable));
}

export function explainBid(state, pos) {
  const hand = state.hands[pos];
  const maxAllowed = maxAllowedBid(state, pos);
  const raw =
    hand.reduce((n, c) => n + pointProbabilityNonsuit(c, hand), 0) +
    pointTrump(hand) +
    extraTrumpSuitPoint(hand) +
    sideSuitLengthBonus(hand);
  const nilEligible = canProceedWithNil(hand);
  const rounded = Math.floor(raw + (1.0 - BID_ROUND_UP_THRESHOLD));
  let bid;
  if (maxAllowed <= 0) bid = 0;
  else if (rounded === 0 && nilEligible) bid = 0;
  else bid = Math.min(Math.max(rounded, 1), Math.min(8, maxAllowed));
  return { raw, nilEligible, bid };
}

export const chooseBid = (state, pos) => explainBid(state, pos).bid;

// ── Computer card play (HeuristicBot, standard partnership path) ─────────────

const isTrumpCard = (c) => c.suit === TRUMP;
const highToLow = (cards) => cards.slice().sort((a, b) => ord(b) - ord(a) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
const highest = (cards) => cards.reduce((b, c) => (ord(c) > ord(b) ? c : b));
const lowest = (cards) => cards.reduce((b, c) => (ord(c) < ord(b) ? c : b));
const higherThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) > ord(base)));
const lowerThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) < ord(base)));

const teamBid = (state, team) => TEAM_PLAYERS[team].reduce((n, p) => n + (state.bids[p] ?? 0), 0);
const effectiveTricks = (state, team) => TEAM_PLAYERS[team].reduce((n, p) => n + ((state.bids[p] ?? 0) > 0 ? state.tricksWon[p] : 0), 0);
const isNil = (state, p) => state.bids[p] === 0;
const nilAlive = (state, p) => isNil(state, p) && state.tricksWon[p] === 0;
const winningPlay = (state) => winningPlayOf(state.currentTrick);

function highestRemaining(state, suit) {
  const inPlay = [...Object.values(state.hands).flat(), ...state.currentTrick.map((p) => p.card)].filter((c) => c.suit === suit);
  return inPlay.length ? highest(inPlay) : null;
}

function suitPlayedMap(state) {
  const counts = { C: 0, S: 0, D: 0, H: 0 };
  for (const t of state.completedTricks) counts[t[0].card.suit]++;
  return counts;
}

function trumpDoneMap(state) {
  const out = { C: [], S: [], D: [], H: [] };
  for (const t of state.completedTricks) {
    const lead = t[0].card.suit;
    if (lead === TRUMP) continue;
    for (const p of t.slice(1)) if (p.card.suit === TRUMP) out[lead].push(p.player);
  }
  return out;
}

// shouldPlayToWin is always true with sandbags off (the app default), so the
// "play to lose" branches of HeuristicBot are not ported.

function playLeadToWin(state, pos, legal) {
  // aceMove
  const ace = legal.find((c) => c.rank === "A" && (!has(legal, c.suit, "Q") || has(legal, c.suit, "K")));
  if (ace) return ace;
  // partnerCanTrumpCard
  const partner = opposite(pos);
  if (!nilAlive(state, partner)) {
    const done = trumpDoneMap(state);
    for (const suit of BRAY_SUITS.filter((s) => s !== TRUMP)) {
      if (done[suit].includes(partner)) {
        const cards = legal.filter((c) => c.suit === suit && !isTrumpCard(c));
        if (cards.length) return highest(cards);
      }
    }
  }
  // playWinningCardSpade
  if (Object.values(state.tricksWon).reduce((a, b) => a + b, 0) + 1 >= 3) {
    const trumps = legal.filter(isTrumpCard);
    if (trumps.length && !(trumps.length < Math.trunc(legal.length / 2) - 1)) {
      const top = highestRemaining(state, TRUMP);
      if (top && trumps.some((c) => sameCard(c, top))) return top;
    }
  }
  // playKqStrategy
  const led = suitPlayedMap(state);
  for (const card of legal.filter((c) => c.rank === "K" || c.rank === "Q")) {
    if (led[card.suit] === 0 && !has(legal, card.suit, "A")) {
      const suited = legal.filter((c) => c.suit === card.suit);
      if (suited.length >= 2) {
        const lower = lowerThan(suited, card);
        if (lower.length) return highest(lower);
      }
    }
  }
  // playHighestSuitLowCard: lead high to protect a partner's live Nil, else low
  const nonTrump = legal.filter((c) => !isTrumpCard(c));
  if (nonTrump.length) return nilAlive(state, partner) ? highest(nonTrump) : lowest(nonTrump);
  return highest(legal);
}

function nilFollow(state, legal) {
  const lead = state.currentTrick[0].card.suit;
  const winning = winningPlay(state).card;
  const leadCards = legal.filter((c) => c.suit === lead);
  const firstNonTrumpHigh = () => highToLow(legal).find((c) => !isTrumpCard(c)) || lowest(legal);
  if (isTrumpCard(winning) && lead !== TRUMP) {
    if (leadCards.length) return highest(leadCards);
    return firstNonTrumpHigh();
  }
  if (leadCards.length) {
    const lower = lowerThan(leadCards, winning);
    return lower.length ? highest(lower) : lowest(leadCards);
  }
  if (isTrumpCard(winning)) {
    const lowerSpades = lowerThan(legal.filter(isTrumpCard), winning);
    if (lowerSpades.length) return highest(lowerSpades);
  }
  return firstNonTrumpHigh();
}

function suitedStrategy(state, pos, same) {
  if (same.length === 1) return same[0];
  const w = winningPlay(state);
  const winningCard = w.card;
  const partnerWinning = opposite(pos) === w.player;
  const partnerTryingNil = partnerWinning && nilAlive(state, w.player);
  const opponentTryingNil = !partnerWinning && nilAlive(state, w.player);
  const sorted = highToLow(same);
  const higher = higherThan(same, winningCard);
  const playPosition = state.currentTrick.length + 1;
  if (playPosition === 4) {
    if (partnerWinning) return partnerTryingNil && higher.length ? lowest(higher) : lowest(sorted);
    return higher.length && !opponentTryingNil ? lowest(higher) : lowest(sorted);
  }
  const top = highestRemaining(state, sorted[0].suit);
  const myHigh = sorted[0];
  const myLow = sorted[sorted.length - 1];
  const beats = trickRank(myHigh, myHigh.suit) > trickRank(winningCard, myHigh.suit);
  const standing = top !== null && trickRank(winningCard, myHigh.suit) > trickRank(top, myHigh.suit);
  const myHighIsTop = top !== null && sameCard(top, myHigh);
  if (playPosition === 2 || playPosition === 3) {
    if (partnerWinning) {
      if (partnerTryingNil && higher.length) return highest(higher);
      if (standing) return myLow;
      if (myHighIsTop && beats) return myHigh;
      return myLow;
    }
    if (playPosition === 3 && opponentTryingNil && myHighIsTop && beats) return myLow;
    const ace = sorted.find((c) => c.rank === "A" && winningCard.suit === state.currentTrick[0].card.suit);
    if (ace) return ace;
    return myHighIsTop && beats ? myHigh : myLow;
  }
  return myLow;
}

function trumpMove(state, pos, legal) {
  const w = winningPlay(state);
  const partnerWinning = opposite(pos) === w.player;
  const partnerTryingNil = partnerWinning && nilAlive(state, w.player);
  const opponentTryingNil = !partnerWinning && nilAlive(state, w.player);
  if (partnerWinning && !partnerTryingNil) return null;
  if (!partnerWinning && opponentTryingNil) return null;
  const trumps = legal.filter(isTrumpCard);
  if (!trumps.length) return null;
  if (!isTrumpCard(w.card)) return lowest(trumps);
  const over = higherThan(trumps, w.card);
  return over.length ? lowest(over) : null;
}

function playFollowToWin(state, pos, legal) {
  const lead = state.currentTrick[0].card.suit;
  const same = legal.filter((c) => c.suit === lead);
  if (same.length) return suitedStrategy(state, pos, same);
  if (lead !== TRUMP) {
    const t = trumpMove(state, pos, legal);
    if (t) return t;
  }
  const nonTrump = legal.filter((c) => !isTrumpCard(c));
  return lowest(nonTrump.length ? nonTrump : legal);
}

/** `pos` may be SOUTH, which the page uses for hints. */
export function chooseCard(state, pos) {
  const legal = legalMoves(state, pos);
  if (!legal.length) throw new Error(`No legal moves for ${pos}`);
  let chosen;
  if (!state.currentTrick.length) {
    chosen = nilAlive(state, pos) ? lowest(legal) : playLeadToWin(state, pos, legal);
  } else {
    chosen = nilAlive(state, pos) ? nilFollow(state, legal) : playFollowToWin(state, pos, legal);
  }
  return legal.some((c) => sameCard(c, chosen)) ? chosen : lowest(legal);
}
