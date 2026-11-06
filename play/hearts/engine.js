// Hearts rules engine and computer players, ported from the Android app
// (hearts-rules: HeartsEngine.kt, LegalMoves.kt, PassingRules.kt, ai/HeartsBot.kt,
// HeartsLeadStrategy.kt, HeartsFollowStrategy.kt, MoonShotStrategy.kt, PassStrategy.kt).
// Two rule sets: HEARTS (alternating pass, Q♠ = 13, shoot the moon, game to 100) and
// BRAY, which the Bray app plays on the same engine (HeartsRules.BRAY: no passing,
// Q♠ = 12, free lead, no moon, −12 for a deal with zero tricks, rotating starter).
// No Jack of Diamonds variant. Pure functions plus one bot object; no DOM.

export const POSITIONS = ["NORTH", "EAST", "SOUTH", "WEST"]; // clockwise
export const SUITS = ["S", "H", "C", "D"]; // Kotlin Suit enum order
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const MOON = 26;

export const HEARTS = {
  name: "hearts",
  target: 100,
  passing: true,
  queenOfSpadesValue: 13,
  freeLead: false,
  moonEnabled: true,
  zeroTrickBonus: 0,
  rotatingStarter: false,
};

export const BRAY = {
  ...HEARTS,
  name: "bray",
  passing: false,
  queenOfSpadesValue: 12,
  freeLead: true,
  moonEnabled: false,
  zeroTrickBonus: -12,
  rotatingStarter: true,
};

const ord = (c) => RANKS.indexOf(c.rank) + 1; // 2 = 1 ... A = 13
export const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const cardId = (c) => c.suit + c.rank;
export const next = (p) => POSITIONS[(POSITIONS.indexOf(p) + 1) % 4]; // clockwise: N, E, S, W
export const prev = (p) => POSITIONS[(POSITIONS.indexOf(p) + 3) % 4];
export const across = (p) => POSITIONS[(POSITIONS.indexOf(p) + 2) % 4];
export const others = (p) => POSITIONS.filter((x) => x !== p);

const TWO_CLUBS = { suit: "C", rank: "2" };
const QUEEN_SPADES = { suit: "S", rank: "Q" };

/** Card value the bots reason with (Q♠ = 13 in both rule sets, as in the app's AiUtils). */
export const points = (c) => (c.suit === "H" ? 1 : sameCard(c, QUEEN_SPADES) ? 13 : 0);
/** Card value that is actually scored under `rules`. */
export const penalty = (c, rules = HEARTS) => (c.suit === "H" ? 1 : sameCard(c, QUEEN_SPADES) ? rules.queenOfSpadesValue : 0);
const trickPoints = (t) => t.reduce((n, p) => n + points(p.card), 0);

const HAND_SUIT_ORDER = { H: 0, S: 1, D: 2, C: 3 };
export function sortHand(hand) {
  return hand.slice().sort((a, b) => HAND_SUIT_ORDER[a.suit] - HAND_SUIT_ORDER[b.suit] || ord(b) - ord(a));
}

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

export const passDirectionFor = (dealNumber, rules = HEARTS) =>
  rules.passing ? ["HOLD", "LEFT", "RIGHT", "ACROSS"][dealNumber % 4] : "HOLD";
const receiver = (pos, dir) => (dir === "LEFT" ? next(pos) : dir === "RIGHT" ? prev(pos) : dir === "ACROSS" ? across(pos) : pos);
const giver = (pos, dir) => (dir === "LEFT" ? prev(pos) : dir === "RIGHT" ? next(pos) : dir === "ACROSS" ? across(pos) : pos);
export { receiver, giver };

const zero = () => ({ NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 });
const winnerOf = (trick) => {
  const lead = trick[0].card.suit;
  return trick.filter((p) => p.card.suit === lead).reduce((b, p) => (ord(p.card) > ord(b.card) ? p : b)).position;
};

