package services

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/clab/knowledge-server/internal/types"
)

// hubCandidates is the ordered list of filenames considered as hub documents.
var hubCandidates = []string{"index.md", "hub.md", "README.md", "_index.md"}

// linkPattern matches markdown links: [text](href)
var linkPattern = regexp.MustCompile(`\[([^\]]*)\]\(([^)]+)\)`)

// stalePattern matches deprecated/stale status in YAML frontmatter.
var stalePattern = regexp.MustCompile(`(?i)status:\s*(deprecated|stale)`)

// frontmatterPattern matches YAML frontmatter at the start of a file.
var frontmatterPattern = regexp.MustCompile(`^---\n([\s\S]*?)\n---`)

// collectMD recursively collects .md files, skipping hidden dirs and node_modules.
func collectMD(directory string) []string {
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
			results = append(results, collectMD(filepath.Join(directory, name))...)
		} else if strings.HasSuffix(name, ".md") {
			results = append(results, filepath.Join(directory, name))
		}
	}
	return results
}

// extractLinks extracts relative markdown links [text](path) from content.
func extractLinks(content string) []string {
	var links []string
	matches := linkPattern.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		href := m[2]
		if strings.HasPrefix(href, "http") || strings.HasPrefix(href, "#") {
			continue
		}
		// Strip fragment
		if idx := strings.Index(href, "#"); idx >= 0 {
			href = href[:idx]
		}
		if href != "" {
			links = append(links, href)
		}
	}
	return links
}

// hasCrosslinkSection checks if content has a "## Related" section with at least one link.
func hasCrosslinkSection(content string) bool {
	idx := strings.Index(content, "## Related")
	if idx < 0 {
		return false
	}
	after := content[idx:]
	return linkPattern.MatchString(after)
}

// findHubDoc returns the path of the first hub document found in the directory, or empty string.
func findHubDoc(directory string) string {
	for _, name := range hubCandidates {
		candidate := filepath.Join(directory, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

// CheckIntegrity runs integrity checks on modifiedDocs relative to basePath
// and returns (passed, debts).
func CheckIntegrity(modifiedDocs []string, basePath string) (bool, []types.DebtItem) {
	var debts []types.DebtItem

	for _, doc := range modifiedDocs {
		fullPath := filepath.Clean(filepath.Join(basePath, doc))

		data, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}
		content := string(data)

		// 1. Crosslink check
		if !hasCrosslinkSection(content) {
			debts = append(debts, types.DebtItem{
				Type:        "missing_crosslink",
				Path:        doc,
				Description: `Missing "## Related" section with crosslinks`,
			})
		}

		// 2. Hub registration check
		folder := filepath.Dir(fullPath)
		hubDoc := findHubDoc(folder)
		if hubDoc != "" {
			hubData, err := os.ReadFile(hubDoc)
			if err == nil {
				docBasename := filepath.Base(fullPath)
				if !strings.Contains(string(hubData), docBasename) {
					rel, _ := filepath.Rel(basePath, hubDoc)
					debts = append(debts, types.DebtItem{
						Type:        "missing_hub",
						Path:        doc,
						Description: "Not listed in hub doc " + rel,
					})
				}
			}
		}

		// 3. Link validation
		for _, link := range extractLinks(content) {
			resolved := filepath.Clean(filepath.Join(filepath.Dir(fullPath), link))
			if _, err := os.Stat(resolved); os.IsNotExist(err) {
				debts = append(debts, types.DebtItem{
					Type:        "broken_link",
					Path:        doc,
					Description: "Broken link: " + link,
				})
			}
		}

		// 4. Staleness check (frontmatter)
		if fm := frontmatterPattern.FindStringSubmatch(content); fm != nil {
			if stalePattern.MatchString(fm[1]) {
				debts = append(debts, types.DebtItem{
					Type:        "stale_doc",
					Path:        doc,
					Description: "Doc is marked as deprecated/stale in frontmatter",
				})
			}
		}
	}

	// 5. Orphan detection
	allDocs := collectMD(basePath)
	for _, docPath := range allDocs {
		folder := filepath.Dir(docPath)
		hubDoc := findHubDoc(folder)
		if hubDoc == "" || hubDoc == docPath {
			continue
		}

		basename := filepath.Base(docPath)
		// Skip hub candidates themselves
		isHub := false
		for _, hc := range hubCandidates {
			if basename == hc {
				isHub = true
				break
			}
		}
		if isHub {
			continue
		}

		hubData, err := os.ReadFile(hubDoc)
		if err != nil {
			continue
		}
		if !strings.Contains(string(hubData), basename) {
			rel, _ := filepath.Rel(basePath, docPath)
			hubRel, _ := filepath.Rel(basePath, hubDoc)
			debts = append(debts, types.DebtItem{
				Type:        "orphan_doc",
				Path:        rel,
				Description: "Orphan: not referenced by " + hubRel,
			})
		}
	}

	return len(debts) == 0, debts
}
