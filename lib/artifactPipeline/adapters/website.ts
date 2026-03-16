import { ExecutionOutputBundle } from '../../../types';

interface WebsiteStructuredModel {
  family: 'website';
  runId: string;
  schemaId: string;
  title: string;
  sections: Array<{ id: string; heading: string; body: string }>;
}

interface RenderWebsiteInput {
  model: WebsiteStructuredModel;
  runId: string;
  localeMode: { type: 'single'; targetLanguage: 'en' | 'cz' } | { type: 'multilingual'; locales: Array<'en' | 'cz'> };
}

export function renderWebsiteArtifact(input: RenderWebsiteInput): ExecutionOutputBundle {
  const sectionHtml = input.model.sections
    .map(
      (section) =>
        `<section id="${section.id}"><h2>${section.heading}</h2><p>${section.body}</p></section>`
    )
    .join('\n');

  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${input.model.title}</title>`,
    '  <link rel="stylesheet" href="styles.css" />',
    '</head>',
    '<body>',
    `  <header><h1>${input.model.title}</h1></header>`,
    `  <main>${sectionHtml}</main>`,
    `  <footer>Run ID: ${input.runId}</footer>`,
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
  ].join('\n');

  const stylesCss = [
    ':root {',
    '  --bg: #f6f8fa;',
    '  --fg: #0f172a;',
    '  --surface: #ffffff;',
    '  --accent: #0b6bcb;',
    '}',
    'body { font-family: Georgia, "Times New Roman", serif; background: linear-gradient(120deg, #f6f8fa, #dceefc); color: var(--fg); margin: 0; }',
    'header, footer { padding: 1rem 1.2rem; background: var(--surface); border-bottom: 1px solid #d8e3ef; }',
    'main { padding: 1.2rem; display: grid; gap: 0.8rem; }',
    'section { background: var(--surface); border-left: 5px solid var(--accent); padding: 0.8rem; }',
    'h1, h2 { margin: 0 0 0.4rem 0; }',
  ].join('\n');

  const scriptJs = [
    'const runId = ' + JSON.stringify(input.runId) + ';',
    "console.info('[artifact-pipeline] website bundle ready', { runId });",
  ].join('\n');

  return {
    status: 'success',
    summary: `Website bundle emitted from structured schema ${input.model.schemaId}.`,
    files: [
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      { path: 'script.js', content: scriptJs },
      {
        path: 'artifact-meta.json',
        content: JSON.stringify(
          {
            family: 'website',
            runId: input.runId,
            schemaId: input.model.schemaId,
            localeMode: input.localeMode,
          },
          null,
          2
        ),
      },
    ],
    notes: ['Website adapter rendered from current-run structured model only.'],
    removePaths: [],
  };
}
