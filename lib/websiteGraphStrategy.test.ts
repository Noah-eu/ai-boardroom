import { describe, expect, it } from 'vitest';
import { decideWebsiteGraphStrategy, deriveWebsiteNodeDecomposition } from './websiteGraphStrategy';

describe('websiteGraphStrategy', () => {
  it('selects segmented website graph for prompt-only explicit website facts', () => {
    const strategy = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'Prompt Clinic',
      projectDescription: 'Build a website with explicit sections and facts.',
      projectPrompt: [
        'Hero: Prompt Clinic',
        'About: Individual therapy for adults and couples.',
        'Services: Individual sessions, Couple sessions',
        'Pricing: From 1700 CZK / 50 min',
        'Contact: hello@promptclinic.cz, +420 777 111 222',
        'Address: Main 12, Prague',
        'Map: Google map section required',
      ].join('\n'),
      hasWebsiteAttachmentSignals: false,
      hasStructuredWebsiteSources: false,
    });

    expect(strategy.kind).toBe('segmented-website');
    expect(strategy.reasoning.promptFactsSufficient).toBe(true);
    expect(strategy.reasoning.explicitSectionSignals).toBeGreaterThanOrEqual(3);
  });

  it('selects segmented website graph for attachment-based website input', () => {
    const strategy = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'Attachment Clinic',
      projectDescription: 'Website rebuild from attached source URL',
      projectPrompt: 'Rebuild company website from provided source URL.',
      hasWebsiteAttachmentSignals: true,
      hasStructuredWebsiteSources: true,
    });

    expect(strategy.kind).toBe('segmented-website');
    expect(strategy.reasoning.hasStructuredWebsiteSources).toBe(true);
    expect(strategy.reasoning.hasAcquisitionSignals).toBe(true);
  });

  it('keeps prompt-only and attachment-based website inputs on comparable segmented decomposition', () => {
    const promptOnly = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'Parity Prompt',
      projectDescription: 'Create a landing page website',
      projectPrompt:
        'Hero: Parity Prompt\nAbout: Clear value proposition\nServices: Audits\nPricing: From 99 EUR\nContact: hi@example.com',
      hasWebsiteAttachmentSignals: false,
      hasStructuredWebsiteSources: false,
    });

    const attachmentBased = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'Parity Attachment',
      projectDescription: 'Create a landing page website',
      projectPrompt: 'Use source URL and keep same sections.',
      hasWebsiteAttachmentSignals: true,
      hasStructuredWebsiteSources: true,
    });

    expect(promptOnly.kind).toBe('segmented-website');
    expect(attachmentBased.kind).toBe('segmented-website');
    expect(deriveWebsiteNodeDecomposition(promptOnly.kind)).toEqual(
      deriveWebsiteNodeDecomposition(attachmentBased.kind)
    );
    expect(promptOnly.reasoning.structuredContentAvailability).toBe(true);
    expect(attachmentBased.reasoning.structuredContentAvailability).toBe(true);
  });

  it('does not treat acquisition-only signals as structured website assembly readiness', () => {
    const strategy = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'URL-only Intent',
      projectDescription: 'Website rebuild',
      projectPrompt: 'Use URL',
      hasWebsiteAttachmentSignals: true,
      hasStructuredWebsiteSources: false,
    });

    expect(strategy.reasoning.hasAcquisitionSignals).toBe(true);
    expect(strategy.reasoning.hasStructuredWebsiteSources).toBe(false);
    expect(strategy.reasoning.structuredContentAvailability).toBe(false);
    expect(strategy.kind).toBe('generic-code');
  });

  it('uses normalized task intent text to unlock segmented graph for prompt-only tasks', () => {
    const strategy = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'General Project',
      projectDescription: 'Build product output',
      taskIntentText: [
        'Create a one-page website for advisory studio',
        'Hero: Advisory Studio',
        'About: Boutique strategic consulting for founders',
        'Services: Strategy sprint, Fractional CTO',
        'Pricing: From 120 EUR / hour',
        'Contact: hello@advisor.test',
      ].join('\n'),
      hasWebsiteAttachmentSignals: false,
      hasStructuredWebsiteSources: false,
    });

    expect(strategy.kind).toBe('segmented-website');
    expect(strategy.reasoning.websiteIntent).toBe(true);
    expect(strategy.reasoning.structuredContentAvailability).toBe(true);
  });

  it('avoids segmented website graph for non-website app intent without structured facts', () => {
    const strategy = decideWebsiteGraphStrategy({
      outputType: 'app',
      projectName: 'Internal Backoffice Tool',
      projectDescription: 'Build dashboard with filters, CRUD and auth',
      projectPrompt: 'React app with table, charts and API integration.',
      hasWebsiteAttachmentSignals: false,
      hasStructuredWebsiteSources: false,
    });

    expect(strategy.kind).toBe('generic-code');
  });
});
