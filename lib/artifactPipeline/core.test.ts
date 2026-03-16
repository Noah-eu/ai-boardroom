import { describe, expect, it } from 'vitest';
import { runArtifactPipeline, selectArtifactFamily } from './core';

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
    expect(runB.bundle.files.find((file) => file.path === 'artifact-meta.json')?.content).toContain('run-B');
    expect(runB.metadata.validationWarnings).not.toContain('cross_run_fact_contamination');
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
});
