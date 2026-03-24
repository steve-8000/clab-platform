package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/clab/knowledge-server/internal/letta"
	"github.com/clab/knowledge-server/internal/memory"
)

// MemoryHandler exposes the Letta-backed memory gateway.
type MemoryHandler struct {
	client      *letta.Client
	sessions    *memory.SessionStore
	kbStore     *memory.KBStore
	accessToken string
}

// NewMemoryHandler creates a new MemoryHandler.
func NewMemoryHandler(client *letta.Client, sessions *memory.SessionStore, accessToken string) *MemoryHandler {
	return &MemoryHandler{
		client:      client,
		sessions:    sessions,
		accessToken: strings.TrimSpace(accessToken),
	}
}

// SetKBStore attaches the KB store for enriched inject responses.
func (h *MemoryHandler) SetKBStore(store *memory.KBStore) {
	h.kbStore = store
}

type memorySessionRequest struct {
	SessionID string `json:"session_id"`
}

type memoryTranscriptAppendRequest struct {
	SessionID       string `json:"session_id"`
	TurnSummary     string `json:"turnSummary"`
	TranscriptChunk string `json:"transcriptChunk"`
}

type memoryGatewayResponse struct {
	Mode         string   `json:"mode"`
	Message      string   `json:"message"`
	MemoryDiffs  []string `json:"memoryDiffs"`
	ProjectFacts []string `json:"projectFacts"`
	PendingItems []string `json:"pendingItems"`
	Cautions     []string `json:"cautions"`
	VerifiedRefs []string `json:"verifiedRefs"`
}

func decodeSessionID(r *http.Request) (string, error) {
	var req memorySessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return "", err
	}
	return strings.TrimSpace(req.SessionID), nil
}

// RequireAuth enforces the optional bearer token for memory routes.
func (h *MemoryHandler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.accessToken == "" {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		expected := "Bearer " + h.accessToken
		if authHeader != expected {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"ok":    false,
				"error": "unauthorized: invalid or missing bearer token",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (h *MemoryHandler) ensureConfigured(w http.ResponseWriter) bool {
	if h.client != nil && h.sessions != nil && h.client.IsConfigured() {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"ok":    false,
		"error": "memory gateway unavailable: missing LETTA_API_KEY and either LETTA_AGENT_ID or LETTA_MODEL + LETTA_EMBEDDING configuration",
	})
	return false
}

func (h *MemoryHandler) mode() string {
	if h.client != nil && h.client.UsesConversationMode() {
		return "conversation"
	}
	return "blocks"
}

// Health handles GET /v1/memory/health.
func (h *MemoryHandler) Health(w http.ResponseWriter, r *http.Request) {
	if !h.ensureConfigured(w) {
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"status":   "ok",
		"provider": "letta",
		"mode":     h.mode(),
		"agent_id": h.client.AgentID(),
	})
}

// StartSession handles POST /v1/memory/session/start.
func (h *MemoryHandler) StartSession(w http.ResponseWriter, r *http.Request) {
	if !h.ensureConfigured(w) {
		return
	}

	sessionID, err := decodeSessionID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	targetID, err := h.ensureTarget(r.Context(), sessionID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to ensure memory target: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"session_id":      sessionID,
		"conversation_id": targetID,
		"block_id":        targetID,
		"agent_id":        h.client.AgentID(),
		"mode":            h.mode(),
	})
}

// InjectPrompt handles POST /v1/memory/inject/prompt.
func (h *MemoryHandler) InjectPrompt(w http.ResponseWriter, r *http.Request) {
	h.inject(w, r, "prompt")
}

// InjectTool handles POST /v1/memory/inject/tool.
func (h *MemoryHandler) InjectTool(w http.ResponseWriter, r *http.Request) {
	h.inject(w, r, "tool")
}

// AppendTranscript handles POST /v1/memory/transcript/append.
func (h *MemoryHandler) AppendTranscript(w http.ResponseWriter, r *http.Request) {
	if !h.ensureConfigured(w) {
		return
	}

	var req memoryTranscriptAppendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	message := strings.TrimSpace(req.TurnSummary)
	if message == "" {
		message = truncate(strings.TrimSpace(req.TranscriptChunk), 1200)
	}
	if message == "" {
		writeError(w, http.StatusBadRequest, "turnSummary or transcriptChunk is required")
		return
	}

	targetID, err := h.ensureTarget(r.Context(), req.SessionID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to ensure memory target: "+err.Error())
		return
	}

	messageCount := 0
	if h.client.UsesConversationMode() {
		messages, err := h.client.AppendUserMessage(r.Context(), targetID, message)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to append transcript: "+err.Error())
			return
		}
		messageCount = len(messages)
	} else {
		block, err := h.client.RetrieveBlock(r.Context(), targetID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to load memory block: "+err.Error())
			return
		}
		value := strings.TrimSpace(block.Value)
		if value != "" {
			value += "\n"
		}
		value += "- " + message
		updated, err := h.client.UpdateBlock(r.Context(), targetID, truncate(value, 4000))
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to update memory block: "+err.Error())
			return
		}
		if strings.TrimSpace(updated.Value) != "" {
			messageCount = 1
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"session_id":      req.SessionID,
		"conversation_id": targetID,
		"block_id":        targetID,
		"agent_id":        h.client.AgentID(),
		"mode":            h.mode(),
		"appended":        message,
		"message_count":   messageCount,
	})
}

