package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/clab/knowledge-server/internal/letta"
	"github.com/clab/knowledge-server/internal/memory"
)

// KBHandler exposes Knowledge Base endpoints backed by Letta blocks + archival memory.
type KBHandler struct {
	client *letta.Client
	store  *memory.KBStore
}

// NewKBHandler creates a new KBHandler.
func NewKBHandler(client *letta.Client, store *memory.KBStore) *KBHandler {
	return &KBHandler{client: client, store: store}
}

// Categories used for KB blocks.
var kbCategories = []string{"decisions", "patterns", "errors", "insights", "summary"}

const maxBlockValue = 4000

// --- Request/Response types ---

type kbItem struct {
	What    string `json:"what,omitempty"`
	Why     string `json:"why,omitempty"`
	Pattern string `json:"pattern,omitempty"`
	Context string `json:"context,omitempty"`
	Error   string `json:"error,omitempty"`
	Fix     string `json:"fix,omitempty"`
	Insight string `json:"insight,omitempty"`
	Project string `json:"project,omitempty"`
}

func (item kbItem) text() string {
	parts := []string{}
	for _, s := range []string{item.What, item.Pattern, item.Error, item.Insight} {
		if s != "" {
			parts = append(parts, s)
			break
		}
	}
	for _, s := range []string{item.Why, item.Context, item.Fix} {
		if s != "" {
			parts = append(parts, s)
			break
		}
	}
	if item.Project != "" {
		parts = append(parts, "("+item.Project+")")
	}
	return strings.Join(parts, " — ")
}

type kbIngestRequest struct {
	SessionID string   `json:"session_id"`
	Timestamp string   `json:"timestamp"`
	Summary   string   `json:"summary"`
	Decisions []kbItem `json:"decisions"`
	Patterns  []kbItem `json:"patterns"`
	Errors    []kbItem `json:"errors"`
	Insights  []kbItem `json:"insights"`
}

// Ingest handles POST /v1/memory/kb/ingest.
func (h *KBHandler) Ingest(w http.ResponseWriter, r *http.Request) {
	var req kbIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	agentID := h.client.AgentID()
	ctx := r.Context()
	archivalCount := 0

	// Update category blocks and insert archival entries
	categoryItems := map[string][]kbItem{
		"decisions": req.Decisions,
		"patterns":  req.Patterns,
		"errors":    req.Errors,
		"insights":  req.Insights,
	}

	for category, items := range categoryItems {
		if len(items) == 0 {
			continue
		}

		// Append to category block (rolling window)
		var lines []string
		for _, item := range items {
			lines = append(lines, "- "+item.text())
		}
		newText := strings.Join(lines, "\n")

		if err := h.appendToBlock(ctx, category, newText); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to update %s block: %v", category, err))
			return
		}

		// Insert each item into archival memory
		if agentID != "" {
			for _, item := range items {
				text := fmt.Sprintf("[%s] %s", category, item.text())
				meta := map[string]any{
					"category":   category,
					"session_id": req.SessionID,
					"timestamp":  req.Timestamp,
				}
				if item.Project != "" {
					meta["project"] = item.Project
				}
				if _, err := h.client.InsertArchival(ctx, agentID, text, meta); err == nil {
					archivalCount++
				}
			}
		}
	}

	// Update summary block
	if req.Summary != "" {
		summaryLine := fmt.Sprintf("[%s] %s", req.Timestamp, req.Summary)
		if err := h.appendToBlock(ctx, "summary", summaryLine); err != nil {
			writeError(w, http.StatusBadGateway, "failed to update summary block: "+err.Error())
			return
		}

		// Insert summary into archival
		if agentID != "" {
			h.client.InsertArchival(ctx, agentID, "[summary] "+req.Summary, map[string]any{
				"category":   "summary",
				"session_id": req.SessionID,
				"timestamp":  req.Timestamp,
			})
			archivalCount++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"session_id":     req.SessionID,
		"archival_count": archivalCount,
	})
}

// Browse handles GET /v1/memory/kb/browse?category=.
func (h *KBHandler) Browse(w http.ResponseWriter, r *http.Request) {
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	ctx := r.Context()

	if category != "" {
		// Single category
		value, err := h.readBlock(ctx, category)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to read block: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"category": category,
			"content":  value,
		})
		return
	}

	// All categories
	result := map[string]string{}
	for _, cat := range kbCategories {
		value, err := h.readBlock(ctx, cat)
		if err == nil {
			result[cat] = value
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"categories": result,
	})
}

// Search handles GET /v1/memory/kb/search?q=.
func (h *KBHandler) Search(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeError(w, http.StatusBadRequest, "q parameter is required")
		return
	}

	agentID := h.client.AgentID()
	if agentID == "" {
		writeError(w, http.StatusServiceUnavailable, "archival search requires an agent")
		return
	}

	entries, err := h.client.SearchArchival(r.Context(), agentID, query, 20)
	if err != nil {
		writeError(w, http.StatusBadGateway, "archival search failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"query":   query,
		"results": entries,
		"count":   len(entries),
	})
}

// Timeline handles GET /v1/memory/kb/timeline.
func (h *KBHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	value, err := h.readBlock(r.Context(), "summary")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"sessions": []string{},
		})
		return
	}

	lines := strings.Split(strings.TrimSpace(value), "\n")
	// Reverse to show most recent first
	for i, j := 0, len(lines)-1; i < j; i, j = i+1, j-1 {
		lines[i], lines[j] = lines[j], lines[i]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"sessions": lines,
	})
}

// --- Block helpers ---

func (h *KBHandler) ensureBlock(ctx context.Context, category string) (string, error) {
	blockID, found, err := h.store.Get(category)
	if err != nil {
		return "", err
	}
	if found && blockID != "" {
		return blockID, nil
	}

	block, err := h.client.CreateBlock(ctx, "kb:"+category, "", map[string]any{
		"category": category,
		"type":     "kb",
	})
	if err != nil {
		return "", err
	}
	if err := h.store.Set(category, block.ID); err != nil {
		return "", err
	}
	return block.ID, nil
}

func (h *KBHandler) readBlock(ctx context.Context, category string) (string, error) {
	blockID, found, err := h.store.Get(category)
	if err != nil {
		return "", err
	}
	if !found || blockID == "" {
		return "", nil
	}
	block, err := h.client.RetrieveBlock(ctx, blockID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(block.Value), nil
}

func (h *KBHandler) appendToBlock(ctx context.Context, category, text string) error {
	blockID, err := h.ensureBlock(ctx, category)
	if err != nil {
		return err
	}

	block, err := h.client.RetrieveBlock(ctx, blockID)
	if err != nil {
		return err
	}

	value := strings.TrimSpace(block.Value)
	if value != "" {
		value += "\n"
	}
	value += text

	// Rolling window: trim from start if too long
	for len(value) > maxBlockValue {
		idx := strings.Index(value, "\n")
		if idx < 0 {
			value = value[len(value)-maxBlockValue:]
			break
		}
		value = value[idx+1:]
	}

	_, err = h.client.UpdateBlock(ctx, blockID, value)
	return err
}
