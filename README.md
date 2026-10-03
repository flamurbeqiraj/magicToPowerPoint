# Studio — AI presentation designer

A browser based presentation studio. Describe a talk, choose a slide count and visual direction, and the selected AI provider returns a typed presentation model. The app validates that model, renders it as safe SVG, and lets you edit the slides directly.

## Technology choice

- **Svelte 5 + TypeScript** for a small, reactive editor with strong types and little runtime overhead.
- **Vite 8** for fast local development and optimized builds.
- **Zod 4** for validating untrusted model output and keeping the presentation model typed.
- **SVG created from whitelisted elements** for crisp, scalable slides and a single render path for the editor, copy, and download actions.
- **Browser `fetch` provider adapters** for Ollama, LM Studio, and OpenAI-compatible chat endpoints; there is no required paid AI service or application server.

The project uses Vite's current stable major and therefore needs Node.js 20.19+ or 22.12+.

## Project structure

```text
index.html
src/
  App.svelte            Landing experience, editor, settings, and interaction state
  MiniSlide.svelte      Lightweight SVG thumbnail
  app.css               Responsive visual system
  main.ts               Svelte entry point
  lib/
    model.ts            Presentation types, JSON Schema, validation, themes, history helpers
    providers.ts        AI provider adapters, prompts, Ollama model discovery
    svg.ts              Safe SVG renderer and SVG clipboard/download helpers
    images.ts           ImageProvider interface for a future licensed image search service
```

## Install and run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production bundle, run `npm run build`; `npm run preview` serves that bundle locally. `npm run check` runs Svelte and TypeScript diagnostics.

## Use local Ollama

1. Install Ollama from the [official download page](https://ollama.com/download). On Windows, install the downloaded app; Ollama runs its local API in the background. macOS and Linux install instructions are on the same page.
2. In a terminal, download the default model:

   ```bash
   ollama pull qwen3:8b
   ```

   You can also start an interactive session with `ollama run qwen3:8b`. On systems where the app/service is not already running, start the API with `ollama serve`. Ollama's default local API URL is `http://localhost:11434`.
3. Leave the app's provider set to **Ollama · on this device**. The URL and model can be changed in the connection settings. Use the refresh button to discover installed models; the model field remains editable if discovery is unavailable.

Ollama supports JSON Schema constrained output through the `/api/chat` `format` option. The app uses that when available, falls back to JSON mode, and validates the result itself. [Ollama structured-output documentation](https://ollama.com/blog/structured-outputs)

## Use local LM Studio

1. Install [LM Studio](https://lmstudio.ai/) and download a model from its Discover tab.
2. Load the model, open the **Local Server** tab, and start the server. LM Studio's default API base URL is `http://localhost:1234/v1`.
3. Choose **LM Studio** in the app. The app queries `/v1/models` and lets you select a loaded model; leave the API key blank unless authentication is enabled in LM Studio. Use **Find models** after loading or switching models.

The app calls `{base URL}/chat/completions` using LM Studio's OpenAI-compatible API. The base URL should end in `/v1`, not `/chat/completions`. LM Studio must allow browser requests from the app's origin; enable its CORS option if needed.

## Configure a remote OpenAI-compatible API

Choose **OpenAI-compatible API**, then open connection settings and enter:

- **API base URL:** for example `https://api.openai.com/v1` (enter the base URL, not `/chat/completions`).
- **Model name:** the exact model identifier supported by your endpoint.
- **Bearer / access token:** paste the API access token into the password-style field.

The app calls `{base URL}/chat/completions` and sends the token in the `Authorization: Bearer …` header. The token stays in memory for the current page and is not written to local storage, the presentation, logs, or analytics. After a page refresh, paste it again. API providers must allow browser CORS requests from the app's origin; if they do not, place a trusted server-side proxy under your control between the browser and that API. The proxy should keep credentials server-side.

The remote adapter requests JSON Schema output and retries without that option for compatible APIs that do not implement it. The response still passes through the same strict validation and safe renderer.

## OIDC / OAuth architecture

The connection sheet includes issuer, client ID, redirect URI, and scopes for planning an enterprise OIDC setup. **Sign-in and token refresh are not wired up yet.** The model separates the token concepts so that a later PKCE flow can add them without mixing their roles:

- `OidcIdentity.idToken` represents the signed-in user's identity.
- `OAuthAccessCredential.accessToken` represents authorization to call an API.
- `ManualAccessCredential.accessToken` is a manually pasted API credential.

The remote provider only accepts the manually entered token or a future OAuth **access** token. It never reads or sends an OIDC ID token as an API credential. OIDC client secrets do not belong in this browser app.

## Presentation JSON model

`src/lib/model.ts` is the shared source of truth for AI output, validation, rendering, editing, local drafts, and future exporters. The model is independent of SVG:

```ts
type Presentation = {
  title: string;
  theme: {
    background: string; surface: string; primary: string; secondary: string;
    accent: string; textPrimary: string; textSecondary: string; fontFamily: string;
  };
  slides: Array<{
    id: string;
    layout?: string;
    elements: SlideElement[];
  }>;
};
```

Each slide uses a **1280 × 720** logical canvas. Elements are typed text, rectangles, rounded rectangles, circles, ellipses, lines, bullet lists, a whitelisted icon set, and an image request/placeholder. Validation limits slide and element counts, coordinates, dimensions, colors, URLs, text length, and each element's properties. Unsupported individual elements are skipped safely; malformed responses receive one bounded JSON extraction/repair attempt and then a clear error. Generated URLs are never fetched directly: image requests carry a search query and are intended to pass through `ImageProvider` for an approved source and attribution.

The renderer creates SVG nodes and attributes itself; it never inserts model-produced HTML or SVG. Text uses `textContent`, SVG elements and icon paths are whitelisted, and text boxes clip and wrap copy to their bounds. Presentation state is saved locally, separately from history and temporary editor state. Provider credentials are deliberately excluded from the saved draft.

## Add another AI provider

Implement `AIProviderAdapter` in `src/lib/providers.ts` with a `kind` and a `generate(prompt, schema, settings)` method that returns structured JSON text, then register it with `registerAIProvider(adapter)`. Add its settings fields and provider selector entry. Keep response normalization in the adapter and send all provider results through `validatePresentation`; never have a provider return DOM/SVG markup. If the new provider has model discovery, add it as a provider-specific optional method following `listOllamaModels`.

## Future native PPTX export

An exporter should accept `Presentation` from `model.ts` directly and map logical coordinates into PowerPoint's 16:9 page units (for example, `x / 1280 * pageWidth` and `y / 720 * pageHeight`). Map text to native text boxes, rectangles and circles to native shapes, lines to connectors, and curated images to native image relationships. Use each element's fill, stroke, opacity, rotation, and typography properties. Keep the SVG renderer as a separate output adapter; do not parse SVG to create PowerPoint. This allows JSON to remain the shared source for SVG, editable PPTX, PNG, and PDF.

## Current scope

The app implements local and remote AI generation, a slide-level AI redesign, AI edit instructions, drag/reorder/duplicate/add/delete, direct move/resize, double-click text editing, common properties, undo/redo, responsive thumbnails, local draft recovery, SVG download, and SVG clipboard copy. OIDC sign-in, image retrieval, and PPTX/PNG/PDF export are deliberately extension points rather than live integrations.
