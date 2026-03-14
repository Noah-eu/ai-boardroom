import { describe, expect, it } from 'vitest';
import { decideWebsiteGraphStrategy } from './websiteGraphStrategy';

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
    expect(strategy.reasoning.hasSourceSignals).toBe(true);
  });

  it('keeps prompt-only and attachment-based website inputs on comparable segmented strategy', () => {
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