function beginPlay(state) {
  const starter = state.rules.rotatingStarter
    ? POSITIONS[(state.dealNumber - 1) % 4]
    : POSITIONS.find((p) => state.hands[p].some((c) => sameCard(c, TWO_CLUBS)));
  return { ...state, phase: "PLAYING", leader: starter, turn: starter, currentTrick: [] };
}

export function newDeal(dealNumber, matchScores = zero(), rng = Math.random, rules = HEARTS) {
  const deck = shuffle(makeDeck(), rng);
  const hands = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  const order = ["NORTH", "EAST", "SOUTH", "WEST"];
  deck.forEach((c, i) => hands[order[i % 4]].push(c));
  for (const p of POSITIONS) hands[p] = sortHand(hands[p]);
  const direction = passDirectionFor(dealNumber, rules);
  const base = {
    hands,
    currentTrick: [],
    turn: "NORTH",
    leader: "NORTH",
    tricksWon: zero(),
    completedTricks: [],
    lastCompletedTrick: null,
    lastTrickWinner: null,
    phase: "PASSING",
    heartsBroken: false,
    dealNumber,
    passDirection: direction,
    passSelections: {},
    received: {}, // seat -> cards received in the pass
    matchScores,
    dealResult: null,
    rules,
  };
  return direction === "HOLD" ? beginPlay(base) : base;
}

export const nextDeal = (state, rng = Math.random) => newDeal(state.dealNumber + 1, state.matchScores, rng, state.rules);

// ── Passing ──────────────────────────────────────────────────────────────────

export function selectPass(state, pos, cards) {
  if (state.phase !== "PASSING") throw new Error("Not in passing phase");
  if (cards.length !== 3) throw new Error("Must pass exactly 3 cards");
  if (!cards.every((c) => state.hands[pos].some((h) => sameCard(h, c)))) throw new Error("Card not in hand");
  const passSelections = { ...state.passSelections, [pos]: cards };
  const updated = { ...state, passSelections };
  return Object.keys(passSelections).length === 4 ? { ...updated, phase: "PASS_EXCHANGE" } : updated;
}

export function finishPassExchange(state) {
  if (state.phase !== "PASS_EXCHANGE") throw new Error("Not in pass-exchange phase");
  const hands = {};
  const received = {};
  for (const pos of POSITIONS) {
    const outgoing = state.passSelections[pos];
    const incoming = state.passSelections[giver(pos, state.passDirection)];
    received[pos] = incoming;
    hands[pos] = sortHand([...state.hands[pos].filter((c) => !outgoing.some((o) => sameCard(o, c))), ...incoming]);
  }
  return beginPlay({ ...state, hands, received });
}

// ── Play ─────────────────────────────────────────────────────────────────────

export function legalMoves(state, pos) {
  if (state.phase !== "PLAYING" || state.turn !== pos) return [];
  const hand = state.hands[pos];
  const trick = state.currentTrick;
  const leading = trick.length === 0;
  if (state.rules.freeLead) {
    if (leading) return hand;
    const followers = hand.filter((c) => c.suit === trick[0].card.suit);
    return followers.length ? followers : hand;
  }
  const first = state.completedTricks.length === 0;
  if (first) {
    if (leading) return hand.filter((c) => sameCard(c, TWO_CLUBS));
    const led = trick[0].card.suit;
    const followers = hand.filter((c) => c.suit === led);
    if (followers.length) return followers;
    const safe = hand.filter((c) => c.suit !== "H" && !sameCard(c, QUEEN_SPADES));
    return safe.length ? safe : hand;
  }
  if (leading) {
    if (!state.heartsBroken) {
      const nonHearts = hand.filter((c) => c.suit !== "H");
      return nonHearts.length ? nonHearts : hand;
    }
    return hand;
  }
  const led = trick[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);
  return followers.length ? followers : hand;
}

export const isLegal = (state, pos, card) => legalMoves(state, pos).some((c) => sameCard(c, card));

