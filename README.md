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

## Social Media (AI influencers)

The **Social Media** tab creates AI influencer projects with a step-by-step wizard:

- **Photo & video personas:** ground rules → persona → look → portfolio → posting plan → accounts → launch. Looks and portfolio images are generated on the local ComfyUI models. You approve a look, and its description and seed are reused for every image afterwards. Approved images can be animated with the local image-to-video model.
- **Text & commentary personas:** ground rules → persona → topics & sources → posting plan → accounts → launch. Every post is researched and fact-checked: stories come from RSS feeds and web search, and can optionally be informed by what people are posting on Bluesky. The draft uses only facts from trusted sources. Each factual claim must be supported by N independent trusted domains (2+ for political content) and contradicted by none, or the post is blocked.

**Rules enforced in code** (`services/influencers/compliance.ts`), whatever the automation settings say:

- The persona is invented, a stated adult of 21 or older, and never aimed at minors. Image prompts that hint at a minor, a real person's likeness or sexual content are refused. A project's content level is safe for work (default), tasteful implied nudity (framed so nothing private shows, marked sensitive on Bluesky and Mastodon), or explicit. Explicit projects allow adult nudity and sex between consenting adults but never publish anywhere; they need a persona aged 25+, refuse youth-coded words, non-consent, incest and real likenesses, and vision-check every image for anyone who could look under 21.
- Every bio says the account is AI. Images sent to Instagram and Threads carry the IPTC AI source tag, which Meta reads to add its AI label, and each platform's own AI label is part of its setup checklist. Posts no longer carry an `#AIgenerated` hashtag.
- Posting is capped at 6 posts a day, at least 60 minutes apart.
- Posts may only link the verified sources. Political posts may not @-mention people, and election logistics need an official government source.
- Every post also goes through an LLM policy review before it can be approved.
- Posts wait for approval unless *auto-publish* is on. Even then, anything that fails a check is held.

**Platforms:** five publish automatically through their official APIs, using credentials you create for your own accounts:

| Platform | Credential | Notes |
|---|---|---|
| Bluesky | App password | Images only (≤1 MB, resized automatically) |
| Mastodon | Access token | Images and video |
| Instagram | Long-lived access token from a Meta app with *Instagram API with Instagram login* | Professional account; you are an Instagram tester on the app, so no App Review. Needs an image or video. Images are converted to JPEG and cropped into 4:5–1.91:1. Single posts, Reels and carousels (up to 10) |
| Threads | Long-lived access token from the *Threads API* use case | You are a Threads tester on the app. Text, image, video and carousels |
| YouTube | Google OAuth client ID + secret, then **Connect with Google** | Videos only. Uploaded public with *altered or synthetic content* set. Set the consent screen to *In production*, or Google revokes access after 7 days |

Meta tokens are renewed automatically about once a week (they expire after 60 days unused). TikTok and X are prepared for you to post and then mark as posted: TikTok keeps API posts private until it audits the app, and X charges per API post.

**`PUBLIC_URL`** must be DeadChat's public https address (e.g. `https://deadchat.example.com`). Instagram and Threads download each image or video from a signed link under `/api/public/media/` that expires after 6 hours, and Google redirects YouTube sign-ins to `PUBLIC_URL/api/oauth/youtube/callback` (add that as an authorised redirect URI on the OAuth client).

**Setup:** text personas need a web search provider. Set `SEARXNG_URL` (recommended: self-hosted SearXNG) or `BRAVE_SEARCH_API_KEY`, or enter one in the wizard as an admin. The automation runs in the worker process (`RUN_WORKER`) and checks every minute.

## Screenplay

**Create → Screenplay** is a script editor in industry format (Final Draft / Fountain conventions) with an AI storyboard beside it. The AI never writes or changes the script.

- **Writing:** Scene Heading, Action, Character, Parenthetical, Dialogue, Transition, Shot, General and Centered elements. Enter moves to the usual next element, Tab / Shift-Tab change the element, Cmd/Ctrl+0–8 pick one directly, and scene headings, character names and transitions autocomplete. Undo/redo, scene numbers, page estimates and autosave are built in. Import and export Fountain and Final Draft (`.fdx`), and print or save a PDF with standard margins.
- **Shots:** pin a shot to a scene heading or action line and pick a shot type. DeadChat renders an example frame from that part of the script, its characters, the set plan and any reference images. When you revise the section, the frame re-renders once your edit settles, with the same seed, so the picture changes where the words did. Add a music cue to a shot and a short ACE-Step sketch plays from the card.
  - **What re-renders by itself:** only a change to the text of a shot's own script block (once your edit settles). Other changes mark the shot out of date and wait for its **refresh** button: the shot box (type, lens, seconds, music, adjustment notes), character profiles, the set plan, references and style. **Render now** refreshes every shot. **Re-roll** renders a new take straight away.
  - **Adjustment notes:** a list on each shot ("warmer light", "lower camera", "no car in the background"). Each note can be switched off without deleting it. On refresh, the chat model rewrites the frame's prompt to follow the notes that are on; a note wins where it conflicts with the script-built prompt. If the model fails, the notes are added to the prompt as written. The script is never changed.
  - **Hover:** hovering a shot highlights its script block, and hovering a script line highlights its shot.
  - **Lock:** the padlock on a shot keeps its frame and music exactly as they are. Nothing re-renders, not even when its script changes, on Render now, or on Re-roll, until you unlock it.
  - **Extras:** when the action mentions unnamed people (a crowd, waiters, passers-by), the prompt describes them as unrelated strangers with their own faces and clothes, so they don't copy a named character's look or outfit.
