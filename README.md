# ai-boardroom

## OpenAI Setup

### Local development

1. Copy `.env.example` to `.env.local`.
2. Set your key:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

3. Run the app:

```bash
npm run dev
```

`OPENAI_API_KEY` is read only on the server in `app/api/ai/respond/route.ts`. It is never exposed to browser code.

### Netlify

1. Open Site configuration -> Environment variables.
2. Add:
	- `OPENAI_API_KEY` = your production key
	- `OPENAI_MODEL` = `gpt-4.1-mini` (or another supported model)
3. Redeploy the site so the new variables are applied.

## Simulation Mode

Each project has a `Simulation mode` toggle in the sidebar.

- `ON` (default): fully simulated behavior.
- `OFF`: uses real OpenAI calls for debate agents (`Strategist`, `Skeptic`, `Pragmatist`) and planner task-graph generation.

If an OpenAI call fails, the app writes a readable error to the Execution Log and falls back to simulation for that step.