export function scoreDeal(completedTricks, rules = HEARTS) {
  const raw = zero();
  const trickCounts = zero();
  for (const t of completedTricks) {
    const w = winnerOf(t);
    raw[w] += t.reduce((n, p) => n + penalty(p.card, rules), 0);
    trickCounts[w]++;
  }
  if (rules.moonEnabled) {
    const winners = [...new Set(completedTricks.filter((t) => trickPoints(t) > 0).map(winnerOf))];
    if (winners.length === 1) {
      const shooter = winners[0];
      const dealScores = {};
      for (const p of POSITIONS) dealScores[p] = p === shooter ? 0 : MOON;
      return { dealScores, rawPoints: raw, moonShooter: shooter, zeroTrickPlayers: [] };
    }
  }
  const dealScores = { ...raw };
  const zeroTrickPlayers = [];
  if (rules.zeroTrickBonus !== 0) {
    for (const p of POSITIONS) {
      if (trickCounts[p] === 0) {
        dealScores[p] = rules.zeroTrickBonus;
        zeroTrickPlayers.push(p);
      }
    }
  }
  return { dealScores, rawPoints: raw, moonShooter: null, zeroTrickPlayers };
}

export function play(state, pos, card) {
  if (state.phase !== "PLAYING") throw new Error("Not in playing phase");
  if (state.turn !== pos) throw new Error(`Not ${pos}'s turn`);
  if (!isLegal(state, pos, card)) throw new Error(`Illegal move: ${cardId(card)} by ${pos}`);

  const hands = { ...state.hands, [pos]: state.hands[pos].filter((c) => !sameCard(c, card)) };
  const trick = [...state.currentTrick, { position: pos, card }];
  const heartsBroken = state.heartsBroken || card.suit === "H";
  const withPlay = { ...state, hands, currentTrick: trick, heartsBroken };
  if (trick.length < 4) return { ...withPlay, turn: next(pos) };

  const winner = winnerOf(trick);
  const completed = [...state.completedTricks, trick];
  const resolved = {
    ...withPlay,
    currentTrick: [],
    completedTricks: completed,
    lastCompletedTrick: trick,
    lastTrickWinner: winner,
    tricksWon: { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 },
    leader: winner,
    turn: winner,
  };
  if (completed.length < 13) return resolved;

  const result = scoreDeal(completed, state.rules);
  const matchScores = {};
  for (const p of POSITIONS) matchScores[p] = state.matchScores[p] + result.dealScores[p];
  const over = Object.values(matchScores).some((s) => s >= state.rules.target);
  return { ...resolved, matchScores, dealResult: result, phase: over ? "MATCH_OVER" : "DEAL_OVER" };
}

export function matchWinner(state) {
  return POSITIONS.reduce((best, p) => (state.matchScores[p] < state.matchScores[best] ? p : best), POSITIONS[0]);
}

// ── Computer player (HeartsBot) ──────────────────────────────────────────────

const SUIT_RANK = { H: 4, S: 3, D: 2, C: 1 };
const byRankDesc = (a, b) => ord(b) - ord(a) || SUIT_RANK[b.suit] - SUIT_RANK[a.suit];
const sortDesc = (cards) => cards.slice().sort(byRankDesc);
const filterLower = (cards, base) => cards.filter((c) => c.suit === base.suit && ord(c) < ord(base));
const filterHigher = (cards, base) => cards.filter((c) => c.suit === base.suit && ord(c) > ord(base));
const between = (cards, lo, hi) => cards.filter((c) => c.suit === lo.suit && ord(c) >= ord(lo) && ord(c) <= ord(hi));
const bySuit = (cards, suit) => cards.filter((c) => c.suit === suit);
const containsCard = (cards, suit, rank) => cards.some((c) => c.suit === suit && c.rank === rank);
const removeCard = (cards, card) => cards.filter((c) => !sameCard(c, card));
const groupBySuit = (cards) => Object.fromEntries(SUITS.map((s) => [s, cards.filter((c) => c.suit === s)]));
const last = (a) => (a.length ? a[a.length - 1] : undefined);
const card = (suit, rank) => ({ suit, rank });
const isTrumpCard = (c) => c.suit === "H" || sameCard(c, QUEEN_SPADES);

