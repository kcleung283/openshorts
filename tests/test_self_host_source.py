"""Self-host source segment planning (YouTube ?t= and dashboard ranges)."""
import self_host_source


class TestYoutubeStartSeconds:
    def test_query_seconds(self):
        url = "https://www.youtube.com/live/Kyv61l2vF6M?t=10589s"
        assert self_host_source.youtube_start_seconds(url) == 10589.0

    def test_query_plain_digits(self):
        assert self_host_source.youtube_start_seconds("https://youtu.be/x?t=90") == 90.0

    def test_hms_token(self):
        assert self_host_source.youtube_start_seconds("https://youtu.be/x?t=1h2m3s") == 3723.0


class TestPlanSelfHostPartial:
    def test_from_youtube_t(self):
        partial = self_host_source.plan_self_host_partial(
            "https://www.youtube.com/live/Kyv61l2vF6M?t=10589s", None, 60)
        assert partial is not None
        assert partial["start_seconds"] == 10589.0
        assert partial["end_seconds"] == 10589.0 + 35 * 60

    def test_from_dashboard_range(self):
        partial = self_host_source.plan_self_host_partial(
            None, (130, 460), 60)
        assert partial["start_seconds"] == 130.0
        assert partial["end_seconds"] == 460.0