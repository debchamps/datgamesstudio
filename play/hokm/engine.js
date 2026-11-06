// Hokm rules engine and computer players, ported from the Android app
// (hokm-rules: HokmEngine.kt, HokmGameState.kt, HokmCards.kt, ai/HokmBot.kt HeuristicBot).
// Classic Hokm only (no Court Piece mode). Hokm's bot plays cards with the same
// heuristics as the Tarneeb bot, so those two functions are shared from ../tarneeb/engine.js.
// Pure functions; no DOM.

import {
  SEATS,
  SUITS,
  RANKS,
  makeDeck,
  shuffle,
  sortHand,
  nextSeat,
  opposite,
  teamOf,
  sameCard,
  cardId,
  trickRank,
  playLeadToWin,
  playFollowToWin,
} from "../tarneeb/engine.js";

export { SEATS, SUITS, RANKS, nextSeat, opposite, teamOf, sameCard, cardId, trickRank };
export const TRICKS_TO_WIN_HAND = 7;
export const POINTS_TO_WIN = 7;

const ord = (c) => RANKS.indexOf(c.rank) + 1;
const prevSeat = (s) => SEATS[(SEATS.indexOf(s) + 3) % 4];
const DEAL_ORDER = ["NORTH", "EAST", "SOUTH", "WEST"];

/** Flip cards from NORTH around the table until an Ace appears: that seat is the first Hâkem. */
export function drawFirstHakem(rng = Math.random, start = "NORTH") {
  const deck = shuffle(makeDeck(), rng);
  const flips = [];
  let seat = start;
  for (const card of deck) {
    flips.push({ player: seat, card });
    if (card.rank === "A") return { flips, hakem: seat };
    seat = nextSeat(seat);
  }
  return { flips, hakem: start };
}

function dealRound({ hakem, handNumber, teamScores, rng }) {
  const deck = shuffle(makeDeck(), rng);
  const dealt = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  deck.forEach((c, i) => dealt[DEAL_ORDER[i % 4]].push(c));
  const hakemInitialFive = dealt[hakem].slice(0, 5);
  const hands = {};
  for (const s of SEATS) hands[s] = sortHand(dealt[s]);
  return {
    phase: "TRUMP_SELECT",
    hands,
    hakem,
    dealer: prevSeat(hakem),
    hakemInitialFive,
    turn: hakem,
    trump: null,
    currentTrick: [],
    completedTricks: [],
    tricksWon: { SOUTH: 0, EAST: 0, NORTH: 0, WEST: 0 },
    lastCompletedTrick: null,
    lastTrickWinner: null,
    handNumber,
    teamScores,
    roundResult: null,
    matchWinnerTeam: null,
  };
}

export function startGame(hakem, rng = Math.random) {
  return dealRound({ hakem, handNumber: 1, teamScores: { 1: 0, 2: 0 }, rng });
}

export function selectTrump(state, seat, suit) {
  if (state.phase !== "TRUMP_SELECT") throw new Error("Not in TRUMP_SELECT phase");
  if (seat !== state.hakem) throw new Error("Only the Hâkem may declare trump");
  return { ...state, trump: suit, phase: "PLAYING", turn: state.hakem, currentTrick: [] };
}

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

const winnerOf = (plays, trump) => {
  const lead = plays[0].card.suit;
  return plays.reduce((b, p) => (trickRank(p.card, lead, trump) > trickRank(b.card, lead, trump) ? p : b)).player;
};

const teamTricks = (tw, team) => SEATS.filter((s) => teamOf(s) === team).reduce((n, s) => n + tw[s], 0);

function scoreRound(state) {
  const tt = { 1: teamTricks(state.tricksWon, 1), 2: teamTricks(state.tricksWon, 2) };
  const winningTeam = tt[1] >= TRICKS_TO_WIN_HAND ? 1 : 2;
  const losingTeam = winningTeam === 1 ? 2 : 1;
  const hakemTeam = teamOf(state.hakem);
  const kot = tt[losingTeam] === 0;
  const points = !kot ? 1 : winningTeam === hakemTeam ? 2 : 3; // a sweep of the Hâkem pays most
  const delta = { [winningTeam]: points, [losingTeam]: 0 };
  return {
    teamTricks: tt,
    winningTeam,
    hakemTeam,
    kot,
    points,
    trump: state.trump,
    hakemLost: winningTeam !== hakemTeam,
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

  const winner = winnerOf(trick, state.trump);
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
  // The hand ends the moment a team takes its 7th trick.
  if (teamTricks(tricksWon, 1) < TRICKS_TO_WIN_HAND && teamTricks(tricksWon, 2) < TRICKS_TO_WIN_HAND) return base;

  const result = scoreRound(base);
  const scored = { ...base, phase: "ROUND_OVER", roundResult: result, teamScores: result.teamScores };
  if (Math.max(result.teamScores[1], result.teamScores[2]) >= POINTS_TO_WIN) {
    return { ...scored, phase: "MATCH_OVER", matchWinnerTeam: result.teamScores[1] >= result.teamScores[2] ? 1 : 2 };
  }
  return scored;
}

/** The Hâkem role passes to the next player only when the Hâkem's team lost the hand. */
export function nextRound(prev, rng = Math.random) {
  if (prev.phase !== "ROUND_OVER") throw new Error("Not in ROUND_OVER phase");
  const hakem = prev.roundResult.hakemLost ? nextSeat(prev.hakem) : prev.hakem;
  return dealRound({ hakem, handNumber: prev.handNumber + 1, teamScores: prev.teamScores, rng });
}

// ── Computer player (HeuristicBot) ───────────────────────────────────────────

function suitQuality(cards) {
  const w = { A: 4.0, K: 3.0, Q: 2.0, J: 1.0 };
  return cards.reduce((n, c) => n + (w[c.rank] || 0), 0) + Math.max(0.0, (cards.length - 4) * 0.5);
}

/** Pick trump from the five cards the Hâkem has seen: length first, then honours. */
export function chooseTrump(state, seat) {
  const five = state.hakemInitialFive.length ? state.hakemInitialFive : state.hands[seat];
  let best = SUITS[0];
  let score = -Infinity;
  for (const suit of SUITS) {
    const suited = five.filter((c) => c.suit === suit);
    const s = suited.length * 10.0 + suitQuality(suited);
    if (s > score) { best = suit; score = s; }
  }
  return best;
}

export function chooseCard(state, seat) {
  const legal = legalMoves(state, seat);
  if (!legal.length) throw new Error(`No legal moves for ${seat}`);
  const trump = state.trump;
  const chosen = state.currentTrick.length ? playFollowToWin(state, seat, legal, trump) : playLeadToWin(state, seat, legal, trump);
  return legal.some((c) => sameCard(c, chosen)) ? chosen : legal.reduce((b, c) => (ord(c) < ord(b) ? c : b));
}
