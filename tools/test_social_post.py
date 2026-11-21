"""Tests for social_post.py against a fake Graph API. Run: python3 -m unittest tools/test_social_post.py"""
import io
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

    def __init__(self, posts=None, comments=None, fail_on=None):
        self.calls, self.posts, self.comments, self.fail_on = [], posts or [], comments or {}, fail_on
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

    def test_slot_gating_and_missing_secrets(self):
        with mock.patch.object(sys, "argv", ["x", "facebook", "--date", "2026-11-24", "--slot", "17:00"]):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(sp.main(), 0)
            self.assertIn("Nothing to do", buf.getvalue())
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(sys, "argv", ["x", "instagram", "--live", "--date", "2026-11-23"]):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(sp.main(), 1)
            self.assertIn("missing secrets", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
