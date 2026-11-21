#!/usr/bin/env python3
"""Put a prominent "Today's <game> puzzle" entry on the hand-written pages: each web game
(/play/<game>/) and the home page's game cards. Idempotent (marked with
data-daily-teaser). Guides and the /play/ hub get theirs from tools/build_guides.py.

    python3 tools/add_daily_teasers.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAILY = {"spades": "Spades", "hearts": "Hearts", "callbreak": "Callbreak", "twenty-nine": "29",
         "bridge": "Bridge", "tarneeb": "Tarneeb", "bray": "Bray"}
HOME_IDS = {"spades": "spades", "hearts": "hearts", "callbreak": "callbreak", "twenty-nine": "twentynine",
            "bridge": "bridge", "tarneeb": "tarneeb", "bray": "bray"}
SCRIPT = '<script defer src="/assets/daily-teaser.js?v=1"></script>'


def teaser(slug: str, placement: str, indent: str = "") -> str:
    t = DAILY[slug]
    return (f'{indent}<a class="daily-teaser" href="/daily/{slug}/" data-daily-teaser="{slug}" data-placement="{placement}">'
            f'<span class="dtz-fan" aria-hidden="true"></span>'
            f'<span class="dtz-icon" aria-hidden="true">🧩</span>'
            f'<span class="dtz-text"><span class="dtz-eyebrow">The Daily Trick · today</span>'
            f'<span class="dtz-goal">Today\'s {t} puzzle</span>'
            f'<span class="dtz-sub">All cards face up · one card wins <span class="dtz-stars"></span></span></span>'
            f'<span class="dtz-go">Play →</span></a>')


def card_button(slug: str) -> str:
    return (f'<a class="daily-link" href="/daily/{slug}/" data-daily-teaser="{slug}" data-placement="game_card">'
            '<span class="dl-icon" aria-hidden="true">🧩</span><span class="dl-text"><small>Today\'s puzzle</small>'
            '<b data-dtz-goal>Daily Trick</b></span><span class="dl-go" aria-hidden="true">→</span></a>')


def add_script(s: str) -> str:
    if SCRIPT in s:
        return s
    return s.replace('<script defer src="/assets/main.js"></script>',
                     '<script defer src="/assets/main.js"></script>\n    ' + SCRIPT, 1)


def play_page(slug: str) -> None:
    p = ROOT / "play" / slug / "index.html"
    s = p.read_text()
    if "data-daily-teaser" in s:
        return
    # 1. A gold button in the game bar, first of the actions.
    s = s.replace('<div class="game-bar-actions">\n',
                  f'<div class="game-bar-actions">\n            <a class="bar-btn bar-daily" href="/daily/{slug}/" '
                  f'data-placement="game_bar" aria-label="Today\'s {DAILY[slug]} puzzle">🧩<span class="wide-only"> Daily puzzle</span></a>\n', 1)
    # 2. Under the hand (phones and tablets; wide screens show it in the side panel).
    s = re.sub(r'(<p class="legend">.*?</p>\n)', lambda m: m.group(1) + '        <div class="play-daily">\n'
               + teaser(slug, "under_table", "          ") + '\n        </div>\n', s, count=1, flags=re.S)
    # 3. Top of the side panel on wide screens.
    s = re.sub(r'(<aside class="side-promo"[^>]*>\n)', lambda m: m.group(1) + teaser(slug, "side_panel", "          ") + '\n', s, count=1)
    p.write_text(add_script(s))


def home() -> None:
    """A button under each game card's Play button, before the rules link."""
    p = ROOT / "index.html"
    s = p.read_text()
    for slug, gid in HOME_IDS.items():
        start = s.find(f'id="game-{gid}"')
        end = s.find("</article>", start)
        card = s[start:end]
        if "data-daily-teaser" in card or '<a class="rules-link"' not in card:
            continue
        new = card.replace('<a class="rules-link"', card_button(slug) + '\n                <a class="rules-link"', 1)
        s = s[:start] + new + s[end:]
    p.write_text(add_script(s))


def play_hub() -> None:
    p = ROOT / "play" / "index.html"
    s = p.read_text()
    for slug in DAILY:
        marker = f'<a class="phc-rules" href="/how-to-play/{slug}/">'
        i = s.find(marker)
        if i == -1 or f'href="/daily/{slug}/"' in s:
            continue
        j = s.find("</a>", i) + 4
        s = s[:j] + "\n            " + link(slug, "phc-rules phc-daily", "play_hub_card") + s[j:]
    p.write_text(add_script(s))


def main() -> None:
    for slug in DAILY:
        if (ROOT / "play" / slug / "index.html").exists():
            play_page(slug)
    home()
    print("Daily teasers added")


if __name__ == "__main__":
    main()
