package memory

import (
	"path/filepath"
	"testing"
)

func TestSessionStorePersistsMappings(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSessionStore(dir)
	if err != nil {
		t.Fatalf("NewSessionStore failed: %v", err)
	}

	if err := store.Set("session-a", "conversation-1"); err != nil {
		t.Fatalf("Set failed: %v", err)
	}

	conversationID, ok, err := store.Get("session-a")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if !ok {
		t.Fatal("expected session mapping to exist")
	}
	if conversationID != "conversation-1" {
		t.Fatalf("expected conversation-1, got %q", conversationID)
	}

	reloaded, err := NewSessionStore(filepath.Clean(dir))
	if err != nil {
		t.Fatalf("reloading store failed: %v", err)
	}
	conversationID, ok, err = reloaded.Get("session-a")
	if err != nil {
		t.Fatalf("reloaded Get failed: %v", err)
	}
	if !ok || conversationID != "conversation-1" {
		t.Fatalf("expected persisted mapping, got %q ok=%v", conversationID, ok)
	}
}
