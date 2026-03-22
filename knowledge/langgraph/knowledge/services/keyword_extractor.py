"""Keyword extraction from text -- ported from keyword-extractor.ts."""

from __future__ import annotations

import re
from collections import Counter

_STOPWORDS: set[str] = {
    "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "shall", "can",
    "a", "an", "and", "or", "but",
    "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "as", "into", "through", "during", "before", "after",
    "this", "that", "these", "those", "it", "its",
}


def extract_keywords(text: str, max_count: int = 8) -> list[str]:
    """Return the *max_count* most frequent non-stopword tokens (>= 3 chars)."""

    words = re.sub(r"[^a-z0-9\s]", "", text.lower()).split()
    freq = Counter(w for w in words if len(w) >= 3 and w not in _STOPWORDS)
    return [word for word, _ in freq.most_common(max_count)]
