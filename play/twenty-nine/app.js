import * as E from "./engine.js";

const NAMES = { SOUTH: "You", EAST: "Emma", NORTH: "Arthur", WEST: "William" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { bid: 5, play: 5, trickHold: 5 } : { bid: 750, play: 750, trickHold: 1100 };
const ctxNow = () => ({ ourSetScore: match.us, theirSetScore: match.them, positiveScoring: false });
const STEP_LABEL = { DOUBLE: "Double", REDOUBLE: "Redouble", SINGLE_HAND: "Single Hand" };

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
  challenge: $("[data-challenge]"),
  challengeInfo: $("[data-challenge-info]"),
  challengeButtons: $("[data-challenge-buttons]"),
  trumpButtons: $("[data-trump-buttons]"),
  trumpChip: $("[data-trump-chip]"),
  contract: $("[data-contract]"),
  reveal: $("[data-reveal]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.SEATS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let match = { us: 0, them: 0, dealer: "WEST", round: 1 };
let run = 0;
let hintCard = null;
let hintBid = undefined; // number = bid this, null = pass, undefined = none
let hintTrump = null;
let hintReveal = false;
let hintChallenge = undefined; // true = call it, false = decline, undefined = none
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
let bubbles = {}; // seat -> short text shown on the chip during bidding
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);

function cardEl(card) {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}${FACE.has(card.rank) ? " face" : ""}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${SUIT_NAME[card.suit].toLowerCase()}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip" data-rank="${card.rank}">${GLYPH[card.suit]}</span><span class="pc-corner pc-br">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pts">${E.pts(card) ? E.pts(card) : ""}</span>`;
  return d;
}

function render() {
  if (!state) return;
  el.score.innerHTML = `<span class="sc-us">Us <b>${fmt(match.us)}</b></span><span class="sc-them">Them <b>${fmt(match.them)}</b></span>`;
  el.round.textContent = `Round ${match.round}`;

  const bidderSeat = state.phase === "BIDDING" ? null : state.bidding.highestBidder || E.SEATS.find((s) => s === state.trumpSetter);
  for (const s of E.SEATS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    const pts = state.pointsWon[s];
    const tricks = state.tricksWon[s];
    const call = bubbles[s] ? bubbles[s] : E.sitOutSeat(state) === s ? "Sitting out" : state.phase === "PLAYING" || state.phase === "ROUND_OVER" ? `${tricks} tricks · ${pts} pts` : "";
    seat.querySelector("[data-call]").textContent = call || "–";
    seat.classList.toggle("is-turn", state.turn === s && state.phase !== "ROUND_OVER" && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
    seat.classList.toggle("is-bidder", !!bidderSeat && state.phase !== "BIDDING" && state.trumpSetter === s);
    seat.classList.toggle("is-sitout", E.sitOutSeat(state) === s);
  }

  // Contract + trump chips
  const inPlay = state.phase === "PLAYING" || state.phase === "ROUND_OVER";
  el.contract.hidden = !inPlay;
  if (inPlay) {
    const target = E.winningBid(state.bidding);
    const stake = state.multiplier === 4 ? " · Redoubled ×4" : state.multiplier === 2 ? " · Doubled ×2" : "";
    el.contract.textContent = state.isSingleHand
      ? `${NAMES[state.singleHandPlayer]}: Single Hand · all 8 tricks${stake}`
      : `${NAMES[state.trumpSetter]} bid ${target}${stake}`;
  }
  el.trumpChip.hidden = !inPlay;
  if (inPlay) {
    const revealed = E.isTrumpRevealed(state) || (state.phase === "ROUND_OVER" && !state.isSingleHand);
    if (state.isSingleHand) {
      el.trumpChip.className = "chip-trump hidden-trump";
      el.trumpChip.innerHTML = `No trump <b>–</b> single hand`;
    } else if (revealed) {
      el.trumpChip.className = "chip-trump " + (state.trump === "H" || state.trump === "D" ? "red" : "");
      el.trumpChip.innerHTML = `Trump <b>${GLYPH[state.trump]}</b> ${SUIT_NAME[state.trump]}`;
    } else if (state.trumpSetter === "SOUTH") {
      el.trumpChip.className = "chip-trump mine " + (state.trump === "H" || state.trump === "D" ? "red" : "");
      el.trumpChip.innerHTML = `Your trump <b>${GLYPH[state.trump]}</b> hidden`;
    } else {
      el.trumpChip.className = "chip-trump hidden-trump";
      el.trumpChip.innerHTML = `Trump <b>?</b> hidden`;
    }
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
    const b = state.bidding;
    el.bidInfo.textContent = b.highestBidder
      ? `Current bid: ${b.highest} by ${NAMES[b.highestBidder]}`
      : "No bid yet. The minimum bid is 16.";
    const pass = document.createElement("button");
    pass.type = "button";
    pass.className = "bid-btn bid-pass" + (hintBid === null ? " is-hint" : "");
    pass.textContent = "Pass";
    pass.addEventListener("click", () => onBid(null));
    el.bidButtons.appendChild(pass);
    for (let n = E.minimumLegalBid(state, "SOUTH"); n <= E.MAX_BID; n++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bid-btn" + (hintBid === n ? " is-hint" : "");
      btn.textContent = n;
      btn.addEventListener("click", () => onBid(n));
      el.bidButtons.appendChild(btn);
    }
  }

  // Trump selection panel
  const choosing = state.phase === "TRUMP_SELECTION" && state.turn === "SOUTH";
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

  // Double / Redouble / Single Hand panel
  const asking = state.phase === "CHALLENGE" && E.challengeDecider(state) === "SOUTH";
  el.challenge.hidden = !asking;
  el.challengeButtons.replaceChildren();
  if (asking) {
    const step = state.challenge.step;
    const stakeNote = { DOUBLE: "Double: stakes ×2 for both sides.", REDOUBLE: `${NAMES[state.doubler]} doubled. Redouble for ×4?`, SINGLE_HAND: "Single Hand: win all 8 tricks alone for +3 (−3 if you lose one). Your partner sits out." }[step];
    el.challengeInfo.textContent = step === "DOUBLE" ? `${NAMES[state.trumpSetter]} bid ${E.winningBid(state.bidding)}. ${stakeNote}` : stakeNote;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "bid-btn bid-yes" + (hintChallenge === true ? " is-hint" : "");
    yes.textContent = STEP_LABEL[step] + (step === "DOUBLE" ? " ×2" : step === "REDOUBLE" ? " ×4" : "");
    yes.addEventListener("click", () => onChallenge(true));
    const no = document.createElement("button");
    no.type = "button";
    no.className = "bid-btn bid-pass" + (hintChallenge === false ? " is-hint" : "");
    no.textContent = step === "SINGLE_HAND" ? "No, play normally" : "Pass";
    no.addEventListener("click", () => onChallenge(false));
    el.challengeButtons.append(yes, no);
  }

  // Show-trump button (only when you are void in the suit led)
  const canReveal = state.phase === "PLAYING" && state.turn === "SOUTH" && !shownTrick && E.canRevealTrump(state, "SOUTH");
  el.reveal.hidden = !canReveal;
  el.reveal.classList.toggle("is-hint", canReveal && hintReveal);

  el.hint.disabled = !(bidding || choosing || asking || legal.length || canReveal);
}

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
const setStatus = (t) => (el.status.textContent = t);

// ── Game flow ───────────────────────────────────────────────────────────────

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "BIDDING") {
      if (state.turn === "SOUTH") {
        setStatus(state.bidding.highestBidder ? "Your turn to bid. Raise or pass." : "Your turn. Bid at least 16, or pass.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is bidding…`);
      await sleep(SPEED.bid);
      if (token !== run) return;
      const seat = state.turn;
      const bid = E.chooseBid(state, seat);
      if (bid === null) {
        state = E.applyPass(state, seat);
        bubbles[seat] = "Pass";
      } else {
        state = E.applyBid(state, seat, bid);
        bubbles[seat] = `Bid ${bid}`;
      }
    } else if (state.phase === "TRUMP_SELECTION") {
      bubbles = {};
      if (state.turn === "SOUTH") {
        setStatus("You won the bid. Choose the trump suit. It stays hidden.");
        return;
      }
      setStatus(`${NAMES[state.turn]} won the bid at ${E.winningBid(state.bidding)} and is choosing trump…`);
      await sleep(SPEED.bid * 1.2);
      if (token !== run) return;
      state = E.selectTrump(state, E.chooseTrump(state, state.turn));
    } else if (state.phase === "CHALLENGE") {
      const seat = E.challengeDecider(state);
      const step = state.challenge.step;
      if (seat === "SOUTH") {
        setStatus(step === "SINGLE_HAND" ? "Do you want to play a Single Hand?" : step === "DOUBLE" ? "Do you want to Double?" : "Do you want to Redouble?");
        return;
      }
      setStatus(step === "SINGLE_HAND" ? `${NAMES[seat]} is considering a Single Hand…` : `${NAMES[seat]} is considering a ${STEP_LABEL[step]}…`);
      await sleep(step === "SINGLE_HAND" ? SPEED.bid * 0.45 : SPEED.bid);
      if (token !== run) return;
      const call = E.chooseChallenge(state, seat, ctxNow());
      state = E.challengeAnswer(state, call);
      if (call) {
        bubbles[seat] = step === "SINGLE_HAND" ? "Single Hand!" : `${STEP_LABEL[step]}!`;
        render();
        setStatus(step === "DOUBLE" ? `${NAMES[seat]} doubles! Stakes are ×2.` : step === "REDOUBLE" ? `${NAMES[seat]} redoubles! Stakes are ×4.` : `${NAMES[seat]} plays a Single Hand: all 8 tricks alone.`);
        await sleep(SPEED.bid * 1.3);
        if (token !== run) return;
      }
      if (state.phase === "PLAYING") {
        bubbles = {};
        if (state.isSingleHand) {
          setStatus(`${NAMES[state.singleHandPlayer]} plays a Single Hand: all 8 tricks alone. ${NAMES[E.opposite(state.singleHandPlayer)]} sits out.`);
          render();
          await sleep(SPEED.bid * 1.3);
          if (token !== run) return;
        }
      }
    } else if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        const lead = state.currentTrick.length === 0;
        const reveal = E.canRevealTrump(state, "SOUTH");
        setStatus(
          lead
            ? "Your lead. Play any card."
            : reveal
              ? "You can't follow suit. Show the trump to cut, or throw a card."
              : "Your turn. Glowing cards are legal plays.",
        );
        return;
      }
      setStatus(`${NAMES[state.turn]} is thinking…`);
      await sleep(SPEED.play);
      if (token !== run) return;
      const seat = state.turn;
      if (E.canRevealTrump(state, seat) && E.shouldRevealTrump(state, seat)) {
        state = E.revealTrump(state, seat);
        render();
        setStatus(`${NAMES[seat]} asks to see trump: ${SUIT_NAME[state.trump]}!`);
        await sleep(SPEED.play + 300);
        if (token !== run) return;
      }
      await playCard(seat, E.chooseCard(state, seat), token);
      if (token !== run) return;
    } else {
      showRoundOver();
      return;
    }
  }
}

