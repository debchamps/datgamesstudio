#!/usr/bin/env python3
"""Make a week of Instagram and Facebook posts for The Daily Trick, one lane per platform:
Facebook (the Page's South Asian and Arabic followers) gets 29, Callbreak, Bray and Tarneeb;
Instagram (a clean slate, aimed at US/UK players) gets Spades, Hearts and Bridge. One post a
day on each. Feed (1080×1350) and, for Instagram, Story (1080×1920) images, captions, Story
quiz options, next-day answers and posting times.

    python3 tools/make_social_week.py                 # today .. today + 7, both platforms
    python3 tools/make_social_week.py --start 13 --days 7 --platform instagram

Output: social/daily/week-<first date>/{facebook,instagram}/ (git-ignored): images and
captions.md. Puzzle pages, permalinks and data must exist (tools/build_daily.py and the
forge's `web` command).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import build_daily as b
import render_daily_images as r

ROOT = b.ROOT
SITE = b.SITE
# Monday = 0. Weights follow who is on each channel: Callbreak and 29 followers are the Page's
# existing audience; the US games are the most valuable players per user. Review after two
# weeks of results (reach, comments, store clicks by utm_source) and shift days to the winners.
PLATFORMS = {
    "facebook": {
        "rotation": {0: "callbreak", 1: "twenty-nine", 2: "tarneeb", 3: "bray", 4: "twenty-nine", 5: "callbreak", 6: "tarneeb"},
        "formats": ["feed"],
        "note": "Put the link in the **first comment**, not the post. Pin the first comment.",
    },
    "instagram": {
        "rotation": {0: "spades", 1: "hearts", 2: "spades", 3: "bridge", 4: "hearts", 5: "spades", 6: "bridge"},
        "formats": ["feed", "story"],
        "note": "No links in captions: the bio link goes to the Daily Trick page. Add the link sticker and quiz sticker to the Story by hand.",
    },
}
TIMES = {  # UTC; local time in brackets
    "spades": ("13:30", "8:30 am New York"), "hearts": ("13:30", "8:30 am New York"),
    "bridge": ("13:30", "8:30 am New York"), "callbreak": ("14:30", "8 pm India, 8:15 pm Nepal"),
    "twenty-nine": ("14:30", "8:30 pm Bangladesh"), "bray": ("14:30", "8 pm India"),
    "tarneeb": ("17:00", "8 pm Beirut, 6 pm Berlin"),
}
HASHTAGS = {
    "spades": "#spades #spadescardgame #cardgames #puzzle #bridge #trickTaking #brainteaser #dailypuzzle",
    "hearts": "#hearts #heartscardgame #cardgames #puzzle #shootthemoon #brainteaser #dailypuzzle",
    "callbreak": "#callbreak #callbreakgame #cardgames #nepal #india #puzzle #brainteaser #dailypuzzle",
    "twenty-nine": "#29cardgame #twentynine #cardgames #bangladesh #puzzle #brainteaser #dailypuzzle",
    "bray": "#bray #braycardgame #cardgames #india #puzzle #brainteaser #dailypuzzle",
    "tarneeb": "#tarneeb #tarneebgame #cardgames #arabic #puzzle #brainteaser #dailypuzzle",
    "bridge": "#bridge #contractbridge #bridgepuzzle #doubledummy #cardgames #brainteaser #dailypuzzle",
}
SUIT = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}


def pretty(c: str) -> str:
    return ("10" if c[1] == "T" else c[1]) + SUIT[c[0]]


def stars(n: int) -> str:
    return "★" * n + "☆" * (3 - n)


def game_by_slug(slug: str) -> dict:
    return next(g for g in b.GAMES if g["slug"] == slug)


def puzzle_data(g: dict, n: int, count: int) -> dict:
    return json.loads((b.DAILY / "data" / g["data"] / f"{((n - 1) % count) + 1}.json").read_text())


def link(g: dict, n: int, source: str, medium: str = "social") -> str:
    return f"{SITE}/daily/{g['slug']}/{n}/?utm_source={source}&utm_medium={medium}&utm_campaign=daily_trick"


def quiz_options(p: dict) -> tuple[list[str], str]:
    """Up to four cards for a Story quiz sticker: the key card plus wrong ones (never another
    card that also works, or the quiz would mark a right answer wrong)."""
    root = p["nodes"][p["root"]]["m"]
    wrong = [c for c, m in root.items() if not m["ok"]]
    wrong.sort(key=lambda c: (c != p["trap"], c))  # the tempting card first
    options = [p["key"]] + wrong[:3]
    options.sort(key=lambda c: (p["order"][c] * 7 + len(c)) % 11)  # fixed shuffle: don't always list the answer first
    return [pretty(c) for c in options], pretty(p["key"])


def day_block(platform: str, n: int, d: dt.date, g: dict, p: dict, names: dict, nxt: tuple | None) -> list[str]:
    t = g["title"]
    trap_line = "The tempting play is a trap." if p["trap"] else "Can you find it?"
    utc, local = TIMES[g["slug"]]
    md = [f"\n---\n\n## {d:%A %-d %B}: {t}, Daily Trick #{n} {stars(p['stars'])}\n",
          f"**Post at** {utc} UTC ({local}) · **Puzzle:** {p['goal']} · [open]({SITE}/daily/{g['slug']}/{n}/)\n"]
    if p["trap"]:
        ans = (f"✅ Answer to Daily Trick #{n} ({t}): the winning first card is the {pretty(p['key'])}. "
               f"The tempting play, the {pretty(p['trap'])}, loses.")
    else:
        ans = f"✅ Answer to Daily Trick #{n} ({t}): the winning first card is the {pretty(p['key'])}."
    src = "facebook" if platform == "facebook" else "instagram"
    if nxt:
        ans += f"\nToday's puzzle is {nxt[2]['title']}: " + (link(nxt[2], nxt[0], src) if platform == "facebook" else "link in bio")
    if platform == "facebook":
        post = (f"🧩 Daily Trick #{n}: {t} puzzle of the day {stars(p['stars'])}\n\n{p['goal']}\n({p['rules']})\n\n"
                f"All four hands are face up and the other players always play their best card. "
                f"Only one first card works. {trap_line}\n\n"
                f"Comment your card 👇 and tag a friend who thinks they're good at {t}. Answer tomorrow!")
        md.append(f"**Image:** `{names['feed']}` (1080×1350)\n")
        md.append(f"### Post\n```\n{post}\n```\n")
        md.append(f"**First comment (pin it):**\n```\n▶ Play today's {t} puzzle free (no signup, works on your phone): "
                  f"{link(g, n, 'facebook')}\n```\n")
    else:
        post = (f"🧩 Daily Trick #{n} · {t} {stars(p['stars'])}\n\n{p['goal']}\n{p['rules']}\n\n"
                f"Every card is face up and the other players always play their best. "
                f"Only one first card works. {trap_line}\n\n"
                f"Drop your card in the comments 👇 Answer tomorrow.\n"
                f"▶ Play it free, no signup: link in bio (datgamesstudio.com/daily)\n\n{HASHTAGS[g['slug']]}")
        opts, correct = quiz_options(p)
        md.append(f"**Images:** `{names['feed']}` (post, 1080×1350) · `{names['story']}` (Story, 1080×1920)\n")
        md.append(f"### Post caption\n```\n{post}\n```\n")
        md.append("### Story\n"
                  f"- Image: `{names['story']}`\n"
                  f"- Link sticker: `{link(g, n, 'instagram_story')}`\n"
                  f"- Quiz sticker: \"Which card wins?\" · options: {' · '.join(opts)} · **correct: {correct}**\n")
    md.append(f"### Answer: post on {(d + dt.timedelta(days=1)):%a %-d %b} as a comment on this post"
              f"{' and a Story line' if platform == 'instagram' else ''}\n```\n{ans}\n```")
    return md


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, help="first puzzle number (default: today)")
    ap.add_argument("--days", type=int, default=8)
    ap.add_argument("--platform", choices=sorted(PLATFORMS), help="only this platform (default: both)")
    args = ap.parse_args()
    index = json.loads((b.DAILY / "data" / "spades" / "index.json").read_text())
    epoch, count = index["epochDay"], index["count"]
    today = (dt.date.today() - b.EPOCH_DATE).days - epoch + 1
    first = args.start or today
    numbers = list(range(first, first + args.days))
    date_of = lambda n: b.EPOCH_DATE + dt.timedelta(days=epoch + n - 1)
    week = ROOT / "social" / "daily" / f"week-{date_of(first).isoformat()}"

    httpd, port = r.serve()
    try:
        for platform, cfg in PLATFORMS.items():
            if args.platform and platform != args.platform:
                continue
            out = week / platform
            out.mkdir(parents=True, exist_ok=True)
            days = []
            for n in numbers:
                d = date_of(n)
                g = game_by_slug(cfg["rotation"][d.weekday()])
                p = puzzle_data(g, n, count)
                names = {}
                for kind in cfg["formats"]:
                    name = f"{d.isoformat()}-{g['slug']}-{n}-{kind}.jpg"
                    r.shoot(f"http://127.0.0.1:{port}/daily/{g['slug']}/{n}/?og={kind}", r.SIZES[kind], out / name)
                    names[kind] = name
                days.append((n, d, g, p, names))
                print(f"{platform}: {d} {g['slug']} #{n}")
            md = [f"# The Daily Trick on {platform.title()}: {date_of(first):%-d %b} to {date_of(numbers[-1]):%-d %b %Y}\n",
                  f"{cfg['note']} Answers go out the next day.\n",
                  "| Date | Game | # | Post at (UTC) |\n|---|---|---|---|"]
            for n, d, g, p, names in days:
                utc, local = TIMES[g["slug"]]
                md.append(f"| {d:%a %-d %b} | {g['title']} | #{n} | {utc} ({local}) |")
            for i, (n, d, g, p, names) in enumerate(days):
                md += day_block(platform, n, d, g, p, names, days[i + 1] if i + 1 < len(days) else None)
            (out / "captions.md").write_text("\n".join(md) + "\n")
            print(f"→ {out}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
