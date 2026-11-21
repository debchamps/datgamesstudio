#!/usr/bin/env python3
"""Render The Daily Trick's social images with headless Chrome from the puzzle page itself
(`?og=wide` 1200×630 for link previews, `?og=feed` 1080×1350 for Instagram/Facebook posts).

    python3 tools/render_daily_images.py                 # today .. today + 7, wide only
    python3 tools/render_daily_images.py --from 1 --to 35 --feed

Writes daily/og/<slug>-<n>.jpg (link previews, referenced by the permalink pages) and, with
--feed, social/daily/<slug>-<n>-feed.jpg (post images; not published by the site build).
Re-run tools/build_daily.py afterwards so pages pick up new images.
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import http.server
import json
import subprocess
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZES = {"wide": (1200, 630), "feed": (1080, 1350), "story": (1080, 1920)}


def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

    handler = functools.partial(Quiet, directory=str(ROOT))
    # Loopback only: the server exists for the screenshots and stops with the script.
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def shoot(url: str, size: tuple[int, int], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "shot.png"
        subprocess.run([
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
            f"--user-data-dir={tmp}/profile", f"--window-size={size[0]},{size[1]}",
            "--virtual-time-budget=6000", f"--screenshot={png}", url,
        ], check=True, capture_output=True, timeout=90)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", str(png), "--out", str(out)],
                       check=True, capture_output=True)


def main() -> None:
    import build_daily as b  # same folder

    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int)
    ap.add_argument("--to", dest="end", type=int)
    ap.add_argument("--feed", action="store_true", help="also render 1080×1350 post images")
    ap.add_argument("--games", help="comma-separated slugs (default: all)")
    args = ap.parse_args()
    epoch = json.loads((b.DAILY / "data" / "spades" / "index.json").read_text())["epochDay"]
    today = (dt.date.today() - b.EPOCH_DATE).days - epoch + 1
    start, end = args.start or today, args.end or today + 7
    games = [g for g in b.GAMES if not args.games or g["slug"] in args.games.split(",")]
    httpd, port = serve()
    try:
        for g in games:
            for n in range(start, end + 1):
                base = f"http://127.0.0.1:{port}/daily/{g['slug']}/{n}/"
                shoot(base + "?og=wide", SIZES["wide"], ROOT / "daily" / "og" / f"{g['slug']}-{n}.jpg")
                if args.feed:
                    shoot(base + "?og=feed", SIZES["feed"], ROOT / "social" / "daily" / f"{g['slug']}-{n}-feed.jpg")
            print(f"{g['slug']}: #{start}–#{end}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
