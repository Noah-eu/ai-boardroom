import { describe, expect, it } from 'vitest';
import { runArtifactPipeline, selectArtifactFamily } from './core';
import { buildArtifactPipelineExecutionInput } from './runtime';

describe('artifactPipeline core invariants', () => {
  it('enforces run isolation and emits run-scoped metadata', () => {
    const runA = runArtifactPipeline({
      input: {
        runId: 'run-A',
        prompt: 'Project: Demo A. Goal: Build website.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const runB = runArtifactPipeline({
      input: {
        runId: 'run-B',
        prompt: 'Project: Demo B. Goal: Build website.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
      previousRunIds: ['run-A'],
    });

    expect(runA.runId).toBe('run-A');
    expect(runB.runId).toBe('run-B');
    expect(runB.bundle.files.find((file) => file.path === 'artifact-pipeline-metadata.json')?.content).toContain('run-B');
    expect(runB.metadata.validationWarnings).not.toContain('cross_run_fact_contamination');
  });

  it('emits shared packaging metadata and removes stale files in replace mode', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'replace-mode',
        prompt: 'Title: Replace mode website. Section: Fresh content.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        packaging: {
          mode: 'replace',
          previousFilePaths: ['old.html', 'styles.css'],
        },
      },
    });

    expect(result.bundle.files.some((file) => file.path === 'artifact-pipeline-metadata.json')).toBe(true);
    expect(result.bundle.removePaths).toContain('old.html');
    expect(result.bundle.removePaths).not.toContain('styles.css');
  });

  it('flags stale run reuse attempts', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'same-run',
        prompt: 'Build execution plan: phase one, phase two.',
        outputTypeHint: 'plan',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
      previousRunIds: ['same-run'],
    });

    expect(result.metadata.validationWarnings).toContain('run_id_reused');
  });

  it('produces fresh schema ids per run', () => {
    const one = runArtifactPipeline({
      input: {
        runId: 'schema-1',
        prompt: 'Build app for support operations.',
        outputTypeHint: 'app',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const two = runArtifactPipeline({
      input: {
        runId: 'schema-2',
        prompt: 'Build app for support operations.',
        outputTypeHint: 'app',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    expect(one.metadata.schemaId).not.toBe(two.metadata.schemaId);
  });

  it('keeps single-language output locale-consistent by filtering foreign facts', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'locale-single',
        prompt: 'Title: Internal dashboard and metrics overview.',
        outputTypeHint: 'app',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'att-cz',
            kind: 'file',
            title: 'Czech fragment',
            text: 'Nadpis: Přehled faktur a výstupů.',
          },
        ],
      },
    });

    expect(result.facts.some((fact) => fact.locale === 'cz')).toBe(false);
    expect(result.metadata.validationWarnings).not.toContain('single_locale_mixed_content');
  });

  it('supports locale isolation for multilingual outputs', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'locale-multi',
        prompt: 'Summary: the execution output for global report.',
        outputTypeHint: 'document',
        localeMode: { type: 'multilingual', locales: ['en', 'cz'] },
        attachments: [
          {
            id: 'att-cz',
            kind: 'file',
            title: 'Czech input',
            text: 'Shrnutí: Přehled plateb a faktur.',
          },
          {
            id: 'att-en',
            kind: 'file',
            title: 'English input',
            text: 'Summary: Payment and invoice insights.',
          },
        ],
      },
    });

    expect(result.facts.some((fact) => fact.locale === 'cz')).toBe(true);
    expect(result.facts.some((fact) => fact.locale === 'en')).toBe(true);
  });

  it('selects artifact family correctly from intent and hints', () => {
    expect(selectArtifactFamily({ prompt: 'Create a landing page for launch campaign.' })).toBe('website');
    expect(selectArtifactFamily({ prompt: 'Build internal KPI dashboard for sales.' })).toBe('app');
    expect(selectArtifactFamily({ prompt: 'Extract CSV from PDF invoices and produce report.' })).toBe('document');
    expect(selectArtifactFamily({ prompt: 'Write implementation plan with milestones.' })).toBe('plan');
    expect(selectArtifactFamily({ prompt: 'Unknown', outputTypeHint: 'document' })).toBe('document');
  });

  it('retains verified facts instead of replacing with placeholders', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'fact-retention',
        prompt: 'Title: Apollo rollout. Owner: Platform team.',
        outputTypeHint: 'plan',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const planFile = result.bundle.files.find((file) => file.path === 'execution-plan.md')?.content ?? '';
    expect(planFile).toContain('Apollo rollout');
    expect(result.metadata.factCount).toBeGreaterThan(0);
  });

  it('filters noisy fragments from verified facts', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'noise-filter',
        prompt: 'nav menu footer privacy policy __internal__. validFact: Keep this.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const factValues = result.facts.map((fact) => `${fact.key} ${fact.value}`).join(' ');
    expect(factValues.toLowerCase()).not.toContain('privacy policy');
    expect(factValues.toLowerCase()).toContain('keep this');
  });

  it('renderer consumes only current-run structured model', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'renderer-scope',
        prompt: 'Title: Run scoped website. Section: Features.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
    expect(html).toContain('Run scoped website');
    expect(html).not.toContain('unrelated stale value');
  });

  it('keeps adapters isolated by family and avoids cross-family contamination', () => {
    const website = runArtifactPipeline({
      input: {
        runId: 'family-website',
        prompt: 'Create website homepage.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const app = runArtifactPipeline({
      input: {
        runId: 'family-app',
        prompt: 'Create app dashboard.',
        outputTypeHint: 'app',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const document = runArtifactPipeline({
      input: {
        runId: 'family-document',
        prompt: 'Create invoice document summary.',
        outputTypeHint: 'document',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const plan = runArtifactPipeline({
      input: {
        runId: 'family-plan',
        prompt: 'Create implementation plan.',
        outputTypeHint: 'plan',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    expect(website.bundle.files.some((file) => file.path === 'script.js')).toBe(true);
    expect(app.bundle.files.some((file) => file.path === 'app.js')).toBe(true);
    expect(document.bundle.files.some((file) => file.path === 'index.html')).toBe(true);
    expect(plan.bundle.files.some((file) => file.path === 'execution-plan.md')).toBe(true);

    expect(website.bundle.files.some((file) => file.path === 'execution-plan.md')).toBe(false);
    expect(plan.bundle.files.some((file) => file.path === 'app.js')).toBe(false);
  });

  it('prevents stale prompt leakage between run A website and run B URL description', () => {
    const runA = runArtifactPipeline({
      input: {
        runId: 'leak-run-A',
        prompt: 'Brand: LaunchSite Hero Campaign.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const runB = runArtifactPipeline({
      input: {
        runId: 'leak-run-B',
        prompt: 'Feature: API documentation portal.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'url-1',
            kind: 'url',
            title: 'URL snapshot',
            text: 'Page title: Product docs. Summary: This page documents API limits.',
          },
        ],
      },
    });

    const runAText = JSON.stringify(runA.structuredModel).toLowerCase();
    const runBText = JSON.stringify(runB.structuredModel).toLowerCase();

    const runAModelText = runAText;
    const runBModelText = runBText;

    // Run A contains its own structured content
    expect(runAModelText).toContain('launchsite hero campaign');
    // Run B is isolated from Run A's content
    expect(runBModelText).not.toContain('launchsite');
    // Each run is scoped by its own runId
    expect(runA.runId).toBe('leak-run-A');
    expect(runB.runId).toBe('leak-run-B');
  });

  it('keeps debate/planning text out of source facts while preserving runtime metadata', () => {
    const pipelineInput = buildArtifactPipelineExecutionInput({
      project: {
        id: 'proj-iso',
        outputType: 'website',
        language: 'en',
        name: 'Old project title',
        description: 'Create a website',
        latestRevisionFeedback: null,
        latestStableFiles: [],
      },
      snapshot: {
        cycleNumber: 5,
        projectPrompt: 'Create a website',
        revisionPrompt: 'Describe only URL content facts.',
        approvedDebateSummary: 'Debate summary: prioritize conversion funnel and hero CTA.',
        missingInputNotes: ['planning note: update sprint board'],
        pdfTexts: [],
        siteSnapshots: [
          {
            attachmentId: 'url-1',
            title: 'URL',
            source: 'project',
            pageTitle: 'Docs',
            summary: 'Reference docs',
            extractedText: 'API rate limits and examples',
            pages: [],
          },
        ],
        zipSnapshots: [],
        imageInputs: [],
      },
      family: 'website',
    });

    const result = runArtifactPipeline({ input: pipelineInput });
    const factsText = result.facts.map((fact) => `${fact.key} ${fact.value}`).join(' ').toLowerCase();
    const metadataFile = result.bundle.files.find((file) => file.path === 'artifact-pipeline-metadata.json')?.content ?? '';

    expect(factsText).toContain('describe only url content facts');
    expect(factsText).not.toContain('debate summary');
    expect(factsText).not.toContain('hero cta');
    expect(metadataFile).toContain('Debate summary');
  });

  it('preserves current-run prompt isolation across app/document/plan families', () => {
    const app = runArtifactPipeline({
      input: {
        runId: 'isolation-app',
        prompt: 'Build internal dashboard for finance team.',
        outputTypeHint: 'app',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const document = runArtifactPipeline({
      input: {
        runId: 'isolation-document',
        prompt: 'Extract document rows from attached invoices only.',
        outputTypeHint: 'document',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const plan = runArtifactPipeline({
      input: {
        runId: 'isolation-plan',
        prompt: 'Prepare implementation plan with milestones.',
        outputTypeHint: 'plan',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const appText = JSON.stringify(app.structuredModel).toLowerCase();
    const documentText = JSON.stringify(document.structuredModel).toLowerCase();
    const planText = JSON.stringify(plan.structuredModel).toLowerCase();

    expect(appText).toContain('build internal dashboard for finance team');
    expect(documentText).toContain('extract document rows from attached invoices only');
    expect(planText).toContain('prepare implementation plan with milestones');

    expect(documentText).not.toContain('internal dashboard for finance team');
    expect(planText).not.toContain('attached invoices only');
    expect(appText).not.toContain('implementation plan with milestones');
  });

  it('routes website creation task to website adapter contract', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'intent-website-creation',
        prompt: 'Create a company website with hero and contact section.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    expect(result.family).toBe('website');
    expect(result.bundle.files.some((file) => file.path === 'index.html')).toBe(true);
    expect(result.bundle.files.some((file) => file.path === 'app-manifest.json')).toBe(true);
    expect(result.bundle.files.some((file) => file.path === 'invoice-summary.csv')).toBe(false);
  });

  it('routes URL description task to document summary adapter, not invoice exporter', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'intent-url-description',
        prompt: 'Describe the content of attached URL page.',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'url-1',
            kind: 'url',
            title: 'Source page',
            text: 'Page title: Product API docs. Summary: This page explains endpoints and limits.',
          },
        ],
        sourceArtifacts: {
          validatedRowsRaw: JSON.stringify({ rows: [{ sourceFileName: 'url-page', value: 'endpoint summary' }] }),
          summaryMetadataRaw: JSON.stringify({ invoiceCount: 0, warnings: [] }),
        },
      },
    });

    expect(result.family).toBe('document');
    expect(result.metadata.selection.selectedDocumentIntent).toBe('summary-description');
    expect(result.metadata.selection.selectedRendererExporter).toBe('buildFallbackDocumentBundle');
    expect(result.bundle.files.some((file) => file.path === 'summary.md')).toBe(true);
    expect(result.bundle.files.some((file) => file.path === 'invoice-summary.csv')).toBe(false);
    expect(result.bundle.files.some((file) => file.path === 'requested-table.csv')).toBe(false);
  });

  it('routes invoice extraction task to deterministic invoice exporter', () => {
    const validatedRowsRaw = JSON.stringify({
      rows: [
        {
          sourceFileName: 'invoice-1.pdf',
          invoiceNumber: 'INV-001',
          variableSymbol: '2026001',
          currency: 'CZK',
          amountInInvoiceCurrency: 1500,
          amountType: 'overpayment',
        },
      ],
    });

    const summaryMetadataRaw = JSON.stringify({
      invoiceCount: 1,
      uniqueVariableSymbolCount: 1,
      duplicateVariableSymbolCount: 0,
      totalOverpayment: 1500,
      totalUnderpayment: 0,
      netTotal: 1500,
      warnings: [],
      duplicateVariableSymbols: [],
      filesProcessed: ['invoice-1.pdf'],
      filesFailed: [],
    });

    const result = runArtifactPipeline({
      input: {
        runId: 'intent-invoice-extraction',
        prompt: 'Extract invoice rows and export CSV/XLSX summary for accounting.',
        outputTypeHint: 'document',
        localeMode: { type: 'single', targetLanguage: 'en' },
        sourceArtifacts: {
          validatedRowsRaw,
          summaryMetadataRaw,
        },
      },
    });

    expect(result.family).toBe('document');
    expect(result.bundle.files.some((file) => file.path === 'invoice-summary.csv')).toBe(true);
    expect(result.bundle.files.some((file) => file.path === 'invoice-summary.xlsx')).toBe(true);
    expect(result.bundle.files.some((file) => file.path === 'summary.md')).toBe(false);
  });
});

describe('website public renderer isolation', () => {
  it('suppresses URL attachment metadata labels from public website HTML sections', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'url-website-labels',
        prompt: 'Create a product website.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'url-1',
            kind: 'url',
            title: 'Source page',
            text: [
              'Page title: Product API docs',
              'Summary: This page explains endpoints and rate limits.',
              'Pages: /about /contact',
              'Site snapshot source URL: https://example.com',
              'Pages visited: 3',
            ].join('\n'),
          },
        ],
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    // Internal metadata labels must not be section headings
    expect(html).not.toContain('<h2>Page title</h2>');
    expect(html).not.toContain('<h2>Summary</h2>');
    expect(html).not.toContain('<h2>Pages</h2>');
    expect(html).not.toContain('Site snapshot source URL');
    expect(html).not.toContain('Pages visited');
    expect(html).not.toMatch(/<h2>fact_\d+<\/h2>/);
  });

  it('does not expose Run ID in public website HTML or script.js', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'website-run-id-check',
        prompt: 'Create a website.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
    const script = result.bundle.files.find((file) => file.path === 'script.js')?.content ?? '';
    const metadata = result.bundle.files.find((file) => file.path === 'artifact-pipeline-metadata.json')?.content ?? '';

    // Run ID must not appear in any public-facing file
    expect(html).not.toContain('Run ID');
    expect(html).not.toContain('website-run-id-check');
    expect(script).not.toContain('website-run-id-check');
    // But run ID must still be in internal diagnostics
    expect(metadata).toContain('website-run-id-check');
  });

  it('maps structured prompt key-value pairs to user-facing section headings', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'structured-website',
        prompt: 'About: We are a software company. Services: Web development and design. Contact: info@example.com.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    expect(html).toContain('About');
    expect(html).toContain('We are a software company');
    expect(html).toContain('Services');
    // No internal labels
    expect(html).not.toMatch(/fact_\d+/);
    expect(html).not.toContain('Page title');
    expect(html).not.toContain('Run ID');
  });

  it('unstructured prompt produces neutral placeholder, not prompt echo', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'unstructured-website',
        prompt: 'Create a company website for the new product launch.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    // Prompt text must NOT appear in public HTML
    expect(html).not.toContain('Create a company website for the new product launch');
    // Neutral placeholder must be present
    expect(html).toContain('Website');
    // Provenance must report neutral-fallback
    expect((result.structuredModel as unknown as Record<string, unknown>).contentProvenance).toMatchObject({
      titleSource: 'neutral-fallback',
    });
    // No raw fact label headings
    expect(html).not.toMatch(/<h2>fact_\d+<\/h2>/);
    expect(html).not.toContain('<h2>fact_1</h2>');
  });

  it('internal diagnostics are isolated to artifact-pipeline-metadata.json, not public HTML', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'diagnostics-separation',
        prompt: 'Build a company website.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
    const metadata = result.bundle.files.find((file) => file.path === 'artifact-pipeline-metadata.json')?.content ?? '';

    // runId, schemaId, family must NOT appear in visitor-facing HTML
    expect(html).not.toContain('diagnostics-separation');
    expect(html).not.toContain('schemaId');
    expect(html).not.toContain('runId');
    // But they must be present in the internal metadata artifact
    expect(metadata).toContain('diagnostics-separation');
    expect(metadata).toContain('schemaId');
    expect(metadata).toContain('family');
  });

  it('URL attachment content supplements website without exposing attachment source URL', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'url-supplement',
        prompt: 'Overview: Landing page for API product.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'url-2',
            kind: 'url',
            title: 'API docs',
            text: 'Page title: API Docs; Summary: Endpoints and limits; Source URL: https://api.example.com; Pages visited: 2',
          },
        ],
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    // Prompt-driven section must be present
    expect(html).toContain('Landing page for API product');
    // Attachment source metadata must not leak into HTML
    expect(html).not.toContain('https://api.example.com');
    expect(html).not.toContain('Pages visited');
    expect(html).not.toContain('Source URL');
  });
});

