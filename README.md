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
| Generate | `/generate/create`, `/generate/gallery` | Images and video. Local models on the GPU box (Z-Image Turbo, Qwen-Image 2512, FLUX.2 [dev], Wan 2.2, LTX-2.5) or hosted ones (Seedance 2.5, Wan 3.0, Kling 3, Google Omni Flash, MiniMax H3, Luma Ray 3, Nano Banana 2.1, GPT Image 2.5, Seedream 5.0, FLUX.2 [max], Ideogram 4.5, Recraft V4.1). Prompts are refined by the local LLM; images can be vision-checked and retried; any image can be animated. |
| Studio | `/studio` | Characters: portraits and cloned voices. |
| API access | `/tokens` | Tokens and copy-paste setup for Claude Code, OpenAI-compatible tools and the Ollama API. |
| Admin | `/admin/:tab` | Users, models, agent library, usage, pricing, Ollama live stats, ComfyUI. |

The default chat model is `OLLAMA_MODEL` (currently `qwen3.8:27b`) unless an admin picks one in Admin → Models. Web chats use a 32k context window by default (`CHAT_NUM_CTX`) so a 27B model stays fully on a 24 GB GPU; set `num_ctx` per model in Admin → Models to override.

### Media generation

Every image/video job runs on ComfyUI (`COMFYUI_URL`). The model list lives in
`backend/src/services/media/catalog.ts`; each entry fills parameters into an official ComfyUI template stored in
`workflows.json` (ComfyUI's own API-format export — see `ComfyUI-Installs/README.md` on the GPU box).

* **Local models** need only their weights in ComfyUI's models folder; Admin → Media shows any missing files.
* **Free daily (Cloudflare Workers AI)**: FLUX.1 schnell / FLUX.2 [klein] / FLUX.2 [dev] on Cloudflare's free
  10,000-neuron daily allowance (00:00 UTC reset), no GPU needed. Connect an account ID + Workers AI token in
  Admin → Media; DeadChat tallies estimated usage and stops before the allowance runs out.
* **Free sites** (Generate → Free sites): Dreamina (Seedance 2.5), Google Flow (Veo), Kling, PixVerse, Firefly,
  Gemini, Bing, Leonardo, Krea, Recraft, Ideogram… These only offer free credits in their own web apps, so DeadChat
  refines the prompt for the site's model, copies it and opens the site; results can be imported back into the gallery.
* **Hosted models** (closed weights such as Seedance 2.5) run through ComfyUI's partner API nodes and are billed
  to a comfy.org API key, set in Admin → Media and stored encrypted with `SECRETS_KEY` (set it in production).
* Jobs: refine prompt (local LLM) → upload start image → generate → for images, optional vision check that
  rewrites the prompt and retries up to 3 times, keeping the best result. Local jobs unload Ollama first.
* API: `GET /api/generate/models`, `POST /api/generate/jobs`, `POST /api/media/upload`; agents use the
  `generate_image` / `generate_video` tools.
* Checks: `npm test` (graph construction for every model) and
  `npx ts-node --transpile-only scripts/validate-workflows.ts` (validates all graphs against a live ComfyUI without billing).

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

## Multiple Ollama Backends

Set `OLLAMA_BACKENDS` to list several Ollama servers, e.g.
`gpu-box=http://192.168.0.106:11434,mac=http://192.168.0.29:11434`. The first is the primary (the admin URL override changes it); without the variable, `OLLAMA_URL` is the only backend.

- **Per chat:** when more than one backend is online, the chat header shows a backend picker. Switching backend resets the chat to that backend's default model.
- **Different models per backend:** each backend lists its own models. Admin → Models → *Ollama backends* sets each backend's default model (e.g. an MLX model for a Mac); the primary falls back to the global default.
- **Offline backends:** each backend is probed every 10 s. If a chat's backend is offline and another is online, the reply comes from the online one, keeping the chat's model if that backend has it and otherwise using its default; the chat shows a notice.
- **Outside chats:** admin tools use the primary while it's online, else the first online backend; `?backend=<id>` on `/api/ollama/*` targets a specific one. Public API calls go to an online backend that has the requested model, and `/api/tags` and `/v1/models` list models from every online backend.
- **API model fallback:** when no online backend has a generation request's model (`/api/chat`, `/api/generate`, `/v1/chat/completions`, `/v1/completions`, `/v1/messages`), the first online backend's default model answers instead, and the response carries `X-DeadChat-Model`. Requests with images only fall back to a default that can read images; otherwise they get a 400. Embedding and `/api/show` requests are never substituted. Every routed response carries `X-DeadChat-Backend`.

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_BACKENDS` | empty (`OLLAMA_URL` only) | `id=url` pairs, comma-separated; first is primary |
| `OLLAMA_HEALTH_INTERVAL_MS` | `10000` | How often each backend is probed (`/api/tags`) |
| `OLLAMA_HEALTH_TIMEOUT_MS` | `3000` | Probe timeout |
| `OLLAMA_FAIL_THRESHOLD` | `2` | Failed probes in a row before a backend is offline |
| `OLLAMA_RECOVER_THRESHOLD` | `2` | Good probes in a row before it's online again |

Use IP addresses rather than `.local` names: pods can't resolve mDNS. A Mac's Ollama must listen on the network (`launchctl setenv OLLAMA_HOST 0.0.0.0`, then restart Ollama).

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
