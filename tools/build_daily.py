#!/usr/bin/env python3
"""Generate The Daily Trick pages: /daily/ (hub), /daily/<game>/ (today's puzzle) and
/daily/<game>/<n>/ permalinks with per-puzzle titles and social images.

Puzzle data comes from the app's puzzle forge (AndroidGames/puzzle-shared, `web` command),
which writes daily/data/<game>/<n>.json. This script adds daily/data/<game>/meta.json for the
hub and writes the HTML. Social images: tools/render_daily_images.py.

    python3 tools/build_daily.py              # permalinks through today + 30
    python3 tools/build_daily.py --through 60
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAILY = ROOT / "daily"
SITE = "https://www.datgamesstudio.com"
VERSION = "1"

# The order is the hub's order. `data` is the forge's game id; `slug` the URL.
GAMES: list[dict] = [
    {"key": "spades", "data": "spades", "slug": "spades", "title": "Spades", "icon": "spades",
     "play": "/play/spades/", "android": "com.datgames.spade", "apple": "6443504649"},
    {"key": "hearts", "data": "hearts", "slug": "hearts", "title": "Hearts", "icon": "hearts",
     "play": "/play/hearts/", "android": "com.datgames.hearts", "apple": "1620761646"},
    {"key": "callbreak", "data": "callbreak", "slug": "callbreak", "title": "Callbreak", "icon": "callbreak",
     "play": "/play/callbreak/", "android": "com.datgames.CallbreakCardGame", "apple": "1606221936"},
    {"key": "twentynine", "data": "twentynine", "slug": "twenty-nine", "title": "29", "icon": "twentynine",
     "play": "/play/twenty-nine/", "android": "debakesh.com.twentynine", "apple": None},
    {"key": "bridge", "data": "bridge", "slug": "bridge", "title": "Bridge", "icon": "bridge",
     "play": None, "android": "com.datgames.bridge", "apple": "6827570630"},
    {"key": "tarneeb", "data": "tarneeb", "slug": "tarneeb", "title": "Tarneeb", "icon": "tarneeb",
     "play": "/play/tarneeb/", "android": "com.datgames.tarneeb", "apple": "6785555890"},
    {"key": "bray", "data": "bray", "slug": "bray", "title": "Bray", "icon": "bray",
     "play": "/play/bray/", "android": "com.datgames.bray", "apple": "1607650705"},
]
# Euchre is exported too but not listed until its store listing is live.

# Flip when the apps ship daily puzzles, so the result screen can promise them.
PUZZLES_IN_APP = {"android": False, "ios": False}

SUIT = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}
EPOCH_DATE = dt.date(1970, 1, 1)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def sort_hand(cards: list[str], p: dict) -> list[str]:
    base = ["S", "H", "C", "D"]
    start = base.index(p["trump"]) if p.get("trump") else 0
    suits = base[start:] + base[:start]
    return sorted(cards, key=lambda c: (suits.index(c[0]), -p["order"][c]))


def write_meta(g: dict) -> tuple[int, int]:
    d = DAILY / "data" / g["data"]
    index = json.loads((d / "index.json").read_text())
    puzzles = []
    for n in range(1, index["count"] + 1):
        p = json.loads((d / f"{n}.json").read_text())
        puzzles.append({"stars": p["stars"], "goal": p["goal"], "variant": p["variant"],
                        "hand": sort_hand(p["hands"]["S"], p)})
    (d / "meta.json").write_text(json.dumps({"puzzles": puzzles}, ensure_ascii=False, separators=(",", ":")) + "\n")
    return index["epochDay"], index["count"]


SVG = """    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-play" viewBox="0 0 24 24"><path fill="#00D2FF" d="M3.9 1.5 14 12 3.9 22.5c-.5-.3-.9-.9-.9-1.6V3.1c0-.7.4-1.3.9-1.6z"/><path fill="#FFCE00" d="M18.6 8.7 14 12l-3.1-3.1 6.6-3.8c.4.2.8.5 1.1.9z"/><path fill="#00F076" d="M3.9 1.5c.2-.1.5-.2.8-.2.3 0 .7.1 1 .3l9.2 5.3L11.9 10 3.9 1.5z"/><path fill="#FF3A44" d="M3.9 22.5 11.9 14l3 3.1-9.2 5.3c-.3.2-.7.3-1 .3-.3 0-.6-.1-.8-.2z"/></symbol>
      <symbol id="i-apple" viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1-.02 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.02-.01-2.1-.8-2.1-3.1zM14.3 5.8c.6-.7 1-1.7.9-2.7-.8.03-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.5.9.07 1.8-.5 2.5-1.1z"/></symbol>
    </svg>"""

HEADER = """    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header is-solid" data-site-header data-force-solid>
      <a class="brand" href="/" aria-label="DAT Games Studio home">
        <span class="brand-mark" aria-hidden="true">D</span>
        <span><strong>DAT Games</strong><small>Studio</small></span>
      </a>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
        <span></span><span></span><span></span><span class="sr-only">Menu</span>
      </button>
      <nav class="site-nav" id="site-nav" data-site-nav>
        <a href="/daily/" aria-current="page">Daily puzzle</a>
        <a href="/#games">Games</a>
        <a href="/play/">Play online</a>
        <a href="/how-to-play/">How to play</a>
        <a class="nav-cta" href="/#download">Download</a>
      </nav>
    </header>"""

FOOTER = """    <footer class="site-footer">
      <div><strong>DAT Games Studio</strong><span>Free card games &amp; puzzles for Android and iPhone.</span></div>
      <nav aria-label="Footer">
        <a href="/daily/">Daily puzzle</a>
        <a href="/how-to-play/">How to play</a>
        <a href="/privacy-policy/">Privacy Policy</a>
        <a href="https://play.google.com/store/apps/developer?id=DAT+Games" rel="noopener">Google Play</a>
        <a href="https://apps.apple.com/us/developer/debarghya-majumdar/id1606221938" rel="noopener">App Store</a>
      </nav>
    </footer>"""


def head(title: str, description: str, url: str, image: str, wide_image: bool) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-7662884847"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && location.protocol !== 'file:') {{
        gtag('config', 'AW-7662884847');
        gtag('config', 'G-677P55P83T');
      }}
    </script>
    <script defer src="/assets/analytics.js?v=3"></script>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(description)}">
    <link rel="canonical" href="{url}">
    <meta name="theme-color" content="#071c16">
    <meta property="og:site_name" content="DAT Games">
    <meta property="og:title" content="{esc(title.split(' | ')[0])}">
    <meta property="og:description" content="{esc(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{url}">
    <meta property="og:image" content="{image}">
    {'<meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">' if wide_image else ''}
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="/assets/img/icons/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/styles.css?v=7">
    <link rel="stylesheet" href="/daily/daily.css?v={VERSION}">
    <script defer src="/assets/main.js"></script>
  </head>"""


