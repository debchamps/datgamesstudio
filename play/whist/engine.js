// Whist rules engine and computer player, ported from the Android app
// (whist-rules: WhistEngine.kt, WhistCards.kt, ai/WhistBot.kt HeuristicBot).
// Short whist: the dealer's last card sets trump, tricks over six score, game to 5.
// Pure functions; no DOM.

export const POSITIONS = ["NORTH", "EAST", "SOUTH", "WEST"]; // clockwise
export const SUITS = ["S", "H", "C", "D"]; // Kotlin Suit enum order
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const TARGET = 5;

const ord = (c) => RANKS.indexOf(c.rank) + 1; // 2 = 1 ... A = 13
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const cardId = (c) => c.suit + c.rank;
export const next = (p) => POSITIONS[(POSITIONS.indexOf(p) + 1) % 4];
export const opposite = (p) => POSITIONS[(POSITIONS.indexOf(p) + 2) % 4];
export const teamOf = (p) => (p === "NORTH" || p === "SOUTH" ? 1 : 2); // 1 = you + partner
const TEAM_PLAYERS = { 1: ["NORTH", "SOUTH"], 2: ["EAST", "WEST"] };

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
  const dealt = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  const order = ["NORTH", "EAST", "SOUTH", "WEST"];
  deck.forEach((c, i) => dealt[order[i % 4]].push(c));
  const trumpCard = dealt[dealer][dealt[dealer].length - 1]; // the dealer's last card is turned up
  const hands = {};
  for (const p of POSITIONS) hands[p] = sortHand(dealt[p]);
  const eldest = next(dealer);
  return {
    phase: "PLAYING",
    dealer,
    hands,
    trump: trumpCard.suit,
    trumpCard,
    turn: eldest,
    leadStarter: eldest,
    currentTrick: [],
    completedTricks: [],
    tricksWon: { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 },
    lastCompletedTrick: null,
    lastTrickWinner: null,
    gameNumber,
    teamScores,
    roundResult: null,
    matchWinnerTeam: null,
  };
}

export function startGame(dealer = "WEST", rng = Math.random) {
  return dealRound({ dealer, gameNumber: 1, teamScores: { 1: 0, 2: 0 }, rng });
}

export function trickRank(card, lead, trump) {
  if (trump && card.suit === trump) return 100 + ord(card);
  if (card.suit === lead) return 50 + ord(card);
  return ord(card);
}

const winningPlayOf = (plays, trump) => {
  const lead = plays[0].card.suit;
  return plays.reduce((b, p) => (trickRank(p.card, lead, trump) > trickRank(b.card, lead, trump) ? p : b));
};

export function legalMoves(state, pos) {
  if (state.phase !== "PLAYING" || state.turn !== pos) return [];
  const hand = state.hands[pos];
  if (!hand.length) return [];
  if (!state.currentTrick.length) return hand;
  const lead = state.currentTrick[0].card.suit;
  const following = hand.filter((c) => c.suit === lead);
  return following.length ? following : hand;
}

export const isLegal = (state, pos, card) => legalMoves(state, pos).some((c) => sameCard(c, card));

function scoreRound(state) {
  const teamTricks = {};
  const delta = {};
  for (const t of [1, 2]) {
    teamTricks[t] = TEAM_PLAYERS[t].reduce((n, p) => n + state.tricksWon[p], 0);
    delta[t] = Math.max(teamTricks[t] - 6, 0); // only the "odd tricks" over six score
  }
  return {
    teamTricks,
    delta,
    winningTeam: teamTricks[1] > 6 ? 1 : teamTricks[2] > 6 ? 2 : null,
    trump: state.trump,
    teamScores: { 1: state.teamScores[1] + delta[1], 2: state.teamScores[2] + delta[2] },
  };
}

export function play(state, pos, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in PLAYING phase");
  if (state.turn !== pos) throw new Error(`Not ${pos}'s turn`);
  if (!isLegal(state, pos, card)) throw new Error(`Illegal card ${cardId(card)} for ${pos}`);

  const hands = { ...state.hands, [pos]: state.hands[pos].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { player: pos, card }];
  if (trick.length < 4) return { ...state, hands, currentTrick: trick, turn: next(pos) };

  const winner = winningPlayOf(trick, state.trump).player;
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
  return dealRound({ dealer: next(prev.dealer), gameNumber: prev.gameNumber + 1, teamScores: prev.teamScores, rng });
}

// ── Computer player (HeuristicBot) ───────────────────────────────────────────

const has = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const highToLow = (cards) => cards.slice().sort((a, b) => ord(b) - ord(a) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
const highest = (cards) => cards.reduce((b, c) => (ord(c) > ord(b) ? c : b));
const lowest = (cards) => cards.reduce((b, c) => (ord(c) < ord(b) ? c : b));
const higherThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) > ord(base)));
const lowerThan = (cards, base) => highToLow(cards.filter((c) => c.suit === base.suit && ord(c) < ord(base)));
const winningPlay = (state) => winningPlayOf(state.currentTrick, state.trump);

function highestRemaining(state, suit) {
  const inPlay = [...Object.values(state.hands).flat(), ...state.currentTrick.map((p) => p.card)].filter((c) => c.suit === suit);
  return inPlay.length ? highest(inPlay) : null;
}

