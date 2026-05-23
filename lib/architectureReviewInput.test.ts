import { describe, expect, it } from 'vitest';
import { normalizeArchitectureReviewInput } from './architectureReviewInput';

describe('architectureReviewInput', () => {
  it('normalizes and reduces oversized mixed architecture payload', () => {
    const longBlob = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: Build website with hero about services pricing contact map.`).join('\n');

    const normalized = normalizeArchitectureReviewInput({
      projectName: 'Prompt-only reliability project',
      outputType: 'app',
      projectDescription: `Build website from explicit facts.\n${longBlob}`,
      projectPrompt: longBlob,
      revisionPrompt: longBlob,
      debateSummary: longBlob,
      maxChars: 2500,
      websiteFacts: {
        headings: ['Hero', 'About', 'Services', 'Pricing', 'Contact', 'Map'],
        serviceNames: ['Therapy sessions', 'Couples therapy'],
        pricingFields: ['From 1700 CZK / 50 min'],
      },
    });

    expect(normalized.stats.rawChars).toBeGreaterThan(12000);
    expect(normalized.stats.normalizedChars).toBeLessThanOrEqual(2500);
    expect(normalized.normalizedInput).toContain('Architecture Input (normalized)');
    expect(normalized.normalizedInput).toContain('Structured Facts Handoff');
  });

  it('deduplicates prompt-derived facts before architecture handoff', () => {
    const normalized = normalizeArchitectureReviewInput({
      projectName: 'Dup test',
      outputType: 'app',
      projectDescription: 'Website architecture from prompt-only facts',
      projectPrompt: 'Hero: Clinic\nHero: Clinic\nServices: Therapy\nServices: Therapy',
      revisionPrompt: 'Hero: Clinic\nContact: hi@clinic.test\nContact: hi@clinic.test',
      debateSummary: 'Use semantic structure. Use semantic structure.',
      websiteFacts: {
        headings: ['Hero', 'Hero'],
        serviceNames: ['Therapy', 'Therapy'],
        emails: ['hi@clinic.test', 'hi@clinic.test'],
      },
    });

    expect(normalized.stats.droppedDuplicates).toBeGreaterThan(0);
    expect(normalized.stats.keptFactLines).toBeGreaterThan(0);
    expect(normalized.normalizedInput.match(/hero/i)?.length ?? 0).toBeGreaterThan(0);
  });

  it('avoids passing raw prompt blob into architecture input', () => {
    const repeated = 'PROMPT_BLOB_TOKEN very long repeated context segment';
    const rawBlob = Array.from({ length: 40 }, () => repeated).join('\n');

    const normalized = normalizeArchitectureReviewInput({
      projectName: 'Blob test',
      outputType: 'website',
      projectDescription: rawBlob,
      projectPrompt: rawBlob,
      revisionPrompt: rawBlob,
      debateSummary: rawBlob,
      maxChars: 2000,
    });

    expect(normalized.stats.normalizedChars).toBeLessThan(normalized.stats.rawChars);
    expect(normalized.normalizedInput.length).toBeLessThanOrEqual(2000);
    expect(normalized.normalizedInput).toContain('reliability mode: normalized-and-bounded');
  });
});
