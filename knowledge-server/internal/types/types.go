// Package types defines shared data structures for the knowledge layer.
package types

// KnowledgeEntry represents a single knowledge entry stored in the knowledge store.
type KnowledgeEntry struct {
	ID         string   `json:"id"`
	Topic      string   `json:"topic"`
	Content    string   `json:"content"`
	Tags       []string `json:"tags"`
	Source     string   `json:"source"`               // "MANUAL", "EXTRACTED", "DISTILLED"
	Confidence float64  `json:"confidence"`
	CreatedAt  string   `json:"created_at"`
	UpdatedAt  string   `json:"updated_at,omitempty"`
	MissionID  string   `json:"mission_id,omitempty"`
}

// SearchResult represents a result from a project-doc search.
type SearchResult struct {
	Path            string   `json:"path"`
	RelevanceScore  int      `json:"relevance_score"`
	Excerpt         string   `json:"excerpt"`
	MatchedKeywords []string `json:"matched_keywords"`
}

// PreKnowledgeEntry is a deduplicated knowledge entry with relevance score.
type PreKnowledgeEntry struct {
	ID        string  `json:"id"`
	Topic     string  `json:"topic"`
	Excerpt   string  `json:"excerpt"`
	Relevance float64 `json:"relevance"`
}

// PreKnowledgeResult is the result of pre-knowledge retrieval for a task.
type PreKnowledgeResult struct {
	Keywords         []string            `json:"keywords"`
	KnowledgeEntries []PreKnowledgeEntry `json:"knowledge_entries"`
	ProjectDocs      []SearchResult      `json:"project_docs"`
	Warnings         []string            `json:"warnings"`
	TotalChars       int                 `json:"total_chars"`
}

// DebtItem represents a single knowledge-debt finding.
type DebtItem struct {
	Type        string `json:"type"` // missing_crosslink, missing_hub, orphan_doc, broken_link, stale_doc
	Path        string `json:"path"`
	Description string `json:"description"`
}

// DebtSummary holds aggregated counts by debt type.
type DebtSummary struct {
	Total             int `json:"total"`
	MissingCrosslinks int `json:"missing_crosslinks"`
	MissingHub        int `json:"missing_hub"`
	OrphanDocs        int `json:"orphan_docs"`
	BrokenLinks       int `json:"broken_links"`
	StaleDocs         int `json:"stale_docs"`
}

// PostKnowledgeDebt is the result of post-knowledge integrity verification.
type PostKnowledgeDebt struct {
	Passed    bool        `json:"passed"`
	Debts     []DebtItem  `json:"debts"`
	Summary   DebtSummary `json:"summary"`
	MissionID string      `json:"mission_id,omitempty"`
}

// StoreStatus is a status summary of the knowledge store.
type StoreStatus struct {
	TotalEntries int    `json:"total_entries"`
	UniqueTopics int    `json:"unique_topics"`
	LastUpdated  string `json:"last_updated,omitempty"`
}

// TaskResult captures the outcome of a completed task.
type TaskResult struct {
	Status       string   `json:"status"`
	Summary      string   `json:"summary"`
	ChangedFiles []string `json:"changed_files"`
	Risks        []string `json:"risks"`
	Followups    []string `json:"followups"`
}

// ExtractedInsight represents an insight extracted from task execution.
type ExtractedInsight struct {
	ID          string   `json:"id"`
	TaskRunID   string   `json:"task_run_id"`
	Type        string   `json:"type"` // pattern, decision, risk
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Evidence    []string `json:"evidence"`
	Tags        []string `json:"tags"`
	CreatedAt   string   `json:"created_at"`
}
