"""Private token storage and Instagram Login requests, shared by the two local helpers.

No API response, credential-bearing URL, or subprocess error output is printed. Standard library
only; the human runs the helpers. These functions do not publish posts or comments.
"""
from __future__ import annotations

import datetime as dt
import getpass
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import warnings

from social_post import DEFAULT_VERSION, Graph, GraphError, IG_GRAPH, LOCAL_ENV

REPO = "debchamps/datgamesstudio"
EXPECTED_USERNAME = "datgamesstudio"


def hidden_input(prompt: str) -> str:
    # getpass otherwise falls back to echoing stdin when no controlling terminal is available.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            value = getpass.getpass(prompt).strip()
        except (getpass.GetPassWarning, EOFError):
            raise GraphError("Hidden input requires your own interactive terminal.") from None
    if not value or any(ch.isspace() for ch in value):
        raise GraphError("A non-empty value without whitespace is required.")
    return value


def token_request(path: str, **params) -> dict:
    """Meta's exchange/refresh endpoints are unversioned GETs; never surface their URLs."""
    if path not in ("access_token", "refresh_access_token"):
        raise GraphError("Unsupported Instagram token endpoint.")
    url = f"{IG_GRAPH}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            result = json.loads(resp.read().decode())
        if not isinstance(result, dict) or result.get("error"):
            raise GraphError("Instagram rejected the token request (details withheld).")
        return result
    except urllib.error.HTTPError as error:
        error.close()
        raise GraphError(f"Instagram token request failed (HTTP {error.code}). "
                         "Check the token, its age, expiry and granted permissions in the dashboard.") from None
    except (urllib.error.URLError, OSError):
        raise GraphError("Instagram token request failed: network error (details withheld).") from None
    except (ValueError, UnicodeError):
        raise GraphError("Instagram returned an invalid token response (details withheld).") from None


def profile(token: str) -> dict:
    result = Graph(token, os.environ.get("GRAPH_VERSION") or DEFAULT_VERSION, host=IG_GRAPH).call(
        "GET", "me", fields="user_id,username,account_type")
    if "data" in result:
        data = result["data"]
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise GraphError("Expected exactly one Instagram account in the profile response.")
        result = data[0]
    user_id = str(result.get("user_id", ""))
    username = result.get("username", "")
    if not user_id.isascii() or not user_id.isdigit():
        raise GraphError("Instagram did not return a professional account user_id.")
    if not isinstance(username, str) or username.lower() != EXPECTED_USERNAME:
        raise GraphError("This token is not for @datgamesstudio. Nothing was saved.")
    if str(result.get("account_type", "")).upper() not in ("BUSINESS", "MEDIA_CREATOR"):
        raise GraphError("@datgamesstudio must be a Professional (Business or Creator) account.")
    return {"user_id": user_id, "username": username}


def token_values(result: dict, now: dt.datetime) -> dict[str, str]:
    token, seconds = result.get("access_token"), result.get("expires_in")
    if not isinstance(token, str) or not token or any(ch.isspace() for ch in token):
        raise GraphError("Instagram did not return a usable token (response withheld).")
    if isinstance(seconds, bool) or not isinstance(seconds, int) or seconds <= 0:
        raise GraphError("Instagram did not return a usable expires_in (response withheld).")
    return {"IG_ACCESS_TOKEN": token,
            # Midnight UTC is conservative: never claim a token is valid beyond its real expiry.
            "IG_TOKEN_EXPIRES": (now + dt.timedelta(seconds=seconds)).date().isoformat(),
            "IG_TOKEN_ISSUED_AT": now.isoformat()}


def read_env(path: str = LOCAL_ENV) -> dict[str, str]:
    try:
        lines = Path(path).read_text().splitlines()
    except FileNotFoundError:
        return {}
    except OSError:
        raise GraphError("Cannot read the private token file (details withheld).") from None
    values = {}
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.startswith("#"):
            values[key.strip()] = value.strip()
    return values


def update_env(values: dict[str, str], path: str = LOCAL_ENV) -> None:
    """Merge atomically, preserving the existing Facebook credentials; mode 600 from creation."""
    destination = Path(path)
    merged = read_env(path)
    merged.update(values)
    if any(not key.replace("_", "").isalnum() or "\n" in value or "\r" in value
           for key, value in merged.items()):
        raise GraphError("Invalid private environment file format (details withheld).")
    temporary = None
    try:
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".meta-", dir=destination.parent)
        with os.fdopen(fd, "w") as stream:
            stream.write("# DAT Games social posting. Private: never commit or share this file.\n")
            for key, value in merged.items():
                stream.write(f"{key}={value}\n")
        os.replace(temporary, destination)
    except OSError:
        raise GraphError("Cannot save the private token file (details withheld).") from None
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def github_values(values: dict[str, str]) -> None:
    """Only the human invokes this, using their local gh login. Activate the mode last."""
    for key in ("IG_ACCESS_TOKEN", "IG_USER_ID"):
        run_gh(["secret", "set", key, "--repo", REPO], stdin=values[key])
    for key in ("IG_TOKEN_EXPIRES", "IG_AUTH_MODE"):
        run_gh(["variable", "set", key, "--repo", REPO, "--body", values[key]])


def run_gh(args: list[str], stdin: str | None = None) -> None:
    try:
        subprocess.run(["gh", *args], input=stdin.encode() if stdin is not None else None,
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        raise GraphError("GitHub update failed. The private local file is saved. "
                         "Check gh auth status, then run tools/instagram_token_refresh.py --sync-only. "
                         "No new token refresh is needed.") from None
