# Resume editor

LaTeX resume editor with PDF compile and AI suggestions against a job description.

## Ports

| Service  | Port | Command |
|----------|------|---------|
| Backend  | 3002 | `cd backend && npm run dev` |
| Frontend | 5174 | `cd frontend && npm run dev` |

The Vite dev server proxies `/api` to `http://localhost:3002`.

## Environment

Create `backend/.env` with:

- `OPENAI_API_KEY` — required for **Suggest** and persona distillation. If unset, the server still starts; `/api/health` reports `openai_configured: false`. The server may also load the key from `job_automation/backend/.env` (see `server.ts`).
- `DEEPSEEK_API_KEY` — *recommended.* Enables the **Reasoning** stage of the multi-model pipeline (DeepSeek-V4-Pro with thinking mode). Falls back to OpenAI when missing.
- `GEMINI_API_KEY` — *optional.* Enables the **LaTeX alignment** stage on Gemini 3.1 Pro. Falls back to OpenAI `gpt-5.3-codex` when missing.

Model identifiers are env-overridable for forward-compat (see `backend/src/llm/clients.ts`):
`RESUME_REASONING_MODEL`, `RESUME_WRITING_MODEL`, `RESUME_LATEX_MODEL`, `RESUME_LATEX_FALLBACK_MODEL`.

## AI suggestions (multi-model pipeline)

1. Paste or load a `.tex` resume and a job description.
2. Click **Suggest**. The backend runs a 3-stage pipeline:
   1. **Reasoning** — DeepSeek-V4-Pro audits the JD vs the resume **with the user's persona as a quality bar**, and emits a structured plan (`backend/src/llm/reasoning.ts`). E.g. if the persona demands the XYZ format with metrics, bullets without numbers are flagged as `quantify` targets.
   2. **Writing + Persona check** — OpenAI GPT-5.5 receives the persona as the LEAD section of its system prompt and follows a 4-step internal workflow per bullet: read persona → draft → self-check against persona rules (XYZ format, banned words, preferred verbs, metric required?) → revise if any check fails (`backend/src/llm/writing.ts`).
   3. **LaTeX alignment** — Gemini 3.1 Pro (or GPT-5.3-Codex fallback) validates and repairs LaTeX safety: balanced braces, preserved `\\command` set, escaped specials (`#`, `%`, `&`, `_`) (`backend/src/llm/latex.ts`).

### Persona

The user's voice is loaded from `Priyabrata_persona/` (`Instuction.txt`, `Priyabrata_Writing.json`) and is reused on every Suggest call. Status is visible in `/api/health` (`persona.source`, `persona.chars`) and in the status-bar pill (`Persona on · Priyabrata_persona/`). Each stage logs the active persona size, e.g. `[writing] model=gpt-5.5 items=12 persona=3873ch`.
3. A deterministic post-pass (`sanitizeSuggestionsForLatex`) re-escapes any remaining unescaped LaTeX specials so AI-written `C#` / `30%` / `R&D` never break compile.
4. Suggestions are then reconciled against current line numbers, validated, and ranked. The endpoint returns the **top 10** by priority and JD keyword count.

### Apply all in one click

The toolbar shows **Apply all N** whenever there are pending suggestions. Applies them in descending line order (so deletions don't shift later targets), pushes one undo entry per change, and skips any item that would break the LaTeX list structure. Skipped items appear in a one-line summary at the top of the editor.

## Backend tests

```bash
cd backend && npm test
```

## API smoke (Suggest)

With the backend running and `OPENAI_API_KEY` set:

```bash
cd backend && npm run smoke:suggest
```

This posts `fixtures/suggest-smoke.json` and checks the response shape (including `suggestions.length <= 10`).
