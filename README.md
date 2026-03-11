# ai-boardroom

AI Boardroom is an MVP boardroom for AI-led discussion and planning. The current product uses a single OpenAI model today and is intentionally scoped to stay simple while keeping the codebase ready for future multi-provider expansion.

## Product direction

- Current MVP: a single-model, OpenAI-based boardroom.
- Future direction: a multi-provider boardroom that can expand to providers such as OpenAI, Anthropic, and Google, plus external execution tools.
- Discussion and planning work now; true execution workflows will be expanded next.

## OpenAI Setup

### Local development

1. Copy `.env.example` to `.env.local`.
2. Set your key:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.4
```

3. Run the app:

```bash
npm run dev
```

`OPENAI_API_KEY` is read only on the server in `app/api/ai/respond/route.ts`. It is never exposed to browser code.

The MVP currently uses one OpenAI model for boardroom responses. Future versions may add multiple providers, but multi-provider orchestration is not implemented yet.

### Netlify

1. Open Site configuration -> Environment variables.
2. Add:
	- `OPENAI_API_KEY` = your production key
	- `OPENAI_MODEL` = `gpt-5.4`
3. Redeploy the site so the new variables are applied.

## Simulation Mode

Each project has a `Simulation mode` toggle in the sidebar.

- `ON` (default): fully simulated behavior.
- `OFF`: uses real OpenAI calls for debate agents (`Strategist`, `Skeptic`, `Pragmatist`) and planner task-graph generation.

If an OpenAI call fails, the app writes a readable error to the Execution Log and falls back to simulation for that step.