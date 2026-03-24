package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/clab/knowledge-server/internal/handlers"
	"github.com/clab/knowledge-server/internal/letta"
	"github.com/clab/knowledge-server/internal/memory"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4007"
	}

	storeDir := os.Getenv("STORE_DIR")
	if storeDir == "" {
		storeDir = ".knowledge-data"
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	memorySessions, err := memory.NewSessionStore(filepath.Join(storeDir, "memory"))
	if err != nil {
		log.Fatalf("failed to initialize memory session store: %v", err)
	}
	memoryClient := letta.NewClient(letta.Config{
		BaseURL:   os.Getenv("LETTA_BASE_URL"),
		APIKey:    os.Getenv("LETTA_API_KEY"),
		AgentID:   os.Getenv("LETTA_AGENT_ID"),
		Model:     os.Getenv("LETTA_MODEL"),
		Embedding: os.Getenv("LETTA_EMBEDDING"),
		AgentName: os.Getenv("LETTA_AGENT_NAME"),
	})
	memoryHandler := handlers.NewMemoryHandler(memoryClient, memorySessions, os.Getenv("MEMORY_API_KEY"))

	mountMemoryRoutes := func(r chi.Router) {
		r.Use(memoryHandler.RequireAuth)
		r.Get("/health", memoryHandler.Health)
		r.Post("/session/start", memoryHandler.StartSession)
		r.Post("/inject/prompt", memoryHandler.InjectPrompt)
		r.Post("/inject/tool", memoryHandler.InjectTool)
		r.Post("/transcript/append", memoryHandler.AppendTranscript)
	}

	r.Route("/v1/memory", mountMemoryRoutes)
	r.Route("/api/memory", mountMemoryRoutes)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "memory-gateway",
		})
	})
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "memory-gateway",
		})
	})

	log.Printf("memory-gateway listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
