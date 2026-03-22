package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/clab/knowledge-server/internal/services"
	"github.com/clab/knowledge-server/internal/store"
	"github.com/clab/knowledge-server/internal/types"
)

// InsightsHandler handles insight extraction from task results.
type InsightsHandler struct {
	store store.KnowledgeStore
}

// NewInsightsHandler creates a new InsightsHandler.
func NewInsightsHandler(s store.KnowledgeStore) *InsightsHandler {
	return &InsightsHandler{store: s}
}

// extractRequest is the JSON body for POST /v1/insights/extract.
type extractRequest struct {
	TaskRunID string           `json:"taskRunId"`
	Result    types.TaskResult `json:"result"`
	Context   string           `json:"context"`
}

// insightOutput represents an extracted insight in the response.
type insightOutput struct {
	Type       string   `json:"type"`
	Topic      string   `json:"topic"`
	Content    string   `json:"content"`
	Tags       []string `json:"tags"`
	Confidence float64  `json:"confidence"`
}

// Decision indicator words
var decisionIndicators = []string{
	"decided", "chose", "selected", "opted",
	"switched", "migrated", "replaced", "adopted",
}

// Extract handles POST /v1/insights/extract.
// Logic: extract patterns/decisions/risks -> store as knowledge entries -> return insights.
func (h *InsightsHandler) Extract(w http.ResponseWriter, r *http.Request) {
	var req extractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.TaskRunID == "" {
		writeError(w, http.StatusBadRequest, "taskRunId is required")
		return
	}

	var insights []insightOutput
	combinedText := req.Result.Summary + " " + req.Context

	// Pattern extraction: extract keywords (top 10), if >= 3 -> create pattern insight
	keywords := services.ExtractKeywords(combinedText, 10)
	if len(keywords) >= 3 {
		insight := insightOutput{
			Type:       "pattern",
			Topic:      fmt.Sprintf("pattern:%s", req.TaskRunID),
			Content:    fmt.Sprintf("Detected pattern with keywords: %s", strings.Join(keywords, ", ")),
			Tags:       append([]string{"pattern", "extracted"}, keywords...),
			Confidence: 0.8,
		}
		insights = append(insights, insight)
	}

	// Decision extraction: check for indicator words
	lowerText := strings.ToLower(combinedText)
	for _, indicator := range decisionIndicators {
		if strings.Contains(lowerText, indicator) {
			insight := insightOutput{
				Type:       "decision",
				Topic:      fmt.Sprintf("decision:%s", req.TaskRunID),
				Content:    fmt.Sprintf("Decision detected (indicator: '%s') in task output: %s", indicator, truncate(combinedText, 200)),
				Tags:       []string{"decision", "extracted", indicator},
				Confidence: 0.8,
			}
			insights = append(insights, insight)
			break // only one decision insight per extraction
		}
	}

	// Risk extraction: if result.risks is non-empty -> create risk insight
	if len(req.Result.Risks) > 0 {
		insight := insightOutput{
			Type:       "risk",
			Topic:      fmt.Sprintf("risk:%s", req.TaskRunID),
			Content:    fmt.Sprintf("Risks identified: %s", strings.Join(req.Result.Risks, "; ")),
			Tags:       append([]string{"risk", "extracted"}, req.Result.Risks...),
			Confidence: 0.8,
		}
		insights = append(insights, insight)
	}

	// Store each insight as EXTRACTED knowledge entry with confidence 0.8
	now := time.Now().UTC().Format(time.RFC3339)
	storedCount := 0
	for _, insight := range insights {
		entry := types.KnowledgeEntry{
			ID:         newUUID(),
			Topic:      insight.Topic,
			Content:    insight.Content,
			Tags:       insight.Tags,
			Source:     "EXTRACTED",
			Confidence: insight.Confidence,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		_, err := h.store.Store(entry)
		if err == nil {
			storedCount++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"insights":  insights,
		"stored":    storedCount,
		"taskRunId": req.TaskRunID,
	})
}

// truncate shortens a string to maxLen characters.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
