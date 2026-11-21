#!/usr/bin/env python3
"""Post The Daily Trick to the DAT Games Facebook Page and Instagram account through Meta's
Graph API, and answer yesterday's puzzle as a comment. Standard library only.

    python3 tools/social_post.py facebook                  # dry run: prints what it would do
    python3 tools/social_post.py instagram --live          # really posts
    python3 tools/social_post.py facebook --slot 14:30     # only if today's game posts at 14:30 UTC
    python3 tools/social_post.py facebook --date 2026-11-23 --live

Safe by default: without --live nothing is sent to Meta. Each run first looks for an existing
post for the day's puzzle, so re-running a failed job never posts twice. Images must already be
public on the site (make_social_week.py --publish, then push). Setup: docs/social-automation.md.

Environment (live runs only): META_PAGE_TOKEN, FB_PAGE_ID (facebook), IG_USER_ID (instagram);
optional GRAPH_VERSION. Tokens are never printed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import social_content as c

GRAPH = "https://graph.facebook.com"
RUNWAY_DAYS = 3  # fail the job this many days before the published images run out
DEFAULT_VERSION = "v27.0"  # Meta retires old versions; bump (or set GRAPH_VERSION) when it does


class GraphError(Exception):
    pass


class Graph:
    """A minimal Graph API client. The token only ever goes in the request body or query."""

    def __init__(self, token: str, version: str = DEFAULT_VERSION):
        self.token = token
        self.base = f"{GRAPH}/{version}"

    def call(self, method: str, path: str, **params) -> dict:
        params["access_token"] = self.token
        data = urllib.parse.urlencode(params)
        if method == "GET":
            req = urllib.request.Request(f"{self.base}/{path}?{data}")
        else:
            req = urllib.request.Request(f"{self.base}/{path}", data=data.encode(), method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            body = {}
            try:
                body = json.loads(e.read().decode())
            except Exception:
                pass
            err = body.get("error", {})
            hint = " (the token is invalid or expired: make a new long-lived Page token)" if err.get("code") == 190 else ""
            raise GraphError(f"{method} {path}: HTTP {e.code}, {err.get('message', 'no detail')}{hint}") from None
        except urllib.error.URLError as e:
            raise GraphError(f"{method} {path}: network error {e.reason}") from None


LOCAL_ENV = os.path.expanduser("~/.config/datgames-social/meta.env")


def load_local_env(path: str = LOCAL_ENV) -> None:
    """For runs on your own machine: fill missing secrets from the private file written by
    meta_token_setup.py (outside every repo). On GitHub the secrets come from the environment."""
    try:
        lines = open(path).read().splitlines()
    except OSError:
        return
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#") and key.strip() and not os.environ.get(key.strip()):
            os.environ[key.strip()] = value.strip()


def marker_re(n: int) -> re.Pattern:
    return re.compile(rf"Daily Trick #{n}(?!\d)")


def image_is_public(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status == 200 and resp.headers.get("Content-Type", "").startswith("image/")
    except Exception:
        return False


def find_by_marker(items: list[dict], field: str, n: int) -> dict | None:
    rx = marker_re(n)
    return next((i for i in items if rx.search(i.get(field) or "")), None)


def answer_exists(comments: list[dict], answered_n: int) -> bool:
    rx = re.compile(rf"Answer to Daily Trick #{answered_n}(?!\d)")
    return any(rx.search(cm.get("message") or cm.get("text") or "") for cm in comments)


class Poster:
    def __init__(self, platform: str, api: Graph | None, account_id: str | None, live: bool, out=print):
        self.platform, self.api, self.account, self.live, self.out = platform, api, account_id, live, out
        self.failures: list[str] = []

    def step(self, what: str, fn):
        """Run one independent step: a failure is recorded and does not block the others."""
        try:
            return fn()
        except GraphError as e:
            self.failures.append(f"{what}: {e}")
            self.out(f"✗ {what}: {e}")

    # ---------- Facebook ----------
    def recent_fb(self) -> list[dict]:
        return self.api.call("GET", f"{self.account}/posts", fields="id,message", limit=25).get("data", [])

    def fb_today(self, post: dict) -> None:
        n, url = post["n"], c.image_url("facebook", post["n"])
        if self.live and find_by_marker(self.recent_fb(), "message", n):
            return self.out(f"= #{n} is already on the Page, skipping")
        self.out(f"→ Facebook photo post for #{n} ({post['game']['title']}), image {url}\n{post['caption']}\n")
        self.out(f"→ then first comment: {post['first_comment']}")
        if not self.live:
            return
        res = self.api.call("POST", f"{self.account}/photos", url=url, caption=post["caption"], published="true")
        post_id = res.get("post_id") or res.get("id")
        self.out(f"✓ posted {post_id}")
        self.step("first comment", lambda: self.api.call("POST", f"{post_id}/comments", message=post["first_comment"]))

    def fb_answer(self, yesterday: dict) -> None:
        n = yesterday["n"]
        self.out(f"→ answer to #{n} as a comment: {yesterday['answer']}")
        if not self.live:
            return
        hit = find_by_marker(self.recent_fb(), "message", n)
        if not hit:
            return self.out(f"= no Page post for #{n} found, no answer to add")
        comments = self.api.call("GET", f"{hit['id']}/comments", fields="message", limit=50, filter="stream").get("data", [])
        if answer_exists(comments, n):
            return self.out(f"= #{n} already has its answer")
        self.api.call("POST", f"{hit['id']}/comments", message=yesterday["answer"])
        self.out(f"✓ answered #{n}")

    # ---------- Instagram ----------
    def recent_ig(self) -> list[dict]:
        return self.api.call("GET", f"{self.account}/media", fields="id,caption", limit=25).get("data", [])

    def ig_today(self, post: dict) -> None:
        n, url = post["n"], c.image_url("instagram", post["n"])
        if self.live and find_by_marker(self.recent_ig(), "caption", n):
            return self.out(f"= #{n} is already on Instagram, skipping")
        self.out(f"→ Instagram feed post for #{n} ({post['game']['title']}), image {url}\n{post['caption']}\n")
        if not self.live:
            return
        container = self.api.call("POST", f"{self.account}/media", image_url=url, caption=post["caption"])["id"]
        for _ in range(30):  # Instagram processes the image before it can be published
            status = self.api.call("GET", container, fields="status_code").get("status_code")
            if status == "FINISHED":
                break
            if status in ("ERROR", "EXPIRED"):
                raise GraphError(f"container {container} is {status}")
            time.sleep(2)
        else:
            raise GraphError(f"container {container} was not ready after 60 seconds")
        media_id = self.api.call("POST", f"{self.account}/media_publish", creation_id=container)["id"]
        self.out(f"✓ published {media_id}")

    def ig_answer(self, yesterday: dict) -> None:
        n = yesterday["n"]
        self.out(f"→ answer to #{n} as a comment: {yesterday['answer']}")
        if not self.live:
            return
        hit = find_by_marker(self.recent_ig(), "caption", n)
        if not hit:
            return self.out(f"= no Instagram post for #{n} found, no answer to add")
        comments = self.api.call("GET", f"{hit['id']}/comments", fields="text", limit=50).get("data", [])
        if answer_exists(comments, n):
            return self.out(f"= #{n} already has its answer")
        self.api.call("POST", f"{hit['id']}/comments", message=yesterday["answer"])
        self.out(f"✓ answered #{n}")

    def run(self, n: int) -> int:
        post, yesterday = c.build_post(self.platform, n), c.build_post(self.platform, n - 1)
        url = c.image_url(self.platform, n)
        if not image_is_public(url):
            self.out(f"✗ the image is not published yet: {url}\n  Run tools/make_social_week.py --publish, then push the site.")
            self.failures.append("image not published")
            if self.live:
                return 1
        today, answer = (self.fb_today, self.fb_answer) if self.platform == "facebook" else (self.ig_today, self.ig_answer)
        self.step("today's post", lambda: today(post))
        self.step("answer to yesterday", lambda: answer(yesterday))
        ahead = c.image_url(self.platform, n + RUNWAY_DAYS)
        if not image_is_public(ahead):
            self.out(f"⚠ images run out in under {RUNWAY_DAYS} days (missing {ahead}).\n"
                     "  Run tools/make_social_week.py --days 35 --publish, then push the site.")
            if self.live:
                self.failures.append("image runway")
        return 1 if self.failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("platform", choices=sorted(c.PLATFORMS))
    ap.add_argument("--live", action="store_true", help="really post (default: dry run)")
    ap.add_argument("--date", help="UTC date, YYYY-MM-DD (default: today)")
    ap.add_argument("--slot", help="HH:MM UTC: do nothing unless the day's game posts at this time")
    args = ap.parse_args()

    day = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(dt.timezone.utc).date()
    n = c.number_of(day)
    game = c.game_for(args.platform, n)
    utc = c.TIMES[game["slug"]][0]
    if args.slot and args.slot != utc:
        print(f"{day}: {game['title']} posts at {utc} UTC, not {args.slot}. Nothing to do.")
        return 0

    api = account = None
    if args.live:
        load_local_env()
        need = ["META_PAGE_TOKEN", "FB_PAGE_ID" if args.platform == "facebook" else "IG_USER_ID"]
        missing = [k for k in need if not os.environ.get(k)]
        if missing:
            print(f"✗ missing secrets: {', '.join(missing)}. See docs/social-automation.md.")
            return 1
        api = Graph(os.environ["META_PAGE_TOKEN"], os.environ.get("GRAPH_VERSION", DEFAULT_VERSION))
        account = os.environ["FB_PAGE_ID" if args.platform == "facebook" else "IG_USER_ID"]
    print(f"{'LIVE' if args.live else 'DRY RUN'} · {args.platform} · {day} · Daily Trick #{n} · {game['title']}")
    lines: list[str] = []

    def out(msg: str) -> None:
        lines.append(msg)
        print(msg)

    code = Poster(args.platform, api, account, args.live, out).run(n)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"### Daily Trick #{n} on {args.platform} ({'live' if args.live else 'dry run'})\n```\n" + "\n".join(lines) + "\n```\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
