package handlers

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/clab/knowledge-server/internal/store"
	"github.com/clab/knowledge-server/internal/types"
	"github.com/go-chi/chi/v5"
)

// newUUID generates a random UUID v4 string.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// KnowledgeHandler handles CRUD operations for knowledge entries.
type KnowledgeHandler struct {
	store store.KnowledgeStore
}

// NewKnowledgeHandler creates a new KnowledgeHandler.
func NewKnowledgeHandler(s store.KnowledgeStore) *KnowledgeHandler {
	return &KnowledgeHandler{store: s}
}

// storeRequest is the JSON body for POST /v1/knowledge.
type storeRequest struct {
	Topic      string   `json:"topic"`
	Content    string   `json:"content"`
	Tags       []string `json:"tags,omitempty"`
	Source     string   `json:"source,omitempty"`
	Confidence float64  `json:"confidence,omitempty"`
	MissionID  string   `json:"mission_id,omitempty"`
}

// Store handles POST /v1/knowledge — store a new knowledge entry.
func (h *KnowledgeHandler) Store(w http.ResponseWriter, r *http.Request) {
	var req storeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Topic == "" || req.Content == "" {
		writeError(w, http.StatusBadRequest, "topic and content are required")
		return
	}

	if req.Confidence == 0 {
		req.Confidence = 1.0
	}

	now := time.Now().UTC().Format(time.RFC3339)

	entry := types.KnowledgeEntry{
		ID:         newUUID(),
		Topic:      req.Topic,
		Content:    req.Content,
		Tags:       req.Tags,
		Source:     req.Source,
		Confidence: req.Confidence,
		MissionID:  req.MissionID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	stored, err := h.store.Store(entry)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store entry: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"ok":    true,
		"entry": stored,
	})
}

// Search handles GET /v1/knowledge/search?q=...&limit=N
func (h *KnowledgeHandler) Search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	limit := 20 // default limit

	results, err := h.store.Search(query, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"results": results,
		"count":   len(results),
	})
}

// GetByTopic handles GET /v1/knowledge/topic/{topic}
func (h *KnowledgeHandler) GetByTopic(w http.ResponseWriter, r *http.Request) {
	topic := chi.URLParam(r, "topic")
	if topic == "" {
		writeError(w, http.StatusBadRequest, "topic parameter is required")
		return
	}

	entries, err := h.store.GetByTopic(topic)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get entries: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"results": entries,
		"count":   len(entries),
	})
}

// GetByTags handles GET /v1/knowledge/tags?tags=a,b,c
func (h *KnowledgeHandler) GetByTags(w http.ResponseWriter, r *http.Request) {
	tagsParam := r.URL.Query().Get("tags")
	if tagsParam == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'tags' is required")
		return
	}

	tags := strings.Split(tagsParam, ",")
	for i := range tags {
		tags[i] = strings.TrimSpace(tags[i])
	}

	entries, err := h.store.GetByTags(tags)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get entries: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"results": entries,
		"count":   len(entries),
	})
}

// Status handles GET /v1/knowledge/status — store stats.
func (h *KnowledgeHandler) Status(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.Status()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get status: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"stats": stats,
	})
}

// Delete handles DELETE /v1/knowledge/{id}
func (h *KnowledgeHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id parameter is required")
		return
	}

	err := h.store.Delete(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete entry: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"deleted": id,
	})
}