function winningPlay(trick) {
  if (!trick.length) return null;
  const lead = trick[0].card.suit;
  return trick.filter((p) => p.card.suit === lead).reduce((b, p) => (ord(p.card) > ord(b.card) ? p : b));
}

const allPlayed = (state) => [...state.completedTricks.flat(), ...state.currentTrick].map((p) => p.card);
const playedBySuit = (state) => {
  const played = allPlayed(state);
  return Object.fromEntries(SUITS.map((s) => [s, played.filter((c) => c.suit === s).length]));
};
const remainingBySuit = (state) => {
  const p = playedBySuit(state);
  return Object.fromEntries(SUITS.map((s) => [s, 13 - p[s]]));
};
function suitLedCount(state) {
  const counts = { S: 0, H: 0, C: 0, D: 0 };
  for (const t of state.completedTricks) counts[t[0].card.suit]++;
  return counts;
}
function trumpVoidMap(state) {
  const map = { S: new Set(), H: new Set(), C: new Set(), D: new Set() };
  for (const t of state.completedTricks) {
    const lead = t[0].card.suit;
    for (const p of t.slice(1)) if (p.card.suit !== lead && isTrumpCard(p.card)) map[lead].add(p.position);
  }
  return map;
}
function dealPointsSoFar(state) {
  const pts = zero();
  for (const t of state.completedTricks) pts[winnerOf(t)] += trickPoints(t);
  return pts;
}
const isShootMoonPossible = (state) => Object.values(dealPointsSoFar(state)).filter((v) => v > 0).length <= 1;
const isTryingToShootMoon = (state, pos) => isShootMoonPossible(state) && dealPointsSoFar(state)[pos] >= 2;

function passCards(state, pos) {
  if (state.passDirection === "HOLD") return [];
  const hand = state.hands[pos];
  const hasTwoClubs = containsCard(hand, "C", "2");
  const needed = hasTwoClubs ? 2 : 3;
  const candidates = sortDesc(hand).filter((c) => !sameCard(c, TWO_CLUBS)).slice(0, needed);
  return hasTwoClubs ? [...candidates, TWO_CLUBS] : candidates;
}

// MoonShotStrategy
const countHonors = (cards) => cards.filter((c) => c.rank === "A" || c.rank === "K" || c.rank === "Q").length;
const suitIsSafe = (suit) => suit.length === 0 || suit.some((c) => c.rank === "A" || c.rank === "K");
const isDangerousShort = (suit) => suit.length > 0 && suit.length < 3 && !suitIsSafe(suit);

function canPlayMoonShot(hand) {
  if (hand.length < 8) return false;
  const hearts = bySuit(hand, "H");
  const spades = bySuit(hand, "S");
  const clubs = bySuit(hand, "C");
  const diamonds = bySuit(hand, "D");
  if (hearts.length < 5) return false;
  if (countHonors(hearts) < 2) return false;
  const qs = containsCard(hand, "S", "Q");
  const as = containsCard(hand, "S", "A");
  const ks = containsCard(hand, "S", "K");
  if (!qs && !(as && ks)) return false;
  const stoppers = [hearts, spades, clubs, diamonds].filter(suitIsSafe).length;
  if (stoppers < 3) return false;
  if (isDangerousShort(clubs) || isDangerousShort(diamonds)) return false;
  return true;
}

const shouldAbortMoon = (state, pos) => state.completedTricks.some((t) => trickPoints(t) > 0 && winnerOf(t) !== pos);

function moonFirstMove(valid, state) {
  if (!valid.length) return null;
  const grouped = groupBySuit(valid);
  const nonEmpty = Object.values(grouped).filter((g) => g.length).length;
  let best = null;
  let bestLen = 0;
  for (const suit of SUITS) {
    const cards = grouped[suit];
    if (!cards.length) continue;
    if (suit === "H" && !state.heartsBroken && nonEmpty > 1) continue;
    const top = sortDesc(cards)[0];
    if ((top.rank === "A" || top.rank === "K") && cards.length > bestLen) {
      bestLen = cards.length;
      best = top;
    }
  }
  return best || sortDesc(valid)[0];
}

