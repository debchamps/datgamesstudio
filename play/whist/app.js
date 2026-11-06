import * as E from "./engine.js";

const NAMES = { SOUTH: "You", WEST: "William", NORTH: "Arthur", EAST: "Emma" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { play: 5, trickHold: 5, reveal: 5 } : { play: 700, trickHold: 1100, reveal: 1500 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  trumpChip: $("[data-trump-chip]"),
  tricksChip: $("[data-tricks]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.POSITIONS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let run = 0;
let hintCard = null;
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);
const teamTricks = (team) => E.POSITIONS.filter((p) => E.teamOf(p) === team).reduce((n, p) => n + state.tricksWon[p], 0);

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
  el.score.innerHTML = `<span class="sc-us">Us <b>${state.teamScores[1]}</b></span><span class="sc-them">Them <b>${state.teamScores[2]}</b></span><small>to ${E.TARGET}</small>`;
  el.round.textContent = `Hand ${state.gameNumber}`;

  for (const s of E.POSITIONS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    seat.querySelector("[data-call]").textContent = `${state.tricksWon[s]} trick${state.tricksWon[s] === 1 ? "" : "s"}${s === state.dealer ? " · dealer" : ""}`;
    seat.classList.toggle("is-turn", state.turn === s && state.phase === "PLAYING" && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
  }

  const t = state.trumpCard;
  el.trumpChip.className = "chip-trump " + (isRed(t) ? "red" : "");
  el.trumpChip.innerHTML = `Trump <b>${GLYPH[t.suit]}</b> ${SUIT_NAME[t.suit]} <span class="sub">(${NAMES[state.dealer] === "You" ? "your" : NAMES[state.dealer] + "’s"} ${t.rank}${GLYPH[t.suit]})</span>`;
  el.tricksChip.innerHTML = `Tricks: us <b>${teamTricks(1)}</b> · them <b>${teamTricks(2)}</b> (need 7+)`;

  el.hand.replaceChildren();
  const legal = state.phase === "PLAYING" && state.turn === "SOUTH" && !shownTrick ? E.legalMoves(state, "SOUTH") : [];
  state.hands.SOUTH.forEach((card) => {
    const isLegal = legal.some((c) => E.sameCard(c, card));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hand-card" + (isLegal ? " is-legal" : "") + (hintCard && E.sameCard(hintCard, card) ? " is-hint" : "");
    b.disabled = !isLegal;
    b.appendChild(cardEl(card));
    b.addEventListener("click", () => onPlay(card));
    el.hand.appendChild(b);
  });

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

  el.hint.disabled = !legal.length;
}

const setStatus = (t) => (el.status.textContent = t);

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "PLAYING") {
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

async function onPlay(card) {
  if (!(state.phase === "PLAYING" && state.turn === "SOUTH") || shownTrick) return;
  if (!E.isLegal(state, "SOUTH", card)) return;
  const token = run;
  await playCard("SOUTH", card, token);
  if (token === run) advance();
}

function onHint() {
  if (state.phase === "PLAYING" && state.turn === "SOUTH") hintCard = E.chooseCard(state, "SOUTH");
  render();
}

async function announceTrump(token) {
  render();
  const t = state.trumpCard;
  setStatus(`${NAMES[state.dealer] === "You" ? "You turn" : NAMES[state.dealer] + " turns"} up the ${t.rank}${GLYPH[t.suit]}: ${SUIT_NAME[t.suit]} are trump.`);
  await sleep(SPEED.reveal);
  if (token === run) advance();
}

function showRoundOver() {
  const r = state.roundResult;
  const matchDone = state.phase === "MATCH_OVER";
  const weWon = r.winningTeam === 1;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Hand ${state.gameNumber} · Trump ${GLYPH[r.trump]} ${SUIT_NAME[r.trump]}</p>
      <h2 id="dlg-title" class="${weWon ? "good" : "bad"}">${weWon ? `You took ${r.teamTricks[1]} tricks!` : `They took ${r.teamTricks[2]} tricks`}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Tricks</th><th>Points</th><th>Total</th></tr></thead>
        <tbody>
          <tr class="me"><th>Us</th><td>${r.teamTricks[1]}</td><td class="${r.delta[1] ? "good" : ""}">${r.delta[1] ? "+" + r.delta[1] : "0"}</td><td><strong>${r.teamScores[1]}</strong></td></tr>
          <tr><th>Them</th><td>${r.teamTricks[2]}</td><td class="${r.delta[2] ? "good" : ""}">${r.delta[2] ? "+" + r.delta[2] : "0"}</td><td><strong>${r.teamScores[2]}</strong></td></tr>
        </tbody>
      </table>
      <p class="dlg-note">Only tricks over six score: 1 point each. First team to ${E.TARGET} wins.</p>
      <button class="dlg-btn" type="button" data-next autofocus>${matchDone ? "See final result" : "Next hand"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (matchDone) return showMatchOver();
    state = E.nextRound(state);
    hintCard = null;
    announceTrump(run);
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
        <p><strong>Like it? Get the full game.</strong> Longer matches, stats and themes.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.datgames.whist&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_whist&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <a class="store-btn" href="https://apps.apple.com/app/id6443517269?ct=web_game_match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function newMatch() {
  window.datTrack && datTrack('game_start');
  run++;
  el.overlay.hidden = true;
  hintCard = null;
  shownTrick = null;
  state = E.startGame("WEST");
  announceTrump(run);
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
newMatch();
