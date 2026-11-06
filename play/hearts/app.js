import * as E from "./engine.js";

// The same page script runs Hearts and Bray; <html data-game="bray"> picks the Bray rules.
const GAME = document.documentElement.dataset.game === "bray"
  ? {
      rules: E.BRAY,
      play: "com.datgames.bray",
      ios: "1607650705",
      campaign: "play_bray",
      promo: "Online multiplayer, stats, themes and rule options.",
    }
  : {
      rules: E.HEARTS,
      play: "com.datgames.hearts",
      ios: "1620761646",
      campaign: "play_hearts",
      promo: "Achievements, stats, themes and rule options.",
    };
const NAMES = { SOUTH: "You", WEST: "William", NORTH: "Arthur", EAST: "Emma" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const DIR_TEXT = { LEFT: "to the left", RIGHT: "to the right", ACROSS: "across to your partner seat", HOLD: "" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { play: 5, trickHold: 5 } : { play: 700, trickHold: 1100 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  passPanel: $("[data-pass]"),
  passInfo: $("[data-pass-info]"),
  passBtn: $("[data-pass-btn]"),
  dirChip: $("[data-dir]"),
  brokenChip: $("[data-broken]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.POSITIONS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let bot = E.createBot();
let run = 0;
let selected = []; // cards chosen to pass
let hintCards = []; // highlighted by the Hint button
let shownTrick = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const has = (list, c) => list.some((x) => E.sameCard(x, c));

function cardEl(card) {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${SUIT_NAME[card.suit].toLowerCase()}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip">${GLYPH[card.suit]}</span>`;
  return d;
}

function dealPoints(seat) {
  return state.completedTricks.reduce((n, t) => {
    const lead = t[0].card.suit;
    const w = t.filter((p) => p.card.suit === lead).reduce((b, p) => (E.RANKS.indexOf(p.card.rank) > E.RANKS.indexOf(b.card.rank) ? p : b));
    return w.position === seat ? n + t.reduce((m, p) => m + E.penalty(p.card, state.rules), 0) : n;
  }, 0);
}

function render() {
  if (!state) return;
  el.score.innerHTML = `<span>You <b>${state.matchScores.SOUTH}</b></span><small>lowest wins · game to ${state.rules.target}</small>`;
  el.round.textContent = `Deal ${state.dealNumber}`;

  const playing = state.phase === "PLAYING";
  for (const s of E.POSITIONS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "SOUTH" ? "" : "");
    const dp = state.phase === "PASSING" || state.phase === "PASS_EXCHANGE" ? 0 : dealPoints(s);
    seat.querySelector("[data-call]").textContent = `${dp} pts · total ${state.matchScores[s]}`;
    seat.classList.toggle("is-turn", playing && state.turn === s && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
  }

  if (state.rules.freeLead) {
    el.dirChip.textContent = `${NAMES[E.POSITIONS[(state.dealNumber - 1) % 4]]} leads this deal`;
    el.brokenChip.className = "chip-trump red";
    el.brokenChip.innerHTML = `<b>♥</b> Any card may be led`;
  } else {
    el.dirChip.textContent = state.passDirection === "HOLD" ? "No passing this deal" : `Pass ${state.passDirection.toLowerCase()}`;
    el.brokenChip.className = "chip-trump " + (state.heartsBroken ? "red" : "");
    el.brokenChip.innerHTML = state.heartsBroken ? `<b>♥</b> Hearts broken` : `<b>♥</b> Hearts not broken`;
  }

  // Hand
  el.hand.replaceChildren();
  const passing = state.phase === "PASSING";
  const legal = playing && state.turn === "SOUTH" && !shownTrick ? E.legalMoves(state, "SOUTH") : [];
  const received = !state.completedTricks.length && state.received.SOUTH ? state.received.SOUTH : [];
  state.hands.SOUTH.forEach((c) => {
    const isLegal = has(legal, c);
    const b = document.createElement("button");
    b.type = "button";
    b.className =
      "hand-card" +
      (isLegal ? " is-legal" : "") +
      (passing ? " is-pickable" : "") +
      (passing && has(selected, c) ? " is-selected" : "") +
      (has(hintCards, c) ? " is-hint" : "") +
      (has(received, c) ? " is-new" : "");
    b.disabled = !(isLegal || passing);
    b.appendChild(cardEl(c));
    b.addEventListener("click", () => (passing ? togglePass(c) : onPlay(c)));
    el.hand.appendChild(b);
  });

  // Trick
  el.trick.replaceChildren();
  const plays = shownTrick ? shownTrick.plays : state.currentTrick;
  for (const p of plays) {
    const slot = document.createElement("div");
    slot.className = `trick-slot slot-${p.position.toLowerCase()}` + (shownTrick && shownTrick.winner === p.position ? " is-winner" : "");
    slot.appendChild(cardEl(p.card));
    el.trick.appendChild(slot);
  }

  // Pass panel
  el.passPanel.hidden = !passing;
  if (passing) {
    el.passInfo.textContent = `Choose 3 cards to pass ${DIR_TEXT[state.passDirection]} (${selected.length}/3)`;
    el.passBtn.disabled = selected.length !== 3;
  }

  el.hint.disabled = !(passing || legal.length);
}

const setStatus = (t) => (el.status.textContent = t);

function togglePass(c) {
  if (state.phase !== "PASSING") return;
  hintCards = [];
  if (has(selected, c)) selected = selected.filter((x) => !E.sameCard(x, c));
  else if (selected.length < 3) selected = [...selected, c];
  render();
}

function confirmPass() {
  if (state.phase !== "PASSING" || selected.length !== 3) return;
  state = E.selectPass(state, "SOUTH", selected);
  for (const p of E.POSITIONS) if (p !== "SOUTH") state = E.selectPass(state, p, bot.choosePass(state, p));
  selected = [];
  hintCards = [];
  state = E.finishPassExchange(state);
  advance();
}

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "PASSING") {
      setStatus(`Select 3 cards to pass ${DIR_TEXT[state.passDirection]}, then tap Pass cards.`);
      return;
    }
    if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        const first = state.completedTricks.length === 0;
        const got = !state.completedTricks.length && state.received.SOUTH && state.currentTrick.length === 0 && state.passDirection !== "HOLD";
        setStatus(
          first && state.currentTrick.length === 0
            ? GAME.rules.freeLead
              ? "You lead the first trick. Any card is fine."
              : "You hold the 2♣, so you lead it."
            : state.currentTrick.length === 0
              ? "Your lead."
              : "Your turn. Glowing cards are legal plays.",
        );
        void got;
        return;
      }
      setStatus(`${NAMES[state.turn]} is thinking…`);
      await sleep(SPEED.play);
      if (token !== run) return;
      await playCard(state.turn, bot.chooseCard(state, state.turn), token);
      if (token !== run) return;
    } else {
      showDealOver();
      return;
    }
  }
}

