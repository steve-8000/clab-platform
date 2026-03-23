package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clab/knowledge-server/internal/letta"
	"github.com/clab/knowledge-server/internal/memory"
	"github.com/go-chi/chi/v5"
)

func setupMemoryRouter(t *testing.T, serverURL, memoryAPIKey, lettaAPIKey, lettaAgentID, lettaModel, lettaEmbedding, lettaAgentName string) http.Handler {
	t.Helper()

	sessionStore, err := memory.NewSessionStore(t.TempDir())
	if err != nil {
		t.Fatalf("failed to create session store: %v", err)
	}

	handler := NewMemoryHandler(letta.NewClient(letta.Config{
		BaseURL:   serverURL,
		APIKey:    lettaAPIKey,
		AgentID:   lettaAgentID,
		Model:     lettaModel,
		Embedding: lettaEmbedding,
		AgentName: lettaAgentName,
	}), sessionStore, memoryAPIKey)

	r := chi.NewRouter()
	r.Route("/v1/memory", func(r chi.Router) {
		r.Use(handler.RequireAuth)
		r.Get("/health", handler.Health)
		r.Post("/session/start", handler.StartSession)
		r.Post("/inject/prompt", handler.InjectPrompt)
		r.Post("/inject/tool", handler.InjectTool)
		r.Post("/transcript/append", handler.AppendTranscript)
	})
	return r
}

func TestMemoryHealthReturns503WhenLettaConfigMissing(t *testing.T) {
	router := setupMemoryRouter(t, "http://example.com", "", "", "", "", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/memory/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestMemoryRoutesRequireBearerTokenWhenConfigured(t *testing.T) {
	router := setupMemoryRouter(t, "http://example.com", "secret-token", "letta-key", "agent-1", "", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/memory/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestStartSessionCreatesAndReusesConversation(t *testing.T) {
	createCalls := 0
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/conversations/" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		createCalls++
		writeJSON(w, http.StatusOK, map[string]any{
			"id":       "conv-123",
			"agent_id": "agent-1",
		})
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "agent-1", "", "", "")
	body, _ := json.Marshal(map[string]any{"session_id": "session-1"})

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/memory/session/start", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	}

	if createCalls != 1 {
		t.Fatalf("expected 1 create call, got %d", createCalls)
	}
}

func TestStartSessionCreatesAgentWhenAgentIDMissing(t *testing.T) {
	createAgentCalls := 0
	createConversationCalls := 0
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/agents" && r.Method == http.MethodPost:
			createAgentCalls++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("failed decoding create-agent body: %v", err)
			}
			if body["model"] != "gpt-4.1-mini" {
				t.Fatalf("expected model gpt-4.1-mini, got %v", body["model"])
			}
			if body["embedding"] != "text-embedding-3-small" {
				t.Fatalf("expected embedding text-embedding-3-small, got %v", body["embedding"])
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"id": "agent-auto",
			})
		case r.URL.Path == "/v1/conversations/" && r.Method == http.MethodPost:
			createConversationCalls++
			if got := r.URL.Query().Get("agent_id"); got != "agent-auto" {
				t.Fatalf("expected conversation query agent-auto, got %q", got)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"id":       "conv-auto",
				"agent_id": "agent-auto",
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "", "gpt-4.1-mini", "text-embedding-3-small", "memory-bootstrap")
	body, _ := json.Marshal(map[string]any{"session_id": "session-auto"})

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/memory/session/start", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	}

	if createAgentCalls != 1 {
		t.Fatalf("expected 1 create-agent call, got %d", createAgentCalls)
	}
	if createConversationCalls != 1 {
		t.Fatalf("expected 1 create-conversation call, got %d", createConversationCalls)
	}
}

func TestAppendTranscriptUsesTurnSummaryAndForwardsMessage(t *testing.T) {
	var appendedBody map[string]any
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/conversations/" && r.Method == http.MethodPost:
			writeJSON(w, http.StatusOK, map[string]any{
				"id":       "conv-append",
				"agent_id": "agent-1",
			})
		case r.URL.Path == "/v1/conversations/conv-append/messages" && r.Method == http.MethodPost:
			if err := json.NewDecoder(r.Body).Decode(&appendedBody); err != nil {
				t.Fatalf("failed decoding append body: %v", err)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"messages": []map[string]any{
					{"role": "user", "content": "short summary"},
				},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "agent-1", "", "", "")
	body, _ := json.Marshal(map[string]any{
		"session_id":      "session-2",
		"turnSummary":     "short summary",
		"transcriptChunk": "this should not be preferred",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/memory/transcript/append", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	messages := appendedBody["messages"].([]any)
	first := messages[0].(map[string]any)
	if first["content"].(string) != "short summary" {
		t.Fatalf("expected turnSummary to be forwarded, got %v", first["content"])
	}
}

func TestInjectPromptReturnsWhisperPayload(t *testing.T) {
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/conversations/" && r.Method == http.MethodPost:
			writeJSON(w, http.StatusOK, map[string]any{
				"id":       "conv-inject",
				"agent_id": "agent-1",
			})
		case r.URL.Path == "/v1/conversations/conv-inject/messages" && r.Method == http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{
				"messages": []map[string]any{
					{"role": "assistant", "content": "Remember the deployment note."},
				},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "agent-1", "", "", "")
	body, _ := json.Marshal(map[string]any{"session_id": "session-3"})

	req := httptest.NewRequest(http.MethodPost, "/v1/memory/inject/prompt", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payload := resp["payload"].(map[string]any)
	if payload["mode"].(string) != "whisper" {
		t.Fatalf("expected whisper mode, got %v", payload["mode"])
	}
	if payload["message"].(string) == "" {
		t.Fatal("expected non-empty message summary")
	}
}


func TestStartSessionFallsBackToBlockMode(t *testing.T) {
	createBlockCalls := 0
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/blocks/" && r.Method == http.MethodPost:
			createBlockCalls++
			writeJSON(w, http.StatusOK, map[string]any{"id": "block-session", "label": "session", "value": ""})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "", "", "", "")
	body, _ := json.Marshal(map[string]any{"session_id": "session-block"})

	for range 2 {
		req := httptest.NewRequest(http.MethodPost, "/v1/memory/session/start", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	}

	if createBlockCalls != 1 {
		t.Fatalf("expected 1 create-block call, got %d", createBlockCalls)
	}
}

func TestInjectPromptUsesBlockValueInBlockMode(t *testing.T) {
	lettaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/blocks/" && r.Method == http.MethodPost:
			writeJSON(w, http.StatusOK, map[string]any{"id": "block-inject", "label": "session", "value": ""})
		case r.URL.Path == "/v1/blocks/block-inject" && r.Method == http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{"id": "block-inject", "label": "session", "value": "remember this state"})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer lettaServer.Close()

	router := setupMemoryRouter(t, lettaServer.URL, "", "letta-key", "", "", "", "")
	body, _ := json.Marshal(map[string]any{"session_id": "session-block-inject"})
	req := httptest.NewRequest(http.MethodPost, "/v1/memory/inject/prompt", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payload := resp["payload"].(map[string]any)
	if payload["message"].(string) != "remember this state" {
		t.Fatalf("expected block value summary, got %v", payload["message"])
	}
}