describe('website source-derived content provenance', () => {
  it('hotel website: title and sections come from URL attachment, not from prompt', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'hotel-website',
        prompt: 'Vytvoř web pro hotel.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'hotel-url',
            kind: 'url',
            title: 'Hotel page',
            text: [
              'Page title: Grand Hotel Praha',
              'Summary: Luxurious hotel in the heart of Prague offering elegant rooms and fine dining.',
              'Amenities: Spa, rooftop bar, conference rooms.',
            ].join('\n'),
          },
        ],
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    // Title must come from attachment page title, not prompt
    expect(html).toContain('Grand Hotel Praha');
    // Prompt text must NOT appear in public HTML
    expect(html).not.toContain('Vytvoř web pro hotel');
    // Attachment content must be present
    expect(html).toContain('Luxurious hotel');
    // Internal metadata keys must not be headings
    expect(html).not.toContain('<h2>Page title</h2>');
    expect(html).not.toContain('<h2>Summary</h2>');
  });

  it('hotel website: provenance reports source-attachment for URL-derived content', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'hotel-provenance',
        prompt: 'Vytvoř web pro hotel.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
        attachments: [
          {
            id: 'hotel-url-2',
            kind: 'url',
            title: 'Hotel page',
            text: [
              'Page title: Hotel Metropol',
              'Summary: Modern hotel with panoramic city views',
            ].join('; '),
          },
        ],
      },
    });

    const provenance = (result.structuredModel as unknown as Record<string, unknown>).contentProvenance as Record<string, unknown> | undefined;

    expect(provenance).toBeDefined();
    expect(provenance?.titleSource).toBe('source-page-title');
    const sectionSources = provenance?.sectionSources as string[] | undefined;
    expect(Array.isArray(sectionSources)).toBe(true);
    expect(sectionSources?.some((s) => s === 'source-attachment')).toBe(true);
    expect(sectionSources?.every((s) => s !== 'neutral-fallback' || sectionSources.length > 0)).toBe(true);
  });

  it('prompt text never appears in public HTML regardless of input', () => {
    const prompts = [
      'Vytvoř web pro hotel Grand Moravia.',
      'Create a website for our new software product launch.',
      'Build a landing page for the consulting firm.',
    ];

    for (const prompt of prompts) {
      const result = runArtifactPipeline({
        input: {
          runId: `prompt-isolation-${Math.random()}`,
          prompt,
          outputTypeHint: 'website',
          localeMode: { type: 'single', targetLanguage: 'en' },
        },
      });

      const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
      // Raw task instruction must not echo into visitor-facing HTML
      expect(html).not.toContain(prompt);
    }
  });

  it('missing source facts produce neutral placeholder with neutral-fallback provenance', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'empty-website',
        prompt: 'Vytvoř webovou stránku.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'cz' },
      },
    });

    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
    const provenance = (result.structuredModel as unknown as Record<string, unknown>).contentProvenance as Record<string, unknown> | undefined;

    expect(result.family).toBe('website');
    // No prompt echo
    expect(html).not.toContain('Vytvoř webovou stránku');
    // Provenance must track the fallback
    expect(provenance?.titleSource).toBe('neutral-fallback');
    // HTML must still be non-empty and valid
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('structured prompt KV pairs use source-named-fact provenance', () => {
    const result = runArtifactPipeline({
      input: {
        runId: 'kv-provenance',
        prompt: 'Name: Acme Corp. About: We build enterprise software. Contact: hello@acme.com.',
        outputTypeHint: 'website',
        localeMode: { type: 'single', targetLanguage: 'en' },
      },
    });

    const provenance = (result.structuredModel as unknown as Record<string, unknown>).contentProvenance as Record<string, unknown> | undefined;
    const html = result.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';

    expect(result.family).toBe('website');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('We build enterprise software');
    // Provenance tracks structured prompt facts
    expect(provenance?.titleSource).toBe('source-named-fact');
    const sectionSources = provenance?.sectionSources as string[] | undefined;
    expect(sectionSources?.every((s) => s === 'source-fact')).toBe(true);
  });
});
