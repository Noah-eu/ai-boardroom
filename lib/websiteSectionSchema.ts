import { AppLanguage } from '@/types';
import { VerifiedWebsiteContent } from './deterministicWebsiteBuilder';

export type WebsiteSectionSlot =
  | 'hero'
  | 'about'
  | 'approach'
  | 'topics'
  | 'servicesPricing'
  | 'contact'
  | 'map';

export type WebsiteSchemaArchetype = 'personal-profile' | 'organization-neutral';

export type WebsiteSchemaSection = {
  slot: WebsiteSectionSlot;
  artifactPath: string;
  copyTaskLabel: string;
};

export type WebsiteSchemaSelection = {
  schemaId: 'personal-profile-v1' | 'organization-neutral-v1';
  archetype: WebsiteSchemaArchetype;
  confidence: 'high' | 'medium' | 'low';
  reasoning: {
    personalSignals: number;
    organizationalSignals: number;
    inputFactSignals: number;
    selectedBy: 'personal-signal-dominance' | 'organization-default';
  };
  sections: WebsiteSchemaSection[];
};

const SLOT_TO_ARTIFACT_PATH: Record<WebsiteSectionSlot, string> = {
  hero: 'copy-hero.json',
  about: 'copy-about.json',
  approach: 'copy-approach.json',
  topics: 'copy-topics.json',
  servicesPricing: 'copy-services-pricing.json',
  contact: 'copy-contact.json',
  map: 'copy-map.json',
};

const PERSONAL_SIGNAL_PATTERN =
  /\b(about me|o mne|my approach|my story|i offer|i provide|i work|jsem|nabizim|pracuji|muj pristup|muj pribeh)\b/i;

const ORGANIZATIONAL_SIGNAL_PATTERN =
  /\b(about us|o nas|our team|team|company|organization|business|collective|group|clients?|customers?|services?|locations?|branches?)\b/i;

const LEGAL_ENTITY_HINT_PATTERN = /\b(s\.r\.o\.?|a\.s\.?|llc|ltd\.?|inc\.?|gmbh|plc)\b/i;

function countPatternMatches(text: string, pattern: RegExp): number {
  const match = text.match(new RegExp(pattern.source, 'gi'));
  return match ? match.length : 0;
}

function getLocalizedSectionLabels(
  archetype: WebsiteSchemaArchetype,
  language: AppLanguage
): Record<WebsiteSectionSlot, string> {
  if (archetype === 'personal-profile') {
    if (language === 'en') {
      return {
        hero: 'Hero',
        about: 'About',
        approach: 'Approach and Education',
        topics: 'Topics',
        servicesPricing: 'Services and Pricing',
        contact: 'Contact',
        map: 'Map',
      };
    }

    return {
      hero: 'Hero',
      about: 'O mne',
      approach: 'Pristup a vzdelavani',
      topics: 'Temata',
      servicesPricing: 'Sluzby a ceny',
      contact: 'Kontakt',
      map: 'Mapa',
    };
  }

  if (language === 'en') {
    return {
      hero: 'Hero',
      about: 'Overview',
      approach: 'Value Proposition',
      topics: 'Offerings',
      servicesPricing: 'Services and Pricing',
      contact: 'Contact',
      map: 'Location',
    };
  }

  return {
    hero: 'Hero',
    about: 'Prehled',
    approach: 'Hodnoty a pristup',
    topics: 'Nabidka',
    servicesPricing: 'Sluzby a ceny',
    contact: 'Kontakt',
    map: 'Lokalita',
  };
}

function countInputFactSignals(verified?: VerifiedWebsiteContent | null): number {
  if (!verified) return 0;
  let signals = 0;

  if (verified.serviceNames.length > 1) signals += 1;
  if (verified.pricingFields.length > 0) signals += 1;
  if (verified.addresses.length > 0) signals += 1;
  if (verified.ctaTexts.length > 0) signals += 1;
  if (verified.emails.length > 0 || verified.phones.length > 0) signals += 1;

  if (LEGAL_ENTITY_HINT_PATTERN.test(verified.pageTitle)) {
    signals += 1;
  }

  const factText = [
    verified.pageTitle,
    ...verified.bodyTextBlocks,
    ...verified.headings,
    ...verified.serviceNames,
    ...verified.ctaTexts,
  ].join('\n');

  if (countPatternMatches(factText, ORGANIZATIONAL_SIGNAL_PATTERN) > 0) {
    signals += 1;
  }

  return signals;
}

export function selectWebsiteSectionSchema(input: {
  taskIntentText: string;
  language?: AppLanguage;
  verifiedFacts?: VerifiedWebsiteContent | null;
}): WebsiteSchemaSelection {
  const language = input.language ?? 'cz';
  const taskIntent = input.taskIntentText ?? '';

  const personalSignals = countPatternMatches(taskIntent, PERSONAL_SIGNAL_PATTERN);
  const organizationalSignals =
    countPatternMatches(taskIntent, ORGANIZATIONAL_SIGNAL_PATTERN) +
    countPatternMatches(taskIntent, LEGAL_ENTITY_HINT_PATTERN);
  const inputFactSignals = countInputFactSignals(input.verifiedFacts);

  const effectiveOrganizational = organizationalSignals + (inputFactSignals >= 2 ? 1 : 0);

  const archetype: WebsiteSchemaArchetype =
    personalSignals >= 2 && personalSignals > effectiveOrganizational
      ? 'personal-profile'
      : 'organization-neutral';

  const selectedBy: WebsiteSchemaSelection['reasoning']['selectedBy'] =
    archetype === 'personal-profile' ? 'personal-signal-dominance' : 'organization-default';

  const scoreDelta = Math.abs(personalSignals - effectiveOrganizational);
  const confidence: WebsiteSchemaSelection['confidence'] =
    scoreDelta >= 3 ? 'high' : scoreDelta >= 1 ? 'medium' : 'low';

  const labels = getLocalizedSectionLabels(archetype, language);

  const sections: WebsiteSchemaSection[] = (
    ['hero', 'about', 'approach', 'topics', 'servicesPricing', 'contact', 'map'] as const
  ).map((slot) => ({
    slot,
    artifactPath: SLOT_TO_ARTIFACT_PATH[slot],
    copyTaskLabel: labels[slot],
  }));

  return {
    schemaId: archetype === 'personal-profile' ? 'personal-profile-v1' : 'organization-neutral-v1',
    archetype,
    confidence,
    reasoning: {
      personalSignals,
      organizationalSignals: effectiveOrganizational,
      inputFactSignals,
      selectedBy,
    },
    sections,
  };
}

export function createWebsiteCopyTaskPlan(selection: WebsiteSchemaSelection): Array<{
  slot: WebsiteSectionSlot;
  artifactPath: string;
  taskTitleLabel: string;
}> {
  return selection.sections.map((section) => ({
    slot: section.slot,
    artifactPath: section.artifactPath,
    taskTitleLabel: section.copyTaskLabel,
  }));
}
