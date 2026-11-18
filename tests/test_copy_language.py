import clip_selection


def test_llm_copy_language_follows_transcript(monkeypatch):
    monkeypatch.delenv("CLIP_OUTPUT_ENGLISH", raising=False)
    assert clip_selection.llm_copy_language("zh") == "zh"
    assert clip_selection.llm_copy_language("ja-JP") == "ja"


def test_llm_copy_language_forced_english(monkeypatch):
    monkeypatch.setenv("CLIP_OUTPUT_ENGLISH", "1")
    assert clip_selection.llm_copy_language("zh") == "en"
    assert clip_selection.llm_copy_language("es") == "en"