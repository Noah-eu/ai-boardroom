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
        name: 'PDF uploader',
        description: 'Create a simple PDF upload web app',
        latestRevisionFeedback: null,
        outputType: 'app',
      })
    ).toBe('uploader-processor-app');
  });

  it('adds deterministic packaging contract files', () => {
    const stabilized = stabilizeCodeExecutionBundle({
      bundle: {
        status: 'success',
        summary: 'Generated app',
        files: [{ path: 'index.html', content: '<!doctype html><html></html>' }],
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
    expect(paths).toContain('README.md');
    expect(paths).toContain('run-instructions.md');
    expect(paths).toContain('deploy-instructions.md');
    expect(paths).toContain('app-manifest.json');
    expect(paths).toContain('site-metadata.json');
    expect(stabilized.entryPoint).toBe('index.html');
    expect(stabilized.bundle.summary).toContain('mode=landing-page');
  });

  it('detects entry point by priority', () => {
    const entryPoint = detectEntryPoint([
      { path: 'src/main.tsx', content: 'console.log(1);' },
      { path: 'index.html', content: '<!doctype html>' },
    ]);
    expect(entryPoint).toBe('index.html');
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
