import { OutputType } from '@/types';
import {
  deriveVerifiedWebsiteContentFromPrompt,
  hasSufficientVerifiedWebsiteContent,
} from './deterministicWebsiteBuilder';

export type WebsiteGraphStrategyInput = {
  outputType: OutputType;
  projectName: string;
  projectDescription: string;
  projectPrompt?: string | null;
  revisionPrompt?: string | null;
  debateSummary?: string | null;
  hasWebsiteAttachmentSignals?: boolean;
  hasStructuredWebsiteSources?: boolean;
};

export type WebsiteGraphStrategy = {
  kind: 'segmented-website' | 'generic-code';
  reasoning: {
    websiteIntent: boolean;
    explicitSectionSignals: number;
    promptFactsSufficient: boolean;
    hasSourceSignals: boolean;
  };
};

const WEBSITE_INTENT_PATTERN =
  /\b(website|web site|landing page|home\s?page|homepage|company site|static site|html\s+css|corporate site|one-page|one page)\b/i;

const WEBSITE_SECTION_PATTERN = /\b(hero|about|approach|topics?|services?|pricing|contact|map|o mne|pristup|temata|sluzby|ceny|kontakt|mapa)\b/i;

export function decideWebsiteGraphStrategy(input: WebsiteGraphStrategyInput): WebsiteGraphStrategy {
  const joined = [
    input.projectName,
    input.projectDescription,
    input.projectPrompt ?? '',
    input.revisionPrompt ?? '',
    input.debateSummary ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const websiteIntent = input.outputType === 'website' || WEBSITE_INTENT_PATTERN.test(joined);

  const explicitSectionSignals = Array.from(new Set(
    (joined.match(new RegExp(WEBSITE_SECTION_PATTERN.source, 'gi')) ?? []).map((entry) => entry.toLowerCase())
  )).length;

  const promptFacts = deriveVerifiedWebsiteContentFromPrompt({
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    projectPrompt: input.projectPrompt ?? input.projectDescription,
    revisionPrompt: input.revisionPrompt,
    debateSummary: input.debateSummary,
  });

  const promptFactsSufficient = hasSufficientVerifiedWebsiteContent(promptFacts);
  const hasSourceSignals = Boolean(input.hasWebsiteAttachmentSignals || input.hasStructuredWebsiteSources);

  const shouldUseSegmented =
    input.outputType === 'website' ||
    (websiteIntent && (promptFactsSufficient || explicitSectionSignals >= 3 || hasSourceSignals));

  return {
    kind: shouldUseSegmented ? 'segmented-website' : 'generic-code',
    reasoning: {
      websiteIntent,
      explicitSectionSignals,
      promptFactsSufficient,
      hasSourceSignals,
    },
  };
}
