# ai-boardroom

AI Boardroom is an MVP boardroom for AI-led discussion and planning. The current product uses OpenAI only today and is intentionally scoped to stay simple while keeping the codebase ready for future multi-provider expansion.

## Product direction

- Current MVP: an OpenAI-based boardroom with a small model selector for supported OpenAI runs.
- Future direction: a multi-provider boardroom that can expand to providers such as OpenAI, Anthropic, and Google, plus external execution tools.
- Discussion and planning are stable.
- Execute mode now supports a first narrow real-output path for simple static websites: generated HTML, CSS, JavaScript, JSON, and markdown files.
- Richer execution workflows, external tooling, and full app build pipelines are still future work.

## Model selection

- MVP currently supports selecting between OpenAI models only.
- The default model is the cheaper option: `gpt-4.1-mini`.
- Heavier tasks can be switched to `gpt-5.4`.
- OpenAI response controls are model-dependent: `gpt-4.1-mini` runs without an explicit reasoning block and uses supported `medium` verbosity, while `gpt-5.4` may use explicit reasoning controls with the supported `low` effort setting.
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

## Execute Mode Output

When Live execution reaches the Builder in Execute mode, the app now expects a structured file bundle instead of a markdown-only implementation note.

- Allowed generated file types are `.html`, `.css`, `.js`, `.json`, and `.md`.
- For website-style requests, success requires at least one generated file and an `index.html` entry file.
- The Preview panel shows a generated file list, a file viewer, an in-app iframe preview using local bundle assets, and a ZIP download.
- The current scope is intentionally narrow: simple static HTML/CSS/JS sites only. React, Vite, shell execution, external deployment, and third-party build tools are not part of this MVP.

Manual test prompt:

```text
Create a simple todo web app in HTML, CSS and JavaScript.
```