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

## Using DeadChat

| Page | Path | What it's for |
|---|---|---|
| Chat | `/chat`, `/chat/:id` | Chat with local models. Pick an agent and a model per chat; attach images (vision models) or text/code files; reasoning from thinking models is shown collapsed; **Stop** keeps the partial reply. |
| Agents | `/agents` | Saved system prompts. "Can use tools" agents run a plan → tool → observe loop (image/video generation, backend checks). |
| Generate | `/generate` | Image and video generation via ComfyUI, plus the gallery. |
| Studio | `/studio` | Characters: portraits and cloned voices. |
| API access | `/tokens` | Tokens and copy-paste setup for Claude Code, OpenAI-compatible tools and the Ollama API. |
| Admin | `/admin/:tab` | Users, models, agent library, usage, pricing, Ollama live stats, ComfyUI. |

The default chat model is `OLLAMA_MODEL` (currently `qwen3.8:27b`) unless an admin picks one in Admin → Models. Web chats use a 32k context window by default (`CHAT_NUM_CTX`) so a 27B model stays fully on a 24 GB GPU; set `num_ctx` per model in Admin → Models to override.

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
export ANTHROPIC_MODEL="qwen3.8:27b"   # any model exposed by your Ollama
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
