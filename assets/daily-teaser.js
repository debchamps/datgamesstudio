// Fills every [data-daily-teaser="<slug>"] link with today's Daily Trick for that game:
// number, stars, goal and whether this browser already solved it. Without JS (or offline)
// the link still reads "Today's <game> puzzle" and opens /daily/<slug>/.
(() => {
  const DATA = { "twenty-nine": "twentynine" };
  const els = document.querySelectorAll("[data-daily-teaser]");
  if (!els.length) return;
  const d = new Date();
  const today = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  let solved = {};
  try { solved = (JSON.parse(localStorage.getItem("dt:v1")) || {}).solved || {}; } catch (_) {}
  const cache = {};
  const load = (data) => (cache[data] ||= Promise.all([
    fetch(`/daily/data/${data}/index.json`).then((r) => r.json()),
    fetch(`/daily/data/${data}/meta.json`).then((r) => r.json()),
  ]));
  const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
  els.forEach(async (el) => {
    const slug = el.dataset.dailyTeaser;
    const data = DATA[slug] || slug;
    try {
      const [index, meta] = await load(data);
      const n = today - index.epochDay + 1;
      const m = meta.puzzles[(((n - 1) % index.count) + index.count) % index.count];
      const rec = solved[`${data}:${n}`];
      const set = (sel, html) => { const t = el.querySelector(sel); if (t) t.innerHTML = html; };
      set(".dtz-eyebrow", `Daily Trick #${n} · today`);
      set(".dtz-goal", m.goal);
      set(".dtz-stars", `${"★".repeat(m.stars)}<i>${"★".repeat(3 - m.stars)}</i>`);
      set("[data-dtz-goal]", m.goal);
      if (rec) {
        el.classList.add("is-done");
        set(".dtz-go", `Solved ${"★".repeat(rec.stars)}`);
      }
      const fan = el.querySelector(".dtz-fan");
      if (fan) {
        fan.innerHTML = m.hand.slice(0, 5).map((c, i) =>
          `<span style="--r:${(i - 2) * 6}deg;color:${"HD".includes(c[0]) ? "#c62828" : "#111"}">${c[1] === "T" ? "10" : c[1]}${SUIT[c[0]]}</span>`).join("");
      }
    } catch (_) { /* keep the static text */ }
  });
})();
