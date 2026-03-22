package services

import (
	"os"
	"path/filepath"
	"testing"
)

func setupDoc(t *testing.T, base, relPath, content string) {
	t.Helper()
	fullPath := filepath.Join(base, relPath)
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create dir %s: %v", dir, err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write %s: %v", fullPath, err)
	}
}

func TestCheckIntegrity_CleanDocPasses(t *testing.T) {
	base := t.TempDir()

	// Create a clean document with ## Related section containing a link
	// and a valid relative link target
	setupDoc(t, base, "docs/guide.md", `# Guide

Some content here.

## Related

- [Other doc](other.md)
`)
	setupDoc(t, base, "docs/other.md", "# Other\nContent here.\n")

	passed, debts := CheckIntegrity([]string{"docs/guide.md"}, base)

	// Filter out orphan_doc debts (those are from the global scan, not from guide.md checks)
	var relevantDebts []string
	for _, d := range debts {
		if d.Type != "orphan_doc" {
			relevantDebts = append(relevantDebts, d.Type+": "+d.Description)
		}
	}

	if len(relevantDebts) > 0 {
		t.Errorf("expected clean doc to have no debts (excluding orphans), got: %v", relevantDebts)
	}
	// Note: passed may be false due to orphan detection on other.md (no hub doc),
	// so we check debts directly instead
	_ = passed
}

func TestCheckIntegrity_MissingRelatedSection(t *testing.T) {
	base := t.TempDir()

	setupDoc(t, base, "docs/norelatd.md", `# Document

Content without a Related section.
`)

	_, debts := CheckIntegrity([]string{"docs/norelatd.md"}, base)

	found := false
	for _, d := range debts {
		if d.Type == "missing_crosslink" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected missing_crosslink debt for doc without ## Related section")
	}
}

func TestCheckIntegrity_BrokenLinks(t *testing.T) {
	base := t.TempDir()

	setupDoc(t, base, "docs/broken.md", `# Document

## Related

- [Missing doc](nonexistent.md)
`)

	_, debts := CheckIntegrity([]string{"docs/broken.md"}, base)

	found := false
	for _, d := range debts {
		if d.Type == "broken_link" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected broken_link debt for link to nonexistent file")
	}
}

func TestCheckIntegrity_StaleFrontmatter(t *testing.T) {
	base := t.TempDir()

	setupDoc(t, base, "docs/stale.md", `---
title: Old Document
status: deprecated
---

# Stale Document

## Related

- [nothing](#)
`)

	_, debts := CheckIntegrity([]string{"docs/stale.md"}, base)

	found := false
	for _, d := range debts {
		if d.Type == "stale_doc" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected stale_doc debt for deprecated frontmatter")
	}
}

func TestCheckIntegrity_OrphanDetection(t *testing.T) {
	base := t.TempDir()

	// Create a hub doc that references guide.md but NOT orphan.md
	setupDoc(t, base, "docs/index.md", `# Docs Hub

- [Guide](guide.md)
`)
	setupDoc(t, base, "docs/guide.md", `# Guide

## Related

- [Hub](index.md)
`)
	setupDoc(t, base, "docs/orphan.md", `# Orphan

## Related

- [Hub](index.md)
`)

	_, debts := CheckIntegrity([]string{"docs/guide.md"}, base)

	found := false
	for _, d := range debts {
		if d.Type == "orphan_doc" && d.Path == filepath.Join("docs", "orphan.md") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected orphan_doc debt for orphan.md not referenced by hub")
	}
}
