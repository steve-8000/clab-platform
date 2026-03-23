package letta

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config holds Letta client configuration.
type Config struct {
	BaseURL   string
	APIKey    string
	AgentID   string
	Model     string
	Embedding string
	AgentName string
}

// IsConfigured reports whether the client has the required Letta settings.
func (c Config) IsConfigured() bool {
	return strings.TrimSpace(c.APIKey) != ""
}

// Client is a minimal Letta HTTP client.
type Client struct {
	baseURL    string
	apiKey     string
	model      string
	embedding  string
	agentName  string
	httpClient *http.Client
	mu         sync.Mutex
	agentID    string
}

// NewClient creates a new Letta client.
func NewClient(cfg Config) *Client {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.letta.com"
	}
	return &Client{
		baseURL:   baseURL,
		apiKey:    strings.TrimSpace(cfg.APIKey),
		agentID:   strings.TrimSpace(cfg.AgentID),
		model:     strings.TrimSpace(cfg.Model),
		embedding: strings.TrimSpace(cfg.Embedding),
		agentName: strings.TrimSpace(cfg.AgentName),
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

// SetHTTPClient overrides the underlying http.Client, primarily for tests.
func (c *Client) SetHTTPClient(httpClient *http.Client) {
	if httpClient != nil {
		c.httpClient = httpClient
	}
}

// AgentID returns the configured Letta agent ID.
func (c *Client) AgentID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.agentID
}

// IsConfigured reports whether the client is ready to call Letta.
func (c *Client) IsConfigured() bool {
	return c.apiKey != ""
}

// CanBootstrapAgent reports whether the client can lazily create an agent.
func (c *Client) CanBootstrapAgent() bool {
	return c.apiKey != "" && c.model != "" && c.embedding != ""
}

// UsesConversationMode reports whether the client can use Letta conversations.
func (c *Client) UsesConversationMode() bool {
	return c.AgentID() != "" || c.CanBootstrapAgent()
}

// Conversation represents a minimal Letta conversation object.
type Conversation struct {
	ID      string `json:"id"`
	AgentID string `json:"agent_id"`
}

// Agent represents a minimal Letta agent object.
type Agent struct {
	ID string `json:"id"`
}

// Block represents a minimal Letta block object.
type Block struct {
	ID       string         `json:"id"`
	Label    string         `json:"label,omitempty"`
	Value    string         `json:"value,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Message represents a minimal Letta message object.
type Message struct {
	ID          string `json:"id,omitempty"`
	Role        string `json:"role,omitempty"`
	Content     any    `json:"content,omitempty"`
	MessageType string `json:"message_type,omitempty"`
	Date        string `json:"date,omitempty"`
}

// CreateConversation creates a new conversation for the configured agent.
func (c *Client) CreateConversation(ctx context.Context) (Conversation, error) {
	agentID, err := c.EnsureAgent(ctx)
	if err != nil {
		return Conversation{}, err
	}

	path := "/v1/conversations/"
	query := url.Values{}
	query.Set("agent_id", agentID)

	var conv Conversation
	if err := c.doJSON(ctx, http.MethodPost, path+"?"+query.Encode(), nil, &conv); err != nil {
		return Conversation{}, err
	}
	return conv, nil
}

// EnsureAgent returns the configured agent id or creates one lazily when bootstrap settings are present.
func (c *Client) EnsureAgent(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.agentID != "" {
		return c.agentID, nil
	}
	if !c.CanBootstrapAgent() {
		return "", fmt.Errorf("missing Letta bootstrap configuration")
	}

	agent, err := c.CreateAgent(ctx)
	if err != nil {
		return "", err
	}

	if c.agentID == "" {
		c.agentID = strings.TrimSpace(agent.ID)
	}
	return c.agentID, nil
}

// CreateAgent creates a minimal Letta agent.
func (c *Client) CreateAgent(ctx context.Context) (Agent, error) {
	reqBody := map[string]any{
		"model":     c.model,
		"embedding": c.embedding,
		"memory_blocks": []map[string]any{
			{
				"label": "human",
				"value": "Project memory bootstrap. Capture stable facts, decisions, and unresolved risks.",
			},
		},
	}
	if c.agentName != "" {
		reqBody["name"] = c.agentName
	}

	var agent Agent
	if err := c.doJSON(ctx, http.MethodPost, "/v1/agents", reqBody, &agent); err != nil {
		return Agent{}, err
	}
	return agent, nil
}

// CreateBlock creates a minimal Letta block.
func (c *Client) CreateBlock(ctx context.Context, label, value string, metadata map[string]any) (Block, error) {
	reqBody := map[string]any{
		"label": label,
		"value": value,
	}
	if len(metadata) > 0 {
		reqBody["metadata"] = metadata
	}
	var block Block
	if err := c.doJSON(ctx, http.MethodPost, "/v1/blocks/", reqBody, &block); err != nil {
		return Block{}, err
	}
	return block, nil
}

// RetrieveBlock fetches a Letta block by ID.
func (c *Client) RetrieveBlock(ctx context.Context, blockID string) (Block, error) {
	var block Block
	if err := c.doJSON(ctx, http.MethodGet, "/v1/blocks/"+blockID, nil, &block); err != nil {
		return Block{}, err
	}
	return block, nil
}

// UpdateBlock updates the value of a Letta block.
func (c *Client) UpdateBlock(ctx context.Context, blockID, value string) (Block, error) {
	var block Block
	if err := c.doJSON(ctx, http.MethodPatch, "/v1/blocks/"+blockID, map[string]any{"value": value}, &block); err != nil {
		return Block{}, err
	}
	return block, nil
}

// ListMessages returns conversation messages.
func (c *Client) ListMessages(ctx context.Context, conversationID string) ([]Message, error) {
	var direct []Message
	if err := c.doJSON(ctx, http.MethodGet, "/v1/conversations/"+conversationID+"/messages", nil, &direct); err == nil {
		return direct, nil
	}

	var wrapped struct {
		Messages []Message `json:"messages"`
		Data     []Message `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/conversations/"+conversationID+"/messages", nil, &wrapped); err != nil {
		return nil, err
	}
	if len(wrapped.Messages) > 0 {
		return wrapped.Messages, nil
	}
	return wrapped.Data, nil
}

// AppendUserMessage appends a compact user message to a conversation.
func (c *Client) AppendUserMessage(ctx context.Context, conversationID, text string) ([]Message, error) {
	reqBody := map[string]any{
		"messages": []map[string]any{
			{
				"role":    "user",
				"content": text,
			},
		},
		"streaming": false,
	}

	var direct []Message
	if err := c.doJSON(ctx, http.MethodPost, "/v1/conversations/"+conversationID+"/messages", reqBody, &direct); err == nil {
		return direct, nil
	}

	var wrapped struct {
		Messages []Message `json:"messages"`
		Data     []Message `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/v1/conversations/"+conversationID+"/messages", reqBody, &wrapped); err != nil {
		return nil, err
	}
	if len(wrapped.Messages) > 0 {
		return wrapped.Messages, nil
	}
	return wrapped.Data, nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any) error {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		payload = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, payload)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request letta: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("letta api %s %s returned %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}

	if out == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}
