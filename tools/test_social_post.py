"""Tests for social_post.py against a fake Graph API. Run: python3 -m unittest tools/test_social_post.py"""
import io
import datetime as dt
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import social_content as c  # noqa: E402
import social_post as sp  # noqa: E402

N = 7  # Mon 23 Nov 2026: Callbreak on Facebook, Spades on Instagram


class FakeGraph:
    """Records calls; `posts` / `comments` seed what the account already has."""

    def __init__(self, posts=None, comments=None, fail_on=None, *, token=None, version=None, host=None):
        self.calls, self.posts, self.comments, self.fail_on = [], posts or [], comments or {}, fail_on
        self.token, self.base = token, f"{host}/{version}"
        self.status = ["IN_PROGRESS", "FINISHED"]

    def call(self, method, path, **params):
        self.calls.append((method, path, params))
        if self.fail_on and self.fail_on in path:
            raise sp.GraphError(f"{method} {path}: HTTP 400, boom")
        if method == "GET" and (path.endswith("/posts") or path.endswith("/media")):
            return {"data": self.posts}
        if method == "GET" and path.endswith("/comments"):
            return {"data": self.comments.get(path.split("/")[0], [])}
        if method == "GET":  # container status
            return {"status_code": self.status.pop(0) if len(self.status) > 1 else self.status[0]}
        if path.endswith("/photos"):
            return {"id": "photo1", "post_id": "PAGE_post1"}
        if path.endswith("/media"):
            return {"id": "container1"}
        if path.endswith("/media_publish"):
            return {"id": "media1"}
        return {"id": "comment1"}

    def posted(self, suffix):
        return [x for x in self.calls if x[0] == "POST" and x[1].endswith(suffix)]


def run(platform, api, live=True, public=True, n=N):
    lines = []
    poster = sp.Poster(platform, api, "ACCT", live, out=lines.append)
    with mock.patch.object(sp, "image_is_public", return_value=public), mock.patch.object(sp.time, "sleep"):
        code = poster.run(n)
    return code, "\n".join(lines), poster


