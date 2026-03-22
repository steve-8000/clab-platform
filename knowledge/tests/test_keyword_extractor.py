"""Tests for langgraph.knowledge.services.keyword_extractor."""

import pytest

from langgraph.knowledge.services.keyword_extractor import extract_keywords


class TestExtractKeywords:
    """Tests for the extract_keywords function."""

    def test_basic_extraction(self):
        """Basic keyword extraction from a simple sentence."""
        text = "Python is great for building machine learning models"
        keywords = extract_keywords(text)
        assert isinstance(keywords, list)
        assert len(keywords) > 0
        assert "python" in keywords
        assert "machine" in keywords
        assert "learning" in keywords
        assert "building" in keywords
        assert "models" in keywords

    def test_stopword_filtering(self):
        """Common stopwords should be removed from results."""
        text = "the is are was were have has had do does did will would should"
        keywords = extract_keywords(text)
        assert keywords == [], f"Expected empty list but got {keywords}"

    def test_short_word_filtering(self):
        """Words shorter than 3 characters should be filtered out."""
        text = "go do it an be me we us up at to on in by"
        keywords = extract_keywords(text)
        assert keywords == [], f"Expected empty list but got {keywords}"

    def test_max_count_limit(self):
        """The max_count parameter should limit the number of results."""
        text = (
            "python java rust golang typescript javascript kotlin swift "
            "ruby scala elixir haskell"
        )
        keywords = extract_keywords(text, max_count=3)
        assert len(keywords) <= 3

    def test_max_count_default_is_8(self):
        """Default max_count should be 8."""
        text = " ".join(
            [f"word{i}" for i in range(20)]
        )  # 20 unique words
        keywords = extract_keywords(text)
        assert len(keywords) <= 8

    def test_empty_text(self):
        """Empty text should return an empty list."""
        assert extract_keywords("") == []
        assert extract_keywords("   ") == []

    def test_frequency_ordering(self):
        """Most frequent words should appear first."""
        text = "python python python java java rust"
        keywords = extract_keywords(text)
        assert keywords[0] == "python"
        assert keywords[1] == "java"
        assert keywords[2] == "rust"

    def test_punctuation_stripped(self):
        """Punctuation should be stripped before keyword extraction."""
        text = "python! java? rust. (golang) [typescript]"
        keywords = extract_keywords(text)
        assert "python" in keywords
        assert "java" in keywords
        assert "rust" in keywords

    def test_case_insensitive(self):
        """Keywords should be lowercase regardless of input case."""
        text = "Python JAVA Rust GoLang"
        keywords = extract_keywords(text)
        for kw in keywords:
            assert kw == kw.lower(), f"Keyword '{kw}' is not lowercase"

    def test_duplicate_words_counted_correctly(self):
        """Duplicate words should be counted and deduplicated in output."""
        text = "testing testing testing framework framework tool"
        keywords = extract_keywords(text)
        # No duplicate keywords in output
        assert len(keywords) == len(set(keywords))
        # Most frequent first
        assert keywords[0] == "testing"
        assert keywords[1] == "framework"
