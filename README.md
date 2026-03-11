# ai-boardroom

AI Boardroom is an MVP boardroom for AI-led discussion and planning. The current product uses OpenAI only today and is intentionally scoped to stay simple while keeping the codebase ready for future multi-provider expansion.

## Product direction

- Current MVP: an OpenAI-based boardroom with a small model selector for supported OpenAI runs.
- Future direction: a multi-provider boardroom that can expand to providers such as OpenAI, Anthropic, and Google, plus external execution tools.
- Discussion and planning work now; true execution workflows will be expanded next.

## Model selection

- MVP currently supports selecting between OpenAI models only.
- The default model is the cheaper option: `gpt-4.1-mini`.
- Heavier tasks can be switched to `gpt-5.4`.
- Future versions may support multiple providers, but provider selection is not implemented yet.

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

If the user does not explicitly pick a model for a run, the app falls back to `OPENAI_MODEL` on the server, and then to `gpt-4.1-mini`.

### Netlify

1. Open Site configuration -> Environment variables.
2. Add:
	- `OPENAI_API_KEY` = your production key
	- `OPENAI_MODEL` = `gpt-4.1-mini`
3. Redeploy the site so the new variables are applied.

## Simulation Mode

Each project has a `Simulation mode` toggle in the sidebar.

- `ON` (default): fully simulated behavior.
- `OFF`: uses real OpenAI calls for debate agents (`Strategist`, `Skeptic`, `Pragmatist`) and planner task-graph generation.

If an OpenAI call fails, the app writes a readable error to the Execution Log and falls back to simulation for that step.