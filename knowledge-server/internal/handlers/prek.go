package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/clab/knowledge-server/internal/services"
	"github.com/clab/knowledge-server/internal/store"
)

// PreKHandler handles pre-knowledge retrieval requests.
type PreKHandler struct {
	store store.KnowledgeStore
}

// NewPreKHandler creates a new PreKHandler.
func NewPreKHandler(s store.KnowledgeStore) *PreKHandler {
	return &PreKHandler{store: s}
}

// retrieveRequest is the JSON body for POST /v1/pre-k/retrieve.
type retrieveRequest struct {
	Task   string   `json:"task"`
	RoleID string   `json:"roleId"`
	Scope  []string `json:"scope,omitempty"`
}

// Retrieve handles POST /v1/pre-k/retrieve.
// Logic: extract keywords -> search store -> search docs -> assemble result.
func (h *PreKHandler) Retrieve(w http.ResponseWriter, r *http.Request) {
	var req retrieveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Task == "" {
		writeError(w, http.StatusBadRequest, "task is required")
		return
	}

	// Step 1: Extract keywords from task description (top 10)
	keywords := services.ExtractKeywords(req.Task, 10)

	// Step 2: Search knowledge store with each keyword
	var storeResults []map[string]any
	seen := make(map[string]bool)
	for _, kw := range keywords {
		entries, err := h.store.Search(kw, 10)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if seen[e.ID] {
				continue
			}
			seen[e.ID] = true
			storeResults = append(storeResults, map[string]any{
				"id":         e.ID,
				"topic":      e.Topic,
				"content":    e.Content,
				"tags":       e.Tags,
				"source":     e.Source,
				"confidence": e.Confidence,
			})
		}
	}

	// Step 3: Search docs if scope is provided
	var docResults []map[string]any
	if len(req.Scope) > 0 {
		docs := services.SearchDocs(keywords, req.Scope, 10, 8000)
		for _, d := range docs {
			docResults = append(docResults, map[string]any{
				"path":             d.Path,
				"relevance_score":  d.RelevanceScore,
				"excerpt":          d.Excerpt,
				"matched_keywords": d.MatchedKeywords,
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"keywords":  keywords,
		"knowledge": storeResults,
		"docs":      docResults,
		"count":     len(storeResults) + len(docResults),
	})
}
