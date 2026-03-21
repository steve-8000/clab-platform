# Deployment Runbook

## Prerequisites

Before deploying clab-platform, ensure the following are available:

### Infrastructure

- **Kubernetes cluster** (v1.28+) with `kubectl` configured
- **Container registry** (Docker Hub, GitHub Container Registry, or private registry)
- **PostgreSQL** (v15+) — managed service recommended (AWS RDS, Neon, Supabase)
- **NATS** (v2.10+) with JetStream enabled
- **Domain/Ingress** configured for API gateway and dashboard

### Local Tools

- Node.js v20+
- pnpm v9+
- Docker v24+
- `kubectl` configured for the target cluster
- `helm` v3 (optional, for NATS Helm chart)

### Environment Variables

Each service requires environment variables. Create a Kubernetes Secret or use a secrets manager:

```bash
# Shared
DATABASE_URL=postgresql://user:pass@host:5432/clab
NATS_URL=nats://nats:4222

# API Gateway
API_PORT=3000
JWT_SECRET=<generate-a-secure-secret>
DASHBOARD_ORIGIN=https://dashboard.example.com

# Mission Service
MISSION_SERVICE_PORT=3001
PLANNING_MODEL=claude-sonnet-4-20250514

# Runtime Manager
RUNTIME_MANAGER_PORT=3002
MAX_CONCURRENT_WORKERS=8
WORKER_HEARTBEAT_TIMEOUT_MS=30000

# Browser Service
BROWSER_SERVICE_PORT=3003
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Review Service
REVIEW_SERVICE_PORT=3004
REVIEW_MODEL=claude-sonnet-4-20250514
```

## Build and Push Images

### 1. Install dependencies and build all packages

```bash
cd /path/to/clab-platform
pnpm install
pnpm build
```

### 2. Build Docker images

Each app has its own Dockerfile. Build from the repo root (monorepo context):

```bash
# Set your registry
REGISTRY=ghcr.io/your-org/clab-platform

# Build all service images
for service in api-gateway orchestrator runtime-manager browser-service review-service dashboard; do
  docker build \
    -f apps/${service}/Dockerfile \
    -t ${REGISTRY}/${service}:$(git rev-parse --short HEAD) \
    -t ${REGISTRY}/${service}:latest \
    .
done
```

### 3. Push images

```bash
for service in api-gateway orchestrator runtime-manager browser-service review-service dashboard; do
  docker push ${REGISTRY}/${service}:$(git rev-parse --short HEAD)
  docker push ${REGISTRY}/${service}:latest
done
```

## Deploy to Kubernetes

### 1. Create namespace

```bash
kubectl create namespace clab-platform
```

### 2. Deploy NATS (if not using an external instance)

```bash
helm repo add nats https://nats-io.github.io/k8s/helm/charts/
helm repo update

helm install nats nats/nats \
  --namespace clab-platform \
  --set config.jetstream.enabled=true \
  --set config.jetstream.fileStore.pvc.size=10Gi
```

### 3. Create secrets

```bash
kubectl create secret generic clab-secrets \
  --namespace clab-platform \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/clab' \
  --from-literal=NATS_URL='nats://nats:4222' \
  --from-literal=JWT_SECRET='your-jwt-secret'
```

### 4. Apply Kubernetes manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml  # if using file-based secrets
kubectl apply -f k8s/services/
kubectl apply -f k8s/deployments/
kubectl apply -f k8s/ingress.yaml
```

### 5. Verify deployments

```bash
kubectl get pods -n clab-platform
# All pods should be Running

kubectl get svc -n clab-platform
# All services should have ClusterIP assigned
```

## Run Database Migrations

Migrations run as a Kubernetes Job to ensure they complete before services start querying.

### Option A: Kubernetes Job

```bash
kubectl apply -f k8s/jobs/migrate.yaml

# Watch the job
kubectl logs -f job/clab-migrate -n clab-platform
```

### Option B: Manual (from a machine with DB access)

```bash
cd packages/db
DATABASE_URL='postgresql://user:pass@host:5432/clab' pnpm drizzle-kit migrate
```

### Verify migration

```bash
# Connect to the database and check
psql $DATABASE_URL -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;"
```

## Verify Health Endpoints

Each service exposes a `GET /health` endpoint:

```bash
# Port-forward the API gateway
kubectl port-forward svc/api-gateway 3000:3000 -n clab-platform

# Check individual service health
curl http://localhost:3000/health
# Expected: {"status":"ok","version":"...","uptime":...}

# Check aggregated health (gateway checks all downstream services)
curl http://localhost:3000/health/all
# Expected: {"api-gateway":"ok","orchestrator":"ok","runtime-manager":"ok",...}
```

### Health check details

| Service          | Endpoint     | Checks                                    |
| ---------------- | ------------ | ----------------------------------------- |
| API Gateway      | `/health`    | Self, downstream service connectivity     |
| Mission Service     | `/health`    | Self, DB connection, NATS connection       |
| Runtime Manager  | `/health`    | Self, DB connection, NATS connection       |
| Browser Service  | `/health`    | Self, Playwright browser launch            |
| Review Service   | `/health`    | Self, DB connection                        |
| Dashboard        | `/health`    | Self (static assets served)                |

## Rollback Procedure

### Rolling back a deployment

```bash
# Check rollout history
kubectl rollout history deployment/orchestrator -n clab-platform

# Roll back to previous revision
kubectl rollout undo deployment/orchestrator -n clab-platform

# Roll back to a specific revision
kubectl rollout undo deployment/orchestrator -n clab-platform --to-revision=3

# Verify
kubectl rollout status deployment/orchestrator -n clab-platform
```

### Rolling back a database migration

Database rollbacks are not automatic. If a migration causes issues:

1. **Stop affected services** to prevent further writes:
   ```bash
   kubectl scale deployment/orchestrator --replicas=0 -n clab-platform
   kubectl scale deployment/runtime-manager --replicas=0 -n clab-platform
   ```

2. **Apply a reverse migration** (manually or via drizzle-kit):
   ```bash
   cd packages/db
   # Write a reverse migration SQL file
   DATABASE_URL='...' psql -f migrations/rollback/XXXX_reverse.sql
   ```

3. **Redeploy previous image versions**:
   ```bash
   kubectl set image deployment/orchestrator \
     orchestrator=${REGISTRY}/orchestrator:<previous-tag> \
     -n clab-platform
   ```

4. **Scale services back up**:
   ```bash
   kubectl scale deployment/orchestrator --replicas=2 -n clab-platform
   kubectl scale deployment/runtime-manager --replicas=2 -n clab-platform
   ```

### Emergency: Full rollback

If the entire release needs to be reverted:

```bash
# Roll back all deployments
for deploy in api-gateway orchestrator runtime-manager browser-service review-service dashboard; do
  kubectl rollout undo deployment/${deploy} -n clab-platform
done

# Verify all pods are healthy
kubectl get pods -n clab-platform -w
```

## Post-Deployment Checklist

- [ ] All pods are `Running` and `Ready`
- [ ] Health endpoints return `ok` for all services
- [ ] Database migrations applied successfully
- [ ] NATS streams exist and consumers are registered
- [ ] Dashboard loads and shows real-time data
- [ ] Create a test mission to verify end-to-end flow
- [ ] Check logs for errors: `kubectl logs -l app=orchestrator -n clab-platform`
- [ ] Verify metrics/monitoring dashboards are receiving data
