package memory

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// SessionStore persists session-to-conversation mappings in a local JSON file.
type SessionStore struct {
	path string
	mu   sync.Mutex
}

// NewSessionStore creates a file-backed session store in the given directory.
func NewSessionStore(dir string) (*SessionStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create memory store dir: %w", err)
	}
	return &SessionStore{
		path: filepath.Join(dir, "memory-sessions.json"),
	}, nil
}

// Get returns the conversation ID for a session, if present.
func (s *SessionStore) Get(sessionID string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	mappings, err := s.read()
	if err != nil {
		return "", false, err
	}
	conversationID, ok := mappings[sessionID]
	return conversationID, ok, nil
}

// Set stores the conversation ID for a session.
func (s *SessionStore) Set(sessionID, conversationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	mappings, err := s.read()
	if err != nil {
		return err
	}
	mappings[sessionID] = conversationID
	return s.write(mappings)
}

func (s *SessionStore) read() (map[string]string, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read memory session store: %w", err)
	}
	if len(data) == 0 {
		return map[string]string{}, nil
	}

	var mappings map[string]string
	if err := json.Unmarshal(data, &mappings); err != nil {
		return nil, fmt.Errorf("parse memory session store: %w", err)
	}
	if mappings == nil {
		mappings = map[string]string{}
	}
	return mappings, nil
}

func (s *SessionStore) write(mappings map[string]string) error {
	data, err := json.MarshalIndent(mappings, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal memory session store: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return fmt.Errorf("write memory session store: %w", err)
	}
	return nil
}