function moonSubsequentMove(valid, state) {
  if (!valid.length) return null;
  const w = winningPlay(state.currentTrick);
  if (!w) return null;
  const sorted = sortDesc(valid);
  const higher = filterHigher(sorted, w.card);
  if (higher.length) return last(sortDesc(higher));
  return last(sorted);
}

// HeartsLeadStrategy
function smallHeartMove(hearts) {
  return last(between(hearts, card("H", "2"), card("H", "4")));
}

function spadeMove(spades, suitLed) {
  if (!spades.length) return null;
  if (between(spades, card("S", "Q"), card("S", "A")).length) return null;
  const led = suitLed.S;
  if (led <= 4) return between(spades, card("S", "2"), card("S", "J"))[0] || null;
  if (led <= 10) return between(spades, card("S", "2"), card("S", "5"))[0] || null;
  return null;
}

function playLow(cards, suit) {
  return last(sortDesc(between(cards, card(suit, "2"), card(suit, "5")))) || null;
}

function diamondOrClubMove(cards, state, suit) {
  if (!cards.length) return null;
  const playedCount = playedBySuit(state)[suit];
  const trumped = trumpVoidMap(state)[suit].size > 0;
  const remainingOthers = 13 - playedCount - cards.length;
  if (!trumped && playedCount < 6 && remainingOthers >= 6) return sortDesc(cards)[0];
  return playLow(cards, suit);
}

function fallbackLead(cards, rng) {
  const sorted = sortDesc(cards);
  const r = rng();
  const diamonds = bySuit(sorted, "D");
  const clubs = bySuit(sorted, "C");
  const spades = bySuit(sorted, "S");
  const hearts = bySuit(sorted, "H");
  if (diamonds.length && r < 0.3) return last(diamonds);
  if (clubs.length && r < 0.6) return last(clubs);
  if (spades.length && r < 0.8) return last(spades);
  if (hearts.length) return last(hearts);
  return last(sorted);
}

// `deterministic` is used for hints, so the suggestion doesn't change on every click.
function leadMove(state, pos, rng, deterministic) {
  const legal = legalMoves(state, pos);
  const grouped = groupBySuit(legal);
  const diamondCard = diamondOrClubMove(grouped.D, state, "D");
  const clubCard = diamondOrClubMove(grouped.C, state, "C");
  const heartCard = smallHeartMove(grouped.H);
  const spadeCard = spadeMove(grouped.S, suitLedCount(state));
  const preferred = [diamondCard, clubCard, heartCard, spadeCard].filter(Boolean);
  if (preferred.length) return deterministic ? preferred[0] : preferred[Math.floor(rng() * preferred.length)];
  return fallbackLead(legal, rng);
}

// HeartsFollowStrategy
function heartsStrategy(cards, state) {
  if (cards.length === 1) return cards[0];
  const sorted = sortDesc(cards);
  const w = winningPlay(state.currentTrick);
  const lower = filterLower(sorted, w.card);
  const higher = filterHigher(sorted, w.card);
  if (lower.length) {
    if (isTryingToShootMoon(state, w.position)) return last(lower);
    return lower[0];
  }
  return isShootMoonPossible(state) && higher.length > 1 ? higher[1] : higher[0];
}

