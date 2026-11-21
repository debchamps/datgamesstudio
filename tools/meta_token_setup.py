#!/usr/bin/env python3
"""Turn a short-lived Graph API Explorer token into a Page token that doesn't expire, and keep it
safely: in a private file outside every repo (~/.config/datgames-social/meta.env, mode 600) and,
if you agree, as GitHub Actions secrets. Standard library only. Run it yourself in a terminal:

    python3 tools/meta_token_setup.py

It asks for the App Secret and the Explorer token with hidden input, so neither is echoed, put in
chat, or saved in your shell history. Nothing secret is ever printed or written inside a repo.
"""
from __future__ import annotations

import getpass
import json
import os
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

APP_ID = "1653465589615252"  # DAT Games Social (not a secret)
VERSION = "v27.0"
REPO = "debchamps/datgamesstudio"
ENV_FILE = os.path.expanduser("~/.config/datgames-social/meta.env")


def graph(path: str, **params) -> dict:
    url = f"https://graph.facebook.com/{VERSION}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("error", {}).get("message", "no detail")
        except Exception:
            msg = "no detail"
        raise SystemExit(f"✗ Meta rejected the request ({path.split('?')[0]}): {msg}") from None


def pick_page(pages: list[dict]) -> dict:
    if not pages:
        raise SystemExit("✗ No Pages came back. In the Explorer dialog, tick the DAT Games Page and try again.")
    match = [p for p in pages if "dat games" in p.get("name", "").lower()]
    if len(match) == 1:
        return match[0]
    for i, p in enumerate(pages, 1):
        print(f"  {i}. {p['name']} ({p['id']})")
    return pages[int(input("Which Page? number: ")) - 1]


def write_env(values: dict[str, str], path: str = ENV_FILE) -> None:
    """Write KEY=VALUE lines to a file only the owner can read."""
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("# DAT Games social posting. Private: never commit or share this file.\n")
        for k, v in values.items():
            f.write(f"{k}={v}\n")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def set_github_secret(name: str, value: str) -> None:
    # The value goes in on stdin, not on the command line, so it never shows up in a process list.
    subprocess.run(["gh", "secret", "set", name, "--repo", REPO], input=value.encode(), check=True,
                   stdout=subprocess.DEVNULL)


def main() -> None:
    print(f"Meta app {APP_ID}. Input is hidden.\n")
    secret = getpass.getpass("App Secret (App settings → Basic → Show): ").strip()
    short = getpass.getpass("Token from the Graph API Explorer: ").strip()
    if not secret or not short:
        raise SystemExit("✗ Both are needed.")
    long_user = graph("oauth/access_token", grant_type="fb_exchange_token", client_id=APP_ID,
                      client_secret=secret, fb_exchange_token=short)["access_token"]
    pages = graph("me/accounts", fields="id,name,access_token,instagram_business_account", access_token=long_user)["data"]
    page = pick_page(pages)
    check = graph(page["id"], fields="name,fan_count", access_token=page["access_token"])
    print(f"✓ Page token works for “{check['name']}” ({check.get('fan_count', '?')} followers).")
    values = {"META_PAGE_TOKEN": page["access_token"], "FB_PAGE_ID": page["id"], "GRAPH_VERSION": VERSION}
    ig = (page.get("instagram_business_account") or {}).get("id")
    if ig:
        values["IG_USER_ID"] = ig
        print(f"✓ Instagram account {ig} is linked to this Page.")
    else:
        print("• No Instagram account linked to this Page yet (Facebook only).")
    write_env(values)
    print(f"✓ Saved to {ENV_FILE} (readable only by you).")
    if input(f"Also store them as GitHub secrets on {REPO}? [y/N] ").strip().lower() == "y":
        for k in ("META_PAGE_TOKEN", "FB_PAGE_ID", "IG_USER_ID"):
            if k in values:
                set_github_secret(k, values[k])
                print(f"✓ secret {k} set")
    print("\nDone. To check the Page token is a non-expiring one, paste it into Meta's Access Token Debugger:"
          "\n  it should say “Expires: Never”.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nStopped. Nothing was saved.")
