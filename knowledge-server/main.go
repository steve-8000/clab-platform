package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/clab/knowledge-server/internal/handlers"
	"github.com/clab/knowledge-server/internal/store"
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

	s, err := store.NewLocalKnowledgeStore(storeDir)
	if err != nil {
		log.Fatalf("failed to initialize store: %v", err)
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

	kh := handlers.NewKnowledgeHandler(s)
	prek := handlers.NewPreKHandler(s)
	postk := handlers.NewPostKHandler()
	insights := handlers.NewInsightsHandler(s)

	r.Route("/v1/knowledge", func(r chi.Router) {
		r.Post("/", kh.Store)
		r.Get("/search", kh.Search)
		r.Get("/topic/{topic}", kh.GetByTopic)
		r.Get("/tags", kh.GetByTags)
		r.Get("/status", kh.Status)
		r.Delete("/{id}", kh.Delete)
	})

	r.Post("/v1/pre-k/retrieve", prek.Retrieve)
	r.Post("/v1/post-k/check", postk.Check)
	r.Post("/v1/insights/extract", insights.Extract)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "knowledge-service",
		})
	})

	log.Printf("knowledge-service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
