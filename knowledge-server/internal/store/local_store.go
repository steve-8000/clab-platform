package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/clab/knowledge-server/internal/types"
)

// LocalKnowledgeStore is a file-based JSON implementation of KnowledgeStore.
// Each entry is stored as {id}.json in the configured directory.
type LocalKnowledgeStore struct {
	dir string
	mu  sync.RWMutex
}

// NewLocalKnowledgeStore creates a new LocalKnowledgeStore backed by the given directory.
// The directory is created if it does not exist.
func NewLocalKnowledgeStore(directory string) (*LocalKnowledgeStore, error) {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return nil, fmt.Errorf("create store directory: %w", err)
	}
	return &LocalKnowledgeStore{dir: directory}, nil
}

func (s *LocalKnowledgeStore) entryPath(id string) string {
	return filepath.Join(s.dir, id+".json")
}

func (s *LocalKnowledgeStore) readEntry(path string) (types.KnowledgeEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return types.KnowledgeEntry{}, err
	}
	var entry types.KnowledgeEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return types.KnowledgeEntry{}, fmt.Errorf("parse %s: %w", path, err)
	}
	return entry, nil
}

func (s *LocalKnowledgeStore) readAll() ([]types.KnowledgeEntry, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var result []types.KnowledgeEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		entry, err := s.readEntry(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue // skip unreadable entries
		}
		result = append(result, entry)
	}
	return result, nil
}

// Store persists a knowledge entry as {id}.json. Overwrites if exists.
func (s *LocalKnowledgeStore) Store(entry types.KnowledgeEntry) (types.KnowledgeEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return types.KnowledgeEntry{}, fmt.Errorf("marshal entry: %w", err)
	}
	if err := os.WriteFile(s.entryPath(entry.ID), data, 0o644); err != nil {
		return types.KnowledgeEntry{}, fmt.Errorf("write entry: %w", err)
	}
	return entry, nil
}

// Search performs keyword search with scoring: topic=3, content=2, tag=1.
// Results are sorted by score descending and limited to the given count.
func (s *LocalKnowledgeStore) Search(query string, limit int) ([]types.KnowledgeEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	terms := strings.Fields(strings.ToLower(query))
	if len(terms) == 0 {
		return nil, nil
	}

	all, err := s.readAll()
	if err != nil {
		return nil, err
	}

	type scored struct {
		score float64
		entry types.KnowledgeEntry
	}
	var results []scored

	for _, entry := range all {
		var score float64
		topicLower := strings.ToLower(entry.Topic)
		contentLower := strings.ToLower(entry.Content)
		tagsLower := make([]string, len(entry.Tags))
		for i, t := range entry.Tags {
			tagsLower[i] = strings.ToLower(t)
		}

		for _, term := range terms {
			if strings.Contains(topicLower, term) {
				score += 3
			}
			if strings.Contains(contentLower, term) {
				score += 2
			}
			for _, tag := range tagsLower {
				if strings.Contains(tag, term) {
					score += 1
					break
				}
			}
		}

		if score > 0 {
			results = append(results, scored{score: score, entry: entry})
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].score > results[j].score
	})

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	out := make([]types.KnowledgeEntry, len(results))
	for i, r := range results {
		out[i] = r.entry
	}
	return out, nil
}

// GetByTopic returns entries matching the topic exactly (case-insensitive).
func (s *LocalKnowledgeStore) GetByTopic(topic string) ([]types.KnowledgeEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	all, err := s.readAll()
	if err != nil {
		return nil, err
	}

	topicLower := strings.ToLower(topic)
	var result []types.KnowledgeEntry
	for _, e := range all {
		if strings.ToLower(e.Topic) == topicLower {
			result = append(result, e)
		}
	}
	return result, nil
}

// GetByTags returns entries matching any of the given tags (case-insensitive).
func (s *LocalKnowledgeStore) GetByTags(tags []string) ([]types.KnowledgeEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	all, err := s.readAll()
	if err != nil {
		return nil, err
	}

	tagSet := make(map[string]struct{}, len(tags))
	for _, t := range tags {
		tagSet[strings.ToLower(t)] = struct{}{}
	}

	var result []types.KnowledgeEntry
	for _, e := range all {
		for _, t := range e.Tags {
			if _, ok := tagSet[strings.ToLower(t)]; ok {
				result = append(result, e)
				break
			}
		}
	}
	return result, nil
}

// Status returns total entries, unique topics, and last updated timestamp.
func (s *LocalKnowledgeStore) Status() (types.StoreStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	all, err := s.readAll()
	if err != nil {
		return types.StoreStatus{}, err
	}

	if len(all) == 0 {
		return types.StoreStatus{}, nil
	}

	topics := make(map[string]struct{})
	var lastUpdated string
	for _, e := range all {
		topics[e.Topic] = struct{}{}
		ts := e.UpdatedAt
		if ts == "" {
			ts = e.CreatedAt
		}
		if ts > lastUpdated {
			lastUpdated = ts
		}
	}

	return types.StoreStatus{
		TotalEntries: len(all),
		UniqueTopics: len(topics),
		LastUpdated:  lastUpdated,
	}, nil
}

// Delete removes an entry by ID. Returns an error if not found.
func (s *LocalKnowledgeStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := s.entryPath(id)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("entry not found: %s", id)
	}
	return os.Remove(path)
}