def config(page: dict, epoch: int, count: int) -> str:
    games = {g["key"]: {
        "key": g["key"], "data": g["data"], "slug": g["slug"], "title": g["title"],
        "icon": f"/assets/img/icons/{g['icon']}.png", "play": g["play"],
        "android": g["android"], "apple": g["apple"],
    } for g in GAMES}
    cfg = {"epochDay": epoch, "count": count, "order": [g["key"] for g in GAMES], "games": games,
           "puzzlesInApp": PUZZLES_IN_APP, "page": page}
    return json.dumps(cfg, ensure_ascii=False).replace("</", "<\\/")


def puzzle_page(g: dict, number: int | None, epoch: int, count: int, meta: dict | None) -> str:
    slug = g["slug"]
    if number is None:
        url = f"{SITE}/daily/{slug}/"
        title = f"{g['title']} Puzzle of the Day: The Daily Trick | DAT Games"
        desc = (f"A free {g['title']} puzzle every day. All cards face up, one winning play. "
                "Can you find it? Play in your browser, no signup.")
        image = f"{SITE}/assets/img/screens/{g['icon']}.webp"
        wide = False
    else:
        url = f"{SITE}/daily/{slug}/{number}/"
        goal = meta["goal"] if meta else ""
        date = (EPOCH_DATE + dt.timedelta(days=epoch + number - 1)).strftime("%-d %B %Y")
        title = f"Daily Trick #{number}: {g['title']} puzzle, {goal} | DAT Games"
        desc = f"{g['title']} puzzle for {date}: {goal}. All cards face up, only one card wins. Can you find it?"
        og = DAILY / "og" / f"{slug}-{number}.jpg"
        wide = og.exists()
        image = f"{SITE}/daily/og/{slug}-{number}.jpg" if wide else f"{SITE}/assets/img/screens/{g['icon']}.webp"
    page = {"kind": "puzzle", "game": g["key"], "number": number}
    partner = "Partner" if g["key"] in ("spades", "twentynine", "tarneeb", "bridge") else ""
    crumb_last = f"#{number}" if number else "Today"
    return f"""{head(title, desc, url, image, wide)}
  <body>
{SVG}
{HEADER}

    <main id="main" class="dt-page">
      <div class="dt-wrap">
        <div class="dt-shell">
          <div class="og-brand" aria-hidden="true">
            <p class="dt-eyebrow">The Daily Trick</p>
            <h1><span data-og-number></span> {esc(g['title'])}</h1>
            <p class="q" data-og-goal></p>
            <p class="q">Only one card wins. Can you find it?</p>
            <p class="url">datgamesstudio.com/daily</p>
          </div>
          <nav class="dt-crumbs" aria-label="Breadcrumb"><a href="/daily/">The Daily Trick</a><span>/</span><a href="/daily/{slug}/">{esc(g['title'])}</a><span>/</span><span>{crumb_last}</span></nav>
          <div class="dt-head">
            <div>
              <p class="dt-eyebrow">{esc(g['title'])} puzzle of the day</p>
              <h1 class="dt-title" data-title>The Daily Trick</h1>
            </div>
            <div class="dt-meta">
              <span class="dt-pill"><img src="/assets/img/icons/{g['icon']}.png" alt="" width="20" height="20">{esc(g['title'])}</span>
              <span class="dt-pill" data-variant-pill></span>
              <span class="dt-pill" data-stars-pill></span>
            </div>
          </div>

          <div class="dt-layout">
            <section class="dt-stage" data-stage aria-label="{esc(g['title'])} puzzle">
              <div class="dt-goal">
                <div class="dt-trump" data-trump hidden><b></b><small>TRUMP</small></div>
                <div class="dt-goal-text"><h2 data-goal>Loading today's puzzle…</h2><p data-rules></p></div>
              </div>
              <div class="dt-meter" data-meter aria-live="polite"></div>
              <div class="dt-table" data-table>
                <div class="dt-seat dt-seat-n" data-seat="N"><span class="dt-tag">North{(' <em>' + partner + '</em>') if partner else ''}</span><div class="dt-row" data-cards></div></div>
                <div class="dt-seat dt-seat-w" data-seat="W"><span class="dt-tag">West</span><div class="dt-col" data-cards></div></div>
                <div class="dt-center" data-center aria-live="polite"><div class="dt-status" data-status role="status">Dealing…</div></div>
                <div class="dt-seat dt-seat-e" data-seat="E"><span class="dt-tag">East</span><div class="dt-col" data-cards></div></div>
                <div class="dt-you dt-seat" data-seat="S">
                  <div class="dt-hand" data-hand aria-label="Your hand"></div>
                  <span class="dt-tag">You</span>
                </div>
              </div>
              <div class="dt-tools">
                <button type="button" class="dt-btn" data-retry>↺ Start over</button>
                <button type="button" class="dt-btn" data-hint-btn hidden>💡 Show me the first card</button>
                <a class="dt-btn" href="/how-to-play/{slug}/">{esc(g['title'])} rules</a>
              </div>
            </section>

            <aside class="dt-side">
              <div class="dt-card">
                <h3>How the Daily Trick works</h3>
                <ul>
                  <li>Every card is face up. You play South{' (and dummy in Bridge)' if g['key'] == 'bridge' else ''}.</li>
                  <li>The other players always play their best card.</li>
                  <li>Exactly one first card reaches the goal. The obvious play is a trap.</li>
                  <li>A new puzzle for every game, every day at midnight.</li>
                </ul>
              </div>
              <div class="dt-card" data-side-app data-placement="daily_side"></div>
              <div class="dt-card">
                <h3>Today's other puzzles</h3>
                <ul class="dt-others" data-others data-placement="other_puzzles"></ul>
                <a class="dt-more" href="/daily/">All of today's puzzles →</a>
              </div>
            </aside>
          </div>
        </div>
      </div>
      <div class="dt-overlay" data-overlay hidden></div>
    </main>

{FOOTER}
    <script type="application/json" id="dt-config">{config(page, epoch, count)}</script>
    <script type="module" src="/daily/daily.js?v={VERSION}"></script>
  </body>
</html>
"""