function suitPlayedMap(state) {
  const counts = { S: 0, H: 0, C: 0, D: 0 };
  for (const t of state.completedTricks) counts[t[0].card.suit]++;
  return counts;
}

/** Players known to be out of a suit: they didn't follow when it was led. */
function voidMap(state) {
  const out = { S: new Set(), H: new Set(), C: new Set(), D: new Set() };
  const tricks = [...state.completedTricks, state.currentTrick].filter((t) => t.length);
  for (const t of tricks) {
    const lead = t[0].card.suit;
    for (const p of t.slice(1)) if (p.card.suit !== lead) out[lead].add(p.player);
  }
  return out;
}

function outstandingTrumps(state, pos) {
  const played = [...state.completedTricks.flat(), ...state.currentTrick].filter((p) => p.card.suit === state.trump).length;
  const mine = state.hands[pos].filter((c) => c.suit === state.trump).length;
  return Math.max(0, 13 - played - mine);
}

function canBeRuffed(state, pos, suit) {
  if (suit === state.trump) return false;
  const partner = opposite(pos);
  const voidOpponent = [...voidMap(state)[suit]].some((p) => p !== pos && p !== partner);
  return voidOpponent && outstandingTrumps(state, pos) > 0;
}

function playLeadToWin(state, pos, legal) {
  const trump = state.trump;
  // aceMove, skipping Aces an opponent could ruff
  const ace = legal
    .filter((c) => c.rank === "A" && !canBeRuffed(state, pos, c.suit))
    .find((c) => !has(legal, c.suit, "Q") || has(legal, c.suit, "K"));
  if (ace) return ace;
  // partnerCanTrumpCard: lead a suit the partner is void in (not an Ace)
  const partner = opposite(pos);
  const voids = voidMap(state);
  for (const suit of SUITS.filter((s) => s !== trump)) {
    if (voids[suit].has(partner)) {
      const suited = legal.filter((c) => c.suit === suit && c.rank !== "A");
      if (suited.length) return highest(suited);
    }
  }
  // playWinningTrump
  if (Object.values(state.tricksWon).reduce((a, b) => a + b, 0) + 1 >= 3) {
    const trumps = legal.filter((c) => c.suit === trump);
    if (trumps.length && !(trumps.length < Math.trunc(legal.length / 2) - 1)) {
      const top = highestRemaining(state, trump);
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
  // playHighestSuitLowCard, preferring suits nobody can ruff
  const nonTrump = legal.filter((c) => c.suit !== trump);
  if (nonTrump.length) {
    const safe = nonTrump.filter((c) => !canBeRuffed(state, pos, c.suit));
    return lowest(safe.length ? safe : nonTrump);
  }
  return highest(legal);
}

function suitedStrategy(state, pos, same) {
  if (same.length === 1) return same[0];
  const trump = state.trump;
  const w = winningPlay(state);
  const winningCard = w.card;
  const partnerWinning = opposite(pos) === w.player;
  const sorted = highToLow(same);
  const higher = higherThan(same, winningCard);
  const playPosition = state.currentTrick.length + 1;
  const winningIsTrump = winningCard.suit === trump && state.currentTrick[0].card.suit !== trump;
  if (winningIsTrump) return lowest(sorted);
  if (playPosition === 4) {
    if (partnerWinning) return lowest(sorted);
    return higher.length ? lowest(higher) : lowest(sorted);
  }
  const top = highestRemaining(state, sorted[0].suit);
  const myHigh = sorted[0];
  const myLow = sorted[sorted.length - 1];
  const beats = trickRank(myHigh, myHigh.suit, trump) > trickRank(winningCard, myHigh.suit, trump);
  const standing = top !== null && trickRank(winningCard, myHigh.suit, trump) > trickRank(top, myHigh.suit, trump);
  const myHighIsTop = top !== null && sameCard(top, myHigh);
  if (partnerWinning) {
    if (standing) return myLow;
    if (myHighIsTop && beats) return myHigh;
    return myLow;
  }
  return myHighIsTop && beats ? myHigh : myLow;
}

function trumpMove(state, pos, legal) {
  const w = winningPlay(state);
  if (opposite(pos) === w.player) return null;
  const trumps = legal.filter((c) => c.suit === state.trump);
  if (!trumps.length) return null;
  if (w.card.suit !== state.trump) return lowest(trumps);
  const over = higherThan(trumps, w.card);
  return over.length ? lowest(over) : null;
}

function playFollowToWin(state, pos, legal) {
  const lead = state.currentTrick[0].card.suit;
  const same = legal.filter((c) => c.suit === lead);
  if (same.length) return suitedStrategy(state, pos, same);
  if (lead !== state.trump) {
    const t = trumpMove(state, pos, legal);
    if (t) return t;
  }
  const nonTrump = legal.filter((c) => c.suit !== state.trump);
  return lowest(nonTrump.length ? nonTrump : legal);
}

export function chooseCard(state, pos) {
  const legal = legalMoves(state, pos);
  if (!legal.length) throw new Error(`No legal moves for ${pos}`);
  const chosen = state.currentTrick.length ? playFollowToWin(state, pos, legal) : playLeadToWin(state, pos, legal);
  return legal.some((c) => sameCard(c, chosen)) ? chosen : lowest(legal);
}
