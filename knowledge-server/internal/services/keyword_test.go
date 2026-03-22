package services

import (
	"strings"
	"testing"
)

func TestExtractKeywords_Basic(t *testing.T) {
	text := "Golang testing framework provides excellent tooling for developers"
	keywords := ExtractKeywords(text, 10)

	if len(keywords) == 0 {
		t.Fatal("expected at least one keyword, got none")
	}

	found := false
	for _, kw := range keywords {
		if kw == "golang" || kw == "testing" || kw == "framework" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected meaningful keywords, got: %v", keywords)
	}
}

func TestExtractKeywords_StopwordFiltering(t *testing.T) {
	text := "the quick brown fox is a very fast animal and it was running"
	keywords := ExtractKeywords(text, 20)

	stopwordList := []string{"the", "is", "and", "was"}
	for _, sw := range stopwordList {
		for _, kw := range keywords {
			if kw == sw {
				t.Errorf("stopword %q should have been filtered out, but found in keywords: %v", sw, keywords)
			}
		}
	}
}

func TestExtractKeywords_ShortWordFiltering(t *testing.T) {
	text := "go is an ok language to use"
	keywords := ExtractKeywords(text, 20)

	for _, kw := range keywords {
		if len(kw) < 3 {
			t.Errorf("keyword %q has fewer than 3 chars, should have been filtered", kw)
		}
	}
}

func TestExtractKeywords_MaxCountLimit(t *testing.T) {
	text := "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima"
	keywords := ExtractKeywords(text, 3)

	if len(keywords) > 3 {
		t.Errorf("expected at most 3 keywords, got %d: %v", len(keywords), keywords)
	}
}

func TestExtractKeywords_EmptyText(t *testing.T) {
	keywords := ExtractKeywords("", 10)
	if len(keywords) != 0 {
		t.Errorf("expected empty result for empty text, got: %v", keywords)
	}
}

func TestExtractKeywords_FrequencyOrdering(t *testing.T) {
	// "server" appears 4 times, "database" 3 times, "client" 2 times, "network" 1 time
	text := "server database client server database server client server database network"
	keywords := ExtractKeywords(text, 10)

	if len(keywords) < 4 {
		t.Fatalf("expected at least 4 keywords, got %d: %v", len(keywords), keywords)
	}

	if keywords[0] != "server" {
		t.Errorf("expected first keyword to be 'server', got %q", keywords[0])
	}

	if keywords[1] != "database" {
		t.Errorf("expected second keyword to be 'database', got %q", keywords[1])
	}

	if keywords[2] != "client" {
		t.Errorf("expected third keyword to be 'client', got %q", keywords[2])
	}
}

func TestExtractKeywords_NonAlphanumericStripped(t *testing.T) {
	text := "Hello, World! This is a test-driven approach (using Go)."
	keywords := ExtractKeywords(text, 10)

	for _, kw := range keywords {
		if strings.ContainsAny(kw, ".,!()-") {
			t.Errorf("keyword %q contains non-alphanumeric characters", kw)
		}
	}
}
