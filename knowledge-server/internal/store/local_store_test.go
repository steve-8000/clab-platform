package store

import (
	"fmt"
	"testing"

	"github.com/clab/knowledge-server/internal/types"
)

func newTestStore(t *testing.T) *LocalKnowledgeStore {
	t.Helper()
	dir := t.TempDir()
	s, err := NewLocalKnowledgeStore(dir)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	return s
}

func TestStore_StoreAndRetrieve(t *testing.T) {
	s := newTestStore(t)

	entry := types.KnowledgeEntry{
		ID:         "test-1",
		Topic:      "Go Testing",
		Content:    "Testing in Go is straightforward",
		Tags:       []string{"go", "testing"},
		Source:     "MANUAL",
		Confidence: 1.0,
		CreatedAt:  "2024-01-01T00:00:00Z",
	}

	stored, err := s.Store(entry)
	if err != nil {
		t.Fatalf("Store failed: %v", err)
	}
	if stored.ID != "test-1" {
		t.Errorf("expected ID 'test-1', got %q", stored.ID)
	}

	results, err := s.Search("go testing", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != "test-1" {
		t.Errorf("expected ID 'test-1', got %q", results[0].ID)
	}
}

func TestSearch_Scoring(t *testing.T) {
	s := newTestStore(t)

	// Entry with "api" in topic (score 3), content (score 2), and tag (score 1) = 6
	topicMatch := types.KnowledgeEntry{
		ID:        "topic-match",
		Topic:     "API Design",
		Content:   "api design patterns for rest api",
		Tags:      []string{"api"},
		CreatedAt: "2024-01-01T00:00:00Z",
	}

	// Entry with "api" only in content (score 2)
	contentOnly := types.KnowledgeEntry{
		ID:        "content-only",
		Topic:     "Backend Systems",
		Content:   "building api services",
		Tags:      []string{"backend"},
		CreatedAt: "2024-01-01T00:00:00Z",
	}

	s.Store(topicMatch)
	s.Store(contentOnly)

	results, err := s.Search("api", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) < 2 {
		t.Fatalf("expected at least 2 results, got %d", len(results))
	}

	if results[0].ID != "topic-match" {
		t.Errorf("expected topic-match to rank first, got %q", results[0].ID)
	}
}

func TestSearch_EmptyForNoMatch(t *testing.T) {
	s := newTestStore(t)

	s.Store(types.KnowledgeEntry{
		ID:        "entry-1",
		Topic:     "Go Programming",
		Content:   "Learning Go",
		Tags:      []string{"go"},
		CreatedAt: "2024-01-01T00:00:00Z",
	})

	results, err := s.Search("python django", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results for non-matching query, got %d", len(results))
	}
}

func TestGetByTopic_CaseInsensitive(t *testing.T) {
	s := newTestStore(t)

	s.Store(types.KnowledgeEntry{
		ID:        "entry-1",
		Topic:     "Go Testing",
		Content:   "Unit tests in Go",
		CreatedAt: "2024-01-01T00:00:00Z",
	})

	results, err := s.GetByTopic("go testing")
	if err != nil {
		t.Fatalf("GetByTopic failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for case-insensitive topic, got %d", len(results))
	}

	results, err = s.GetByTopic("GO TESTING")
	if err != nil {
		t.Fatalf("GetByTopic failed: %v", err)
	}
	if len(results) != 1 {
		t.Errorf("expected 1 result for uppercase topic, got %d", len(results))
	}
}

func TestGetByTags_AnyMatch(t *testing.T) {
	s := newTestStore(t)

	s.Store(types.KnowledgeEntry{
		ID:        "entry-go",
		Topic:     "Go",
		Content:   "Go language",
		Tags:      []string{"go", "language"},
		CreatedAt: "2024-01-01T00:00:00Z",
	})
	s.Store(types.KnowledgeEntry{
		ID:        "entry-rust",
		Topic:     "Rust",
		Content:   "Rust language",
		Tags:      []string{"rust", "systems"},
		CreatedAt: "2024-01-01T00:00:00Z",
	})

	results, err := s.GetByTags([]string{"go"})
	if err != nil {
		t.Fatalf("GetByTags failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != "entry-go" {
		t.Errorf("expected entry-go, got %q", results[0].ID)
	}

	// Search for "go" or "rust" should return both
	results, err = s.GetByTags([]string{"go", "rust"})
	if err != nil {
		t.Fatalf("GetByTags failed: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("expected 2 results for any-match, got %d", len(results))
	}
}

func TestStatus_CorrectCounts(t *testing.T) {
	s := newTestStore(t)

	s.Store(types.KnowledgeEntry{
		ID:        "e1",
		Topic:     "Topic A",
		Content:   "content",
		CreatedAt: "2024-01-01T00:00:00Z",
	})
	s.Store(types.KnowledgeEntry{
		ID:        "e2",
		Topic:     "Topic B",
		Content:   "content",
		CreatedAt: "2024-01-02T00:00:00Z",
	})
	s.Store(types.KnowledgeEntry{
		ID:        "e3",
		Topic:     "Topic A",
		Content:   "more content",
		CreatedAt: "2024-01-03T00:00:00Z",
	})

	status, err := s.Status()
	if err != nil {
		t.Fatalf("Status failed: %v", err)
	}

	if status.TotalEntries != 3 {
		t.Errorf("expected 3 total entries, got %d", status.TotalEntries)
	}
	if status.UniqueTopics != 2 {
		t.Errorf("expected 2 unique topics, got %d", status.UniqueTopics)
	}
	if status.LastUpdated != "2024-01-03T00:00:00Z" {
		t.Errorf("expected last updated '2024-01-03T00:00:00Z', got %q", status.LastUpdated)
	}
}

func TestDelete_Works(t *testing.T) {
	s := newTestStore(t)

	s.Store(types.KnowledgeEntry{
		ID:        "to-delete",
		Topic:     "Temp",
		Content:   "temporary",
		CreatedAt: "2024-01-01T00:00:00Z",
	})

	err := s.Delete("to-delete")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	results, err := s.Search("temporary", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results after delete, got %d", len(results))
	}
}

func TestDelete_NonExistent_ReturnsError(t *testing.T) {
	s := newTestStore(t)

	err := s.Delete("does-not-exist")
	if err == nil {
		t.Error("expected error when deleting non-existent entry, got nil")
	}
}

func TestSearch_RespectsLimit(t *testing.T) {
	s := newTestStore(t)

	for i := 0; i < 10; i++ {
		s.Store(types.KnowledgeEntry{
			ID:        fmt.Sprintf("entry-%d", i),
			Topic:     "Common Topic",
			Content:   "common content about testing",
			Tags:      []string{"common"},
			CreatedAt: "2024-01-01T00:00:00Z",
		})
	}

	results, err := s.Search("common", 3)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 3 {
		t.Errorf("expected 3 results with limit=3, got %d", len(results))
	}
}