class SocialPostTests(unittest.TestCase):
    def test_content_lanes(self):
        self.assertEqual(c.game_for("facebook", N)["slug"], "callbreak")
        self.assertEqual(c.game_for("instagram", N)["slug"], "spades")
        for platform, cfg in c.PLATFORMS.items():  # every lane game has puzzles and a post time
            for slug in cfg["rotation"].values():
                self.assertIn(slug, c.TIMES)
                c.build_post(platform, N)

    def test_dry_run_sends_nothing(self):
        api = FakeGraph()
        code, out, _ = run("facebook", api, live=False)
        self.assertEqual(api.calls, [])
        self.assertIn("Facebook photo post for #7", out)
        self.assertEqual(code, 0)

    def test_facebook_posts_photo_then_link_comment(self):
        api = FakeGraph()
        code, _, _ = run("facebook", api)
        self.assertEqual(code, 0)
        (_, _, photo), = api.posted("/photos")
        self.assertEqual(photo["url"], c.image_url("facebook", N))
        self.assertIn("Daily Trick #7", photo["caption"])
        self.assertNotIn("http", photo["caption"])  # the link goes in the first comment
        comments = api.posted("PAGE_post1/comments")
        self.assertEqual(len(comments), 1)
        self.assertIn("utm_source=facebook", comments[0][2]["message"])

    def test_facebook_answers_yesterday_once(self):
        api = FakeGraph(posts=[{"id": "Y1", "message": "🧩 Daily Trick #6: Tarneeb puzzle"}])
        run("facebook", api)
        answers = [x for x in api.posted("Y1/comments")]
        self.assertEqual(len(answers), 1)
        self.assertIn("Answer to Daily Trick #6", answers[0][2]["message"])
        again = FakeGraph(posts=api.posts, comments={"Y1": [{"message": answers[0][2]["message"]}]})
        run("facebook", again)
        self.assertEqual(again.posted("Y1/comments"), [])

    def test_never_posts_twice(self):
        api = FakeGraph(posts=[{"id": "T1", "message": "🧩 Daily Trick #7: Callbreak puzzle"}])
        code, out, _ = run("facebook", api)
        self.assertEqual(code, 0)
        self.assertEqual(api.posted("/photos"), [])
        self.assertIn("already on the Page", out)

    def test_marker_does_not_match_longer_numbers(self):
        api = FakeGraph(posts=[{"id": "X", "message": "Daily Trick #70: something"}])
        run("facebook", api)
        self.assertEqual(len(api.posted("/photos")), 1)

    def test_instagram_container_then_publish(self):
        api = FakeGraph()
        code, _, _ = run("instagram", api)
        self.assertEqual(code, 0)
        (_, _, media), = api.posted("/media")
        self.assertEqual(media["image_url"], c.image_url("instagram", N))
        self.assertIn("link in bio", media["caption"])
        self.assertEqual(len(api.posted("/media_publish")), 1)
        self.assertEqual(api.posted("/media_publish")[0][2]["creation_id"], "container1")

    def test_instagram_waits_for_processing(self):
        api = FakeGraph()
        run("instagram", api)
        polls = [x for x in api.calls if x[0] == "GET" and x[1] == "container1"]
        self.assertEqual(len(polls), 2)  # IN_PROGRESS, then FINISHED

    def test_instagram_answer_goes_on_yesterdays_media(self):
        api = FakeGraph(posts=[{"id": "M6", "caption": "🧩 Daily Trick #6 · Bridge ★★☆"}])
        run("instagram", api)
        (_, _, m), = api.posted("M6/comments")
        self.assertIn("Answer to Daily Trick #6", m["message"])

    def test_missing_image_blocks_live_post(self):
        api = FakeGraph()
        code, out, _ = run("facebook", api, public=False)
        self.assertEqual(code, 1)
        self.assertEqual(api.posted("/photos"), [])
        self.assertIn("not published", out)

    def test_one_failure_does_not_block_the_other_step(self):
        api = FakeGraph(posts=[{"id": "Y1", "message": "Daily Trick #6: x"}], fail_on="photos")
        code, out, poster = run("facebook", api)
        self.assertEqual(code, 1)
        self.assertEqual(len(api.posted("Y1/comments")), 1)  # yesterday's answer still went out
        self.assertTrue(any("today's post" in f for f in poster.failures))

    def test_token_never_printed_and_expiry_hint(self):
        g = sp.Graph("SECRET_TOKEN")
        err = mock.Mock(code=400)
        err.read.return_value = b'{"error": {"message": "Invalid OAuth access token", "code": 190}}'
        http = sp.urllib.error.HTTPError("u", 400, "bad", {}, io.BytesIO(err.read.return_value))
        with mock.patch.object(sp.urllib.request, "urlopen", side_effect=http):
            with self.assertRaises(sp.GraphError) as cm:
                g.call("GET", "123/posts")
        self.assertNotIn("SECRET_TOKEN", str(cm.exception))
        self.assertIn("expired", str(cm.exception))

    def test_private_env_file_fills_missing_secrets_only(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
            f.write("# comment\nMETA_PAGE_TOKEN=from_file\nFB_PAGE_ID=999\n")
        try:
            with mock.patch.dict(os.environ, {"FB_PAGE_ID": "from_env"}, clear=True):
                sp.load_local_env(f.name)
                self.assertEqual(os.environ["META_PAGE_TOKEN"], "from_file")
                self.assertEqual(os.environ["FB_PAGE_ID"], "from_env")  # the environment wins
        finally:
            os.unlink(f.name)
        sp.load_local_env("/nonexistent/meta.env")  # a missing file is fine

    def test_token_setup_writes_private_file(self):
        import stat as st
        import tempfile
        import meta_token_setup as mts
        path = os.path.join(tempfile.mkdtemp(), "sub", "meta.env")
        mts.write_env({"META_PAGE_TOKEN": "t", "FB_PAGE_ID": "1"}, path)
        self.assertEqual(st.S_IMODE(os.stat(path).st_mode), 0o600)
        with open(path) as stream:
            self.assertIn("META_PAGE_TOKEN=t", stream.read())

    def test_slot_gating_and_missing_secrets(self):
        with mock.patch.object(sys, "argv", ["x", "facebook", "--date", "2026-11-24", "--slot", "17:00"]):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(sp.main(), 0)
            self.assertIn("Nothing to do", buf.getvalue())
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(sp, "load_local_env"), \
                mock.patch.object(sys, "argv", ["x", "instagram", "--live", "--date", "2026-11-23"]):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(sp.main(), 1)
            self.assertIn("missing secrets", buf.getvalue())


class InstagramLoginTests(unittest.TestCase):
    def invoke(self, env=None, platform="instagram", live=True, api=None):
        api = api or FakeGraph()
        args = ["social_post.py", platform, "--date", "2026-11-23"] + (["--live"] if live else [])
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env or {}, clear=True), mock.patch.object(sp, "load_local_env"), \
                mock.patch.object(sys, "argv", args), mock.patch.object(sp, "Graph", return_value=api) as factory, \
                mock.patch.object(sp, "image_is_public", return_value=True), mock.patch.object(sp.time, "sleep"), \
                redirect_stdout(buf):
            code = sp.main()
        return code, buf.getvalue(), factory, api

    def settings(self, days=30):
        expiry = dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=days)
        return {"IG_AUTH_MODE": "instagram_login", "IG_ACCESS_TOKEN": "fixture-instagram",
                "IG_USER_ID": "123", "IG_TOKEN_EXPIRES": expiry.isoformat()}

    def test_instagram_login_uses_own_host_token_and_full_flow(self):
        env = self.settings()
        env["GRAPH_VERSION"] = ""  # GitHub passes an unset variable as an empty string
        code, output, factory, api = self.invoke(env)
        self.assertEqual(code, 0)
        factory.assert_called_once_with("fixture-instagram", "v27.0", host=sp.IG_GRAPH)
        self.assertEqual(len(api.posted("123/media")), 1)
        self.assertEqual(api.posted("123/media_publish")[0][2], {"creation_id": "container1"})
        self.assertNotIn("fixture-instagram", output)

    def test_instagram_login_does_not_duplicate_post_or_answer(self):
        api = FakeGraph(posts=[{"id": "T", "caption": "Daily Trick #7"},
                               {"id": "Y", "caption": "Daily Trick #6"}],
                        comments={"Y": [{"text": "Answer to Daily Trick #6: already done"}]})
        code, output, _, api = self.invoke(self.settings(), api=api)
        self.assertEqual(code, 0)
        self.assertEqual(api.posted("/media"), [])
        self.assertEqual(api.posted("/media_publish"), [])
        self.assertEqual(api.posted("/comments"), [])
        self.assertIn("already on Instagram", output)
        self.assertIn("already has its answer", output)

    def test_instagram_login_answers_yesterday(self):
        api = FakeGraph(posts=[{"id": "Y", "caption": "Daily Trick #6"}])
        code, _, _, api = self.invoke(self.settings(), api=api)
        self.assertEqual(code, 0)
        self.assertIn("Answer to Daily Trick #6", api.posted("Y/comments")[0][2]["message"])

    def test_expiry_guard_stops_all_calls_even_for_a_historical_post(self):
        # --date selects the puzzle, never the token validity date.
        for days in (7, 0, -1):
            with self.subTest(days=days):
                code, output, factory, api = self.invoke(self.settings(days))
                self.assertEqual(code, 1)
                factory.assert_not_called()
                self.assertEqual(api.calls, [])
                self.assertIn("expired" if days <= 0 else "7 days", output)

    def test_missing_or_invalid_expiry_blocks_live(self):
        for value in ("", "tomorrow", "2026-02-30", "20261130"):
            env = self.settings()
            env["IG_TOKEN_EXPIRES"] = value
            code, output, factory, _ = self.invoke(env)
            self.assertEqual(code, 1)
            factory.assert_not_called()
            self.assertIn("IG_TOKEN_EXPIRES", output)

    def test_fourteen_days_remaining_is_allowed(self):
        self.assertEqual(self.invoke(self.settings(14))[0], 0)

    def test_missing_secrets_are_specific_to_instagram_login(self):
        code, output, factory, _ = self.invoke({"IG_AUTH_MODE": "instagram_login"})
        self.assertEqual(code, 1)
        factory.assert_not_called()
        self.assertIn("IG_ACCESS_TOKEN, IG_USER_ID", output)
        self.assertNotIn("META_PAGE_TOKEN", output)

    def test_dry_run_needs_no_credentials_or_expiry_and_sends_nothing(self):
        code, output, factory, api = self.invoke({"IG_AUTH_MODE": "instagram_login"}, live=False)
        self.assertEqual(code, 0)
        factory.assert_not_called()
        self.assertEqual(api.calls, [])
        self.assertIn("DRY RUN", output)
        self.assertIn("Spades", output)
        self.assertIn(c.image_url("instagram", N), output)

    def test_facebook_ignores_instagram_auth_mode_and_expiry(self):
        env = {"IG_AUTH_MODE": "instagram_login", "IG_TOKEN_EXPIRES": "expired",
               "META_PAGE_TOKEN": "fixture-page", "FB_PAGE_ID": "456"}
        code, _, factory, api = self.invoke(env, platform="facebook")
        self.assertEqual(code, 0)
        factory.assert_called_once_with("fixture-page", "v27.0", host=sp.GRAPH)
        self.assertEqual(len(api.posted("456/photos")), 1)

    def test_default_instagram_mode_remains_facebook_login(self):
        env = {"META_PAGE_TOKEN": "fixture-page", "IG_USER_ID": "456", "IG_AUTH_MODE": ""}
        code, _, factory, _ = self.invoke(env)
        self.assertEqual(code, 0)
        factory.assert_called_once_with("fixture-page", "v27.0", host=sp.GRAPH)

    def test_invalid_auth_mode_is_rejected_without_echoing_it(self):
        code, output, factory, _ = self.invoke({"IG_AUTH_MODE": "fixture-invalid-value"})
        self.assertEqual(code, 1)
        factory.assert_not_called()
        self.assertNotIn("fixture-invalid-value", output)

    def test_instagram_graph_requests_use_instagram_host(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data": []}'
        graph = sp.Graph("fixture-instagram", host=sp.IG_GRAPH)
        with mock.patch.object(sp.urllib.request, "urlopen", return_value=response) as request:
            graph.call("GET", "123/media", fields="id,caption")
        url = sp.urllib.parse.urlparse(request.call_args.args[0].full_url)
        self.assertEqual(url.netloc, "graph.instagram.com")
        self.assertEqual(url.path, "/v27.0/123/media")
        self.assertEqual(sp.urllib.parse.parse_qs(url.query)["access_token"], ["fixture-instagram"])

    def test_http_and_network_errors_never_echo_credentials_or_urls(self):
        token = "fixture-credential+/="
        encoded = sp.urllib.parse.quote_plus(token)
        errors = [sp.urllib.error.HTTPError("url", 400, "bad", {}, io.BytesIO(
            ('{"error":{"message":"' + token + ' ' + encoded + '","code":190}}').encode())),
            sp.urllib.error.URLError("https://graph.instagram.com/me?access_token=" + encoded),
            TimeoutError(token)]
        for error in errors:
            with mock.patch.object(sp.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(sp.GraphError) as caught:
                    sp.Graph(token, host=sp.IG_GRAPH).call("GET", "123/media")
            self.assertNotIn(token, str(caught.exception))
            self.assertNotIn(encoded, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
