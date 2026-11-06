import * as E from "./engine.js";

const NAMES = { SOUTH: "You", EAST: "Emma", NORTH: "Arthur", WEST: "William" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { play: 5, trickHold: 5, draw: 5 } : { play: 700, trickHold: 1100, draw: 1800 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  trumpPanel: $("[data-trump-panel]"),
  trumpInfo: $("[data-trump-info]"),
  trumpButtons: $("[data-trump-buttons]"),
  trumpChip: $("[data-trump-chip]"),
  hakemChip: $("[data-hakem]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.SEATS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let run = 0;
let hintCard = null;
let hintTrump = null;
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);
const teamTricks = (team) => E.SEATS.filter((s) => E.teamOf(s) === team).reduce((n, s) => n + state.tricksWon[s], 0);
const fmtSuit = (s) => `${GLYPH[s]} ${SUIT_NAME[s]}`;

function cardEl(card) {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}${FACE.has(card.rank) ? " face" : ""}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${SUIT_NAME[card.suit].toLowerCase()}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip" data-rank="${card.rank}">${GLYPH[card.suit]}</span><span class="pc-corner pc-br">${card.rank}<i>${GLYPH[card.suit]}</i></span>`;
  return d;
}

function render() {
  if (!state) return;
  el.score.innerHTML = `<span class="sc-us">Us <b>${state.teamScores[1]}</b></span><span class="sc-them">Them <b>${state.teamScores[2]}</b></span><small>to ${E.POINTS_TO_WIN}</small>`;
  el.round.textContent = `Hand ${state.handNumber}`;

  const playing = state.phase === "PLAYING" || state.phase === "ROUND_OVER" || state.phase === "MATCH_OVER";
  for (const s of E.SEATS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    seat.querySelector("[data-call]").textContent = playing ? `${state.tricksWon[s]} trick${state.tricksWon[s] === 1 ? "" : "s"}` : s === state.hakem ? "Hâkem" : "–";
    seat.classList.toggle("is-turn", state.turn === s && state.phase !== "ROUND_OVER" && state.phase !== "MATCH_OVER" && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
    seat.classList.toggle("is-bidder", s === state.hakem);
  }

  el.hakemChip.innerHTML = playing
    ? `Hâkem: <b>${NAMES[state.hakem]}</b> · tricks <b>${teamTricks(1)}</b>–<b>${teamTricks(2)}</b> (first to ${E.TRICKS_TO_WIN_HAND})`
    : `Hâkem: <b>${NAMES[state.hakem]}</b>`;
  el.trumpChip.hidden = !playing;
  if (playing) {
    el.trumpChip.className = "chip-trump " + (state.trump === "H" || state.trump === "D" ? "red" : "");
    el.trumpChip.innerHTML = `Trump <b>${GLYPH[state.trump]}</b> ${SUIT_NAME[state.trump]}`;
  }

  // Hand. While trump is being chosen only the Hâkem's first five cards are known.
  el.hand.replaceChildren();
  const choosing = state.phase === "TRUMP_SELECT";
  const legal = state.phase === "PLAYING" && state.turn === "SOUTH" && !shownTrick ? E.legalMoves(state, "SOUTH") : [];
  const cards = choosing ? (state.hakem === "SOUTH" ? state.hakemInitialFive.slice().sort((a, b) => E.SUITS.indexOf(a.suit) - E.SUITS.indexOf(b.suit) || E.RANKS.indexOf(b.rank) - E.RANKS.indexOf(a.rank)) : []) : state.hands.SOUTH;
  cards.forEach((card) => {
    const isLegal = legal.some((c) => E.sameCard(c, card));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hand-card" + (isLegal ? " is-legal" : "") + (hintCard && E.sameCard(hintCard, card) ? " is-hint" : "");
    b.disabled = !isLegal;
    b.appendChild(cardEl(card));
    b.addEventListener("click", () => onPlay(card));
    el.hand.appendChild(b);
  });

  // Trick
  el.trick.replaceChildren();
  const plays = shownTrick ? shownTrick.plays : state.currentTrick;
  if (!plays.length) seenTrick.clear();
  for (const p of plays) {
    const slot = document.createElement("div");
    slot.className = `trick-slot slot-${p.player.toLowerCase()}` + (seenTrick.has(E.cardId(p.card)) ? "" : " fresh") + (shownTrick && shownTrick.winner === p.player ? " is-winner" : "");
    seenTrick.add(E.cardId(p.card));
    slot.appendChild(cardEl(p.card));
    el.trick.appendChild(slot);
  }

  // Trump panel (Hâkem = you)
  const picking = choosing && state.hakem === "SOUTH";
  el.trumpPanel.hidden = !picking;
  el.trumpButtons.replaceChildren();
  if (picking) {
    el.trumpInfo.textContent = "You are the Hâkem. Pick trump from your first five cards.";
    for (const suit of E.SUITS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suit-btn " + (suit === "H" || suit === "D" ? "red" : "") + (hintTrump === suit ? " is-hint" : "");
      btn.innerHTML = `<b>${GLYPH[suit]}</b><span>${SUIT_NAME[suit]}</span>`;
      btn.addEventListener("click", () => onTrump(suit));
      el.trumpButtons.appendChild(btn);
    }
  }

  el.hint.disabled = !(picking || legal.length);
}

const setStatus = (t) => (el.status.textContent = t);

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "TRUMP_SELECT") {
      if (state.hakem === "SOUTH") {
        setStatus("You are the Hâkem. Choose the trump suit.");
        return;
      }
      setStatus(`${NAMES[state.hakem]} is the Hâkem and is choosing trump…`);
      await sleep(SPEED.play * 1.3);
      if (token !== run) return;
      state = E.selectTrump(state, state.hakem, E.chooseTrump(state, state.hakem));
    } else if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        setStatus(state.currentTrick.length === 0 ? "Your lead. Play any card." : "Your turn. Glowing cards are legal plays.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is thinking…`);
      await sleep(SPEED.play);
      if (token !== run) return;
      await playCard(state.turn, E.chooseCard(state, state.turn), token);
      if (token !== run) return;
    } else {
      showRoundOver();
      return;
    }
  }
}

