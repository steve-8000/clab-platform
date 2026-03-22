// Package services implements knowledge-layer business logic.
package services

import (
	"regexp"
	"sort"
	"strings"
)

// stopwords is the set of common English words to filter out during keyword extraction.
var stopwords = map[string]struct{}{
	"the": {}, "is": {}, "are": {}, "was": {}, "were": {}, "be": {}, "been": {}, "being": {},
	"have": {}, "has": {}, "had": {}, "do": {}, "does": {}, "did": {},
	"will": {}, "would": {}, "could": {}, "should": {}, "may": {}, "might": {}, "shall": {}, "can": {},
	"a": {}, "an": {}, "and": {}, "or": {}, "but": {},
	"in": {}, "on": {}, "at": {}, "to": {}, "for": {}, "of": {}, "with": {}, "by": {}, "from": {},
	"as": {}, "into": {}, "through": {}, "during": {}, "before": {}, "after": {},
	"this": {}, "that": {}, "these": {}, "those": {}, "it": {}, "its": {},
}

// nonAlphanumeric matches anything that is not a lowercase letter, digit, or whitespace.
var nonAlphanumeric = regexp.MustCompile(`[^a-z0-9\s]`)

// ExtractKeywords returns the maxCount most frequent non-stopword tokens (>= 3 chars).
func ExtractKeywords(text string, maxCount int) []string {
	cleaned := nonAlphanumeric.ReplaceAllString(strings.ToLower(text), "")
	words := strings.Fields(cleaned)

	freq := make(map[string]int)
	for _, w := range words {
		if len(w) < 3 {
			continue
		}
		if _, ok := stopwords[w]; ok {
			continue
		}
		freq[w]++
	}

	type wordCount struct {
		word  string
		count int
	}
	ranked := make([]wordCount, 0, len(freq))
	for w, c := range freq {
		ranked = append(ranked, wordCount{word: w, count: c})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].count != ranked[j].count {
			return ranked[i].count > ranked[j].count
		}
		return ranked[i].word < ranked[j].word // stable tie-break
	})

	if maxCount > 0 && len(ranked) > maxCount {
		ranked = ranked[:maxCount]
	}

	result := make([]string, len(ranked))
	for i, wc := range ranked {
		result[i] = wc.word
	}
	return result
}