function spadesStrategy(cards, state, position) {
  if (cards.length === 1) return cards[0];
  const sorted = sortDesc(cards);
  const haveQS = containsCard(sorted, "S", "Q");
  const winning = winningPlay(state.currentTrick).card;
  const roundPoints = trickPoints(state.currentTrick);
  const lower = sortDesc(filterLower(sorted, winning));
  const higher = sortDesc(filterHigher(sorted, winning));
  if (winning.rank === "K" || winning.rank === "A") {
    if (haveQS) return QUEEN_SPADES;
    if (lower.length) return lower[0];
    if (higher.length) return last(higher);
    return sorted[0];
  }
  if (winning.rank === "Q") {
    if (lower.length) return lower[0];
    if (higher.length) return higher[0];
    return sorted[0];
  }
  const btw = between(sorted, winning, card("S", "J"));
  const exceptQ = removeCard(sorted, QUEEN_SPADES);
  if (position === 4 && roundPoints === 0) return exceptQ.length ? exceptQ[0] : sorted[0];
  if (btw.length) return sortDesc(btw)[0];
  if (lower.length) return lower[0];
  if (exceptQ.length) return last(exceptQ);
  return sorted[0];
}

function diamondClubsStrategy(cards, state, position, pos) {
  const remaining = remainingBySuit(state);
  const roundSuit = state.currentTrick[0].card.suit;
  const sorted = sortDesc(cards);
  const canShootMoon = isShootMoonPossible(state);
  const alreadyTrumped = trickPoints(state.currentTrick) > 0;
  if (remaining[roundSuit] >= 6 && !alreadyTrumped) {
    if (canShootMoon && pos !== "SOUTH" && sorted.length >= 2) return sorted[1];
    return sorted[0];
  }
  const winning = winningPlay(state.currentTrick).card;
  const lower = filterLower(sorted, winning);
  if (lower.length) return lower[0];
  if (position === 2 || position === 3) {
    const higher = filterHigher(sorted, winning);
    const belowFive = filterLower(higher, card(roundSuit, "5"));
    if (belowFive.length) return last(belowFive);
  }
  return sorted[0];
}

function offSuitStrategy(cards, state) {
  const sorted = sortDesc(cards);
  if (containsCard(sorted, "S", "Q")) return QUEEN_SPADES;
  const w = winningPlay(state.currentTrick);
  if (w && isTryingToShootMoon(state, w.position)) return last(sorted);
  const hearts = bySuit(sorted, "H");
  if (hearts.length) return sortDesc(hearts)[0];
  return sorted[0];
}

function followMove(state, pos) {
  const valid = legalMoves(state, pos);
  const roundSuit = state.currentTrick[0].card.suit;
  const position = state.currentTrick.length + 1;
  if (valid.some((c) => c.suit === roundSuit)) {
    if (roundSuit === "S") return spadesStrategy(valid, state, position);
    if (roundSuit === "H") return heartsStrategy(valid, state);
    return diamondClubsStrategy(valid, state, position, pos);
  }
  return offSuitStrategy(valid, state);
}

export function createBot(rng = Math.random) {
  let lastSeenDeal = null;
  const moonCommit = {};

  function shouldAttemptMoon(state, pos) {
    if (!state.rules.moonEnabled) return false;
    if (lastSeenDeal !== state.dealNumber) {
      lastSeenDeal = state.dealNumber;
      for (const k of Object.keys(moonCommit)) delete moonCommit[k];
    }
    if (pos in moonCommit) {
      if (!moonCommit[pos]) return false;
      if (shouldAbortMoon(state, pos)) {
        moonCommit[pos] = false;
        return false;
      }
      return true;
    }
    if (state.completedTricks.length) {
      moonCommit[pos] = false;
      return false;
    }
    moonCommit[pos] = canPlayMoonShot(state.hands[pos]);
    return moonCommit[pos];
  }

  return {
    choosePass: (state, pos) => passCards(state, pos),
    chooseCard(state, pos, { deterministic = false } = {}) {
      if (!deterministic && shouldAttemptMoon(state, pos)) {
        const valid = legalMoves(state, pos);
        const moonCard = state.currentTrick.length ? moonSubsequentMove(valid, state) : moonFirstMove(valid, state);
        if (moonCard) return moonCard;
      }
      return state.currentTrick.length ? followMove(state, pos) : leadMove(state, pos, rng, deterministic);
    },
  };
}
