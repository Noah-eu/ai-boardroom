import { describe, expect, it } from 'vitest';
import { deriveVerifiedWebsiteContentFromPrompt } from './deterministicWebsiteBuilder';
import { createWebsiteCopyTaskPlan, selectWebsiteSectionSchema } from './websiteSectionSchema';

describe('websiteSectionSchema', () => {
  it('selects organization-neutral schema for company/service style intent', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Harbor Suites',
      projectPrompt: [
        'Build a public company website for Harbor Suites.',
        'About us: Boutique accommodation with premium service.',
        'Services: Deluxe room, Family room, Airport transfer',
        'Pricing: From 220 EUR per night',
        'Contact: reservations@harbor.example, +420 777 100 200',
        'Address: Riverside 12, Prague',
      ].join('\n'),
    });

    const selection = selectWebsiteSectionSchema({
      taskIntentText: [
        'Create website for Harbor Suites company presentation.',
        'Use neutral service-business structure and clear offerings.',
      ].join('\n'),
      language: 'en',
      verifiedFacts: verified,
    });

    const taskPlan = createWebsiteCopyTaskPlan(selection);

    expect(selection.archetype).toBe('organization-neutral');
    expect(selection.schemaId).toBe('organization-neutral-v1');
    expect(taskPlan.map((entry) => entry.taskTitleLabel)).toEqual([
      'Hero',
      'Overview',
      'Value Proposition',
      'Offerings',
      'Services and Pricing',
      'Contact',
      'Location',
    ]);
  });

  it('keeps uncertain schema fallback domain-neutral', () => {
    const selection = selectWebsiteSectionSchema({
      taskIntentText: 'Build website from current facts.',
      language: 'en',
    });

    expect(selection.archetype).toBe('organization-neutral');
    expect(selection.reasoning.selectedBy).toBe('organization-default');
  });

  it('selects personal-profile only under clear personal signal dominance', () => {
    const selection = selectWebsiteSectionSchema({
      taskIntentText: [
        'Create my personal website.',
        'About me: I provide counseling and I work with clients directly.',
        'My approach: practical and empathetic.',
      ].join('\n'),
      language: 'en',
    });

    expect(selection.archetype).toBe('personal-profile');
    expect(selection.reasoning.selectedBy).toBe('personal-signal-dominance');
  });
});
