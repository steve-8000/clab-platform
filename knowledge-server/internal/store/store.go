// Package store defines the knowledge store interface and implementations.
package store

import "github.com/clab/knowledge-server/internal/types"

// KnowledgeStore is the interface that any knowledge-store backend must satisfy.
type KnowledgeStore interface {
	// Store persists a knowledge entry. Overwrites if the ID already exists.
	Store(entry types.KnowledgeEntry) (types.KnowledgeEntry, error)

	// Search performs keyword search and returns entries ranked by relevance.
	Search(query string, limit int) ([]types.KnowledgeEntry, error)

	// GetByTopic returns entries matching the topic exactly (case-insensitive).
	GetByTopic(topic string) ([]types.KnowledgeEntry, error)

	// GetByTags returns entries matching any of the given tags (case-insensitive).
	GetByTags(tags []string) ([]types.KnowledgeEntry, error)

	// Status returns a summary of the store state.
	Status() (types.StoreStatus, error)

	// Delete removes an entry by ID. Returns an error if not found.
	Delete(id string) error
}