async function playCard(seat, card, token) {
  const before = state.completedTricks.length;
  const hadPair = state.pairDeclaredBy;
  state = E.play(state, seat, card);
  hintCard = null;
  hintReveal = false;
  if (!hadPair && state.pairDeclaredBy) setStatus(`${NAMES[state.pairDeclaredBy]} declared the K+Q pair of trump!`);
  if (state.completedTricks.length > before) {
    const last = state.completedTricks[state.completedTricks.length - 1];
    shownTrick = { plays: last.plays, winner: last.winner };
    render();
    const trickPts = last.plays.reduce((n, p) => n + E.pts(p.card), 0);
    setStatus(`${NAMES[last.winner]} takes the trick${trickPts ? ` (${trickPts} point${trickPts > 1 ? "s" : ""})` : ""}.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function onBid(value) {
  if (state.phase !== "BIDDING" || state.turn !== "SOUTH") return;
  hintBid = undefined;
  if (value === null) {
    state = E.applyPass(state, "SOUTH");
    bubbles.SOUTH = "Pass";
  } else {
    state = E.applyBid(state, "SOUTH", value);
    bubbles.SOUTH = `Bid ${value}`;
  }
  advance();
}

function onTrump(suit) {
  if (state.phase !== "TRUMP_SELECTION" || state.turn !== "SOUTH") return;
  hintTrump = null;
  state = E.selectTrump(state, suit);
  advance();
}

function onChallenge(call) {
  if (state.phase !== "CHALLENGE" || E.challengeDecider(state) !== "SOUTH") return;
  const step = state.challenge.step;
  hintChallenge = undefined;
  state = E.challengeAnswer(state, call);
  if (call) bubbles.SOUTH = step === "SINGLE_HAND" ? "Single Hand!" : `${STEP_LABEL[step]}!`;
  if (state.phase === "PLAYING") bubbles = {};
  advance();
}

async function onPlay(card) {
  if (!(state.phase === "PLAYING" && state.turn === "SOUTH") || shownTrick) return;
  if (!E.isLegal(state, "SOUTH", card)) return;
  const token = run;
  await playCard("SOUTH", card, token);
  if (token === run) advance();
}

function onReveal() {
  if (!E.canRevealTrump(state, "SOUTH")) return;
  state = E.revealTrump(state, "SOUTH");
  hintReveal = false;
  const mustCut = E.legalMoves(state, "SOUTH").every((c) => c.suit === state.trump);
  render();
  setStatus(`Trump is ${SUIT_NAME[state.trump]}. ${mustCut ? "You must play a trump." : "You hold no trump, so play any card."}`);
}

function onHint() {
  if (state.phase === "BIDDING" && state.turn === "SOUTH") hintBid = E.chooseBid(state, "SOUTH");
  else if (state.phase === "TRUMP_SELECTION" && state.turn === "SOUTH") hintTrump = E.chooseTrump(state, "SOUTH");
  else if (state.phase === "CHALLENGE" && E.challengeDecider(state) === "SOUTH") hintChallenge = E.chooseChallenge(state, "SOUTH", ctxNow(), () => 1);
  else if (state.phase === "PLAYING" && state.turn === "SOUTH") {
    if (E.canRevealTrump(state, "SOUTH") && E.shouldRevealTrump(state, "SOUTH")) hintReveal = true;
    else hintCard = E.chooseCard(state, "SOUTH");
  }
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function showRoundOver() {
  const r = state.roundResult;
  match.us += r.ourDelta;
  match.them += r.theirDelta;
  match.us = Math.max(-E.MATCH_SCORE, Math.min(E.MATCH_SCORE, match.us));
  match.them = Math.max(-E.MATCH_SCORE, Math.min(E.MATCH_SCORE, match.them));
  render();

  const decided = match.us >= E.MATCH_SCORE || match.them >= E.MATCH_SCORE || match.us <= -E.MATCH_SCORE || match.them <= -E.MATCH_SCORE;
  const bidderName = r.bidderUs ? "Your team" : "Opponents";
  const bidderPts = r.bidderUs ? r.ourPoints : r.theirPoints;
  const pairNote = r.pairDeclaredBy
    ? `<p class="dlg-note">${NAMES[r.pairDeclaredBy]} declared the K+Q pair, so the target moved to <b>${r.effectiveTarget}</b>.</p>`
    : "";
  const title = r.isSingleHand
    ? r.bidderUs
      ? r.succeeded ? "Single Hand made!" : "Single Hand lost"
      : r.succeeded ? "Opponents made a Single Hand" : "You stopped the Single Hand!"
    : r.bidderUs
      ? r.succeeded ? "You made the bid!" : "Bid missed"
      : r.succeeded ? "Opponents made their bid" : "You set them!";
  const good = r.bidderUs === r.succeeded;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Round ${match.round} · ${r.isSingleHand ? "Single Hand" : `Trump ${GLYPH[r.trump]} ${SUIT_NAME[r.trump]}`}${r.multiplier > 1 ? ` · ${r.multiplier === 4 ? "Redoubled ×4" : "Doubled ×2"}` : ""}</p>
      <h2 id="dlg-title" class="${good ? "good" : "bad"}">${title}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Card points</th><th>Tricks</th></tr></thead>
        <tbody>
          <tr class="me"><th>Us</th><td><strong>${r.ourPoints}</strong></td><td>${r.ourTricks}</td></tr>
          <tr><th>Them</th><td><strong>${r.theirPoints}</strong></td><td>${r.theirTricks}</td></tr>
        </tbody>
      </table>
      <p class="dlg-note">${
        r.isSingleHand
          ? `${NAMES[r.bidder]} needed all 8 tricks. ${r.succeeded ? "Swept them: +3." : "Lost a trick: −3."}`
          : `${bidderName} bid <b>${r.bidTarget}</b> and took <b>${bidderPts}</b>. ${r.succeeded ? "Bid made" : "Bid missed"}: ${fmt(r.bidderUs ? r.ourDelta : r.theirDelta)}${r.multiplier > 1 ? ` (×${r.multiplier})` : ""}.`
      }</p>
      ${pairNote}
      <p class="dlg-score">Match: <b>Us ${fmt(match.us)}</b> · <b>Them ${fmt(match.them)}</b> <small>(first to +${E.MATCH_SCORE} wins)</small></p>
      <button class="dlg-btn" type="button" data-next autofocus>${decided ? "See final result" : "Next round"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (decided) return showMatchOver();
    match.round += 1;
    match.dealer = E.nextSeat(match.dealer);
    startRound();
  });
}

function showMatchOver() {
  const won = match.us >= E.MATCH_SCORE || match.them <= -E.MATCH_SCORE;
  window.datTrack && datTrack('match_finish', { result: won ? 'won' : 'lost' });
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete</p>
      <h2 id="dlg-title" class="${won ? "good" : "bad"}">${won ? "You won the match! 🏆" : "The opponents won the match"}</h2>
      <p class="dlg-score">Final: <b>Us ${fmt(match.us)}</b> · <b>Them ${fmt(match.them)}</b></p>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> Double/Redouble, Single Hand, 7th-card trump, house rules, stats and a stronger computer.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=debakesh.com.twentynine&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_29&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <span class="store-btn is-soon"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>iPhone</small>Coming soon</span></span>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function resetHints() {
  hintCard = hintTrump = null;
  hintBid = undefined;
  hintReveal = false;
  hintChallenge = undefined;
}

function startRound() {
  run++;
  bubbles = {};
  shownTrick = null;
  resetHints();
  state = E.startRound(match.dealer);
  advance();
}

function newMatch() {
  window.datTrack && datTrack('game_start');
  match = { us: 0, them: 0, dealer: "WEST", round: 1 };
  el.overlay.hidden = true;
  startRound();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
el.reveal.addEventListener("click", onReveal);
newMatch();