func (h *MemoryHandler) inject(w http.ResponseWriter, r *http.Request, kind string) {
	if !h.ensureConfigured(w) {
		return
	}

	sessionID, err := decodeSessionID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	targetID, err := h.ensureTarget(r.Context(), sessionID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to ensure memory target: "+err.Error())
		return
	}

	summary := "No Letta messages available yet."
	if h.client.UsesConversationMode() {
		messages, err := h.client.ListMessages(r.Context(), targetID)
		if err == nil {
			summary = summarizeLettaMessages(messages)
		}
	} else {
		block, err := h.client.RetrieveBlock(r.Context(), targetID)
		if err == nil && strings.TrimSpace(block.Value) != "" {
			summary = truncate(strings.TrimSpace(block.Value), 300)
		}
	}

	// Enrich with KB data if available
	decisions, patterns, errors_, insights := h.loadKBBlocks(r.Context())

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"session_id":      sessionID,
		"conversation_id": targetID,
		"block_id":        targetID,
		"agent_id":        h.client.AgentID(),
		"mode":            h.mode(),
		"kind":            kind,
		"payload": memoryGatewayResponse{
			Mode:         "whisper",
			Message:      summary,
			MemoryDiffs:  decisions,
			ProjectFacts: patterns,
			PendingItems: []string{},
			Cautions:     errors_,
			VerifiedRefs: insights,
		},
	})
}

func (h *MemoryHandler) ensureTarget(ctx context.Context, sessionID string) (string, error) {
	if targetID, found, err := h.sessions.Get(sessionID); err != nil {
		return "", err
	} else if found && targetID != "" {
		return targetID, nil
	}

	if h.client.UsesConversationMode() {
		conv, err := h.client.CreateConversation(ctx)
		if err != nil {
			return "", err
		}
		if err := h.sessions.Set(sessionID, conv.ID); err != nil {
			return "", err
		}
		return conv.ID, nil
	}

	block, err := h.client.CreateBlock(ctx, "session", "", map[string]any{"session_id": sessionID})
	if err != nil {
		return "", err
	}
	if err := h.sessions.Set(sessionID, block.ID); err != nil {
		return "", err
	}
	return block.ID, nil
}

// loadKBBlocks reads KB category blocks and returns recent items as string slices.
func (h *MemoryHandler) loadKBBlocks(ctx context.Context) (decisions, patterns, errors_, insights []string) {
	decisions = []string{}
	patterns = []string{}
	errors_ = []string{}
	insights = []string{}

	if h.kbStore == nil || h.client == nil {
		return
	}

	readLines := func(category string, maxLines int) []string {
		blockID, found, err := h.kbStore.Get(category)
		if err != nil || !found || blockID == "" {
			return nil
		}
		block, err := h.client.RetrieveBlock(ctx, blockID)
		if err != nil || strings.TrimSpace(block.Value) == "" {
			return nil
		}
		lines := strings.Split(strings.TrimSpace(block.Value), "\n")
		// Take last N lines
		if len(lines) > maxLines {
			lines = lines[len(lines)-maxLines:]
		}
		return lines
	}

	decisions = readLines("decisions", 5)
	patterns = readLines("patterns", 5)
	errors_ = readLines("errors", 3)
	insights = readLines("insights", 3)

	if decisions == nil {
		decisions = []string{}
	}
	if patterns == nil {
		patterns = []string{}
	}
	if errors_ == nil {
		errors_ = []string{}
	}
	if insights == nil {
		insights = []string{}
	}
	return
}

func summarizeLettaMessages(messages []letta.Message) string {
	if len(messages) == 0 {
		return "No Letta messages available yet."
	}

	parts := make([]string, 0, 3)
	for i := len(messages) - 1; i >= 0 && len(parts) < 3; i-- {
		text := extractMessageText(messages[i])
		if text == "" {
			continue
		}
		parts = append(parts, text)
	}
	if len(parts) == 0 {
		return "No Letta messages available yet."
	}

	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return truncate(strings.Join(parts, " | "), 300)
}

func extractMessageText(message letta.Message) string {
	switch content := message.Content.(type) {
	case string:
		return strings.TrimSpace(content)
	case []any:
		parts := make([]string, 0, len(content))
		for _, item := range content {
			if value, ok := item.(map[string]any); ok {
				if text, ok := value["text"].(string); ok && strings.TrimSpace(text) != "" {
					parts = append(parts, strings.TrimSpace(text))
				}
			}
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	case map[string]any:
		if text, ok := content["text"].(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}
