import * as E from "./engine.js";

const NAMES = { SOUTH: "You", EAST: "Emma", NORTH: "Arthur", WEST: "William" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { bid: 5, play: 5, trickHold: 5 } : { bid: 750, play: 700, trickHold: 1100 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  bid: $("[data-bid]"),
  bidInfo: $("[data-bid-info]"),
  bidButtons: $("[data-bid-buttons]"),
  trumpPanel: $("[data-trump-panel]"),
  trumpButtons: $("[data-trump-buttons]"),
  trumpChip: $("[data-trump-chip]"),
  contract: $("[data-contract]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.SEATS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let match = { dealer: "WEST" };
let run = 0;
let hintCard = null;
let hintBid = undefined; // number = bid this, null = pass, undefined = none
let hintTrump = null;
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
let notice = ""; // one-off banner, e.g. after an all-pass redeal
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

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
  el.round.textContent = `Round ${state.gameNumber}`;

  const playing = state.phase === "PLAYING" || state.phase === "ROUND_OVER" || state.phase === "MATCH_OVER";
  for (const s of E.SEATS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    const bubble = state.bidLog[s];
    seat.querySelector("[data-call]").textContent = playing
      ? `${state.tricksWon[s]} trick${state.tricksWon[s] === 1 ? "" : "s"}`
      : bubble !== undefined ? (bubble === "Pass" ? "Pass" : `Bid ${bubble}`) : "–";
    seat.classList.toggle("is-turn", state.turn === s && state.phase !== "ROUND_OVER" && state.phase !== "MATCH_OVER" && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
    seat.classList.toggle("is-bidder", playing && state.bidder === s);
  }

  el.contract.hidden = !playing;
  el.trumpChip.hidden = !playing;
  if (playing) {
    const myTeam = E.teamOf(state.bidder) === 1;
    const need = state.contractBid;
    const got = [...E.SEATS].filter((s) => E.teamOf(s) === E.teamOf(state.bidder)).reduce((n, s) => n + state.tricksWon[s], 0);
    el.contract.innerHTML = `${NAMES[state.bidder]} bid <b>${need}</b> · ${myTeam ? "we" : "they"} have <b>${got}</b>`;
    el.trumpChip.className = "chip-trump " + (state.trump === "H" || state.trump === "D" ? "red" : "");
    el.trumpChip.innerHTML = `Trump <b>${GLYPH[state.trump]}</b> ${SUIT_NAME[state.trump]}`;
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
    el.bidInfo.textContent = state.highBidder
      ? `Current bid: ${state.highBid} by ${NAMES[state.highBidder]}`
      : "No bid yet. Bid how many tricks your team will take (7 to 13).";
    const pass = document.createElement("button");
    pass.type = "button";
    pass.className = "bid-btn bid-pass" + (hintBid === null ? " is-hint" : "");
    pass.textContent = "Pass";
    pass.addEventListener("click", () => onBid(null));
    el.bidButtons.appendChild(pass);
    for (let n = E.minAllowedBid(state); n <= E.MAX_BID; n++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bid-btn" + (hintBid === n ? " is-hint" : "");
      btn.textContent = n;
      btn.addEventListener("click", () => onBid(n));
      el.bidButtons.appendChild(btn);
    }
  }

  // Trump panel
  const choosing = state.phase === "TRUMP_SELECT" && state.turn === "SOUTH";
  el.trumpPanel.hidden = !choosing;
  el.trumpButtons.replaceChildren();
  if (choosing) {
    for (const suit of E.SUITS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suit-btn " + (suit === "H" || suit === "D" ? "red" : "") + (hintTrump === suit ? " is-hint" : "");
      btn.innerHTML = `<b>${GLYPH[suit]}</b><span>${SUIT_NAME[suit]}</span>`;
      btn.addEventListener("click", () => onTrump(suit));
      el.trumpButtons.appendChild(btn);
    }
  }

  el.hint.disabled = !(bidding || choosing || legal.length);
}

const setStatus = (t) => (el.status.textContent = t);

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "BIDDING") {
      if (state.turn === "SOUTH") {
        setStatus(notice || (state.highBidder ? "Your turn. Raise the bid or pass." : "Your turn. Bid your team's tricks, or pass."));
        return;
      }
      setStatus(notice || `${NAMES[state.turn]} is bidding…`);
      await sleep(SPEED.bid);
      if (token !== run) return;
      notice = "";
      const seat = state.turn;
      const prevRedeals = state.redeals;
      state = E.applyBid(state, seat, E.chooseBid(state, seat));
      if (state.redeals > prevRedeals) notice = "Everyone passed. New deal.";
    } else if (state.phase === "TRUMP_SELECT") {
      notice = "";
      if (state.turn === "SOUTH") {
        setStatus(`You won the bid at ${state.contractBid}. Choose the trump suit.`);
        return;
      }
      setStatus(`${NAMES[state.turn]} won the bid at ${state.contractBid} and is choosing trump…`);
      await sleep(SPEED.bid * 1.2);
      if (token !== run) return;
      state = E.selectTrump(state, state.turn, E.chooseTrump(state, state.turn));
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
    const plays = state.lastCompletedTrick;
    shownTrick = { plays, winner: state.lastTrickWinner };
    render();
    setStatus(`${NAMES[state.lastTrickWinner]} takes the trick.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function onBid(value) {
  if (state.phase !== "BIDDING" || state.turn !== "SOUTH") return;
  hintBid = undefined;
  notice = "";
  const prevRedeals = state.redeals;
  state = E.applyBid(state, "SOUTH", value);
  if (state.redeals > prevRedeals) notice = "Everyone passed. New deal.";
  advance();
}

function onTrump(suit) {
  if (state.phase !== "TRUMP_SELECT" || state.turn !== "SOUTH") return;
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
  if (state.phase === "BIDDING" && state.turn === "SOUTH") hintBid = E.chooseBid(state, "SOUTH");
  else if (state.phase === "TRUMP_SELECT" && state.turn === "SOUTH") hintTrump = E.chooseTrump(state, "SOUTH");
  else if (state.phase === "PLAYING" && state.turn === "SOUTH") hintCard = E.chooseCard(state, "SOUTH");
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function showRoundOver() {
  const r = state.roundResult;
  const matchDone = state.phase === "MATCH_OVER";
  const weBid = r.contractTeam === 1;
  const title = weBid ? (r.made ? "You made the bid!" : "Bid missed") : r.made ? "Opponents made their bid" : "You set them!";
  const good = weBid === r.made;
  const bidderTricks = r.teamTricks[r.contractTeam];
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Round ${state.gameNumber} · Trump ${GLYPH[r.trump]} ${SUIT_NAME[r.trump]}</p>
      <h2 id="dlg-title" class="${good ? "good" : "bad"}">${title}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Tricks</th><th>This round</th><th>Total</th></tr></thead>
        <tbody>
          <tr class="me"><th>Us</th><td>${r.teamTricks[1]}</td><td class="${r.delta[1] >= 0 ? "good" : "bad"}">${fmt(r.delta[1])}</td><td><strong>${r.teamScores[1]}</strong></td></tr>
          <tr><th>Them</th><td>${r.teamTricks[2]}</td><td class="${r.delta[2] >= 0 ? "good" : "bad"}">${fmt(r.delta[2])}</td><td><strong>${r.teamScores[2]}</strong></td></tr>
        </tbody>
      </table>
      <p class="dlg-note">${weBid ? "Your team" : "Opponents"} bid <b>${r.contractBid}</b> and took <b>${bidderTricks}</b>. ${r.made ? "Made: they score every trick they took." : `Missed: they lose ${r.contractBid} and the defenders score their tricks.`}</p>
      <button class="dlg-btn" type="button" data-next autofocus>${matchDone ? "See final result" : "Next round"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (matchDone) return showMatchOver();
    match.dealer = E.nextSeat(state.dealer);
    state = E.nextRound(state);
    resetHints();
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
        <p><strong>Like it? Get the full game.</strong> Egyptian and Syrian 41 variants, English and Arabic, stats and themes.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.datgames.tarneeb&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_tarneeb&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <a class="store-btn" href="https://apps.apple.com/app/id6785555890?ct=web_game_match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function resetHints() {
  hintCard = hintTrump = null;
  hintBid = undefined;
  shownTrick = null;
}

function newMatch() {
  window.datTrack && datTrack('game_start');
  run++;
  notice = "";
  el.overlay.hidden = true;
  resetHints();
  state = E.startGame("WEST");
  advance();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
newMatch();
