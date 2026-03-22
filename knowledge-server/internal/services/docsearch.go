package services

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/clab/knowledge-server/internal/types"
)

// walkMD recursively collects .md file paths, skipping hidden dirs and node_modules.
func walkMD(directory string) []string {
	var results []string
	entries, err := os.ReadDir(directory)
	if err != nil {
		return results
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			if strings.HasPrefix(name, ".") || name == "node_modules" {
				continue
			}
			results = append(results, walkMD(filepath.Join(directory, name))...)
		} else if strings.HasSuffix(name, ".md") {
			results = append(results, filepath.Join(directory, name))
		}
	}
	return results
}

// SearchDocs searches markdown docs for keyword matches across searchPaths.
// A file must match at least 2 keywords to qualify.
func SearchDocs(keywords []string, searchPaths []string, maxResults int, maxTotalChars int) []types.SearchResult {
	// Collect all .md files from the search paths.
	var allFiles []string
	for _, sp := range searchPaths {
		info, err := os.Stat(sp)
		if err != nil {
			continue
		}
		if info.IsDir() {
			allFiles = append(allFiles, walkMD(sp)...)
		} else if strings.HasSuffix(sp, ".md") {
			allFiles = append(allFiles, sp)
		}
	}

	// Score each file by keyword matches.
	var scored []types.SearchResult
	for _, filePath := range allFiles {
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		content := string(data)
		lower := strings.ToLower(content)

		var matched []string
		for _, kw := range keywords {
			if strings.Contains(lower, strings.ToLower(kw)) {
				matched = append(matched, kw)
			}
		}

		// Must match at least 2 keywords to qualify.
		if len(matched) < 2 {
			continue
		}

		excerpt := content
		if len(excerpt) > 400 {
			excerpt = excerpt[:400]
		}

		scored = append(scored, types.SearchResult{
			Path:            filePath,
			RelevanceScore:  len(matched),
			Excerpt:         excerpt,
			MatchedKeywords: matched,
		})
	}

	// Sort by relevance descending.
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].RelevanceScore > scored[j].RelevanceScore
	})

	if maxResults > 0 && len(scored) > maxResults {
		scored = scored[:maxResults]
	}

	// Trim total excerpt chars to stay within budget.
	var trimmed []types.SearchResult
	totalChars := 0
	for _, r := range scored {
		remaining := maxTotalChars - totalChars
		if remaining <= 0 {
			break
		}
		if len(r.Excerpt) > remaining {
			r.Excerpt = r.Excerpt[:remaining]
			trimmed = append(trimmed, r)
			totalChars += remaining
		} else {
			trimmed = append(trimmed, r)
			totalChars += len(r.Excerpt)
		}
	}

	return trimmed
}
