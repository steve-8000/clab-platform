package services

import (
	"os"
	"path/filepath"
	"testing"
)

func createMDFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to create test file %s: %v", name, err)
	}
	return path
}

func TestSearchDocs_FindsMDFilesMatchingKeywords(t *testing.T) {
	dir := t.TempDir()

	createMDFile(t, dir, "architecture.md",
		"This document describes the server architecture and database design patterns used in production.")
	createMDFile(t, dir, "quickstart.md",
		"Getting started guide for new developers joining the team.")

	// "server" and "database" match architecture.md (2 keywords)
	results := SearchDocs([]string{"server", "database", "architecture"}, []string{dir}, 10, 10000)

	if len(results) == 0 {
		t.Fatal("expected at least 1 result, got none")
	}
	if results[0].Path != filepath.Join(dir, "architecture.md") {
		t.Errorf("expected architecture.md to match, got %q", results[0].Path)
	}
}

func TestSearchDocs_Minimum2KeywordsRequired(t *testing.T) {
	dir := t.TempDir()

	createMDFile(t, dir, "single.md",
		"This document only mentions server and nothing else relevant.")

	// Only 1 keyword matches, so it should not qualify
	results := SearchDocs([]string{"server", "quantum", "blockchain"}, []string{dir}, 10, 10000)

	if len(results) != 0 {
		t.Errorf("expected 0 results (only 1 keyword match), got %d", len(results))
	}
}

func TestSearchDocs_MaxResultsRespected(t *testing.T) {
	dir := t.TempDir()

	// Create 5 files that all match 2+ keywords
	for i := 0; i < 5; i++ {
		createMDFile(t, dir, filepath.Base(filepath.Join(dir, string(rune('a'+i))+".md")),
			"This file discusses server architecture and database design.")
	}

	results := SearchDocs([]string{"server", "database"}, []string{dir}, 2, 100000)

	if len(results) > 2 {
		t.Errorf("expected at most 2 results, got %d", len(results))
	}
}

func TestSearchDocs_MaxTotalCharsTrimmed(t *testing.T) {
	dir := t.TempDir()

	// Create a file with long content
	longContent := ""
	for i := 0; i < 100; i++ {
		longContent += "server database design patterns for enterprise applications. "
	}
	createMDFile(t, dir, "long.md", longContent)
	createMDFile(t, dir, "short.md", "server database quick overview.")

	results := SearchDocs([]string{"server", "database"}, []string{dir}, 10, 50)

	totalChars := 0
	for _, r := range results {
		totalChars += len(r.Excerpt)
	}
	if totalChars > 50 {
		t.Errorf("total excerpt chars %d exceeds maxTotalChars 50", totalChars)
	}
}

func TestSearchDocs_SubdirectoryWalk(t *testing.T) {
	dir := t.TempDir()
	subdir := filepath.Join(dir, "docs", "guides")
	if err := os.MkdirAll(subdir, 0o755); err != nil {
		t.Fatal(err)
	}

	createMDFile(t, subdir, "nested.md",
		"This nested document covers server architecture and database optimization.")

	results := SearchDocs([]string{"server", "database"}, []string{dir}, 10, 10000)

	if len(results) == 0 {
		t.Fatal("expected to find nested .md file, got none")
	}
}
