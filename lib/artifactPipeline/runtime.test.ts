import { describe, expect, it } from 'vitest';
import {
  buildArtifactPipelineExecutionInput,
  resolveDocumentIntentHint,
  resolveProjectArtifactFamily,
  shouldRouteGeneratedFilesThroughArtifactPipeline,
} from './runtime';

describe('artifactPipeline runtime routing', () => {
  it('routes production website generated-files stage through the new common core', () => {
    const shouldRoute = shouldRouteGeneratedFilesThroughArtifactPipeline({
      project: {
        name: 'Launch Site',
        description: 'Create a marketing website for new launch',
        latestRevisionFeedback: null,
        outputType: 'website',
        attachments: [],
      },
      task: { agent: 'Builder' },
      artifactPath: 'generated-files.json',
      documentGeneratedFilesStage: false,
    });

    expect(shouldRoute).toBe(true);
  });

  it('keeps app/document/plan selection boundaries intact', () => {
    expect(
      resolveProjectArtifactFamily({
        name: 'Ops App',
        description: 'Internal dashboard for operations',
        latestRevisionFeedback: null,
        outputType: 'app',
        attachments: [],
      })
    ).toBe('app');

    expect(
      resolveProjectArtifactFamily({
        name: 'Invoice Export',
        description: 'Extract document rows from PDF and create CSV',
        latestRevisionFeedback: null,
        outputType: 'document',
        attachments: [],
      })
    ).toBe('document');

    expect(
      resolveProjectArtifactFamily({
        name: 'Execution Plan',
        description: 'Prepare implementation plan and review notes',
        latestRevisionFeedback: null,
        outputType: 'plan',
        attachments: [],
      })
    ).toBe('plan');
  });

  it('still routes document exporter generated-files through the common core', () => {
    const shouldRoute = shouldRouteGeneratedFilesThroughArtifactPipeline({
      project: {
        name: 'Invoice Export',
        description: 'Structured invoice export',
        latestRevisionFeedback: null,
        outputType: 'document',
        attachments: [],
      },
      task: { agent: 'Builder' },
      artifactPath: 'generated-files.json',
      documentGeneratedFilesStage: true,
    });

    expect(shouldRoute).toBe(true);
  });

  it('builds shared execution input with locale propagation and replace packaging', () => {
    const input = buildArtifactPipelineExecutionInput({
      project: {
        id: 'proj-1',
        outputType: 'website',
        language: 'cz',
        name: 'Boardroom Site',
        description: 'Website for boardroom launch',
        latestRevisionFeedback: 'Use clear structure.',
        latestStableFiles: [{ path: 'old.html', content: '<html></html>' }],
      },
      snapshot: {
        cycleNumber: 2,
        projectPrompt: 'Vytvor firemni web s jasnou strukturou.',
        revisionPrompt: 'Uprav copy pro aktualni launch.',
        approvedDebateSummary: 'Pouzit fakta z priloh a drzet cestinu.',
        missingInputNotes: ['Chybi finalni pricing table.'],
        pdfTexts: [],
        siteSnapshots: [
          {
            attachmentId: 'url-1',
            title: 'Existing site',
            source: 'project',
            pageTitle: 'Old site',
            summary: 'Legacy structure summary',
            extractedText: 'Services Contact About',
            pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary', excerpt: 'Home excerpt' }],
          },
        ],
        zipSnapshots: [],
        imageInputs: [],
      },
      family: 'website',
    });

    expect(input.localeMode).toEqual({ type: 'single', targetLanguage: 'cz' });
    expect(input.packaging).toEqual({ mode: 'replace', previousFilePaths: ['old.html'] });
    expect(input.attachments?.[0]?.kind).toBe('url');
    expect(input.prompt).toBe('Uprav copy pro aktualni launch.');
    expect(input.runtimeMetadata?.promptSource).toBe('revisionPrompt');
    expect(input.runtimeMetadata?.orchestration?.approvedDebateSummary).toContain('Pouzit fakta z priloh');
  });

  it('resolves URL description prompts to summary-description intent hint', () => {
    expect(
      resolveDocumentIntentHint({
        prompt: 'Describe the attached URL page and summarize the key content.',
        attachmentKinds: ['url'],
      })
    ).toBe('summary-description');
  });

  it('includes runtime build commit metadata in execution input', () => {
    const input = buildArtifactPipelineExecutionInput({
      project: {
        id: 'proj-build-1',
        outputType: 'document',
        language: 'en',
        name: 'Runtime audit',
        description: 'Describe URL page',
        latestRevisionFeedback: null,
        latestStableFiles: [],
      },
      snapshot: {
        cycleNumber: 1,
        projectPrompt: 'Describe attached URL page and summarize content.',
        revisionPrompt: '',
        approvedDebateSummary: '',
        missingInputNotes: [],
        pdfTexts: [],
        siteSnapshots: [],
        zipSnapshots: [],
        imageInputs: [],
      },
      family: 'document',
      runtimeBuildCommitHash: '562eb3c21e035a75d9876a034c5f7630d681db63',
    });

    expect(input.runtimeMetadata?.build?.commitHash).toBe('562eb3c21e035a75d9876a034c5f7630d681db63');
    expect(input.runtimeMetadata?.build?.commitShort).toBe('562eb3c');
  });
});
