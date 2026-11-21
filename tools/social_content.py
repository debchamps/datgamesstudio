"""What The Daily Trick posts on each platform, shared by the weekly generator
(make_social_week.py) and the automatic poster (social_post.py). Standard library only.

One lane per platform: Facebook (the Page's South Asian and Arabic followers) gets 29, Callbreak,
Bray and Tarneeb; Instagram (a clean slate, aimed at US/UK players) gets Spades, Hearts and
Bridge. One post a day on each. Review after two weeks of results and shift days to the winners.
"""
from __future__ import annotations

import datetime as dt
import json

import build_daily as b

SITE = b.SITE
IMAGE_DIR = "daily/social"  # published with the site: <IMAGE_DIR>/<platform>/<name>

# Monday = 0.
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
TIMES = {  # UTC "HH:MM", with the local time it means
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


def pack_info() -> tuple[int, int]:
    """(epochDay of puzzle #1, puzzles per pack)."""
    index = json.loads((b.DAILY / "data" / "spades" / "index.json").read_text())
    return index["epochDay"], index["count"]


def date_of(n: int) -> dt.date:
    return b.EPOCH_DATE + dt.timedelta(days=pack_info()[0] + n - 1)


def number_of(day: dt.date) -> int:
    return (day - b.EPOCH_DATE).days - pack_info()[0] + 1


def puzzle_data(g: dict, n: int) -> dict:
    count = pack_info()[1]
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
    options.sort(key=lambda c: (p["order"][c] * 7 + len(c)) % 11)  # fixed shuffle: the answer isn't always first
    return [pretty(c) for c in options], pretty(p["key"])


def game_for(platform: str, n: int) -> dict:
    return game_by_slug(PLATFORMS[platform]["rotation"][date_of(n).weekday()])


def image_name(platform: str, n: int, kind: str = "feed") -> str:
    d = date_of(n)
    return f"{d.isoformat()}-{game_for(platform, n)['slug']}-{n}-{kind}.jpg"


def image_url(platform: str, n: int, kind: str = "feed") -> str:
    return f"{SITE}/{IMAGE_DIR}/{platform}/{image_name(platform, n, kind)}"


def build_post(platform: str, n: int) -> dict:
    """Everything for puzzle #n on a platform: game, caption, link comment, the answer to post
    the next day, the day's image names and time."""
    d = date_of(n)
    g = game_for(platform, n)
    p = puzzle_data(g, n)
    t = g["title"]
    trap_line = "The tempting play is a trap." if p["trap"] else "Can you find it?"
    first_comment = None
    if platform == "facebook":
        caption = (f"🧩 Daily Trick #{n}: {t} puzzle of the day {stars(p['stars'])}\n\n{p['goal']}\n({p['rules']})\n\n"
                   f"All four hands are face up and the other players always play their best card. "
                   f"Only one first card works. {trap_line}\n\n"
                   f"Comment your card 👇 and tag a friend who thinks they're good at {t}. Answer tomorrow!")
        first_comment = (f"▶ Play today's {t} puzzle free (no signup, works on your phone): "
                         f"{link(g, n, 'facebook')}")
    else:
        caption = (f"🧩 Daily Trick #{n} · {t} {stars(p['stars'])}\n\n{p['goal']}\n{p['rules']}\n\n"
                   f"Every card is face up and the other players always play their best. "
                   f"Only one first card works. {trap_line}\n\n"
                   f"Drop your card in the comments 👇 Answer tomorrow.\n"
                   f"▶ Play it free, no signup: link in bio (datgamesstudio.com/daily)\n\n{HASHTAGS[g['slug']]}")
    if p["trap"]:
        answer = (f"✅ Answer to Daily Trick #{n} ({t}): the winning first card is the {pretty(p['key'])}. "
                  f"The tempting play, the {pretty(p['trap'])}, loses.")
    else:
        answer = f"✅ Answer to Daily Trick #{n} ({t}): the winning first card is the {pretty(p['key'])}."
    nxt = game_for(platform, n + 1)
    answer += f"\nToday's puzzle is {nxt['title']}: " + (
        link(nxt, n + 1, "facebook") if platform == "facebook" else "link in bio")
    utc, local = TIMES[g["slug"]]
    return {"n": n, "date": d, "game": g, "puzzle": p, "caption": caption, "first_comment": first_comment,
            "answer": answer, "utc": utc, "local": local, "marker": f"Daily Trick #{n}"}
