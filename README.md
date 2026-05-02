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

## AI suggestions

1. Paste or load a `.tex` resume and a job description.
2. Click **Suggest**. The backend calls OpenAI (`gpt-4o-mini`), reconciles line numbers, validates LaTeX safety (protected lines, balanced braces, preserved `\\command` set), then returns the **top 10** suggestions by priority and JD keyword count (`MAX_SUGGESTIONS_RETURNED` in `backend/src/suggestPipeline.ts`).

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