- **Character names:** cues autocomplete from the Characters tab and from anyone already speaking. Names also complete mid-line in action and dialogue (Enter, Tab or → accepts). A name that speaks but has no profile gets a placeholder profile in the Characters tab. Editing a placeholder keeps it; an untouched placeholder disappears if its cue was a typo you fixed.
- **Characters:** build out each character (human or not), refine a visual description, and generate reference photos. Appearance and wardrobe go into every shot the character is in; voice-over and off-screen cues don't put them in frame.
- **Set plan:** a top-down plan per scene with the cast, one camera per shot, lights and set pieces. Moving them changes the frame's staging (who's in frame and where, shot size, facing, camera height, light direction).
- **References:** upload photos for the whole script, a scene or a shot. They're described by the vision model, and that look is folded into the matching frames.

Music needs the ACE-Step checkpoint on the GPU box: `ace_step_v1_3.5b.safetensors` in `ComfyUI/models/checkpoints` (from Comfy-Org/ACE-Step_ComfyUI_repackaged).

## Medical cases

**Create → Medical cases** brings a case's evidence together and presents it with drill-down.

- **Evidence:** drop in files or whole folders.
  - DICOM: single images, ultrasound and angiography **cine loops**, CT/MRI series (slices are stacked into one scrollable item, ordered by position) and PDFs embedded in DICOM.
  - Photos, videos, PDFs, text and CSV lab exports.
  - Patient names, IDs and birth dates in DICOM headers are not kept. Text burned into images is, so each image has a "cover top" band for presenting.
  - Compressed DICOM previews support uncompressed, JPEG baseline and RLE. JPEG-LS, JPEG 2000 and MPEG-in-DICOM are stored and downloadable but not previewed yet.
- **Profile (optional):** demographics with BSA, presentation, history, medications, vitals, labs with trend charts (paste from a spreadsheet), a timeline, the clinical question and teaching points.
- **Overview:** the case at a glance (summary, timeline, evidence by category, lab trends, background). Every card opens a full viewer with notes and details; ← / → move through the case. Loops play with frame step, speed and brightness/contrast; stacks scroll with the mouse wheel.
- **Present:** full-screen slides (title, summary, background, each piece of evidence, labs, take-home points). ← / → move, N toggles notes, G shows all slides.
- **AI notes and summary:** optional drafts from the local Ollama model (images and sampled loop frames need a vision model, e.g. a medical one like Lingshu). They're labelled as drafts and editable. These are presentation aids, not diagnostic tools.
- **Sharing:** the owner shares a case with other members as **Can view** or **Can edit**. The case shows up in their list marked "shared by …".
  - **Viewers** see everything (profile, evidence, frames, analyses, the presentation) but can't change anything.
  - **Editors** can also change the profile and evidence, upload files and run analyses.
  - **Owner only:** deleting the case and changing who it's shared with. Admins have owner access.
  - **Leaving:** members can remove a shared case from their own list.
  - **Section access:** a member needs the Medical cases section to open it, and the share dialog flags anyone without it.
- **Full analysis** (in an item's drill-down): reviews **every frame** of a loop, stack, video or image.
  - **Pipeline dropdown:** General, Pediatric echo, Adult echo, Cath angiography, Cardiac MRI or CT. One is suggested from the DICOM modality and patient age, or from a first look at a frame when there's no metadata.
  - **Frame review:** a vision model (Qwen3-VL 32B recommended; any installed vision model works) reviews windows of 8 consecutive frames and returns timed observations. Clicking one jumps the viewer to that frame. Videos are read frame by frame in the browser first (up to 1,500 frames).
  - **Specialist models** run on the GPU box's [med-service](deploy/gpu-box/med-service/README.md) (PanEcho now; EchoAI-Peds, CineMA and TotalSegmentator listed but not ready). "Skip specialist models" runs only the frame review and report, and is the default when the service is offline.
  - **Combined report:** merges everything, naming which model reported each finding and where the models disagree.
  - **Timing:** each stage shows progress, elapsed time and an estimate (this run's pace, then earlier runs, then defaults). Runs can be canceled and resume after a restart. The model stays loaded during a run and is unloaded afterwards so ComfyUI gets the GPU back.

## Passwords

Anyone can change their own password with the key icon by their name in the sidebar (`/account/password`). Browsers' password managers find it through `/.well-known/change-password`. Changing it signs that account out everywhere else. New passwords need at least 8 characters and can't be the username.

When an admin creates a user or resets a password, the person is asked to choose their own password at their next sign-in. Until they do, they see only that screen and the API refuses everything else. The admin can untick this option in either form.

## Section permissions

Admins choose which sections each user can use under **Admin → Users → Edit**: Chat, Agents, Generate, Studio, Social Media, Screenplay, Medical cases and API access. "All sections" (the default, and what existing users have) includes sections added later. Admins always have everything.

Hidden sections disappear from the menu, and the server refuses their API calls (`403`, `code: tab_forbidden`), including chat over the WebSocket. API tokens only work for users with **API access**. Shared plumbing (jobs, media, uploads) stays available to every signed-in user, and Screenplay and Studio can still use the generation endpoints they need. Changes apply on the user's next request; they don't need to sign out.

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
