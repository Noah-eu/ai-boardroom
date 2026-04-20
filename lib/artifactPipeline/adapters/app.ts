import { ExecutionOutputBundle } from '../../../types';

interface AppStructuredModel {
  family: 'app';
  runId: string;
  schemaId: string;
  appName: string;
  screens: Array<{ id: string; name: string; purpose: string; fields: string[] }>;
}

interface RenderAppInput {
  model: AppStructuredModel;
  runId: string;
  localeMode: { type: 'single'; targetLanguage: 'en' | 'cz' } | { type: 'multilingual'; locales: Array<'en' | 'cz'> };
}

export function renderAppArtifact(input: RenderAppInput): ExecutionOutputBundle {
  const cards = input.model.screens
    .map((screen) => {
      const fields = screen.fields.map((field) => `<li>${field}</li>`).join('');
      return `<article class="screen"><h2>${screen.name}</h2><p>${screen.purpose}</p><ul>${fields}</ul></article>`;
    })
    .join('\n');

  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${input.model.appName}</title>`,
    '  <link rel="stylesheet" href="styles.css" />',
    '</head>',
    '<body>',
    `  <h1>${input.model.appName}</h1>`,
    `  <section class="grid">${cards}</section>`,
    '  <script src="app.js"></script>',
    '</body>',
    '</html>',
  ].join('\n');

  const stylesCss = [
    ':root { --bg: #eef6ff; --surface: #fff; --fg: #0f172a; --border: #c7d8ec; }',
    'body { margin: 0; padding: 1rem; background: radial-gradient(circle at 20% 20%, #d7ecff, #eef6ff); color: var(--fg); font-family: "Trebuchet MS", Verdana, sans-serif; }',
    'h1 { margin-top: 0; }',
    '.grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }',
    '.screen { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0.9rem; }',
  ].join('\n');

  const appJs = [
    'const model = ' + JSON.stringify(input.model) + ';',
    "console.info('[artifact-pipeline] app bundle ready', { runId: model.runId, screens: model.screens.length });",
  ].join('\n');

  return {
    status: 'success',
    summary: `App bundle emitted from structured schema ${input.model.schemaId}.`,
    files: [
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      { path: 'app.js', content: appJs },
    ],
    notes: ['App adapter rendered from current-run structured model only.'],
    removePaths: [],
  };
}
