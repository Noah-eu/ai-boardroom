import { AppLanguage, ExecutionOutputBundle } from '../../../types';
import { buildDeterministicDocumentExecutionBundle } from '../../documentExporter';

interface DocumentStructuredModel {
  family: 'document';
  runId: string;
  schemaId: string;
  localeMode: { type: 'single'; targetLanguage: AppLanguage } | { type: 'multilingual'; locales: AppLanguage[] };
  intent: 'summary-description' | 'invoice-extraction';
  outputContract: 'document-summary-bundle' | 'invoice-export-bundle';
  title: string;
  summary: string;
  factsTable: Array<{ key: string; value: string }>;
  sourceArtifacts?: {
    validatedRowsRaw?: string | null;
    summaryMetadataRaw?: string | null;
  };
}

interface RenderDocumentInput {
  model: DocumentStructuredModel;
  runId: string;
  localeMode: { type: 'single'; targetLanguage: AppLanguage } | { type: 'multilingual'; locales: AppLanguage[] };
}

function resolvePrimaryLanguage(localeMode: RenderDocumentInput['localeMode']): AppLanguage {
  if (localeMode.type === 'single') return localeMode.targetLanguage;
  return localeMode.locales[0] ?? 'en';
}

function buildFallbackDocumentBundle(input: RenderDocumentInput): ExecutionOutputBundle {
  const rows = input.model.factsTable
    .map((row) => `<tr><th>${row.key}</th><td>${row.value}</td></tr>`)
    .join('');

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${input.model.title}</title>`,
    '</head>',
    '<body>',
    `  <h1>${input.model.title}</h1>`,
    `  <p>${input.model.summary}</p>`,
    `  <table border="1" cellspacing="0" cellpadding="8"><tbody>${rows}</tbody></table>`,
    '</body>',
    '</html>',
  ].join('\n');

  return {
    status: 'success',
    summary: `Document summary bundle emitted from schema ${input.model.schemaId}.`,
    files: [
      { path: 'index.html', content: html },
      { path: 'summary.md', content: `# ${input.model.title}\n\n${input.model.summary}` },
      { path: 'facts.json', content: JSON.stringify(input.model.factsTable, null, 2) },
    ],
    notes: ['Document summary adapter rendered from current-run structured model only.'],
    removePaths: [],
  };
}

export function renderDocumentArtifact(input: RenderDocumentInput): ExecutionOutputBundle {
  const language = resolvePrimaryLanguage(input.localeMode);
  const sourceArtifacts = input.model.sourceArtifacts ?? {};

  if (input.model.intent === 'invoice-extraction') {
    const deterministic = buildDeterministicDocumentExecutionBundle({
      validatedRowsRaw: sourceArtifacts.validatedRowsRaw,
      summaryMetadataRaw: sourceArtifacts.summaryMetadataRaw,
      language,
      requestedOutputPrompt: input.model.summary,
    });

    return {
      ...deterministic.bundle,
      notes: [...deterministic.bundle.notes, 'Document adapter used deterministic exporter from current-run artifacts.'],
    };
  }

  return buildFallbackDocumentBundle(input);
}