async function playCard(seat, c, token) {
  const before = state.completedTricks.length;
  const wasBroken = state.heartsBroken;
  state = E.play(state, seat, c);
  hintCards = [];
  if (!wasBroken && state.heartsBroken) setStatus("Hearts are broken.");
  if (state.completedTricks.length > before) {
    shownTrick = { plays: state.lastCompletedTrick, winner: state.lastTrickWinner };
    render();
    const pts = state.lastCompletedTrick.reduce((n, p) => n + E.penalty(p.card, state.rules), 0);
    setStatus(`${NAMES[state.lastTrickWinner]} takes the trick${pts ? ` and ${pts} point${pts > 1 ? "s" : ""}` : ""}.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

async function onPlay(c) {
  if (!(state.phase === "PLAYING" && state.turn === "SOUTH") || shownTrick) return;
  if (!E.isLegal(state, "SOUTH", c)) return;
  const token = run;
  await playCard("SOUTH", c, token);
  if (token === run) advance();
}

function onHint() {
  if (state.phase === "PASSING") {
    hintCards = bot.choosePass(state, "SOUTH");
    selected = hintCards.slice();
  } else if (state.phase === "PLAYING" && state.turn === "SOUTH") {
    hintCards = [bot.chooseCard(state, "SOUTH", { deterministic: true })];
  }
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function ranking() {
  return E.POSITIONS.slice().sort((a, b) => state.matchScores[a] - state.matchScores[b]);
}

function showDealOver() {
  const r = state.dealResult;
  const matchDone = state.phase === "MATCH_OVER";
  const low = Math.min(...E.POSITIONS.map((p) => state.matchScores[p]));
  const rows = [...E.POSITIONS]
    .sort((a, b) => state.matchScores[a] - state.matchScores[b])
    .map(
      (p) =>
        `<tr class="${p === "SOUTH" ? "me" : ""}"><th>${NAMES[p]}</th><td class="${r.dealScores[p] === 0 ? "good" : r.dealScores[p] >= 13 ? "bad" : ""}">${r.dealScores[p] > 0 ? "+" : ""}${r.dealScores[p]}</td><td><strong>${state.matchScores[p]}</strong>${state.matchScores[p] === low ? " ★" : ""}</td></tr>`,
    )
    .join("");
  const moon = r.moonShooter
    ? `<p class="dlg-note moon">🌙 <b>${r.moonShooter === "SOUTH" ? "You shot" : NAMES[r.moonShooter] + " shot"} the moon!</b> ${r.moonShooter === "SOUTH" ? "Everyone else takes" : "You and the others take"} 26.</p>`
    : "";
  const zero = r.zeroTrickPlayers.length
    ? `<p class="dlg-note moon">🧤 <b>${r.zeroTrickPlayers.map((p) => NAMES[p]).join(", ")}</b> took no tricks: ${r.zeroTrickPlayers.includes("SOUTH") && r.zeroTrickPlayers.length === 1 ? "a" : "each a"} <b>${GAME.rules.zeroTrickBonus}</b> bonus.</p>`
    : "";
  const title = r.moonShooter === "SOUTH" ? "You shot the moon!" : r.zeroTrickPlayers.includes("SOUTH") ? "No tricks: −12 bonus!" : r.dealScores.SOUTH === 0 ? "A clean deal!" : `You took ${r.dealScores.SOUTH} point${r.dealScores.SOUTH === 1 ? "" : "s"}`;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Deal ${state.dealNumber} of the match</p>
      <h2 id="dlg-title" class="${r.dealScores.SOUTH <= 5 ? "good" : "bad"}">${title}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>This deal</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${moon}${zero}
      <p class="dlg-note">Lowest total wins. The game ends when someone reaches ${state.rules.target}.</p>
      <button class="dlg-btn" type="button" data-next autofocus>${matchDone ? "See final result" : "Next deal"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (matchDone) return showMatchOver();
    state = E.nextDeal(state);
    selected = [];
    hintCards = [];
    advance();
  });
}

function showMatchOver() {
  const order = ranking();
  const place = order.indexOf("SOUTH") + 1;
  const won = order[0] === "SOUTH";
  const list = order
    .map((s, i) => `<li class="${s === "SOUTH" ? "me" : ""}"><span>${i + 1}</span><strong>${NAMES[s]}</strong><em>${state.matchScores[s]}</em></li>`)
    .join("");
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete</p>
      <h2 id="dlg-title" class="${won ? "good" : "bad"}">${won ? "You won the match! 🏆" : `You finished ${place}${["st", "nd", "rd", "th"][Math.min(place, 4) - 1]}`}</h2>
      <ol class="final-list">${list}</ol>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> ${GAME.promo}</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=${GAME.play}&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=${GAME.campaign}&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <a class="store-btn" href="https://apps.apple.com/app/id${GAME.ios}?ct=web_game_match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function newMatch() {
  run++;
  el.overlay.hidden = true;
  selected = [];
  hintCards = [];
  shownTrick = null;
  bot = E.createBot();
  state = E.newDeal(1, undefined, Math.random, GAME.rules);
  advance();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
el.passBtn.addEventListener("click", confirmPass);
newMatch();
