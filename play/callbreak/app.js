import * as E from "./engine.js";

const NAMES = { SOUTH: "You", EAST: "Emma", NORTH: "Arthur", WEST: "William" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { bid: 5, play: 5, trickHold: 5 } : { bid: 650, play: 750, trickHold: 1100 };

const $ = (sel) => document.querySelector(sel);
const el = {
  deal: $("[data-deal]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  bid: $("[data-bid]"),
  bidButtons: $("[data-bid-buttons]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.SEATS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let run = 0; // bumps on "new match" so stale timers stop
let hintCard = null;
let hintBid = null;
let shownTrick = null; // { plays, winner } while a finished trick is on display
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);

function cardEl(card, extra = "") {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}${FACE.has(card.rank) ? " face" : ""} ${extra}`.trim();
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${{ S: "spades", H: "hearts", C: "clubs", D: "diamonds" }[card.suit]}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip" data-rank="${card.rank}">${GLYPH[card.suit]}</span><span class="pc-corner pc-br">${card.rank}<i>${GLYPH[card.suit]}</i></span>`;
  return d;
}

function render() {
  if (!state) return;
  el.deal.textContent = `Deal ${Math.min(state.gameNumber, state.totalGames)} of ${state.totalGames}`;

  for (const s of E.SEATS) {
    const seat = el.seats[s];
    const bid = state.bids[s];
    const won = state.tricksWon[s];
    seat.querySelector("[data-name]").textContent = NAMES[s];
    seat.querySelector("[data-score]").textContent = state.matchScores[s].toFixed(1);
    seat.querySelector("[data-call]").textContent = bid ? `${won}/${bid}` : "–";
    seat.classList.toggle("is-turn", state.turn === s && (state.phase === "BIDDING" || state.phase === "PLAYING") && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
  }

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

  // Trick in the middle
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
  if (bidding && !el.bidButtons.children.length) {
    for (let n = E.MIN_BID; n <= E.MAX_BID; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bid-btn";
      b.textContent = n;
      b.dataset.bid = n;
      b.addEventListener("click", () => onBid(n));
      el.bidButtons.appendChild(b);
    }
  }
  if (!bidding) el.bidButtons.replaceChildren();
  el.bidButtons.querySelectorAll(".bid-btn").forEach((b) => b.classList.toggle("is-hint", hintBid === Number(b.dataset.bid)));

  el.hint.disabled = !(bidding || legal.length);
}

function setStatus(text) {
  el.status.textContent = text;
}

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "BIDDING") {
      if (state.turn === "SOUTH") {
        setStatus("How many tricks will you win? Pick your call.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is calling…`);
      await sleep(SPEED.bid);
      if (token !== run) return;
      state = E.applyBid(state, state.turn, E.chooseBid(state, state.turn));
    } else if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        const lead = state.currentTrick.length === 0;
        setStatus(lead ? "Your lead. Play any card." : "Your turn. Glowing cards are legal plays.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is thinking…`);
      await sleep(SPEED.play);
      if (token !== run) return;
      await playCard(state.turn, E.chooseCard(state, state.turn), token);
      if (token !== run) return;
    } else if (state.phase === "ROUND_OVER") {
      showRoundOver();
      return;
    } else {
      showMatchOver();
      return;
    }
  }
}

async function playCard(seat, card, token) {
  const before = state.completedTricks.length;
  state = E.play(state, seat, card);
  if (seat === "SOUTH") window.DATAnalytics?.cardPlayed();
  hintCard = null;
  if (state.completedTricks.length > before) {
    const plays = state.lastCompletedTrick;
    const lead = plays[0].card.suit;
    const winner = plays.reduce((b, p) => (rank(p.card, lead) > rank(b.card, lead) ? p : b)).player;
    shownTrick = { plays, winner };
    render();
    setStatus(`${NAMES[winner]} takes the trick.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function rank(card, lead) {
  const o = E.RANKS.indexOf(card.rank) + 1;
  return card.suit === "S" ? 100 + o : card.suit === lead ? 50 + o : o;
}

function onBid(n) {
  if (state.phase !== "BIDDING" || state.turn !== "SOUTH") return;
  hintBid = null;
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

function scoreTable(result, withDeal) {
  const rows = E.SEATS.map((s) => {
    const made = result.tricksWon[s] >= result.bids[s];
    const d = result.roundScores[s];
    return `<tr class="${s === "SOUTH" ? "me" : ""}"><th>${NAMES[s]}</th><td>${result.bids[s]}</td><td>${result.tricksWon[s]}</td><td class="${made ? "good" : "bad"}">${d > 0 ? "+" : ""}${d.toFixed(1)}</td><td><strong>${result.matchScores[s].toFixed(1)}</strong></td></tr>`;
  }).join("");
  return `<table class="score-table"><thead><tr><th></th><th>Call</th><th>Won</th><th>Deal</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function showRoundOver() {
  const r = state.roundResult;
  const last = state.gameNumber >= state.totalGames;
  window.DATAnalytics?.roundFinish({ round_number: state.gameNumber, result: r.roundScores.SOUTH >= r.bids.SOUTH ? "won" : "lost" });
  if (last) {
    const winner = E.SEATS.reduce((best, seat) => state.matchScores[seat] > state.matchScores[best] ? seat : best);
    window.DATAnalytics?.finishMatch({ result: winner === "SOUTH" ? "won" : "lost" });
  }
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Deal ${state.gameNumber} of ${state.totalGames}</p>
      <h2 id="dlg-title">${r.roundScores.SOUTH >= r.bids.SOUTH ? "You made your call" : "Call missed"}</h2>
      ${scoreTable(r)}
      <button class="dlg-btn" type="button" data-next autofocus>${last ? "See final result" : "Next deal"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    state = E.nextRound(state);
    hintBid = hintCard = null;
    advance();
  });
}

function showMatchOver() {
  render();
  const ranked = E.SEATS.slice().sort((a, b) => state.matchScores[b] - state.matchScores[a]);
  const youWon = state.matchWinner === "SOUTH";
  window.DATAnalytics?.finishMatch({ result: youWon ? 'won' : 'lost' });
  const place = ranked.indexOf("SOUTH") + 1;
  const list = ranked
    .map((s, i) => `<li class="${s === "SOUTH" ? "me" : ""}"><span>${i + 1}</span><strong>${NAMES[s]}</strong><em>${state.matchScores[s].toFixed(1)}</em></li>`)
    .join("");
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete</p>
      <h2 id="dlg-title">${youWon ? "You won the match! 🏆" : `You finished ${place}${["st", "nd", "rd", "th"][Math.min(place, 4) - 1]}`}</h2>
      <ol class="final-list">${list}</ol>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> Offline play, achievements, themes and stats.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.datgames.CallbreakCardGame&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_callbreak&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <a class="store-btn" href="https://apps.apple.com/app/id1606221936?ct=web_game_match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function newMatch(event) {
  window.DATAnalytics?.startMatch(event);
  run++;
  el.overlay.hidden = true;
  el.bidButtons.replaceChildren();
  hintBid = hintCard = shownTrick = null;
  state = E.startGame(E.SEATS[Math.floor(Math.random() * 4)]);
  advance();
}

document.querySelector("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
newMatch();
