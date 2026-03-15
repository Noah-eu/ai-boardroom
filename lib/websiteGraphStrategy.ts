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
  taskIntentText?: string | null;
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
    promptStructuredFactsAvailable: boolean;
    hasStructuredWebsiteSources: boolean;
    hasAcquisitionSignals: boolean;
    structuredContentAvailability: boolean;
  };
};

export const SEGMENTED_WEBSITE_GRAPH_NODE_DECOMPOSITION = [
  'content-normalization',
  'copy-hero',
  'copy-about',
  'copy-approach',
  'copy-topics',
  'copy-services-pricing',
  'copy-contact',
  'copy-map',
  'html-build',
  'styles-build',
  'script-build',
  'generated-files-assembly',
  'patch-plan',
  'quality-review',
  'bundle-export',
  'final-summary',
] as const;

export const GENERIC_CODE_GRAPH_NODE_DECOMPOSITION = [
  'file-build',
  'generated-files',
  'patch-plan',
  'quality-review',
  'bundle-export',
  'final-summary',
] as const;

export function deriveWebsiteNodeDecomposition(
  kind: WebsiteGraphStrategy['kind']
): readonly string[] {
  return kind === 'segmented-website'
    ? SEGMENTED_WEBSITE_GRAPH_NODE_DECOMPOSITION
    : GENERIC_CODE_GRAPH_NODE_DECOMPOSITION;
}

const WEBSITE_INTENT_PATTERN =
  /\b(website|web site|landing page|home\s?page|homepage|company site|static site|html\s+css|corporate site|one-page|one page)\b/i;

const WEBSITE_SECTION_PATTERN = /\b(hero|about|approach|topics?|services?|pricing|contact|map|o mne|pristup|temata|sluzby|ceny|kontakt|mapa)\b/i;

export function decideWebsiteGraphStrategy(input: WebsiteGraphStrategyInput): WebsiteGraphStrategy {
  const joined = [
    input.projectName,
    input.projectDescription,
    input.projectPrompt ?? '',
    input.taskIntentText ?? '',
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
  const promptStructuredFactsAvailable = Boolean(
    promptFacts.sourceUrl ||
      promptFacts.bodyTextBlocks.length > 0 ||
      promptFacts.serviceNames.length > 0 ||
      promptFacts.pricingFields.length > 0 ||
      promptFacts.ctaTexts.length > 0 ||
      promptFacts.emails.length > 0 ||
      promptFacts.phones.length > 0 ||
      promptFacts.addresses.length > 0
  );
  const hasStructuredWebsiteSources = Boolean(input.hasStructuredWebsiteSources);
  const hasAcquisitionSignals = Boolean(input.hasWebsiteAttachmentSignals);
  const structuredContentAvailability =
    promptStructuredFactsAvailable || explicitSectionSignals >= 3 || hasStructuredWebsiteSources;

  const shouldUseSegmented =
    input.outputType === 'website' ||
    (websiteIntent && structuredContentAvailability);

  return {
    kind: shouldUseSegmented ? 'segmented-website' : 'generic-code',
    reasoning: {
      websiteIntent,
      explicitSectionSignals,
      promptFactsSufficient,
      promptStructuredFactsAvailable,
      hasStructuredWebsiteSources,
      hasAcquisitionSignals,
      structuredContentAvailability,
    },
  };
}
