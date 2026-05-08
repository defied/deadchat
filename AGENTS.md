# AGENTS.md — Add `/v1/messages` Anthropic-compat endpoint to deadchat

## Goal

Claude Code (and the Anthropic SDK in general) speaks the **Anthropic Messages API** at `POST /v1/messages`. Deadchat currently only exposes Ollama-native (`/api/chat`) and OpenAI-compat (`/v1/chat/completions`) routes via `backend/src/routes/publicApi.ts`. Add a new public, API-token-authed `POST /v1/messages` endpoint that translates Anthropic-format requests/responses to Ollama-format and back, with streaming support.

When this is done, a user should be able to run Claude Code with:
```bash
export ANTHROPIC_BASE_URL="https://deadchat.deadplanet.net"
export ANTHROPIC_AUTH_TOKEN="dc_live_..."
export ANTHROPIC_MODEL="qwen3.6"   # or whatever Ollama model name is enabled
```
…and have it work end-to-end, including tool use.

## Scope

**In scope (v1):**
- Non-streaming and streaming `POST /v1/messages`
- Text content blocks
- `system` parameter (string or content-block array)
- `tools` and `tool_choice`
- `tool_use` blocks (assistant) and `tool_result` blocks (user)
- `max_tokens`, `temperature`, `top_p`, `top_k`, `stop_sequences`
- Bumping body size limits (Express + ingress)
- Lightweight unit tests for the translation functions

