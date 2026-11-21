#!/usr/bin/env python3
"""Make a stretch of Instagram and Facebook posts for The Daily Trick, one lane per platform
(see social_content.py): feed (1080×1350) and, for Instagram, Story (1080×1920) images,
captions, Story quiz options, next-day answers and posting times.

    python3 tools/make_social_week.py                      # today .. today + 7, both platforms
    python3 tools/make_social_week.py --start 13 --days 7 --platform instagram
    python3 tools/make_social_week.py --days 35 --publish  # also copy feed images into the site

Output: social/daily/week-<first date>/{facebook,instagram}/ (git-ignored): images and
captions.md. With --publish the feed images are also written to daily/social/<platform>/, which
the site publishes: the automatic poster (social_post.py) needs public image URLs, so run this
about a month ahead and push. Puzzle pages and data must exist (build_daily.py, forge `web`).
"""
from __future__ import annotations

import argparse
import datetime as dt
import shutil

import render_daily_images as r
import social_content as c


def day_block(platform: str, post: dict, names: dict) -> list[str]:
    g, p, n, d = post["game"], post["puzzle"], post["n"], post["date"]
    md = [f"\n---\n\n## {d:%A %-d %B}: {g['title']}, Daily Trick #{n} {c.stars(p['stars'])}\n",
          f"**Post at** {post['utc']} UTC ({post['local']}) · **Puzzle:** {p['goal']} · "
          f"[open]({c.SITE}/daily/{g['slug']}/{n}/)\n"]
    if platform == "facebook":
        md.append(f"**Image:** `{names['feed']}` (1080×1350)\n")
        md.append(f"### Post\n```\n{post['caption']}\n```\n")
        md.append(f"**First comment (pin it):**\n```\n{post['first_comment']}\n```\n")
    else:
        opts, correct = c.quiz_options(p)
        md.append(f"**Images:** `{names['feed']}` (post, 1080×1350) · `{names['story']}` (Story, 1080×1920)\n")
        md.append(f"### Post caption\n```\n{post['caption']}\n```\n")
        md.append("### Story\n"
                  f"- Image: `{names['story']}`\n"
                  f"- Link sticker: `{c.link(g, n, 'instagram_story')}`\n"
                  f"- Quiz sticker: \"Which card wins?\" · options: {' · '.join(opts)} · **correct: {correct}**\n")
    md.append(f"### Answer: post on {(d + dt.timedelta(days=1)):%a %-d %b} as a comment on this post"
              f"{' and a Story line' if platform == 'instagram' else ''}\n```\n{post['answer']}\n```")
    return md


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, help="first puzzle number (default: today)")
    ap.add_argument("--days", type=int, default=8)
    ap.add_argument("--platform", choices=sorted(c.PLATFORMS), help="only this platform (default: both)")
    ap.add_argument("--publish", action="store_true", help="also copy feed images to daily/social/<platform>/")
    args = ap.parse_args()
    first = args.start or c.number_of(dt.date.today())
    numbers = list(range(first, first + args.days))
    week = c.b.ROOT / "social" / "daily" / f"week-{c.date_of(first).isoformat()}"

    httpd, port = r.serve()
    try:
        for platform, cfg in c.PLATFORMS.items():
            if args.platform and platform != args.platform:
                continue
            out = week / platform
            out.mkdir(parents=True, exist_ok=True)
            posts = []
            for n in numbers:
                post = c.build_post(platform, n)
                g = post["game"]
                names = {}
                for kind in cfg["formats"]:
                    name = c.image_name(platform, n, kind)
                    r.shoot(f"http://127.0.0.1:{port}/daily/{g['slug']}/{n}/?og={kind}", r.SIZES[kind], out / name)
                    names[kind] = name
                if args.publish:
                    site = c.b.ROOT / c.IMAGE_DIR / platform
                    site.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(out / names["feed"], site / names["feed"])
                posts.append((post, names))
                print(f"{platform}: {post['date']} {g['slug']} #{n}")
            md = [f"# The Daily Trick on {platform.title()}: {c.date_of(first):%-d %b} to {c.date_of(numbers[-1]):%-d %b %Y}\n",
                  f"{cfg['note']} Answers go out the next day.\n",
                  "| Date | Game | # | Post at (UTC) |\n|---|---|---|---|"]
            for post, _ in posts:
                md.append(f"| {post['date']:%a %-d %b} | {post['game']['title']} | #{post['n']} | {post['utc']} ({post['local']}) |")
            for post, names in posts:
                md += day_block(platform, post, names)
            (out / "captions.md").write_text("\n".join(md) + "\n")
            print(f"→ {out}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
