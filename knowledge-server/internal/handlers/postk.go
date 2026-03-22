package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/clab/knowledge-server/internal/services"
	"github.com/clab/knowledge-server/internal/types"
)

// PostKHandler handles post-knowledge integrity checks.
type PostKHandler struct{}

// NewPostKHandler creates a new PostKHandler.
func NewPostKHandler() *PostKHandler {
	return &PostKHandler{}
}

// checkRequest is the JSON body for POST /v1/post-k/check.
type checkRequest struct {
	ModifiedDocs []string `json:"modifiedDocs"`
	BasePath     string   `json:"basePath,omitempty"`
	MissionID    string   `json:"missionId,omitempty"`
}

// Check handles POST /v1/post-k/check.
// Logic: run integrity check -> build summary -> return debt report.
func (h *PostKHandler) Check(w http.ResponseWriter, r *http.Request) {
	var req checkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if len(req.ModifiedDocs) == 0 {
		writeError(w, http.StatusBadRequest, "modifiedDocs is required and must not be empty")
		return
	}

	basePath := req.BasePath
	if basePath == "" {
		basePath = "."
	}

	// Run integrity checks on modified docs
	passed, debts := services.CheckIntegrity(req.ModifiedDocs, basePath)

	// Build summary counts
	summary := types.DebtSummary{Total: len(debts)}
	for _, d := range debts {
		switch d.Type {
		case "missing_crosslink":
			summary.MissingCrosslinks++
		case "missing_hub":
			summary.MissingHub++
		case "orphan_doc":
			summary.OrphanDocs++
		case "broken_link":
			summary.BrokenLinks++
		case "stale_doc":
			summary.StaleDocs++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"passed":     passed,
		"debts":      debts,
		"summary":    summary,
		"mission_id": req.MissionID,
	})
}