async function playCard(seat, card, token) {
  const before = state.completedTricks.length;
  state = E.play(state, seat, card);
  hintCard = null;
  if (state.completedTricks.length > before) {
    shownTrick = { plays: state.lastCompletedTrick, winner: state.lastTrickWinner };
    render();
    setStatus(`${NAMES[state.lastTrickWinner]} takes the trick.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function onTrump(suit) {
  if (state.phase !== "TRUMP_SELECT" || state.hakem !== "SOUTH") return;
  hintTrump = null;
  state = E.selectTrump(state, "SOUTH", suit);
  advance();
}

async function onPlay(card) {
  if (!(state.phase === "PLAYING" && state.turn === "SOUTH") || shownTrick) return;
  if (!E.isLegal(state, "SOUTH", card)) return;
  const token = run;
  await playCard("SOUTH", card, token);
  if (token === run) advance();
}

function onHint() {
  if (state.phase === "TRUMP_SELECT" && state.hakem === "SOUTH") hintTrump = E.chooseTrump(state, "SOUTH");
  else if (state.phase === "PLAYING" && state.turn === "SOUTH") hintCard = E.chooseCard(state, "SOUTH");
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function showRoundOver() {
  const r = state.roundResult;
  const matchDone = state.phase === "MATCH_OVER";
  const weWon = r.winningTeam === 1;
  const hakemUs = r.hakemTeam === 1;
  const kotNote = r.kot
    ? `<p class="dlg-note moon">🧹 <b>Kot!</b> ${weWon ? "You swept" : "They swept"} all ${E.TRICKS_TO_WIN_HAND} tricks${r.hakemTeam === r.winningTeam ? "" : " against the Hâkem"}: <b>${r.points} points</b>.</p>`
    : "";
  const nextHakem = r.hakemLost ? E.nextSeat(state.hakem) : state.hakem;
  const next = matchDone
    ? ""
    : `<p class="dlg-note">${r.hakemLost ? `The Hâkem's team lost, so the Hâkem role passes to <b>${NAMES[nextHakem]}</b>.` : `The Hâkem's team won, so <b>${NAMES[state.hakem]}</b> stays Hâkem.`}</p>`;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Hand ${state.handNumber} · Trump ${fmtSuit(r.trump)}</p>
      <h2 id="dlg-title" class="${weWon ? "good" : "bad"}">${weWon ? "You won the hand!" : "They won the hand"}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Tricks</th><th>Points</th><th>Total</th></tr></thead>
        <tbody>
          <tr class="me"><th>Us${hakemUs ? " (Hâkem)" : ""}</th><td>${r.teamTricks[1]}</td><td class="${r.delta[1] ? "good" : ""}">${r.delta[1] ? "+" + r.delta[1] : "0"}</td><td><strong>${r.teamScores[1]}</strong></td></tr>
          <tr><th>Them${hakemUs ? "" : " (Hâkem)"}</th><td>${r.teamTricks[2]}</td><td class="${r.delta[2] ? "good" : ""}">${r.delta[2] ? "+" + r.delta[2] : "0"}</td><td><strong>${r.teamScores[2]}</strong></td></tr>
        </tbody>
      </table>
      ${kotNote}
      ${next}
      <button class="dlg-btn" type="button" data-next autofocus>${matchDone ? "See final result" : "Next hand"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (matchDone) return showMatchOver();
    state = E.nextRound(state);
    hintCard = hintTrump = null;
    advance();
  });
}

function showMatchOver() {
  const won = state.matchWinnerTeam === 1;
  window.datTrack && datTrack('match_finish', { result: won ? 'won' : 'lost' });
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete</p>
      <h2 id="dlg-title" class="${won ? "good" : "bad"}">${won ? "You won the match! 🏆" : "The opponents won the match"}</h2>
      <p class="dlg-score">Final: <b>Us ${state.teamScores[1]}</b> · <b>Them ${state.teamScores[2]}</b></p>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> Court Piece mode, English and Arabic, stats and themes.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.datgames.hokm&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_hokm&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <span class="store-btn is-soon"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>iPhone</small>Coming soon</span></span>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

async function newMatch() {
  window.datTrack && datTrack('game_start');
  run++;
  const token = run;
  el.overlay.hidden = true;
  hintCard = hintTrump = null;
  shownTrick = null;
  const draw = E.drawFirstHakem();
  state = E.startGame(draw.hakem);
  render();
  const last = draw.flips[draw.flips.length - 1];
  setStatus(`Drawing for the Hâkem: cards go round until an Ace. ${NAMES[last.player]} gets the ${last.card.rank}${GLYPH[last.card.suit]} and is the Hâkem.`);
  await sleep(SPEED.draw);
  if (token !== run) return;
  advance();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
newMatch();
