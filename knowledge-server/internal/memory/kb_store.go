package memory

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// KBStore persists category → Letta block ID mappings for the Knowledge Base.
type KBStore struct {
	path string
	mu   sync.Mutex
}

// NewKBStore creates a file-backed KB store in the given directory.
func NewKBStore(dir string) (*KBStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create kb store dir: %w", err)
	}
	return &KBStore{
		path: filepath.Join(dir, "kb-blocks.json"),
	}, nil
}

// Get returns the block ID for a category, if present.
func (s *KBStore) Get(category string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	mappings, err := s.read()
	if err != nil {
		return "", false, err
	}
	blockID, ok := mappings[category]
	return blockID, ok, nil
}

// Set stores the block ID for a category.
func (s *KBStore) Set(category, blockID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	mappings, err := s.read()
	if err != nil {
		return err
	}
	mappings[category] = blockID
	return s.write(mappings)
}

// All returns all category → block ID mappings.
func (s *KBStore) All() (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *KBStore) read() (map[string]string, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read kb store: %w", err)
	}
	if len(data) == 0 {
		return map[string]string{}, nil
	}
	var mappings map[string]string
	if err := json.Unmarshal(data, &mappings); err != nil {
		return nil, fmt.Errorf("parse kb store: %w", err)
	}
	if mappings == nil {
		mappings = map[string]string{}
	}
	return mappings, nil
}

func (s *KBStore) write(mappings map[string]string) error {
	data, err := json.MarshalIndent(mappings, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal kb store: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return fmt.Errorf("write kb store: %w", err)
	}
	return nil
}