def hub_page(epoch: int, count: int) -> str:
    url = f"{SITE}/daily/"
    title = "The Daily Trick: Card Puzzle of the Day | DAT Games"
    desc = ("A new card puzzle every day for Spades, Hearts, Callbreak, 29, Bridge, Tarneeb and Bray. "
            "All cards face up, one winning play. Free in your browser.")
    tiles = "\n".join(f"""          <a class="dt-tile" href="/daily/{g['slug']}/" data-tile="{g['key']}">
            <div class="fan" aria-hidden="true"></div>
            <div class="dt-tile-top"><img src="/assets/img/icons/{g['icon']}.png" alt="" width="40" height="40"><strong>{esc(g['title'])}</strong><span data-stars></span></div>
            <p data-variant></p>
            <h3 data-goal>Today's {esc(g['title'])} puzzle</h3>
            <div class="dt-tile-foot"><span class="dt-pill" style="min-height:26px;padding:3px 10px">Free · no signup</span><span class="dt-go">Play</span></div>
          </a>""" for g in GAMES)
    return f"""{head(title, desc, url, f"{SITE}/assets/img/screens/spades.webp", False)}
  <body>
{SVG}
{HEADER}

    <main id="main" class="dt-page">
      <div class="dt-wrap">
        <section class="dt-hero">
          <div>
            <p class="dt-eyebrow">Card puzzle of the day</p>
            <h1>The Daily <span>Trick</span></h1>
            <p>Every day, one puzzle for each game. All cards are face up and the other players play their best. Only one card wins. Can you find it?</p>
          </div>
          <div class="dt-today">
            <span class="dt-pill gold">Daily Trick <span data-hub-number></span></span>
            <span class="dt-pill" data-hub-date></span>
            <span class="dt-pill" data-hub-streak hidden></span>
            <span class="dt-pill">New puzzles in <b data-countdown style="margin-left:4px;font-variant-numeric:tabular-nums"></b></span>
          </div>
        </section>
        <div class="dt-grid" data-hub data-placement="hub_tile">
{tiles}
        </div>
        <section class="dt-how" aria-label="How it works">
          <div><b>All cards face up</b><p>You see every hand. No luck, no hidden cards: just the one play that works.</p></div>
          <div><b>Best defence</b><p>The other players always play their strongest card, so a wrong first card always gets punished.</p></div>
          <div><b>Share your result</b><p>Solve it first try for three stars, keep your streak, and challenge friends with a spoiler-free result.</p></div>
        </section>
      </div>
    </main>

{FOOTER}
    <script type="application/json" id="dt-config">{config({"kind": "hub"}, epoch, count)}</script>
    <script type="module" src="/daily/daily.js?v={VERSION}"></script>
  </body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--through", type=int, help="last permalink number (default: today + 30)")
    args = ap.parse_args()
    epoch = count = None
    metas: dict[str, list] = {}
    for g in GAMES:
        e, c = write_meta(g)
        epoch, count = e, c
        metas[g["key"]] = json.loads((DAILY / "data" / g["data"] / "meta.json").read_text())["puzzles"]
    today_number = (dt.date.today() - EPOCH_DATE).days - epoch + 1
    through = args.through or today_number + 30
    (DAILY / "index.html").write_text(hub_page(epoch, count))
    pages = 1
    for g in GAMES:
        base = DAILY / g["slug"]
        base.mkdir(parents=True, exist_ok=True)
        (base / "index.html").write_text(puzzle_page(g, None, epoch, count, None))
        pages += 1
        for n in range(1, through + 1):
            meta = metas[g["key"]][(n - 1) % count]
            d = base / str(n)
            d.mkdir(exist_ok=True)
            (d / "index.html").write_text(puzzle_page(g, n, epoch, count, meta))
            pages += 1
    print(f"Wrote {pages} pages; permalinks #1–#{through} (today is #{today_number})")


if __name__ == "__main__":
    main()
