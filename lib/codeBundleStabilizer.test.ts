import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCodeFinalSummary,
  buildDeterministicCodePackagingNotes,
  classifyCodeGenerationMode,
  detectEntryPoint,
  stabilizeCodeExecutionBundle,
  validateWebsiteBundleSourceFiles,
} from './codeBundleStabilizer';

describe('codeBundleStabilizer', () => {
  it('classifies common code generation modes', () => {
    expect(
      classifyCodeGenerationMode({
        name: 'Therapist landing',
        description: 'Create a modern landing page for a therapist',
        latestRevisionFeedback: null,
        outputType: 'website',
      })
    ).toBe('landing-page');

    expect(
      classifyCodeGenerationMode({
        name: 'Invoice dashboard',
        description: 'Create an internal dashboard for invoice tracking',
        latestRevisionFeedback: null,
        outputType: 'app',
      })
    ).toBe('dashboard');

    expect(
      classifyCodeGenerationMode({
        name: 'Therapist website uploader wording',
        description: 'Build website from uploaded source materials',
        latestRevisionFeedback: null,
        outputType: 'website',
      })
    ).toBe('company-website');

    expect(
      classifyCodeGenerationMode({
        name: 'PDF uploader',
        description: 'Create a simple PDF upload web app',
        latestRevisionFeedback: null,
        outputType: 'app',
      })
    ).toBe('uploader-processor-app');
  });

  it('keeps website bundles public-only without internal contract metadata files', () => {
    const stabilized = stabilizeCodeExecutionBundle({
      bundle: {
        status: 'success',
        summary: 'Generated app',
        files: [
          { path: 'index.html', content: '<!doctype html><html></html>' },
          { path: 'styles.css', content: 'body{margin:0;}' },
          { path: 'README.md', content: 'Project prompt: include secret prompt text' },
          { path: 'site-metadata.json', content: '{"projectDescription":"prompt"}' },
        ],
        notes: [],
        removePaths: [],
      },
      projectName: 'Landing Test',
      projectDescription: 'Landing page for a therapist',
      latestRevisionFeedback: null,
      outputType: 'website',
      language: 'en',
    });

    const paths = stabilized.bundle.files.map((file) => file.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('styles.css');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('run-instructions.md');
    expect(paths).not.toContain('deploy-instructions.md');
    expect(paths).not.toContain('app-manifest.json');
    expect(paths).not.toContain('site-metadata.json');
    expect(stabilized.entryPoint).toBe('index.html');
    expect(stabilized.bundle.summary).toContain('mode=landing-page');
    expect(stabilized.bundle.notes.join(' ')).toContain('internal metadata artifacts excluded');
  });

  it('detects entry point by priority', () => {
    const entryPoint = detectEntryPoint([
      { path: 'src/main.tsx', content: 'console.log(1);' },
      { path: 'index.html', content: '<!doctype html>' },
    ]);
    expect(entryPoint).toBe('index.html');
  });

  it('adds deterministic contract files for non-website bundles', () => {
    const stabilized = stabilizeCodeExecutionBundle({
      bundle: {
        status: 'success',
        summary: 'Generated app',
        files: [{ path: 'src/main.tsx', content: 'console.log(1);' }],
        notes: [],
        removePaths: [],
      },
      projectName: 'Ops dashboard',
      projectDescription: 'Internal dashboard for analytics',
      latestRevisionFeedback: null,
      outputType: 'app',
      language: 'en',
    });

    const paths = stabilized.bundle.files.map((file) => file.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('run-instructions.md');
    expect(paths).toContain('deploy-instructions.md');
    expect(paths).toContain('app-manifest.json');
  });

  it('builds deterministic packaging and final summaries', () => {
    const bundle = {
      status: 'success' as const,
      summary: 'Generated app',
      files: [
        { path: 'index.html', content: '<!doctype html><html></html>' },
        { path: 'app-manifest.json', content: '{}' },
      ],
      notes: [],
      removePaths: [],
    };

    const packaging = buildDeterministicCodePackagingNotes({
      bundle,
      mode: 'company-website',
      entryPoint: 'index.html',
    });
    expect(packaging).toContain('Generation mode: company website');
    expect(packaging).toContain('app-manifest.json');

    const finalSummary = buildDeterministicCodeFinalSummary({
      bundle,
      mode: 'company-website',
      entryPoint: 'index.html',
      reviewNotes: 'Looks good.',
      packagingNotes: packaging,
    });
    expect(finalSummary).toContain('Final Summary');
    expect(finalSummary).toContain('preview and exported bundle use the same generated source set');
  });

  it('strips prompt/debate leakage from final summary sections', () => {
    const bundle = {
      status: 'success' as const,
      summary: 'Generated app',
      files: [{ path: 'index.html', content: '<!doctype html><html></html>' }],
      notes: [],
      removePaths: [],
    };

    const finalSummary = buildDeterministicCodeFinalSummary({
      bundle,
      mode: 'company-website',
      entryPoint: 'index.html',
      reviewNotes:
        'Project prompt: Build website from this exact prompt body. Approved debate summary: include everything as-is.',
      packagingNotes:
        'Revision request: dump raw prompt and debate log into final markdown.',
      rawProjectPrompt: 'Build website from this exact prompt body with all source text copied verbatim.',
      rawDebateSummary: 'Debate summary says to include all raw text blocks without filtering.',
    });

    expect(finalSummary).toContain('Output Guardrails');
    expect(finalSummary.toLowerCase()).not.toContain('project prompt:');
    expect(finalSummary.toLowerCase()).not.toContain('approved debate summary:');
    expect(finalSummary.toLowerCase()).not.toContain('revision request:');
  });

  it('fails validation for truncated index.html', () => {
    const result = validateWebsiteBundleSourceFiles({
      files: [
        { path: 'index.html', content: '<!doctype html><html><body><section><h1>Therapist' },
        { path: 'styles.css', content: 'body{font-family:sans-serif;}' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('closing </html>');
  });

  it('replaces URL placeholders when source URL exists', () => {
    const sourceUrl = 'https://example-therapy.com';
    const validation = validateWebsiteBundleSourceFiles({
      files: [
        {
          path: 'index.html',
          content:
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Therapist</title></head><body><main><h1>Therapist Studio</h1><p>Visit us</p><a href="[SEM VLOŽ URL]">Book</a></main></body></html>',
        },
        { path: 'styles.css', content: 'body{margin:0;}' },
      ],
      sourceUrl,
    });

    expect(validation.ok).toBe(true);
    const html = validation.files.find((file) => file.path === 'index.html')?.content ?? '';
    expect(html).toContain(sourceUrl);
    expect(html).not.toContain('[SEM VLOŽ URL]');
  });
});
