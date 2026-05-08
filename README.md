# DeadChat

AI-powered chat application with real-time messaging, file sharing, and integrated AI assistants powered by Ollama.

## Quick Start

```bash
# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Start development servers
npm run dev
```

## Docker Compose

```bash
cd deploy/docker
docker compose up --build
```

The frontend will be available at http://localhost:8080 and the backend API at http://localhost:3000.

## Helm Deployment

```bash
# Install to Kubernetes cluster
helm install deadchat deploy/helm/deadchat

# Install with custom values
helm install deadchat deploy/helm/deadchat -f my-values.yaml

# Or apply raw manifests
kubectl apply -f deploy/k8s/
```

## Default Credentials

- **Username:** admin
- **Password:** admin123

Change these immediately after first login.

## Public API

DeadChat exposes three API surfaces under API-token auth (`Authorization: Bearer dc_live_...`):

| Surface | Path | Notes |
|---|---|---|
| Ollama-native | `POST /api/chat`, `/api/generate`, `/api/tags`, ... | Pass-through to upstream Ollama |
| OpenAI-compatible | `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `GET /v1/models` | Pass-through |
| Anthropic-compatible | `POST /v1/messages` | Translates to/from Ollama; supports streaming + tool use |

### Claude Code / Anthropic SDK

```bash
export ANTHROPIC_BASE_URL="https://deadchat.deadplanet.net"
export ANTHROPIC_AUTH_TOKEN="dc_live_..."
export ANTHROPIC_MODEL="qwen3.6"   # any model exposed by your Ollama
claude
```

Limitations of the Anthropic-compat layer: image content blocks are dropped,
prompt caching headers (`cache_control`) are accepted and ignored, no
`/v1/messages/count_tokens` endpoint, and tool-use quality depends on the
underlying Ollama model.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, TailwindCSS
- **Backend:** Node.js, Express, TypeScript, SQLite
- **AI:** Ollama (local LLM inference)
- **Real-time:** WebSockets
- **Deployment:** Docker, Kubernetes, Helm
