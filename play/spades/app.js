import * as E from "./engine.js";

const NAMES = { SOUTH: "You", WEST: "William", NORTH: "Arthur", EAST: "Emma" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { bid: 5, play: 5, trickHold: 5 } : { bid: 700, play: 700, trickHold: 1100 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  bid: $("[data-bid]"),
  bidInfo: $("[data-bid-info]"),
  bidButtons: $("[data-bid-buttons]"),
  teamChip: $("[data-team]"),
  brokenChip: $("[data-broken]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.POSITIONS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let run = 0;
let hintCard = null;
let hintBid = undefined;
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);
const bidText = (b) => (b === 0 ? "Nil" : `${b}`);
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

function cardEl(card) {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}${FACE.has(card.rank) ? " face" : ""}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${SUIT_NAME[card.suit].toLowerCase()}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip" data-rank="${card.rank}">${GLYPH[card.suit]}</span><span class="pc-corner pc-br">${card.rank}<i>${GLYPH[card.suit]}</i></span>`;
  return d;
}

function teamLine(team) {
  const players = team === 1 ? ["SOUTH", "NORTH"] : ["EAST", "WEST"];
  if (players.some((p) => !(p in state.bids))) return null;
  const bid = players.reduce((n, p) => n + state.bids[p], 0);
  const won = players.reduce((n, p) => n + (state.bids[p] > 0 ? state.tricksWon[p] : 0), 0);
  return { bid, won };
}

function render() {
  if (!state) return;
  el.score.innerHTML = `<span class="sc-us">Us <b>${state.teamScores[1]}</b></span><span class="sc-them">Them <b>${state.teamScores[2]}</b></span><small>to ${E.TARGET}</small>`;
  el.round.textContent = `Round ${state.gameNumber}`;

  const playing = state.phase !== "BIDDING";
  for (const s of E.POSITIONS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    const b = state.bids[s];
    seat.querySelector("[data-call]").textContent =
      b === undefined ? "–" : playing ? `bid ${bidText(b)} · won ${state.tricksWon[s]}` : `Bid ${bidText(b)}`;
    seat.classList.toggle("is-turn", state.turn === s && (state.phase === "BIDDING" || state.phase === "PLAYING") && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
    seat.classList.toggle("is-nil", b === 0);
  }

  const us = teamLine(1);
  const them = teamLine(2);
  el.teamChip.innerHTML = us && them ? `Us <b>${us.won}/${us.bid}</b> · Them <b>${them.won}/${them.bid}</b>` : "Bidding…";
  el.brokenChip.className = "chip-trump" + (state.spadesBroken ? "" : " muted");
  el.brokenChip.innerHTML = state.spadesBroken ? `<b>♠</b> Spades broken` : `<b>♠</b> Spades not broken`;

  // Your hand
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

  // Bidding panel
  const bidding = state.phase === "BIDDING" && state.turn === "SOUTH";
  el.bid.hidden = !bidding;
  el.bidButtons.replaceChildren();
  if (bidding) {
    const partner = state.bids.NORTH;
    el.bidInfo.textContent =
      partner === undefined ? "How many tricks will you take? Nil = none at all." : `Arthur bid ${bidText(partner)}. How many will you take?`;
    const max = E.maxAllowedBid(state, "SOUTH");
    for (let n = 0; n <= max; n++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bid-btn" + (n === 0 ? " bid-nil" : "") + (hintBid === n ? " is-hint" : "");
      btn.textContent = n === 0 ? "Nil" : n;
      btn.addEventListener("click", () => onBid(n));
      el.bidButtons.appendChild(btn);
    }
  }

  el.hint.disabled = !(bidding || legal.length);
}

const setStatus = (t) => (el.status.textContent = t);

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "BIDDING") {
      if (state.turn === "SOUTH") {
        setStatus("Your bid. Count your Aces, Kings and spades.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is bidding…`);
      await sleep(SPEED.bid);
      if (token !== run) return;
      state = E.applyBid(state, state.turn, E.chooseBid(state, state.turn));
    } else if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        const lead = state.currentTrick.length === 0;
        setStatus(lead ? (state.spadesBroken ? "Your lead." : "Your lead. Spades can't be led until they're broken.") : "Your turn. Glowing cards are legal plays.");
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
  const wasBroken = state.spadesBroken;
  state = E.play(state, seat, card);
  if (seat === "SOUTH") window.DATAnalytics?.cardPlayed();
  hintCard = null;
  if (!wasBroken && state.spadesBroken) setStatus("Spades are broken.");
  if (state.completedTricks.length > before) {
    shownTrick = { plays: state.lastCompletedTrick, winner: state.lastTrickWinner };
    render();
    const w = state.lastTrickWinner;
    const bust = state.bids[w] === 0 && state.tricksWon[w] === 1;
    setStatus(bust ? `${NAMES[w]} takes a trick and busts the Nil!` : `${NAMES[w]} takes the trick.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function onBid(n) {
  if (state.phase !== "BIDDING" || state.turn !== "SOUTH") return;
  hintBid = undefined;
  state = E.applyBid(state, "SOUTH", n);
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
  if (state.phase === "BIDDING" && state.turn === "SOUTH") hintBid = E.chooseBid(state, "SOUTH");
  else if (state.phase === "PLAYING" && state.turn === "SOUTH") hintCard = E.chooseCard(state, "SOUTH");
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function showRoundOver() {
  const r = state.roundResult;
  const matchDone = E.isMatchComplete(state);
  const nilNotes = E.POSITIONS.filter((p) => r.bids[p] === 0)
    .map((p) => `${NAMES[p]}'s Nil ${r.nilStatus[p] === "MADE" ? `made: <b>+${E.NIL_BONUS}</b>` : `failed: <b>−${E.NIL_BONUS}</b>`}`)
    .join(" · ");
  const row = (t, label) =>
    `<tr class="${t === 1 ? "me" : ""}"><th>${label}</th><td>${r.teamBids[t]}</td><td>${r.effective[t]}</td><td class="${r.delta[t] >= 0 ? "good" : "bad"}">${fmt(r.delta[t])}</td><td><strong>${r.teamScores[t]}</strong></td></tr>`;
  const good = r.delta[1] >= r.delta[2];
  const madeUs = r.teamBids[1] === 0 || r.effective[1] >= r.teamBids[1];
  window.DATAnalytics?.roundFinish({ round_number: state.gameNumber, result: madeUs ? "won" : "lost" });
  if (matchDone) window.DATAnalytics?.finishMatch({ result: state.teamScores[1] > state.teamScores[2] ? "won" : "lost" });
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Round ${state.gameNumber}</p>
      <h2 id="dlg-title" class="${good ? "good" : "bad"}">${madeUs ? "Your team made its bid" : "Your team was set"}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Bid</th><th>Won</th><th>Round</th><th>Total</th></tr></thead>
        <tbody>${row(1, "Us")}${row(2, "Them")}</tbody>
      </table>
      ${nilNotes ? `<p class="dlg-note">${nilNotes}</p>` : ""}
      <p class="dlg-note">Make your bid: 10 per trick bid plus 1 per extra trick. Miss it: lose 10 per trick bid. A Nil bidder's tricks never count for the partner.</p>
      <button class="dlg-btn" type="button" data-next autofocus>${matchDone ? "See final result" : "Next round"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    state = E.nextRound(state);
    hintBid = undefined;
    hintCard = null;
    if (state.phase === "MATCH_OVER") return showMatchOver();
    advance();
  });
}

function showMatchOver() {
  const won = state.matchWinnerTeam === 1;
  window.DATAnalytics?.finishMatch({ result: won ? 'won' : 'lost' });
  const mercy = Math.min(state.teamScores[1], state.teamScores[2]) <= E.MERCY;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete${mercy ? " · mercy rule" : ""}</p>
      <h2 id="dlg-title" class="${won ? "good" : "bad"}">${won ? "You won the match! 🏆" : "The opponents won the match"}</h2>
      <p class="dlg-score">Final: <b>Us ${state.teamScores[1]}</b> · <b>Them ${state.teamScores[2]}</b></p>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> Cutthroat, Jokers, Blind Nil, sandbags, stats and themes.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.datgames.spade&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_spades&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <a class="store-btn" href="https://apps.apple.com/app/id6443504649?ct=web_game_match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function newMatch(event) {
  window.DATAnalytics?.startMatch(event);
  run++;
  el.overlay.hidden = true;
  hintCard = null;
  hintBid = undefined;
  shownTrick = null;
  state = E.startGame("WEST");
  advance();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
newMatch();
