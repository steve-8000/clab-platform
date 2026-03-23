package letta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestCreateConversationSendsAgentIDAsQueryParam(t *testing.T) {
	client := NewClient(Config{
		BaseURL: "https://example.test",
		APIKey:  "test-key",
		AgentID: "agent-123",
	})

	client.SetHTTPClient(&http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.Method != http.MethodPost {
				t.Fatalf("expected POST request, got %s", req.Method)
			}
			if req.URL.Path != "/v1/conversations/" {
				t.Fatalf("expected path /v1/conversations/, got %s", req.URL.Path)
			}
			if got := req.URL.Query().Get("agent_id"); got != "agent-123" {
				t.Fatalf("expected agent_id query param agent-123, got %q", got)
			}
			if auth := req.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Fatalf("expected bearer auth header, got %q", auth)
			}
			if contentType := req.Header.Get("Content-Type"); contentType != "" {
				t.Fatalf("expected no content-type for empty body, got %q", contentType)
			}

			if req.Body != nil {
				body, err := io.ReadAll(req.Body)
				if err != nil {
					t.Fatalf("read request body: %v", err)
				}
				if trimmed := strings.TrimSpace(string(body)); trimmed != "" {
					t.Fatalf("expected empty request body, got %s", trimmed)
				}
			}

			respBody, err := json.Marshal(Conversation{
				ID:      "conv-1",
				AgentID: "agent-123",
			})
			if err != nil {
				t.Fatalf("marshal response: %v", err)
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(string(respBody))),
			}, nil
		}),
	})

	conv, err := client.CreateConversation(context.Background())
	if err != nil {
		t.Fatalf("CreateConversation returned error: %v", err)
	}
	if conv.ID != "conv-1" {
		t.Fatalf("expected conversation id conv-1, got %q", conv.ID)
	}
	if conv.AgentID != "agent-123" {
		t.Fatalf("expected conversation agent_id agent-123, got %q", conv.AgentID)
	}
}

func TestEnsureAgentCreatesAndCachesAgentID(t *testing.T) {
	createAgentCalls := 0
	client := NewClient(Config{
		BaseURL:   "https://example.test",
		APIKey:    "test-key",
		Model:     "gpt-4.1-mini",
		Embedding: "text-embedding-3-small",
		AgentName: "memory-bootstrap",
	})

	client.SetHTTPClient(&http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.Method != http.MethodPost {
				t.Fatalf("expected POST request, got %s", req.Method)
			}
			if req.URL.Path != "/v1/agents" {
				t.Fatalf("expected path /v1/agents, got %s", req.URL.Path)
			}

			createAgentCalls++

			var body map[string]any
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Fatalf("decode request body: %v", err)
			}
			if body["model"] != "gpt-4.1-mini" {
				t.Fatalf("expected model gpt-4.1-mini, got %v", body["model"])
			}
			if body["embedding"] != "text-embedding-3-small" {
				t.Fatalf("expected embedding text-embedding-3-small, got %v", body["embedding"])
			}
			if body["name"] != "memory-bootstrap" {
				t.Fatalf("expected name memory-bootstrap, got %v", body["name"])
			}
			blocks, ok := body["memory_blocks"].([]any)
			if !ok || len(blocks) == 0 {
				t.Fatalf("expected non-empty memory_blocks, got %v", body["memory_blocks"])
			}

			respBody, err := json.Marshal(Agent{ID: "agent-created"})
			if err != nil {
				t.Fatalf("marshal response: %v", err)
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(string(respBody))),
			}, nil
		}),
	})

	for i := 0; i < 2; i++ {
		agentID, err := client.EnsureAgent(context.Background())
		if err != nil {
			t.Fatalf("EnsureAgent returned error: %v", err)
		}
		if agentID != "agent-created" {
			t.Fatalf("expected agent-created, got %q", agentID)
		}
	}

	if createAgentCalls != 1 {
		t.Fatalf("expected 1 agent creation call, got %d", createAgentCalls)
	}
}


func TestBlockCRUD(t *testing.T) {
	created := 0
	updated := 0
	client := NewClient(Config{
		BaseURL: "https://example.test",
		APIKey:  "test-key",
	})

	client.SetHTTPClient(&http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			switch {
			case req.Method == http.MethodPost && req.URL.Path == "/v1/blocks/":
				created++
				respBody, _ := json.Marshal(Block{ID: "block-1", Label: "session", Value: ""})
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(respBody)))}, nil
			case req.Method == http.MethodGet && req.URL.Path == "/v1/blocks/block-1":
				respBody, _ := json.Marshal(Block{ID: "block-1", Label: "session", Value: "existing"})
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(respBody)))}, nil
			case req.Method == http.MethodPatch && req.URL.Path == "/v1/blocks/block-1":
				updated++
				respBody, _ := json.Marshal(Block{ID: "block-1", Label: "session", Value: "updated"})
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(respBody)))}, nil
			default:
				t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
				return nil, nil
			}
		}),
	})

	block, err := client.CreateBlock(context.Background(), "session", "", map[string]any{"session_id": "s-1"})
	if err != nil || block.ID != "block-1" {
		t.Fatalf("CreateBlock failed: %v %+v", err, block)
	}
	block, err = client.RetrieveBlock(context.Background(), "block-1")
	if err != nil || block.Value != "existing" {
		t.Fatalf("RetrieveBlock failed: %v %+v", err, block)
	}
	block, err = client.UpdateBlock(context.Background(), "block-1", "updated")
	if err != nil || block.Value != "updated" {
		t.Fatalf("UpdateBlock failed: %v %+v", err, block)
	}
	if created != 1 || updated != 1 {
		t.Fatalf("expected 1 create and 1 update, got create=%d update=%d", created, updated)
	}
}
