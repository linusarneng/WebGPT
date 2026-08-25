# WebGPT

A ChatGPT-inspired chat interface that runs a real language model **entirely inside your browser tab**.
There is no inference backend, no API key, no account, and no telemetry. After the model files are
downloaded once, every token is generated on your own device.

> **Honest expectations:** WebGPT runs `onnx-community/Qwen2.5-0.5B-Instruct`, a 0.5-billion-parameter
> open model. It is fast, private, and genuinely useful for short questions, drafting, and small code
> snippets. It is **not** comparable to a large hosted assistant such as ChatGPT — it will be weaker at
> reasoning, long context, and factual recall, and it can be confidently wrong.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Then click **Load local AI** in the empty state. Nothing is downloaded until you do.

Other commands:

```bash
npm run build        # type-check (tsc --noEmit) + production build to dist/
npm run preview      # serve the production build on http://localhost:4173
npm run test         # Vitest unit and integration tests
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright browser tests (desktop + mobile projects)
```

`npm run test:e2e` builds the app and serves it on port 4173 automatically.

---

## How it works

```
main thread                          Web Worker
───────────                          ──────────
ui/*  ──▶ state/chat-store  ──▶  inference/inference-client ──▶ inference/ai.worker
              │                        (typed protocol)              │
              ▼                                                @huggingface/transformers
     storage/chat-repository                                    (WebGPU or WASM)
        (IndexedDB)
```

- **The main thread never imports Transformers.js.** All model loading and generation happens in
  `src/inference/ai.worker.ts`, so downloading and decoding never freeze the interface.
- `src/inference/protocol.ts` defines a discriminated-union message contract in both directions:
  commands (`initialize`, `generate`, `abort`, `dispose`) and events (`status`, `progress`, `ready`,
  `token`, `complete`, `aborted`, `error`).
- `src/state/chat-store.ts` holds immutable chat state and is the only place that decides whether a
  late token, completion, or error is still allowed to modify a reply.
- `src/ui/markdown.ts` renders assistant output by building DOM nodes and assigning `textContent`.
  **No model or user text is ever passed through `innerHTML`.**

## Models, cache, performance, and browser support

WebGPT intentionally exposes **exactly three** local, browser-compatible ONNX models. Qwen2.5 remains the default; pick a different model from the first-run card or the top-bar model control. Choosing a model only changes the pending selection. It persists in `localStorage`, releases any currently resident worker pipeline, retains conversations, and requires an explicit **Load** before downloading or running the new model.

| Model | Hugging Face repository | First download | Best for |
|---|---|---:|---|
| **Qwen2.5 0.5B Instruct (default)** | `onnx-community/Qwen2.5-0.5B-Instruct` | ~500 MB | The recommended balance for general chat and short writing |
| Granite 4.0 350M | `onnx-community/granite-4.0-350m-ONNX-web` | ~360 MB | The smallest local download |
| Qwen3 0.6B | `onnx-community/Qwen3-0.6B-ONNX` | ~590 MB | More headroom for longer, harder prompts |

Weights are fetched directly from the Hugging Face CDN only when you explicitly load a model. The browser HTTP cache stores each model independently; clearing site data/cache can require another download. Prompts and replies are never sent with those weight requests.

**WebGPU is strongly preferred.** WebGPT calls `navigator.gpu.requestAdapter()` inside the worker and uses WebGPU when an adapter is returned. Recent Chrome/Edge desktop and Safari on current macOS/iOS are the most practical targets. Without WebGPU, it falls back to CPU/WASM and says so plainly; CPU generation is noticeably slower.

> **Tailscale note:** a page served over plain HTTP through a Tailscale address cannot use WebGPU because browsers require a secure context for WebGPU. Use HTTPS (or open the app on `localhost`) when testing WebGPU remotely. WebGPT has no backend and does not require Tailscale.

Practical requirements: a modern browser, a few GB of free RAM, and enough disk space for cached weights. Older phones and low-memory machines may fail to allocate a model; the load error is recoverable and keeps the conversation intact.

### Model configuration

The catalog and generation settings live in `src/config/model.ts`; preference persistence lives in `src/storage/model-preference.ts`. Keep model ids, dtypes, and approximate download sizes accurate to the ONNX artifacts each repository publishes.

## Privacy

- **Your prompts and replies never leave your device.** They are processed by the model running in
  this browser tab. There is no application backend to send them to.
- **Model weights are fetched from Hugging Face** (`huggingface.co`) on first load and whenever the
  browser cache is cleared. That request contains no prompt data.
- **Conversations are stored locally in IndexedDB** under the database name `webgpt`. Deleting a
  conversation removes it from that database; clearing site data removes everything.
- If IndexedDB is unavailable — private browsing, blocked storage, or an exhausted quota — WebGPT
  falls back to in-memory storage for the session and shows a banner saying history will not persist.
- No analytics, no telemetry, no cookies, no accounts.

## Behaviour worth knowing

- **Stop** interrupts generation and keeps whatever text had already streamed, marked as stopped.
- **Errors are recoverable.** A failed reply keeps your original prompt and offers Retry; a failed
  model load offers Try loading again. Neither discards the conversation.
- **Switching chats mid-generation is safe.** The reply keeps streaming into the conversation it
  started in and is never rendered into a different one.
- **A reply interrupted by a page reload** is restored as stopped (with its partial text) or failed,
  never as a permanently spinning message.
- Only one generation runs at a time; the composer turns into a Stop button while it does.

## Project layout

```
src/
  app.ts                     App composition: wires store, worker client and UI
  main.ts                    Browser entry point
  styles.css                 Design system, layout, responsive + reduced-motion rules
  config/model.ts            Model id, dtypes, generation and context settings
  domain/chat.ts             Conversation/Message types and title derivation
  state/chat-store.ts        Immutable observable chat state
  storage/chat-repository.ts IndexedDB persistence with in-memory fallback
  inference/
    protocol.ts              Typed worker message contract
    inference-client.ts      Worker lifecycle (no Transformers.js import)
    ai.worker.ts             Transformers.js pipeline, streaming, abort
  ui/                        app-shell, sidebar, chat-view, composer, model-status, markdown
tests/                       Vitest unit + integration tests
e2e/                         Playwright specs and the injected mock worker
```

## Testing notes

`e2e/mock-worker.ts` installs a scripted stand-in for the inference worker via
`window.__WEBGPT_WORKER_FACTORY__` before the app boots. That seam lets the Playwright suite exercise
the full interface — loading, streaming, stop, persistence, error recovery, mobile drawer — without
downloading half a gigabyte of weights on every run. The hook is only ever set by tests; normal
browser usage always creates the real worker.

## Scope

v1 is deliberately text-only: no accounts, server APIs, file uploads, tools, model picker, voice, or
deployment configuration.