**Out of scope (defer):**
- Image content blocks (assistant-side; Claude Code doesn't send them)
- Prompt caching (`cache_control`) — accept and ignore (no-op)
- `metadata` field — accept and ignore
- Token-counting endpoint (`/v1/messages/count_tokens`)

## Files

### Create

- `backend/src/services/anthropicTranslate.ts` — pure translation functions, no I/O
- `backend/src/routes/anthropicCompat.ts` — Express route handler
- `backend/src/types/anthropic.ts` — TypeScript types for the Anthropic Messages API surface we use
- `backend/src/services/anthropicTranslate.test.ts` — `node:test` unit tests

### Modify

- `backend/src/app.ts` — bump body parser limits; mount the new router (before JWT routes, alongside `publicApiRoutes`)
- `deploy/k8s/deadchat.yaml:172` — `nginx.ingress.kubernetes.io/proxy-body-size: "32m"`
- `deploy/helm/deadchat/templates/ingress.yaml:14` — same value
- `backend/package.json` — add `"test": "node --test --import=tsx dist/**/*.test.js"` (or equivalent; pick whatever runs `node:test` against compiled TS, or use `tsx`/`ts-node` to run sources directly)
- `deadchat/README.md` — short note that `POST /v1/messages` is supported for Anthropic SDK / Claude Code clients

## Implementation steps

### Step 1 — bump body size

`backend/src/app.ts` lines 20–21:
```ts
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));
```

`deploy/k8s/deadchat.yaml:172` and `deploy/helm/deadchat/templates/ingress.yaml:14`:
```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "32m"
```

### Step 2 — types

In `backend/src/types/anthropic.ts`, define minimal types for the request and the response/stream shape. You don't need to model every Anthropic edge case — just what we accept and emit. Roughly:

- `AnthropicMessagesRequest` with: `model`, `max_tokens`, `messages`, optional `system`, `temperature`, `top_p`, `top_k`, `stop_sequences`, `stream`, `tools`, `tool_choice`, `metadata`
- `AnthropicContentBlock` discriminated union: `text`, `image`, `tool_use`, `tool_result`
- `AnthropicMessage` with `role: 'user' | 'assistant'` and `content: string | AnthropicContentBlock[]`
- `AnthropicTool` with `name`, `description`, `input_schema`
- `AnthropicToolChoice`: `{type: 'auto'|'any'|'tool'|'none', name?: string, disable_parallel_tool_use?: boolean}` (also accept the bare string `"auto"` etc. for forward-compat)
- `AnthropicResponse`, `AnthropicStreamEvent` (the discriminated union of SSE event payloads)

Keep types narrow and non-strict on unknown fields (use `Record<string, unknown>` for things like `input_schema` and tool inputs).

### Step 3 — translation functions

`backend/src/services/anthropicTranslate.ts` — three pure functions. **No `fetch`, no `res.write`, no DB calls in this file.** It must be unit-testable in isolation.

#### 3a. `anthropicToOllamaRequest(req: AnthropicMessagesRequest): OllamaChatRequest`

**Top-level mapping:**

| Anthropic | Ollama |
|---|---|
| `model` | `model` (pass-through) |
| `max_tokens` (required) | `options.num_predict` |
| `temperature` | `options.temperature` |
| `top_p` | `options.top_p` |
| `top_k` | `options.top_k` |
| `stop_sequences` | `options.stop` |
| `stream` | `stream` (pass-through) |
| `tools` | `tools` (translated, see below) |
| `tool_choice` | (best-effort, see below) |
| `metadata` | (drop) |
| `system` | prepended as `{role: 'system', content: ...}` (see below) |

**`system` parameter:**
- If string: emit one `{role: 'system', content: <string>}` message at the front of `messages`.
- If array of content blocks: concatenate the `text` fields of all `text`-typed blocks (joined by `\n\n`); ignore non-text blocks (don't error). Same emission as above.
- If absent: no system message added.

**Per-message translation** (`messages: AnthropicMessage[]` → `OllamaMessage[]`):

For each input message, the translation may produce **one or more output messages**:

- **role `user`, content string**: `{role: 'user', content: <string>}`.
- **role `assistant`, content string**: `{role: 'assistant', content: <string>}`.
- **content array** — walk the blocks, accumulating:
  - `text` blocks → concatenate into a `content` string (joined by `\n\n` if multiple).
  - `image` blocks (assistant or user) → in v1, drop with a debug log; do not error.
  - `tool_use` blocks (assistant only) → collect into `tool_calls: [{id, type:'function', function:{name, arguments: JSON.stringify(input)}}]`. Emit one assistant message that combines the accumulated text (if any) + `tool_calls`.
  - `tool_result` blocks (user only) → emit a separate `{role: 'tool', tool_call_id: block.tool_use_id, content: <string>}` message **for each** tool_result block. The block's `content` may be:
    - a string → use as-is
    - an array of content blocks → concatenate the `text` blocks (same rule as `system`)
    - if `is_error: true`, prefix the content with `"[error] "` so the model sees it
  - If the same `user` message has both text/non-tool blocks AND `tool_result` blocks, emit the tool messages first, then a separate `{role:'user', content:<text>}` if there's leftover text.

Order is preserved across messages.

**`tools` translation:**
```ts
{type: 'function', function: {name, description, parameters: input_schema}}
```
If `input_schema` is missing or not an object, default to `{type: 'object', properties: {}}`.

**`tool_choice`:**
- `'auto'` or `{type:'auto'}` → omit (Ollama default).
- `'none'` or `{type:'none'}` → omit `tools` from the upstream request entirely (forces no tool calls).
- `{type:'any'}` or `{type:'tool', name:...}` → pass `tools` through; document in the route or a comment that "force-tool" is best-effort and depends on the model. Do NOT fail on these.

**Server-side options merge:** after building the Ollama request, merge `getOptionsForModel(req.model)` from `services/modelSettings.ts` over the top of `options` (server defaults take priority? — match the existing convention in `publicApi.ts:113` `mergeOptions`, which puts server first then client; do the same here so server-admin-set options can be overridden by client only when explicit).

#### 3b. `ollamaToAnthropicResponse(resp: OllamaChatResponse, requestModel: string): AnthropicResponse`

Build:
```ts
{
  id: `msg_${randomUUID()}`,
  type: 'message',
  role: 'assistant',
  model: requestModel,
  content: [...],            // see below
  stop_reason: ...,           // see below
  stop_sequence: null,
  usage: {
    input_tokens: resp.prompt_eval_count ?? 0,
    output_tokens: resp.eval_count ?? 0,
  },
}
```

**`content` array:**
- If `resp.message.content` is non-empty: push `{type:'text', text: <content>}`.
- For each `tool_call` in `resp.message.tool_calls ?? []`: push `{type:'tool_use', id: tc.id ?? \`toolu_${randomUUID()}\`, name: tc.function.name, input: <parsed>}`. `tc.function.arguments` may be a string OR an already-parsed object (Ollama is inconsistent here): if string, `JSON.parse` it (catch + fallback to `{}`); else use as-is.
- If both empty, push `{type:'text', text:''}` (Anthropic clients expect at least one block).

**`stop_reason`:**
- If any `tool_use` block was emitted → `'tool_use'` (overrides everything).
- Else if `resp.done_reason === 'length'` → `'max_tokens'`.
- Else if model emitted text that ends with one of `req.stop_sequences` → `'stop_sequence'` and set `stop_sequence` to the matched value. (Detect by suffix match.)
- Else → `'end_turn'`.

#### 3c. `ollamaStreamToAnthropicSSE(reader: ReadableStreamDefaultReader<Uint8Array>, requestModel: string, stopSequences?: string[]): AsyncGenerator<string>`

Yields fully-formatted SSE strings ready to write to the response (each yielded string ends with `\n\n`). Format per event:
```
event: <name>
data: <json>

```

**Event sequence the route must emit:**

1. `message_start` — emit immediately, before reading any upstream chunks:
   ```json
   {"type":"message_start","message":{"id":"msg_<uuid>","type":"message","role":"assistant","content":[],"model":"<requestModel>","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}
   ```

2. As Ollama NDJSON chunks arrive, parse line-by-line. State machine across chunks:
   - **First text seen** → emit `content_block_start` for index 0 with `{type:'text', text:''}`, then `content_block_delta` with `{type:'text_delta', text:<chunk>}`. Mark text block open.
   - **Subsequent text chunks** → emit `content_block_delta`.
   - **First `tool_calls` chunk seen** → if a text block is open, emit `content_block_stop` for it first. Then for each tool call in the chunk, emit `content_block_start` with `{type:'tool_use', id, name, input:{}}` and one `content_block_delta` with `{type:'input_json_delta', partial_json: JSON.stringify(input)}`. Index increments per tool block.
     - Note: Ollama typically delivers a tool call in a single chunk (not a stream of partials). Emit it as `start` + one `input_json_delta` carrying the whole stringified input + `stop`. This is valid per the Anthropic streaming spec.
   - Track `prompt_eval_count` / `eval_count` from any chunk that includes them (final chunk usually does).

3. After the upstream stream signals `done: true` (or the reader closes):
   - Emit `content_block_stop` for the last open block.
   - Emit `message_delta` with the final `stop_reason` / `stop_sequence` and `usage: {output_tokens: <eval_count>}`.
   - Emit `message_stop`.

4. Optionally emit `event: ping\ndata: {"type":"ping"}\n\n` every ~15s to keep proxies from timing out. (Implement via a `setInterval` in the route, not the generator.)

**On upstream error mid-stream**: emit an `event: error\ndata: {"type":"error","error":{"type":"api_error","message":"..."}}\n\n` if headers are already sent; otherwise return a JSON 502 (handled in the route, not the generator).

### Step 4 — route

`backend/src/routes/anthropicCompat.ts`. Pattern:

```ts
import { Router, Request, Response } from 'express';
import { authenticateApiToken } from '../middleware/apiToken';
import { config } from '../config';
import { logUsage } from '../services/usage';
import {
  anthropicToOllamaRequest,
  ollamaToAnthropicResponse,
  ollamaStreamToAnthropicSSE,
} from '../services/anthropicTranslate';

const router = Router();

router.post('/v1/messages', authenticateApiToken, async (req: Request, res: Response) => {
  // 1. validate minimum required fields (model, messages, max_tokens); 400 on missing
  // 2. translate to Ollama request
  // 3. fetch upstream; if !resp.ok, return 502 with a JSON Anthropic-shaped error envelope
  // 4. if stream === true: set SSE headers, pipe via ollamaStreamToAnthropicSSE
  //    if false: read full JSON, translate via ollamaToAnthropicResponse, send 200 JSON
  // 5. always logUsage(req.user!.id, null, 'public:/v1/messages', model, promptTokens, evalTokens, durationMs) in finally
});

export default router;
```

SSE response headers:
```ts
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.flushHeaders();
```

Handle client disconnect: `req.on('close', () => reader.cancel().catch(() => {}))` — same pattern as `publicApi.ts:67-70`.

Mount in `app.ts` alongside `publicApiRoutes`:
```ts
app.use(anthropicCompatRoutes);   // before JWT routes
```

### Step 5 — error envelope

When returning errors (validation, upstream failure, etc.), use Anthropic's shape so SDKs surface them correctly:
```json
{"type":"error","error":{"type":"invalid_request_error","message":"..."}}
```
Common types: `invalid_request_error` (400), `authentication_error` (401), `not_found_error` (404), `api_error` (5xx), `overloaded_error` (529).

### Step 6 — tests

`backend/src/services/anthropicTranslate.test.ts` using `node:test`:

- Request translation:
  - Plain text user → Ollama with one user message
  - `system` as string → system message prepended
  - `system` as content-block array → concatenated text in one system message
  - `tool_use` (assistant) + `tool_result` (user) → assistant with `tool_calls`, then `role: 'tool'` message with `tool_call_id`
  - `tool_result.content` as array of text blocks → concatenated
  - `is_error: true` → content prefixed with `[error]`
  - `tools` array → translated to OpenAI-style function tool format
  - `tool_choice: 'none'` → upstream `tools` omitted
  - `max_tokens` → `options.num_predict`
- Response translation:
  - Text-only Ollama response → one text block, `stop_reason: 'end_turn'`
  - `done_reason: 'length'` → `stop_reason: 'max_tokens'`
  - Response with `tool_calls` → `tool_use` block + `stop_reason: 'tool_use'`
  - `arguments` as string vs object — both round-trip
- Streaming (drive the generator with a mock async iterable of NDJSON lines):
  - Pure text → `message_start` → `content_block_start(text)` → N × `content_block_delta(text_delta)` → `content_block_stop` → `message_delta` → `message_stop`
  - Tool call after text → both blocks emitted with correct indices
  - `eval_count` from final chunk → propagated into `message_delta.usage.output_tokens`

Run with `npm test` after `npm run build`.

### Step 7 — README

Add a short section to `deadchat/README.md` (and/or `backend/README.md` if it exists) explaining that `POST /v1/messages` is supported, listing the env vars Claude Code users should set, and noting current limitations (no images, no prompt caching, tool support depends on the underlying Ollama model).

## Verification (the implementing agent must do this before declaring done)

1. `npm run build` in `backend/` — clean.
2. `npm test` in `backend/` — all translation tests pass.
3. **Local smoke test** without k8s:
   ```bash
   cd backend && npm run dev
   # in another shell, with a valid dc_live_ token:
   curl -N -H "Authorization: Bearer dc_live_..." \
        -H "Content-Type: application/json" \
        -d '{"model":"qwen3.6","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"say hi in 5 words"}]}' \
        http://localhost:3000/v1/messages
   ```
   Confirm: `event: message_start` appears, then `content_block_delta` events with text, then `message_stop`.
4. **Non-streaming** smoke test (same `curl` without `-N` and `"stream":false`): returns a single JSON Anthropic message.
5. **Tool round-trip** smoke test with a small `tools` array — confirm `tool_use` block appears in the response when the model decides to call.
6. **Claude Code end-to-end**: run `claude` from a shell with the env vars at the top of this doc, send "hello", confirm a response comes back. Then ask it to read a file — confirm tool calls round-trip.

## Out-of-scope follow-ups (do NOT do in this PR)

- Image content blocks (will need base64 → Ollama `images` field; defer until a user actually needs it)
- Prompt caching headers (Ollama has no equivalent; would need a separate caching layer)
- `/v1/messages/count_tokens` endpoint
- Rate limiting (orthogonal, applies to all public API routes)

## Code quality bar

- No `any` in new code unless justified by an inline comment. Prefer `unknown` + narrowing.
- Translation functions are pure: no `fetch`, no `console.log` in the hot path, no DB calls. Pass everything in via params.
- Keep `anthropicTranslate.ts` under ~300 lines; if it gets larger, split request/response/stream into separate files.
- Match existing style in `publicApi.ts` (Router pattern, error handling, `logUsage` in `finally`).
- Match existing style for limits/options handling — reuse `getOptionsForModel` and `mergeOptions`-equivalent logic.
- No new runtime dependencies. Use built-in `crypto.randomUUID()` for IDs, native `fetch`, `node:test` for tests.

## When done

Open a PR with title `feat(backend): add /v1/messages Anthropic-compat endpoint` and a body listing:
1. The new files and modified files (with line refs)
2. The verification steps that were run and their output (paste the SSE smoke-test output)
3. Any deviations from this spec, with reasoning
