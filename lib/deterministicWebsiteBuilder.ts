import { AppLanguage, ExecutionSnapshot } from '@/types';

export type VerifiedWebsiteContent = {
  sourceUrl: string | null;
  pageTitle: string;
  navigationLabels: string[];
  headings: string[];
  bodyTextBlocks: string[];
  serviceNames: string[];
  pricingFields: string[];
  ctaTexts: string[];
  emails: string[];
  phones: string[];
  addresses: string[];
  missingFields: string[];
  warnings: string[];
};

export type DeterministicWebsiteArtifacts = {
  indexHtml: string;
  stylesCss: string;
  scriptJs: string;
};

export type BilingualWebsiteArtifacts = {
  indexCzHtml: string;
  indexEnHtml: string;
  stylesCss: string;
  scriptJs: string;
};

export type WebsitePipelineDiagnostics = {
  language: AppLanguage;
  rawExtractedSourceFacts: {
    pageTitle: string;
    headings: string[];
    bodyTextBlocks: string[];
    serviceNames: string[];
    pricingFields: string[];
    ctaTexts: string[];
    emails: string[];
    phones: string[];
    addresses: string[];
  };
  localeFilteredFacts: {
    headings: string[];
    bodyFacts: string[];
    serviceFacts: string[];
    pricingFacts: string[];
    ctaFacts: string[];
  };
  normalizedContentModel: {
    title: string;
    heroTitle: string;
    heroSubtitle: string;
    aboutCopy: string;
    approachCopy: string;
    topics: string[];
    services: string[];
    pricing: string[];
    contact: {
      email: string | null;
      phone: string | null;
      address: string | null;
    };
    mapCopy: string;
    mapUrl: string | null;
  };
  selectedSchema: {
    archetype: WebsiteArchetype;
    labels: {
      aboutHeading: string;
      approachHeading: string;
      topicsHeading: string;
      servicesPricingHeading: string;
      contactHeading: string;
      mapHeading: string;
    };
  };
  slotInputs: {
    hero: { title: string; supportingFact: string | null; ctaCandidates: string[] };
    about: { seed: string | null; fallback: string | null; override: string | null };
    approach: { seed: string | null; fallback: string | null; override: string | null };
    topics: { candidates: string[]; override: string[] };
    servicesPricing: { verifiedServices: string[]; retainedServiceFacts: string[]; verifiedPricing: string[]; overrideServices: string[]; overridePricing: string[] };
    contact: { introOverride: string | null; email: string | null; phone: string | null; address: string | null };
    map: { fact: string | null; override: string | null };
  };
  finalRenderedSections: {
    about: { shown: boolean; heading: string; items: string[] };
    approach: { shown: boolean; heading: string; items: string[] };
    topics: { shown: boolean; heading: string; items: string[] };
    servicesPricing: { shown: boolean; heading: string; items: string[] };
    contact: { shown: boolean; heading: string; items: string[] };
    map: { shown: boolean; heading: string; items: string[] };
  };
  phaseIssues: {
    rawExtractedSourceFacts: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
    localeFilteredFacts: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
    normalizedWebsiteContentModel: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
    selectedArchetypeSchema: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
    slotInputs: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
    finalRenderedSections: {
      mixedLanguageLeakage: boolean;
      wrongSchemaOrArchetype: boolean;
      noisyFragmentInclusion: boolean;
      factLossToPlaceholder: boolean;
      crossSlotContamination: boolean;
    };
  };
  firstCorruptionPoint:
    | 'locale-filtered facts'
    | 'normalized website content model'
    | 'selected archetype/schema'
    | 'slot inputs'
    | 'final rendered sections'
    | null;
};

export type WebsitePortraitImage = {
  src: string;
  alt: string;
};

export type WebsiteCopySections = {
  hero: {
    title: string;
    subtitle: string;
    cta: string;
  };
  about: {
    body: string;
  };
  approach: {
    body: string;
  };
  topics: {
    items: string[];
  };
  servicesPricing: {
    services: string[];
    pricing: string[];
  };
  contact: {
    intro: string;
  };
  map: {
    body: string;
  };
};

export type PromptWebsiteExtractionInput = {
  projectName?: string;
  projectDescription?: string;
  projectPrompt?: string;
  revisionPrompt?: string | null;
  debateSummary?: string | null;
};

type PublicWebsiteViewModel = {
  language: AppLanguage;
  labels: LocalizedWebsiteLabels;
  title: string;
  heroTitle: string;
  heroSubtitle: string;
  aboutCopy: string;
  approachCopy: string;
  topics: string[];
  services: string[];
  pricing: string[];
  contact: {
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  primaryCta: string;
  sourceUrl: string | null;
  mapUrl: string | null;
  contactIntro: string;
  mapCopy: string;
};

type PricingCandidate = {
  display: string;
  value: number;
};

type WebsiteArchetype = 'personal-profile' | 'company-service';

type LocalizedWebsiteLabels = {
  htmlLang: 'cs' | 'en';
  heroSectionLabel: string;
  aboutSectionId: string;
  aboutHeading: string;
  approachSectionId: string;
  approachHeading: string;
  topicsSectionId: string;
  topicsHeading: string;
  servicesPricingSectionId: string;
  servicesPricingHeading: string;
  servicesHeading: string;
  pricingHeading: string;
  contactSectionId: string;
  contactHeading: string;
  mapSectionId: string;
  mapHeading: string;
  mapLinkLabel: string;
  emptyListNote: string;
  noContactNote: string;
};

type WebsiteBuildDebugCollector = {
  rawExtractedSourceFacts?: WebsitePipelineDiagnostics['rawExtractedSourceFacts'];
  localeFilteredFacts?: WebsitePipelineDiagnostics['localeFilteredFacts'];
  selectedSchema?: WebsitePipelineDiagnostics['selectedSchema'];
  slotInputs?: WebsitePipelineDiagnostics['slotInputs'];
};

const INTERNAL_TEXT_MARKERS = [
  /\bverified\s+source\s+snapshot\b/i,
  /\bstructured\s+snapshot\b/i,
  /\bproject\s+prompt\b/i,
  /\brevision\s+request\b/i,
  /\braw\s+prompt\b/i,
  /\bsummary-metadata\.json\b/i,
  /\bsite-metadata\.json\b/i,
  /\bapp-manifest\.json\b/i,
  /\bmissing\s+fields\b/i,
  /\bextraction\s*warnings?\b/i,
  /\bdebug\b/i,
  /\bmetadata\b/i,
  /\bnavigation\s+labels?\b/i,
  /\braw\s+extracted\b/i,
];

const NAVIGATION_LABEL_PATTERNS = [
  /^home$/i,
  /^domu$/i,
  /^dom[uů]$/i,
  /^about$/i,
  /^o\s*mne$/i,
  /^services?$/i,
  /^sluzby$/i,
  /^contact$/i,
  /^kontakt$/i,
  /^pricing$/i,
  /^cenik$/i,
  /^blog$/i,
  /^faq$/i,
  /^mapa$/i,
];

const GENERIC_PRICING_PLACEHOLDER_PATTERNS = [
  /\bcen[ií]k\s+na\s+vy[žz][aá]d[aá]n[ií]\b/i,
  /\bprice\s+on\s+request\b/i,
  /\bcontact\s+for\s+pricing\b/i,
  /\bpricing\s+tbd\b/i,
  /\bdle\s+domluvy\b/i,
];

const PROVENANCE_STOPWORDS = new Set([
  'a',
  'and',
  'the',
  'for',
  'with',
  'from',
  'that',
  'this',
  'will',
  'are',
  'you',
  'your',
  'our',
  'about',
  'to',
  'na',
  'pro',
  've',
  'po',
  'jsou',
  'bude',
  'budou',
  'vase',
  'nase',
  'zde',
  'vice',
]);

const NEUTRAL_FALLBACK_COPY = {
  cz: { heroSubtitle: '', about: '', approach: '' },
  en: { heroSubtitle: '', about: '', approach: '' },
} as const;

const PERSONAL_PROFILE_PATTERNS = [
  /\b(i|me|my|myself)\b/i,
  /\b(j[aá]|m[eě]|muj|moje|mne)\b/i,
  /\b(i\s+(offer|provide|work)|jsem|pracuji|nabizim|poskytuji)\b/i,
];

const ORGANIZATION_PROFILE_PATTERNS = [
  /\b(we|our|team|company|organization|business)\b/i,
  /\b(my\s+team|our\s+team|we\s+provide|we\s+offer)\b/i,
  /\b(my\s+company|our\s+company|spolecnost|firma|tym|nase\s+sluzby|poskytujeme|nabizime)\b/i,
];

function deriveWebsiteArchetype(params: {
  projectName: string;
  headings: string[];
  bodyFacts: string[];
  serviceNames: string[];
  ctaTexts: string[];
}): WebsiteArchetype {
  const source = [
    params.projectName,
    ...params.headings,
    ...params.bodyFacts,
    ...params.serviceNames,
    ...params.ctaTexts,
  ];

  let personalHits = 0;
  let organizationHits = 0;

  source.forEach((entry) => {
    const cleaned = normalizeWhitespace(entry);
    if (!cleaned) return;
    PERSONAL_PROFILE_PATTERNS.forEach((pattern) => {
      if (pattern.test(cleaned)) personalHits += 1;
    });
    ORGANIZATION_PROFILE_PATTERNS.forEach((pattern) => {
      if (pattern.test(cleaned)) organizationHits += 1;
    });
  });

  return personalHits > organizationHits && personalHits > 0 ? 'personal-profile' : 'company-service';
}

function tokenizeForProvenance(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !PROVENANCE_STOPWORDS.has(token));
}

function hasProvenanceOverlap(candidate: string, facts: string[]): boolean {
  const candidateTokens = uniq(tokenizeForProvenance(candidate), 40);
  if (candidateTokens.length === 0) return false;

  const factTokens = new Set<string>();
  facts.forEach((fact) => {
    tokenizeForProvenance(fact).forEach((token) => factTokens.add(token));
  });

  if (factTokens.size === 0) return false;

  let overlap = 0;
  for (const token of candidateTokens) {
    if (factTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= 2 || (candidateTokens.length <= 3 && overlap >= 1);
}

function isNeutralFallbackText(value: string, language: AppLanguage): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  const fallback = NEUTRAL_FALLBACK_COPY[language === 'en' ? 'en' : 'cz'];
  return (
    normalized === normalizeWhitespace(fallback.heroSubtitle).toLowerCase() ||
    normalized === normalizeWhitespace(fallback.about).toLowerCase() ||
    normalized === normalizeWhitespace(fallback.approach).toLowerCase()
  );
}

const CONTENT_BEARING_TEXT_HINT = /\b(service|services|solution|solutions|offer|offers|support|contact|pricing|product|products|portfolio|about|team|sluzb|sluzby|nabidka|reseni|podpora|kontakt|cena|ceny|produkt|portfolio|tym)\b/i;
const GENERIC_WEBSITE_TITLE_PATTERN = /^(website|web\s*site|site|landing\s*page|home\s*page|homepage|company\s*website)$/i;

function getLocalizedWebsiteLabels(language: AppLanguage, archetype: WebsiteArchetype): LocalizedWebsiteLabels {
  if (language === 'en') {
    const personal = archetype === 'personal-profile';
    return {
      htmlLang: 'en',
      heroSectionLabel: 'Intro',
      aboutSectionId: personal ? 'about-me' : 'about-company',
      aboutHeading: personal ? 'About' : 'About Company',
      approachSectionId: personal ? 'how-i-work' : 'how-we-work',
      approachHeading: personal ? 'How I Work' : 'How We Work',
      topicsSectionId: personal ? 'topics' : 'highlights',
      topicsHeading: personal ? 'Topics' : 'Highlights',
      servicesPricingSectionId: 'services-pricing',
      servicesPricingHeading: 'Services and Pricing',
      servicesHeading: 'Services',
      pricingHeading: 'Pricing',
      contactSectionId: 'contact',
      contactHeading: 'Contact',
      mapSectionId: 'map',
      mapHeading: 'Map',
      mapLinkLabel: 'Open map',
      emptyListNote: '',
      noContactNote: '',
    };
  }

  const personal = archetype === 'personal-profile';

  return {
    htmlLang: 'cs',
    heroSectionLabel: 'Úvod',
    aboutSectionId: personal ? 'o-mne' : 'o-nas',
    aboutHeading: personal ? 'O mně' : 'O nás',
    approachSectionId: personal ? 'jak-pracuji' : 'jak-pracujeme',
    approachHeading: personal ? 'Jak pracuji' : 'Jak pracujeme',
    topicsSectionId: personal ? 'temata' : 'hlavni-oblasti',
    topicsHeading: personal ? 'Témata' : 'Hlavní oblasti',
    servicesPricingSectionId: 'sluzby-ceny',
    servicesPricingHeading: 'Služby a ceny',
    servicesHeading: 'Služby',
    pricingHeading: 'Ceny',
    contactSectionId: 'kontakt',
    contactHeading: 'Kontakt',
    mapSectionId: 'mapa',
    mapHeading: 'Mapa',
    mapLinkLabel: 'Otevřít mapu',
    emptyListNote: '',
    noContactNote: '',
  };
}

function uniq(values: string[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s)\]}>"']+/gi) ?? [];
  return uniq(matches, 8);
}

function extractEmailsFromText(value: string): string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return uniq(matches, 12);
}

function extractPhonesFromText(value: string): string[] {
  const matches = value.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return uniq(matches.map((entry) => normalizePhoneDisplay(entry) ?? '').filter(Boolean), 12);
}

function splitPromptLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function parseLabeledPromptFields(lines: string[]): Map<string, string[]> {
  const output = new Map<string, string[]>();

  lines.forEach((line) => {
    const match = line.match(/^([A-Za-z\u00C0-\u017F\s]+):\s*(.+)$/);
    if (!match) return;
    const rawLabel = match[1].trim().toLowerCase();
    const value = normalizeWhitespace(match[2]);
    if (!value) return;

    const normalizedLabel = rawLabel
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const current = output.get(normalizedLabel) ?? [];
    current.push(value);
    output.set(normalizedLabel, current);
  });

  return output;
}

function getPromptLabelValues(map: Map<string, string[]>, aliases: string[]): string[] {
  const normalizedAliases = aliases.map((alias) =>
    alias
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  );

  const output: string[] = [];
  map.forEach((values, key) => {
    if (!normalizedAliases.includes(key)) return;
    output.push(...values);
  });

  return uniq(output, 20);
}

function looksLikeAddressFact(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (/\b(address|adresa|street|st\.?|road|rd\.?|avenue|ave\.?|ul\.?|ulice|psc|zip|postal|post code|building|suite|unit|office)\b/i.test(normalized)) {
    return true;
  }
  const hasPostalPattern = /\b\d{3}\s?\d{2}\b/.test(normalized) || /\b\d{4,6}\b/.test(normalized);
  const hasStreetLike = /\b\d+[\w/-]*\b/.test(normalized) && /[A-Za-z\u00C0-\u017F]/.test(normalized);
  return hasPostalPattern && hasStreetLike;
}

function looksLikeServiceFact(value: string): boolean {
  return /\b(service|services|solution|solutions|offer|offering|package|packages|product|products|portfolio|feature|features|sluzb|sluzby|nabidka|nabizime|reseni|balicek|balicky|produkt|produkty|portfolio|funkce)\b/i.test(value);
}

function looksLikePricingFact(value: string): boolean {
  return /\b(od|from|cena|cenik|pricing|price)\b/i.test(value) || /(Kc|Kč|CZK|EUR|USD|€|\$)/i.test(value);
}

function looksLikeCtaFact(value: string): boolean {
  return /\b(contact|get started|learn more|request|quote|buy|shop|book|reserve|call|discover|download|subscribe|kontakt|kontaktovat|zacit|zjistit|poptat|objednat|koupit|odebrat)\b/i.test(value);
}

function extractPromptFacts(lines: string[]): {
  headings: string[];
  bodyTextBlocks: string[];
  serviceNames: string[];
  pricingFields: string[];
  ctaTexts: string[];
  addresses: string[];
} {
  const unlabeledLines = lines.filter((line) => !/^[A-Za-z\u00C0-\u017F\s]+:\s*.+$/.test(line));

  const headings = uniq(
    unlabeledLines
      .filter((line) => /^(hero|about|approach|topics?|services?|pricing|contact|mapa?|o mne|pristup|sluzby)\b/i.test(line))
      .map((line) => line.replace(/:.+$/, '').trim()),
    20
  );

  const bodyTextBlocks = uniq(
    unlabeledLines.filter(
      (line) => line.length >= 24 && !looksLikeSerializedPayload(line) && !containsInternalMarker(line)
    ),
    36
  );

  const serviceNames = uniq(unlabeledLines.filter((line) => looksLikeServiceFact(line)), 16);
  const pricingFields = uniq(unlabeledLines.filter((line) => looksLikePricingFact(line)), 16);
  const ctaTexts = uniq(unlabeledLines.filter((line) => looksLikeCtaFact(line)).slice(0, 10), 10);
  const addresses = uniq(unlabeledLines.filter((line) => looksLikeAddressFact(line)), 8);

  return {
    headings,
    bodyTextBlocks,
    serviceNames,
    pricingFields,
    ctaTexts,
    addresses,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function humanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || 'Website';
}

function isGenericWebsiteTitle(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  return GENERIC_WEBSITE_TITLE_PATTERN.test(normalized);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function looksLikeSerializedPayload(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return true;
  }
  return /"[^"]+"\s*:/.test(trimmed);
}

function containsInternalMarker(value: string): boolean {
  return INTERNAL_TEXT_MARKERS.some((pattern) => pattern.test(value));
}

function isNavigationLikeLabel(value: string): boolean {
  const normalized = normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!normalized) return false;
  return NAVIGATION_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizePublicText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return null;
  if (containsInternalMarker(cleaned)) return null;
  if (looksLikeSerializedPayload(cleaned)) return null;
  return cleaned;
}

function sanitizePublicList(
  values: Array<string | null | undefined>,
  max: number,
  options?: {
    rejectNavigationLabels?: boolean;
    rejectInternalMarkers?: boolean;
  }
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const cleaned = sanitizePublicText(value);
    if (!cleaned) continue;
    if (options?.rejectNavigationLabels && isNavigationLikeLabel(cleaned)) continue;
    if (options?.rejectInternalMarkers !== false && containsInternalMarker(cleaned)) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }

  return out;
}

function normalizeComparable(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toComparableSet(values: string[]): Set<string> {
  const output = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeComparable(value);
    if (normalized) output.add(normalized);
  });
  return output;
}

function stripStructuralLabels(values: string[], structuralLabels: Set<string>, max: number): string[] {
  return sanitizePublicList(values, max).filter((value) => !structuralLabels.has(normalizeComparable(value)));
}

function deriveContentLikeSentences(values: string[], max: number): string[] {
  const segments = values
    .flatMap((entry) => entry.split(/[\n.;!?]+/))
    .map((entry) => sanitizePublicText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => entry.length >= 24 || CONTENT_BEARING_TEXT_HINT.test(entry));
  return uniq(segments, max);
}

function limitSentenceLength(value: string, maxChars = 180): string {
  const cleaned = normalizeWhitespace(value);
  if (cleaned.length <= maxChars) return cleaned;
  const cut = cleaned.lastIndexOf(' ', maxChars - 3);
  return `${cleaned.slice(0, cut > 40 ? cut : maxChars - 3)}...`;
}

function normalizePublicParagraph(value: string | null | undefined, maxChars = 220): string | null {
  const cleaned = sanitizePublicText(value);
  if (!cleaned) return null;
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  const collapsed = limitSentenceLength(firstSentence, maxChars);
  if (!collapsed) return null;
  return /[.!?]$/.test(collapsed) ? collapsed : `${collapsed}.`;
}

function detectTextLocale(value: string): AppLanguage | 'unknown' {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return 'unknown';

  const normalizedAscii = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const tokens = normalizedAscii.match(/[a-z]+/g) ?? [];
  if (tokens.length === 0) return 'unknown';

  const czHints = new Set([
    'a',
    'na',
    'pro',
    's',
    'v',
    'k',
    'od',
    'sluzby',
    'sluzba',
    'kontakt',
    'mapa',
    'adresa',
    'cena',
    'ceny',
    'nabidka',
    'tym',
    'spolecnost',
    'firma',
    'zakaznik',
    'podpora',
    'reseni',
    'produkty',
    'sluzeb',
    'rezervace',
    'ubytovani',
    'snidane',
    'pobyt',
    'zakaznicky',
    'provozni',
  ]);

  const enHints = new Set([
    'the',
    'and',
    'with',
    'for',
    'from',
    'about',
    'services',
    'service',
    'contact',
    'map',
    'address',
    'book',
    'pricing',
    'overview',
    'highlights',
    'team',
    'company',
    'support',
    'solution',
    'solutions',
    'product',
    'products',
    'request',
    'quote',
    'learn',
    'more',
    'individual',
    'sessions',
  ]);

  let czHits = /[áéěíóúůýčďňřšťž]/i.test(value) ? 2 : 0;
  let enHits = 0;

  tokens.forEach((token) => {
    if (czHints.has(token)) czHits += 1;
    if (enHints.has(token)) enHits += 1;
  });

  if (czHits === 0 && enHits === 0) return 'unknown';
  if (czHits === enHits) return 'unknown';
  return czHits > enHits ? 'cz' : 'en';
}

function isLocaleConsistentText(value: string, targetLanguage: AppLanguage): boolean {
  const detected = detectTextLocale(value);
  if (detected === targetLanguage) return true;
  if (detected !== 'unknown') return false;

  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  if (!/[A-Za-z\u00C0-\u017F]/.test(normalized)) return true;
  if (/\b(mailto:|tel:|https?:\/\/|www\.)/i.test(normalized)) return true;

  const normalizedAscii = normalized
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const czMarker =
    /\b(a|na|pro|s|v|k|od|sluzby|sluzba|kontakt|mapa|adresa|cena|ceny|nabidka|tym|spolecnost|firma|zakaznik|podpora|reseni|produkty|sluzeb|rezervace|ubytovani|snidane|wellness|pobyt|zakaznicky|provozni)\b/i.test(
      normalizedAscii
    ) || /[áéěíóúůýčďňřšťž]/i.test(normalized);
  const enMarker =
    /\b(the|and|with|for|from|about|services?|contact|map|address|book|pricing|overview|highlights|team|company|support|solution|solutions|product|products|request|quote|learn|more|individual|sessions|call|reserve|buy|shop|download|subscribe)\b/i.test(
      normalizedAscii
    );

  if (targetLanguage === 'cz') {
    return !(enMarker && !czMarker);
  }

  return !(czMarker && !enMarker);
}

function isNoisyPublicListItem(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  if (/[{}\[\]<>]/.test(normalized)) return true;
  if (/\b(mailto:|tel:|https?:\/\/|www\.)/i.test(normalized)) return true;
  if (/\b(email|e-mail|telefon|phone|kontakt|contact|adresa|address|mapa|map)\b/i.test(normalized)) return true;
  if (looksLikeAddressFact(normalized)) {
    return true;
  }
  if (/\b(kc|kč|czk|eur|usd|€|\$)\b/i.test(normalized)) return true;
  const digits = (normalized.match(/\d/g) ?? []).length;
  if (digits >= 4) return true;
  return false;
}

function toTopicLikeItem(value: string): string | null {
  const cleaned = sanitizePublicText(value);
  if (!cleaned) return null;

  const firstFragment = cleaned
    .split(/[;|]/)[0]
    .split(/\s[-–—]\s/)[0]
    .split(':')
    .pop();

  const normalized = normalizeWhitespace(firstFragment ?? cleaned)
    .replace(/^[\-•*\d.\s]+/, '')
    .replace(/^(tema|topic|oblast|focus)\s*[:\-]?\s*/i, '')
    .trim();

  if (!normalized) return null;
  if (/\b(kontakt|contact|email|telefon|phone|pricing|price|cena|cenik|mapa|map|adresa|address)\b/i.test(normalized)) {
    return null;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const concise = words.slice(0, 7).join(' ');
  return concise.length <= 64 ? concise : concise.slice(0, 61).trimEnd() + '...';
}

function deriveTopicLikeItems(values: string[], max: number): string[] {
  const candidates = values
    .flatMap((entry) => entry.split(/[\n,]/))
    .map((entry) => toTopicLikeItem(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => !isNoisyPublicListItem(entry));

  return uniq(candidates, max);
}

function resolvePublicPortraitAlt(inputAlt: string | null | undefined, title: string, language: AppLanguage): string {
  const cleaned = sanitizePublicText(inputAlt ?? '');
  if (cleaned && cleaned.length >= 4 && !containsInternalMarker(cleaned) && !/\b(debug|metadata|snapshot|json|raw|prompt)\b/i.test(cleaned)) {
    return limitSentenceLength(cleaned, 90);
  }
  return language === 'cz' ? `Portrét: ${title}` : `Portrait: ${title}`;
}

function isGenericPricingPlaceholder(value: string): boolean {
  return GENERIC_PRICING_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function pickFirstContentBearingFact(values: string[], excludedValues: string[]): string | null {
  const excluded = toComparableSet(excludedValues);
  for (const value of values) {
    const normalized = normalizeComparable(value);
    if (!normalized || excluded.has(normalized)) continue;
    if (value.length < 18 && !CONTENT_BEARING_TEXT_HINT.test(value)) continue;
    return value;
  }
  return null;
}

function normalizePhoneForTel(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

function extractFirstEmail(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
}

function normalizePhoneDisplay(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  const digits = normalized.replace(/[^\d+]/g, '');
  const czMatch = digits.match(/^\+?420(\d{3})(\d{3})(\d{3})$/);
  if (czMatch) {
    return `+420 ${czMatch[1]} ${czMatch[2]} ${czMatch[3]}`;
  }
  return normalized;
}

function normalizeAddressDisplay(value: string | null): string | null {
  if (!value) return null;

  const withoutContactFragments = value
    .replace(/\b(e-?mail|email)\b\s*[:\-]?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b(tel\.?|telefon|phone|mobil(?:e)?)\b\s*[:\-]?\s*\+?[0-9][0-9\s\-()]{6,}/gi, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\+?[0-9][0-9\s\-()]{7,}/g, '');

  const cleaned = withoutContactFragments
    .replace(/\b(adresa|address|sidlo|sídlo|provozovna)\s*[:\-]/gi, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/[|;]+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '')
    .trim();

  if (!cleaned) return null;
  if (/\b(e-?mail|email|tel\.?|telefon|phone|mobil(?:e)?)\b\s*[:\-]/i.test(cleaned)) return null;
  const hasLetter = /[A-Za-z\u00C0-\u017F]/.test(cleaned);
  return hasLetter ? cleaned : null;
}

function parseLocalizedNumber(value: string): number | null {
  const cleaned = value.replace(/\s+/g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPublicCurrency(value: string): string {
  const upper = value.toUpperCase();
  if (upper === 'KC' || upper === 'KČ' || upper === 'CZK') return 'Kč';
  return upper;
}

function normalizePricingLine(value: string): PricingCandidate | null {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return null;

  // Require pricing markers/currency to avoid unrelated numeric labels.
  if (!/(od|from|price|pricing|cena|cenik|ceník|cost|starting|starting at|per|za|\/)/i.test(cleaned) && !/(Kc|Kč|CZK|EUR|USD|€|\$)/i.test(cleaned)) {
    return null;
  }

  const match = cleaned.match(/([0-9][0-9\s.,]{0,20})(?:\s*)(Kc|Kč|CZK|EUR|USD|€|\$)/i);
  if (!match) return null;

  const numericValue = parseLocalizedNumber(match[1]);
  if (!numericValue || numericValue <= 0) return null;

  const amount = match[1].replace(/\s+/g, ' ').trim();
  const currency = toPublicCurrency(match[2]);
  const prefix = /\b(from|od)\b/i.test(cleaned) ? 'Od ' : '';
  return {
    display: `${prefix}${amount} ${currency}`,
    value: numericValue,
  };
}

function normalizePricingRows(rows: string[]): string[] {
  const candidates = rows
    .map((entry) => normalizePricingLine(entry))
    .filter((entry): entry is PricingCandidate => Boolean(entry));

  if (candidates.length === 0) {
    return [];
  }

  if (candidates.length === 1) {
    return [candidates[0].display];
  }

  const sortedValues = [...candidates].map((entry) => entry.value).sort((a, b) => a - b);
  const median = sortedValues[Math.floor(sortedValues.length / 2)] ?? sortedValues[0];
  const filtered = candidates.filter((entry) => entry.value >= median * 0.7 && entry.value <= median * 2.5);
  const selected = filtered.length > 0 ? filtered : candidates;
  return uniq(selected.map((entry) => entry.display), 8);
}

function buildMapUrl(address: string | null): string | null {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildPublicWebsiteViewModel(params: {
  projectName: string;
  verified: VerifiedWebsiteContent;
  copySections?: Partial<WebsiteCopySections>;
  language?: AppLanguage;
  debugCollector?: WebsiteBuildDebugCollector;
}): PublicWebsiteViewModel {
  const language = params.language ?? 'cz';
  const verifiedTitle = sanitizePublicText(params.verified.pageTitle);
  const fallbackProjectTitle = sanitizePublicText(params.projectName) ?? 'Website';
  const resolvedTitle =
    !isGenericWebsiteTitle(verifiedTitle)
      ? verifiedTitle
      : !isGenericWebsiteTitle(fallbackProjectTitle)
      ? fallbackProjectTitle
      : verifiedTitle ?? fallbackProjectTitle;
  const title = humanTitle(resolvedTitle ?? 'Website');

  const sanitizedNavigationLabels = sanitizePublicList(params.verified.navigationLabels, 30, {
    rejectNavigationLabels: false,
  });
  const sanitizedHeadings = sanitizePublicList(params.verified.headings, 30, {
    rejectNavigationLabels: true,
  });
  const structuralLabels = toComparableSet([...sanitizedNavigationLabels, ...sanitizedHeadings]);
  const sanitizedBodyTextBlocks = stripStructuralLabels(params.verified.bodyTextBlocks, structuralLabels, 36);
  const candidateBodyFacts = deriveContentLikeSentences(sanitizedBodyTextBlocks, 16).map((entry) =>
    limitSentenceLength(entry, 200)
  );

  const sanitizedServiceNames = sanitizePublicList(params.verified.serviceNames, 20, {
    rejectNavigationLabels: true,
  });
  const sanitizedPricingFields = sanitizePublicList(params.verified.pricingFields, 20);
  const sanitizedCtaTexts = sanitizePublicList(params.verified.ctaTexts, 12, {
    rejectNavigationLabels: true,
  });
  const sanitizedEmails = sanitizePublicList(params.verified.emails, 12);
  const sanitizedPhones = sanitizePublicList(params.verified.phones, 12);
  const sanitizedAddresses = sanitizePublicList(params.verified.addresses, 8);
  const addressCandidates = uniq(
    [
      ...sanitizedAddresses,
      ...candidateBodyFacts.filter((entry) => looksLikeAddressFact(entry)),
    ],
    10
  );

  const verifiedServices = stripStructuralLabels(sanitizedServiceNames, structuralLabels, 12);
  const archetype = deriveWebsiteArchetype({
    projectName: title,
    headings: sanitizedHeadings,
    bodyFacts: candidateBodyFacts,
    serviceNames: verifiedServices,
    ctaTexts: sanitizedCtaTexts,
  });
  const labels = getLocalizedWebsiteLabels(language, archetype);

  params.debugCollector &&
    (params.debugCollector.rawExtractedSourceFacts = {
      pageTitle: params.verified.pageTitle,
      headings: [...params.verified.headings],
      bodyTextBlocks: [...params.verified.bodyTextBlocks],
      serviceNames: [...params.verified.serviceNames],
      pricingFields: [...params.verified.pricingFields],
      ctaTexts: [...params.verified.ctaTexts],
      emails: [...params.verified.emails],
      phones: [...params.verified.phones],
      addresses: [...params.verified.addresses],
    });

  params.debugCollector &&
    (params.debugCollector.selectedSchema = {
      archetype,
      labels: {
        aboutHeading: labels.aboutHeading,
        approachHeading: labels.approachHeading,
        topicsHeading: labels.topicsHeading,
        servicesPricingHeading: labels.servicesPricingHeading,
        contactHeading: labels.contactHeading,
        mapHeading: labels.mapHeading,
      },
    });
  const bodyFacts = candidateBodyFacts.filter((entry) => isLocaleConsistentText(entry, language));
  const localeCtaTexts = sanitizedCtaTexts.filter((entry) => isLocaleConsistentText(entry, language));
  const localeVerifiedServices = verifiedServices.filter((entry) => isLocaleConsistentText(entry, language));
  const services = uniq(localeVerifiedServices, 8);

  const topics = deriveTopicLikeItems(
    [
      ...stripStructuralLabels(sanitizedHeadings, structuralLabels, 20),
      ...bodyFacts,
      ...localeVerifiedServices,
    ].filter((entry) => !/kontakt|contact|mapa|pricing|price|cen/i.test(entry)),
    6
  );

  const verifiedPricing = normalizePricingRows([
    ...sanitizedPricingFields,
    ...bodyFacts,
    ...localeVerifiedServices,
  ]);

  const retainedServiceFacts = uniq(
    bodyFacts
      .filter((entry) => looksLikeServiceFact(entry) && !isNoisyPublicListItem(entry))
      .map((entry) => limitSentenceLength(entry, 90)),
    8
  );

  params.debugCollector &&
    (params.debugCollector.localeFilteredFacts = {
      headings: sanitizedHeadings.filter((entry) => isLocaleConsistentText(entry, language)),
      bodyFacts,
      serviceFacts: verifiedServices.filter((entry) => isLocaleConsistentText(entry, language)),
      pricingFacts: verifiedPricing.filter((entry) => isLocaleConsistentText(entry, language)),
      ctaFacts: localeCtaTexts,
    });

  const provenanceFacts = uniq(
    [
      title,
      ...sanitizedHeadings,
      ...bodyFacts,
      ...localeVerifiedServices,
      ...verifiedPricing,
      ...sanitizedCtaTexts,
      ...sanitizedEmails,
      ...sanitizedPhones,
      ...addressCandidates,
    ],
    200
  );

  const isProvenanceSafeOverride = (value: string | null | undefined): boolean => {
    if (!value?.trim()) return false;
    return isNeutralFallbackText(value, language) || hasProvenanceOverlap(value, provenanceFacts);
  };

  const contact = {
    email: extractFirstEmail(sanitizedEmails[0] ?? null),
    phone: normalizePhoneDisplay(sanitizedPhones[0] ?? null),
    address: normalizeAddressDisplay(addressCandidates[0] ?? null),
  };

  const primaryService = services[0] ?? topics[0] ?? null;
  const heroSupportingFact = pickFirstContentBearingFact(bodyFacts, [title, ...sanitizedHeadings]);
  const defaultHeroSubtitle =
    heroSupportingFact ??
    (language === 'cz'
      ? NEUTRAL_FALLBACK_COPY.cz.heroSubtitle
      : NEUTRAL_FALLBACK_COPY.en.heroSubtitle);
  const aboutSeed =
    normalizePublicParagraph(bodyFacts.find((entry) => /\b(about|o\s+n[áa]s|o\s+mne|profil|profile|team|company|spolecnost|firma)\b/i.test(entry))) ??
    null;
  const fallbackAboutFromFacts =
    normalizePublicParagraph(retainedServiceFacts[0]) ??
    normalizePublicParagraph(bodyFacts[0]) ??
    null;
  const defaultAboutCopy =
    aboutSeed ?? fallbackAboutFromFacts ?? (language === 'cz' ? NEUTRAL_FALLBACK_COPY.cz.about : NEUTRAL_FALLBACK_COPY.en.about);
  const approachSeed =
    normalizePublicParagraph(bodyFacts.find((entry) => /\b(pristup|approach|method|metoda|process|workflow|jak\s+pracujeme|jak\s+pracuji)\b/i.test(entry))) ??
    null;
  const fallbackApproachFromFacts =
    normalizePublicParagraph(bodyFacts.find((entry) => looksLikePricingFact(entry) || looksLikeServiceFact(entry))) ?? null;
  const defaultApproachCopy =
    approachSeed ??
    fallbackApproachFromFacts ??
    (language === 'cz' ? NEUTRAL_FALLBACK_COPY.cz.approach : NEUTRAL_FALLBACK_COPY.en.approach);

  const sectionOverrides = params.copySections ?? {};

  const heroOverrideTitleRaw = sanitizePublicText(sectionOverrides.hero?.title);
  const heroOverrideSubtitleRaw = sanitizePublicText(sectionOverrides.hero?.subtitle);
  const heroOverrideCtaRaw = sanitizePublicText(sectionOverrides.hero?.cta);
  const aboutOverrideRaw = sanitizePublicText(sectionOverrides.about?.body);
  const approachOverrideRaw = sanitizePublicText(sectionOverrides.approach?.body);
  const topicsOverrideRaw = sanitizePublicList(sectionOverrides.topics?.items ?? [], 6, {
    rejectNavigationLabels: true,
  });
  const servicesOverrideRaw = sanitizePublicList(sectionOverrides.servicesPricing?.services ?? [], 8, {
    rejectNavigationLabels: true,
  });
  const pricingOverrideRaw = normalizePricingRows(sanitizePublicList(sectionOverrides.servicesPricing?.pricing ?? [], 20));
  const contactIntroOverrideRaw = sanitizePublicText(sectionOverrides.contact?.intro);
  const mapOverrideRaw = sanitizePublicText(sectionOverrides.map?.body);

  const heroOverrideTitle = isProvenanceSafeOverride(heroOverrideTitleRaw) ? heroOverrideTitleRaw : null;
  const heroOverrideSubtitle = isProvenanceSafeOverride(heroOverrideSubtitleRaw) ? heroOverrideSubtitleRaw : null;
  const heroOverrideCta = isProvenanceSafeOverride(heroOverrideCtaRaw) ? heroOverrideCtaRaw : null;
  const aboutOverride = isProvenanceSafeOverride(aboutOverrideRaw) ? aboutOverrideRaw : null;
  const approachOverride = isProvenanceSafeOverride(approachOverrideRaw) ? approachOverrideRaw : null;
  const topicsOverride = topicsOverrideRaw.filter((entry) => isProvenanceSafeOverride(entry));
  const servicesOverride = servicesOverrideRaw.filter((entry) => isProvenanceSafeOverride(entry));
  const pricingOverride = pricingOverrideRaw.filter(
    (entry) => isProvenanceSafeOverride(entry) || /^\d/.test(entry) || /\b(czk|eur|usd|k[čc]|\$|€)\b/i.test(entry)
  );
  const contactIntroOverride = isProvenanceSafeOverride(contactIntroOverrideRaw) ? contactIntroOverrideRaw : null;
  const mapOverride = isProvenanceSafeOverride(mapOverrideRaw) ? mapOverrideRaw : null;

  const heroTitle = normalizeWhitespace(heroOverrideTitle ?? title);
  const heroSubtitle = normalizeWhitespace(heroOverrideSubtitle ?? defaultHeroSubtitle);
  const primaryCta = normalizeWhitespace(
    heroOverrideCta ??
      (localeCtaTexts[0] ??
        (language === 'cz'
          ? archetype === 'company-service'
            ? 'Kontaktovat tym'
            : 'Napsat zpravu'
          : archetype === 'company-service'
          ? 'Contact the team'
          : 'Get in touch'))
  );

  const aboutCopy = normalizeWhitespace(aboutOverride ?? defaultAboutCopy);
  const approachCopy = normalizeWhitespace(approachOverride ?? defaultApproachCopy);
  const topicItems = deriveTopicLikeItems(
    stripStructuralLabels(topicsOverride.length > 0 ? topicsOverride : topics, structuralLabels, 10),
    6
  ).filter((entry) => isLocaleConsistentText(entry, language));
  const serviceItems = uniq(
    stripStructuralLabels(
      verifiedServices.length > 0
        ? [...localeVerifiedServices, ...servicesOverride]
        : servicesOverride.length > 0
        ? servicesOverride
        : [...services, ...retainedServiceFacts],
      structuralLabels,
      8
    ),
    8
  )
    .filter((entry) => !isNoisyPublicListItem(entry))
    .filter((entry) => isLocaleConsistentText(entry, language));
  const filteredPricingOverride = pricingOverride.filter((entry) => !isGenericPricingPlaceholder(entry));
  const pricingItems = uniq(
    verifiedPricing.length > 0
      ? filteredPricingOverride.length > 0
        ? [...verifiedPricing, ...filteredPricingOverride]
        : verifiedPricing
      : pricingOverride,
    8
  );
  const cleanPricingItems = pricingItems.filter((entry) => isLocaleConsistentText(entry, language));
  const mapFact =
    normalizePublicParagraph(bodyFacts.find((entry) => looksLikeAddressFact(entry))) ??
    normalizePublicParagraph(contact.address) ??
    null;
  const contactIntro = normalizeWhitespace(
    contactIntroOverride ??
      (language === 'cz'
        ? contact.email || contact.phone
          ? 'Pouzijte uvedene kontaktni udaje.'
          : ''
        : contact.email || contact.phone
        ? 'Use the listed contact details.'
        : '')
  );
  const mapCopy = normalizeWhitespace(
    mapOverride ??
      (language === 'cz'
        ? mapFact ?? 'Adresa provozovny je uvedena nize.'
        : mapFact ?? 'The business address is listed below.')
  );

  params.debugCollector &&
    (params.debugCollector.slotInputs = {
      hero: {
        title,
        supportingFact: heroSupportingFact,
        ctaCandidates: localeCtaTexts,
      },
      about: {
        seed: aboutSeed,
        fallback: fallbackAboutFromFacts,
        override: aboutOverride,
      },
      approach: {
        seed: approachSeed,
        fallback: fallbackApproachFromFacts,
        override: approachOverride,
      },
      topics: {
        candidates: topics,
        override: topicsOverride,
      },
      servicesPricing: {
        verifiedServices: localeVerifiedServices,
        retainedServiceFacts,
        verifiedPricing,
        overrideServices: servicesOverride,
        overridePricing: pricingOverride,
      },
      contact: {
        introOverride: contactIntroOverride,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
      },
      map: {
        fact: mapFact,
        override: mapOverride,
      },
    });

  return {
    language,
    labels,
    title,
    heroTitle,
    heroSubtitle,
    aboutCopy,
    approachCopy,
    topics: topicItems,
    services: serviceItems,
    pricing: cleanPricingItems,
    contact,
    primaryCta,
    sourceUrl: params.verified.sourceUrl,
    mapUrl: buildMapUrl(contact.address),
    contactIntro,
    mapCopy,
  };
}

export function buildDeterministicWebsiteCopySections(params: {
  projectName: string;
  verified: VerifiedWebsiteContent;
  language?: AppLanguage;
}): WebsiteCopySections {
  const model = buildPublicWebsiteViewModel({
    projectName: params.projectName,
    verified: params.verified,
    language: params.language,
  });

  return {
    hero: {
      title: model.heroTitle,
      subtitle: model.heroSubtitle,
      cta: model.primaryCta,
    },
    about: {
      body: model.aboutCopy,
    },
    approach: {
      body: model.approachCopy,
    },
    topics: {
      items: model.topics,
    },
    servicesPricing: {
      services: model.services,
      pricing: model.pricing,
    },
    contact: {
      intro: model.contactIntro,
    },
    map: {
      body: model.mapCopy,
    },
  };
}

function buildLocaleScopedVerifiedContent(content: VerifiedWebsiteContent, language: AppLanguage): VerifiedWebsiteContent {
  const localeText = (values: string[], max: number): string[] =>
    uniq(values.filter((entry) => isLocaleConsistentText(entry, language)), max);

  return {
    ...content,
    pageTitle: sanitizePublicText(content.pageTitle) ?? 'Website',
    headings: localeText(content.headings, 30),
    bodyTextBlocks: localeText(content.bodyTextBlocks, 40),
    serviceNames: localeText(content.serviceNames, 24),
    pricingFields: localeText(content.pricingFields, 24),
    ctaTexts: localeText(content.ctaTexts, 20),
    // Contact/address identifiers are locale-agnostic business facts and remain shared.
    emails: uniq(content.emails, 12),
    phones: uniq(content.phones, 12),
    addresses: uniq(content.addresses, 12),
  };
}

export function buildDeterministicWebsiteCopySectionsByLocale(params: {
  projectName: string;
  verified: VerifiedWebsiteContent;
  locales: AppLanguage[];
}): Record<AppLanguage, WebsiteCopySections> {
  const output = {} as Record<AppLanguage, WebsiteCopySections>;
  params.locales.forEach((locale) => {
    const localeVerified = buildLocaleScopedVerifiedContent(params.verified, locale);
    output[locale] = buildDeterministicWebsiteCopySections({
      projectName: params.projectName,
      verified: localeVerified,
      language: locale,
    });
  });
  return output;
}

function sectionHasContent(copy: string | null | undefined, items?: string[]): boolean {
  const hasCopy = Boolean(copy && copy.trim());
  const hasItems = Boolean(items && items.length > 0);
  return hasCopy || hasItems;
}

function buildPublicHtml(params: {
  model: PublicWebsiteViewModel;
  portraitImage?: WebsitePortraitImage | null;
  altLangHref?: string | null;
}): string {
  const { model, portraitImage, altLangHref } = params;
  const contactRows = [
    model.contact.email
      ? `<p><strong>E-mail:</strong> <a href="mailto:${escapeHtml(model.contact.email)}">${escapeHtml(model.contact.email)}</a></p>`
      : '',
    model.contact.phone
      ? `<p><strong>${model.language === 'cz' ? 'Telefon' : 'Phone'}:</strong> <a href="tel:${escapeHtml(normalizePhoneForTel(model.contact.phone))}">${escapeHtml(model.contact.phone)}</a></p>`
      : '',
    model.contact.address
      ? `<p><strong>${model.language === 'cz' ? 'Adresa' : 'Address'}:</strong> ${escapeHtml(model.contact.address)}</p>`
      : '',
  ].filter(Boolean);

  const contactMarkup =
    contactRows.length > 0 ? contactRows.join('\n') : `<p>${escapeHtml(model.labels.noContactNote)}</p>`;

  const topicsMarkup =
    model.topics.length > 0
      ? `<ul>\n${model.topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join('\n')}\n      </ul>`
      : `<p class="empty-note">${escapeHtml(model.labels.emptyListNote)}</p>`;
  const servicesMarkup =
    model.services.length > 0
      ? `<ul>\n${model.services.map((service) => `<li>${escapeHtml(service)}</li>`).join('\n')}\n          </ul>`
      : `<p class="empty-note">${escapeHtml(model.labels.emptyListNote)}</p>`;
  const pricingMarkup =
    model.pricing.length > 0
      ? `<ul>\n${model.pricing.map((price) => `<li>${escapeHtml(price)}</li>`).join('\n')}\n          </ul>`
      : `<p class="empty-note">${escapeHtml(model.labels.emptyListNote)}</p>`;


  const portraitMarkup = portraitImage
    ? [
        '<figure class="portrait">',
        `  <img src="${escapeHtml(portraitImage.src)}" alt="${escapeHtml(resolvePublicPortraitAlt(portraitImage.alt, model.title, model.language))}" loading="lazy" decoding="async" />`,
        '</figure>',
      ].join('\n')
    : '';

  const mapMarkup = model.mapUrl
    ? `<p>${escapeHtml(model.mapCopy)}</p><p><a class="map-link" href="${escapeHtml(model.mapUrl)}" target="_blank" rel="noreferrer">${escapeHtml(model.labels.mapLinkLabel)}</a></p>`
    : `<p>${escapeHtml(model.mapCopy)}</p>`;

  return [
    '<!doctype html>',
    `<html lang="${model.labels.htmlLang}">`,
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(model.title)}</title>`,
    model.sourceUrl ? `  <meta name="source-url" content="${escapeHtml(model.sourceUrl)}" />` : '',
    '  <link rel="stylesheet" href="styles.css" />',
    '</head>',
    '<body>',
    ...(altLangHref
      ? [
          '  <nav class="lang-switcher" aria-label="Language">',
          model.language === 'cz'
            ? `    <span class="lang-btn lang-active">CZ</span><a class="lang-btn" href="${escapeHtml(altLangHref)}">EN</a>`
            : `    <a class="lang-btn" href="${escapeHtml(altLangHref)}">CZ</a><span class="lang-btn lang-active">EN</span>`,
          '  </nav>',
        ]
      : []),
    '  <header id="hero" class="hero">',
    `    <p class="section-label">${escapeHtml(model.labels.heroSectionLabel)}</p>`,
    `    <h1>${escapeHtml(model.heroTitle)}</h1>`,
    `    <p class="hero-subtitle">${escapeHtml(model.heroSubtitle)}</p>`,
    `    <a class="cta" href="#${escapeHtml(model.labels.contactSectionId)}">`,
    `      ${escapeHtml(model.primaryCta)}`,
    '    </a>',
    portraitMarkup,
    '  </header>',
    '',
    '  <main>',
    ...(sectionHasContent(model.aboutCopy)
      ? [
          `    <section id="${escapeHtml(model.labels.aboutSectionId)}" class="card">`,
          `      <h2>${escapeHtml(model.labels.aboutHeading)}</h2>`,
          `      <p>${escapeHtml(model.aboutCopy)}</p>`,
          '    </section>',
          '',
        ]
      : []),
    ...(sectionHasContent(model.approachCopy)
      ? [
          `    <section id="${escapeHtml(model.labels.approachSectionId)}" class="card">`,
          `      <h2>${escapeHtml(model.labels.approachHeading)}</h2>`,
          `      <p>${escapeHtml(model.approachCopy)}</p>`,
          '    </section>',
          '',
        ]
      : []),
    ...(sectionHasContent(null, model.topics)
      ? [
          `    <section id="${escapeHtml(model.labels.topicsSectionId)}" class="card">`,
          `      <h2>${escapeHtml(model.labels.topicsHeading)}</h2>`,
          topicsMarkup,
          '    </section>',
          '',
        ]
      : []),
    ...(sectionHasContent(null, model.services) || sectionHasContent(null, model.pricing)
      ? [
          `    <section id="${escapeHtml(model.labels.servicesPricingSectionId)}" class="card">`,
          `      <h2>${escapeHtml(model.labels.servicesPricingHeading)}</h2>`,
          '      <div class="split">',
          '        <div>',
          `          <h3>${escapeHtml(model.labels.servicesHeading)}</h3>`,
          servicesMarkup,
          '        </div>',
          '        <div>',
          `          <h3>${escapeHtml(model.labels.pricingHeading)}</h3>`,
          pricingMarkup,
          '        </div>',
          '      </div>',
          '    </section>',
          '',
        ]
      : []),
    `    <section id="${escapeHtml(model.labels.contactSectionId)}" class="card">`,
    `      <h2>${escapeHtml(model.labels.contactHeading)}</h2>`,
    ...(model.contactIntro ? [`      <p>${escapeHtml(model.contactIntro)}</p>`] : []),
    contactMarkup,
    '    </section>',
    '',
    ...(model.mapUrl || sectionHasContent(model.mapCopy)
      ? [
          `    <section id="${escapeHtml(model.labels.mapSectionId)}" class="card">`,
          `      <h2>${escapeHtml(model.labels.mapHeading)}</h2>`,
          mapMarkup,
          '    </section>',
        ]
      : []),
    '  </main>',
    '',
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function validatePublicWebsiteHtml(indexHtml: string, rawPrompt?: string | null): string[] {
  const errors: string[] = [];
  const lower = indexHtml.toLowerCase();

  const forbiddenLabels = [
    'verified source snapshot',
    'missing fields reported by ingestion',
    'structured snapshot',
    'debug',
    'raw extracted',
    'extractionwarning',
    'project prompt:',
    'revision request:',
    'raw prompt:',
    'summary-metadata.json',
    'site-metadata.json',
    'app-manifest.json',
    '"rawprojectprompt"',
    '"missingfields"',
    '"extractionwarnings"',
  ];

  forbiddenLabels.forEach((marker) => {
    if (lower.includes(marker)) {
      errors.push(`Public HTML contains internal marker: ${marker}`);
    }
  });

  const prompt = normalizeWhitespace(rawPrompt ?? '');
  if (prompt.length >= 120) {
    const promptLines = uniq(
      prompt
        .split(/\r?\n/)
        .map((entry) => normalizeWhitespace(entry))
        .filter((entry) => entry.length >= 120),
      3
    );

    if (promptLines.some((line) => lower.includes(line.toLowerCase()))) {
      errors.push('Public HTML appears to include a full raw user prompt block.');
    }

    const normalizedPrompt = prompt.toLowerCase();
    if (normalizedPrompt.length >= 260 && lower.includes(normalizedPrompt)) {
      errors.push('Public HTML appears to include the entire raw user prompt text.');
    }
  }

  if (/\{\{\s*[^}]+\s*\}\}/.test(indexHtml)) {
    errors.push('Public HTML contains unresolved template tokens.');
  }

  return errors;
}

export function deriveVerifiedWebsiteContentFromPrompt(
  input: PromptWebsiteExtractionInput
): VerifiedWebsiteContent {
  const combinedPrompt = [
    input.projectPrompt ?? '',
    input.revisionPrompt ?? '',
    input.projectDescription ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = splitPromptLines(combinedPrompt);
  const labels = parseLabeledPromptFields(lines);
  const extracted = extractPromptFacts(lines);

  const labeledHero = getPromptLabelValues(labels, ['hero', 'headline', 'title', 'nadpis']);
  const labeledAbout = getPromptLabelValues(labels, ['about', 'o mne']);
  const labeledApproach = getPromptLabelValues(labels, ['approach', 'pristup']);
  const labeledTopics = getPromptLabelValues(labels, ['topics', 'temata']);
  const labeledServices = getPromptLabelValues(labels, ['services', 'sluzby']);
  const labeledPricing = getPromptLabelValues(labels, ['pricing', 'price', 'cenik', 'cena']);
  const labeledContact = getPromptLabelValues(labels, ['contact', 'kontakt']);
  const labeledAddress = getPromptLabelValues(labels, ['address', 'adresa']);
  const labeledCta = getPromptLabelValues(labels, ['cta', 'call to action']);

  const sourceUrl = extractUrls(combinedPrompt)[0] ?? null;
  const projectName = sanitizePublicText(input.projectName) ?? 'Website';
  const explicitTitle = sanitizePublicText(labeledHero[0]) ?? null;

  const pageTitle = explicitTitle && explicitTitle.length >= 4 ? explicitTitle : projectName;
  const bodyTextBlocks = sanitizePublicList(
    [...labeledAbout, ...labeledApproach, ...labeledTopics, ...labeledServices, ...labeledContact, ...extracted.bodyTextBlocks],
    40,
    { rejectNavigationLabels: true }
  );

  const serviceNames = sanitizePublicList([...labeledServices, ...extracted.serviceNames], 20, {
    rejectNavigationLabels: true,
  });

  const pricingFields = sanitizePublicList([...labeledPricing, ...extracted.pricingFields], 20);
  const ctaTexts = sanitizePublicList([...labeledCta, ...extracted.ctaTexts], 20, {
    rejectNavigationLabels: true,
  });
  const emails = extractEmailsFromText(combinedPrompt);
  const phones = extractPhonesFromText(combinedPrompt);
  const addresses = sanitizePublicList([...labeledAddress, ...labeledContact, ...extracted.addresses], 10)
    .map((entry) => normalizeAddressDisplay(entry) ?? '')
    .filter(Boolean);

  const headings = sanitizePublicList([...extracted.headings, pageTitle], 24, {
    rejectNavigationLabels: true,
  });

  const missingFields = [
    emails.length === 0 ? 'email' : '',
    phones.length === 0 ? 'phone' : '',
    addresses.length === 0 ? 'address' : '',
    pricingFields.length === 0 ? 'pricing' : '',
  ].filter(Boolean);

  return {
    sourceUrl,
    pageTitle,
    navigationLabels: [],
    headings,
    bodyTextBlocks,
    serviceNames,
    pricingFields,
    ctaTexts,
    emails,
    phones,
    addresses,
    missingFields,
    warnings: ['Content model derived from explicit prompt facts (prompt-only fast path).'],
  };
}

export function mergeVerifiedWebsiteContent(
  primary: VerifiedWebsiteContent,
  secondary: VerifiedWebsiteContent
): VerifiedWebsiteContent {
  return {
    sourceUrl: primary.sourceUrl ?? secondary.sourceUrl,
    pageTitle: sanitizePublicText(primary.pageTitle) ?? sanitizePublicText(secondary.pageTitle) ?? 'Website',
    navigationLabels: uniq([...primary.navigationLabels, ...secondary.navigationLabels], 30),
    headings: uniq([...primary.headings, ...secondary.headings], 30),
    bodyTextBlocks: uniq([...primary.bodyTextBlocks, ...secondary.bodyTextBlocks], 40),
    serviceNames: uniq([...primary.serviceNames, ...secondary.serviceNames], 24),
    pricingFields: uniq([...primary.pricingFields, ...secondary.pricingFields], 24),
    ctaTexts: uniq([...primary.ctaTexts, ...secondary.ctaTexts], 20),
    emails: uniq([...primary.emails, ...secondary.emails], 12),
    phones: uniq([...primary.phones, ...secondary.phones], 12),
    addresses: uniq([...primary.addresses, ...secondary.addresses], 12),
    missingFields: uniq([...primary.missingFields, ...secondary.missingFields], 20),
    warnings: uniq([...primary.warnings, ...secondary.warnings], 20),
  };
}

export function deriveVerifiedWebsiteContent(siteSnapshots: ExecutionSnapshot['siteSnapshots']): VerifiedWebsiteContent {
  const structured = siteSnapshots
    .map((entry) => entry.structuredData)
    .filter((entry): entry is NonNullable<ExecutionSnapshot['siteSnapshots'][number]['structuredData']> => Boolean(entry));

  const sourceUrl = structured.map((entry) => entry.sourceUrl).find((value) => Boolean(value)) ?? null;
  const pageTitleCandidate =
    structured.map((entry) => sanitizePublicText(entry.pageTitle)).find((value) => Boolean(value)) ??
    siteSnapshots.map((entry) => sanitizePublicText(entry.pageTitle)).find((value) => Boolean(value)) ??
    null;
  const pageTitle = pageTitleCandidate ?? 'Website';

  const navigationLabels = sanitizePublicList(
    structured.flatMap((entry) => entry.navigationLabels),
    30,
    { rejectNavigationLabels: false }
  );
  const headings = sanitizePublicList(
    structured.flatMap((entry) => entry.headings),
    30,
    { rejectNavigationLabels: true }
  );
  const bodyTextBlocks = sanitizePublicList(
    structured.flatMap((entry) => [...entry.paragraphs, ...entry.visibleTextBlocks]),
    40,
    { rejectNavigationLabels: true }
  );
  const serviceNames = sanitizePublicList(
    structured.flatMap((entry) => entry.serviceNames),
    20,
    { rejectNavigationLabels: true }
  );
  const pricingFields = sanitizePublicList(structured.flatMap((entry) => entry.pricingFields), 20);
  const ctaTexts = sanitizePublicList(
    structured.flatMap((entry) => entry.ctaTexts),
    20,
    { rejectNavigationLabels: true }
  );
  const emails = uniq(
    structured
      .flatMap((entry) => entry.contactFields.emails)
      .map((entry) => sanitizePublicText(entry))
      .map((entry) => extractFirstEmail(entry ?? null) ?? ''),
    12
  ).filter(Boolean);
  const phones = uniq(
    structured
      .flatMap((entry) => entry.contactFields.phones)
      .map((entry) => sanitizePublicText(entry))
      .map((entry) => normalizePhoneDisplay(entry ?? null) ?? ''),
    12
  ).filter(Boolean);
  const addresses = uniq(
    structured
      .flatMap((entry) => entry.contactFields.addresses)
      .map((entry) => sanitizePublicText(entry))
      .map((entry) => normalizeAddressDisplay(entry ?? null) ?? ''),
    8
  ).filter(Boolean);
  const missingFields = uniq(structured.flatMap((entry) => entry.missingFields), 20);
  const warnings = uniq(structured.flatMap((entry) => entry.extractionWarnings), 20);

  return {
    sourceUrl,
    pageTitle,
    navigationLabels,
    headings,
    bodyTextBlocks,
    serviceNames,
    pricingFields,
    ctaTexts,
    emails,
    phones,
    addresses,
    missingFields,
    warnings,
  };
}

export function hasSufficientVerifiedWebsiteContent(content: VerifiedWebsiteContent): boolean {
  const hasConcreteTitle = Boolean(content.pageTitle && content.pageTitle.trim().toLowerCase() !== 'website');
  return Boolean(
    hasConcreteTitle ||
      content.headings.length > 0 ||
      content.bodyTextBlocks.length > 0 ||
      content.serviceNames.length > 0 ||
      content.pricingFields.length > 0 ||
      content.emails.length > 0 ||
      content.phones.length > 0 ||
      content.addresses.length > 0
  );
}

export function buildDeterministicWebsiteArtifacts(params: {
  projectName: string;
  projectDescription: string;
  verified: VerifiedWebsiteContent;
  portraitImage?: WebsitePortraitImage | null;
  copySections?: Partial<WebsiteCopySections>;
  language?: AppLanguage;
}): DeterministicWebsiteArtifacts {
  const model = buildPublicWebsiteViewModel({
    projectName: params.projectName,
    verified: params.verified,
    copySections: params.copySections,
    language: params.language,
  });

  const indexHtml = buildPublicHtml({
    model,
    portraitImage: params.portraitImage,
  });

  const stylesCss = [
    ':root {',
    '  --bg: #f4efe6;',
    '  --ink: #222326;',
    '  --accent: #1f6f5f;',
    '  --card: #fffdfa;',
    '  --line: #ded6ca;',
    '}',
    '* { box-sizing: border-box; }',
    'body { margin: 0; font-family: "Lora", "Georgia", serif; color: var(--ink); background: linear-gradient(135deg, #f9f3e8 0%, #f2efe8 42%, #ecf5f2 100%); }',
    '.hero { max-width: 980px; margin: 0 auto; padding: 2.5rem 1.25rem 1.5rem; }',
    '.section-label { margin: 0 0 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-size: 0.78rem; }',
    '.hero h1 { margin: 0; font-size: clamp(1.9rem, 4vw, 3.1rem); line-height: 1.1; }',
    '.hero-subtitle { max-width: 58ch; margin-top: 0.8rem; }',
    '.cta { display: inline-block; margin-top: 1rem; background: var(--accent); color: #ffffff; text-decoration: none; padding: 0.72rem 1.15rem; border-radius: 999px; font-weight: 600; }',
    '.portrait { margin: 1.3rem 0 0; }',
    '.portrait img { width: min(280px, 100%); border-radius: 16px; display: block; border: 1px solid var(--line); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.1); }',
    'main { max-width: 980px; margin: 0 auto; padding: 0 1.25rem 2.6rem; display: grid; gap: 1rem; }',
    '.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1.05rem 1.1rem; box-shadow: 0 4px 14px rgba(26, 26, 26, 0.05); }',
    '.card h2 { margin-top: 0; }',
    '.split { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }',
    '.map-link { color: var(--accent); font-weight: 600; }',
    '.lang-switcher { text-align: right; padding: 0.5rem 1.25rem 0; max-width: 980px; margin: 0 auto; }',
    '.lang-btn { display: inline-block; padding: 0.28rem 0.75rem; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); text-decoration: none; font-size: 0.8rem; margin-left: 0.35rem; font-family: inherit; }',
    '.lang-btn:hover { background: var(--accent); color: #fff; }',
    '.lang-active { background: var(--accent); color: #fff; pointer-events: none; cursor: default; }',
    '@media (max-width: 640px) {',
    '  .hero { padding-top: 1.3rem; }',
    '  .cta { width: 100%; text-align: center; }',
    '  .split { grid-template-columns: 1fr; }',
    '}',
  ].join('\n');

  const scriptJs = [
    "document.querySelectorAll('a[href^=\"#\"]').forEach((anchor) => {",
    "  anchor.addEventListener('click', (event) => {",
    "    const href = anchor.getAttribute('href');",
    "    if (!href) return;",
    "    const target = document.querySelector(href);",
    "    if (!target) return;",
    '    event.preventDefault();',
    "    target.scrollIntoView({ behavior: 'smooth', block: 'start' });",
    '  });',
    '});',
  ].join('\n');

  return {
    indexHtml,
    stylesCss,
    scriptJs,
  };
}

export function diagnoseDeterministicWebsiteRun(params: {
  projectName: string;
  projectDescription: string;
  verified: VerifiedWebsiteContent;
  portraitImage?: WebsitePortraitImage | null;
  copySections?: Partial<WebsiteCopySections>;
  language?: AppLanguage;
}): WebsitePipelineDiagnostics {
  const language = params.language ?? 'cz';
  const debugCollector: WebsiteBuildDebugCollector = {};

  const model = buildPublicWebsiteViewModel({
    projectName: params.projectName,
    verified: params.verified,
    copySections: params.copySections,
    language,
    debugCollector,
  });

  const mixedLanguage = (values: string[]): boolean =>
    values.some((entry) => !isLocaleConsistentText(entry, language) && !looksLikeAddressFact(entry));
  const noisyFragments = (values: string[]): boolean => values.some((entry) => isNoisyPublicListItem(entry));
  const schemaMismatch = (() => {
    const schema = debugCollector.selectedSchema;
    if (!schema) return false;
    if (schema.archetype === 'personal-profile') {
      return /company|nas/i.test(schema.labels.aboutHeading);
    }
    return /about me|o mne/i.test(schema.labels.aboutHeading);
  })();

  const contactLike = (value: string): boolean => /\b(contact|kontakt|email|e-mail|phone|telefon|map|mapa|address|adresa)\b/i.test(value);
  const hasFactSource =
    params.verified.headings.length > 0 ||
    params.verified.bodyTextBlocks.length > 0 ||
    params.verified.serviceNames.length > 0 ||
    params.verified.pricingFields.length > 0;

  const finalRenderedSections: WebsitePipelineDiagnostics['finalRenderedSections'] = {
    about: {
      shown: sectionHasContent(model.aboutCopy),
      heading: model.labels.aboutHeading,
      items: model.aboutCopy ? [model.aboutCopy] : [],
    },
    approach: {
      shown: sectionHasContent(model.approachCopy),
      heading: model.labels.approachHeading,
      items: model.approachCopy ? [model.approachCopy] : [],
    },
    topics: {
      shown: sectionHasContent(null, model.topics),
      heading: model.labels.topicsHeading,
      items: model.topics,
    },
    servicesPricing: {
      shown: sectionHasContent(null, model.services) || sectionHasContent(null, model.pricing),
      heading: model.labels.servicesPricingHeading,
      items: [...model.services, ...model.pricing],
    },
    contact: {
      shown: true,
      heading: model.labels.contactHeading,
      items: [model.contactIntro, model.contact.email ?? '', model.contact.phone ?? '', model.contact.address ?? ''].filter(Boolean),
    },
    map: {
      shown: model.mapUrl || sectionHasContent(model.mapCopy) ? true : false,
      heading: model.labels.mapHeading,
      items: [model.mapCopy, model.mapUrl ?? ''].filter(Boolean),
    },
  };

  const phaseIssues: WebsitePipelineDiagnostics['phaseIssues'] = {
    rawExtractedSourceFacts: {
      mixedLanguageLeakage: mixedLanguage([
        ...(debugCollector.rawExtractedSourceFacts?.headings ?? []),
        ...(debugCollector.rawExtractedSourceFacts?.bodyTextBlocks ?? []),
        ...(debugCollector.rawExtractedSourceFacts?.serviceNames ?? []),
      ]),
      wrongSchemaOrArchetype: false,
      noisyFragmentInclusion: noisyFragments([
        ...(debugCollector.rawExtractedSourceFacts?.headings ?? []),
        ...(debugCollector.rawExtractedSourceFacts?.bodyTextBlocks ?? []),
      ]),
      factLossToPlaceholder: false,
      crossSlotContamination: false,
    },
    localeFilteredFacts: {
      mixedLanguageLeakage: mixedLanguage([
        ...(debugCollector.localeFilteredFacts?.headings ?? []),
        ...(debugCollector.localeFilteredFacts?.bodyFacts ?? []),
        ...(debugCollector.localeFilteredFacts?.serviceFacts ?? []),
        ...(debugCollector.localeFilteredFacts?.pricingFacts ?? []),
        ...(debugCollector.localeFilteredFacts?.ctaFacts ?? []),
      ]),
      wrongSchemaOrArchetype: false,
      noisyFragmentInclusion: noisyFragments([
        ...(debugCollector.localeFilteredFacts?.bodyFacts ?? []),
        ...(debugCollector.localeFilteredFacts?.serviceFacts ?? []),
      ]),
      factLossToPlaceholder: false,
      crossSlotContamination: false,
    },
    normalizedWebsiteContentModel: {
      mixedLanguageLeakage: mixedLanguage([
        model.heroSubtitle,
        model.aboutCopy,
        model.approachCopy,
        ...model.topics,
        ...model.services,
        model.contactIntro,
        model.mapCopy,
      ]),
      wrongSchemaOrArchetype: false,
      noisyFragmentInclusion: noisyFragments([...model.topics, ...model.services]),
      factLossToPlaceholder: hasFactSource && !model.aboutCopy && !model.approachCopy,
      crossSlotContamination: model.topics.some((entry) => contactLike(entry)) || model.services.some((entry) => contactLike(entry)),
    },
    selectedArchetypeSchema: {
      mixedLanguageLeakage: false,
      wrongSchemaOrArchetype: schemaMismatch,
      noisyFragmentInclusion: false,
      factLossToPlaceholder: false,
      crossSlotContamination: false,
    },
    slotInputs: {
      mixedLanguageLeakage: mixedLanguage([
        ...(debugCollector.slotInputs?.topics.candidates ?? []),
        ...(debugCollector.slotInputs?.servicesPricing.verifiedServices ?? []),
      ]),
      wrongSchemaOrArchetype: false,
      noisyFragmentInclusion: noisyFragments([
        ...(debugCollector.slotInputs?.topics.candidates ?? []),
        ...(debugCollector.slotInputs?.servicesPricing.verifiedServices ?? []),
      ]),
      factLossToPlaceholder: false,
      crossSlotContamination:
        (debugCollector.slotInputs?.topics.candidates ?? []).some((entry) => contactLike(entry)) ||
        (debugCollector.slotInputs?.servicesPricing.verifiedServices ?? []).some((entry) => contactLike(entry)),
    },
    finalRenderedSections: {
      mixedLanguageLeakage: mixedLanguage([
        ...finalRenderedSections.about.items,
        ...finalRenderedSections.approach.items,
        ...finalRenderedSections.topics.items,
        ...finalRenderedSections.servicesPricing.items,
      ]),
      wrongSchemaOrArchetype: schemaMismatch,
      noisyFragmentInclusion: noisyFragments([
        ...finalRenderedSections.topics.items,
        ...model.services,
      ]),
      factLossToPlaceholder: hasFactSource && !finalRenderedSections.about.shown && !finalRenderedSections.approach.shown,
      crossSlotContamination:
        finalRenderedSections.topics.items.some((entry) => contactLike(entry)) ||
        finalRenderedSections.servicesPricing.items.some((entry) => contactLike(entry)),
    },
  };

  const hasIssue = (phase: keyof WebsitePipelineDiagnostics['phaseIssues']): boolean =>
    Object.values(phaseIssues[phase]).some(Boolean);

  const firstCorruptionPoint = hasIssue('localeFilteredFacts')
    ? 'locale-filtered facts'
    : hasIssue('normalizedWebsiteContentModel')
    ? 'normalized website content model'
    : hasIssue('selectedArchetypeSchema')
    ? 'selected archetype/schema'
    : hasIssue('slotInputs')
    ? 'slot inputs'
    : hasIssue('finalRenderedSections')
    ? 'final rendered sections'
    : null;

  return {
    language,
    rawExtractedSourceFacts: debugCollector.rawExtractedSourceFacts ?? {
      pageTitle: params.verified.pageTitle,
      headings: [],
      bodyTextBlocks: [],
      serviceNames: [],
      pricingFields: [],
      ctaTexts: [],
      emails: [],
      phones: [],
      addresses: [],
    },
    localeFilteredFacts: debugCollector.localeFilteredFacts ?? {
      headings: [],
      bodyFacts: [],
      serviceFacts: [],
      pricingFacts: [],
      ctaFacts: [],
    },
    normalizedContentModel: {
      title: model.title,
      heroTitle: model.heroTitle,
      heroSubtitle: model.heroSubtitle,
      aboutCopy: model.aboutCopy,
      approachCopy: model.approachCopy,
      topics: model.topics,
      services: model.services,
      pricing: model.pricing,
      contact: model.contact,
      mapCopy: model.mapCopy,
      mapUrl: model.mapUrl,
    },
    selectedSchema: debugCollector.selectedSchema ?? {
      archetype: 'company-service',
      labels: {
        aboutHeading: model.labels.aboutHeading,
        approachHeading: model.labels.approachHeading,
        topicsHeading: model.labels.topicsHeading,
        servicesPricingHeading: model.labels.servicesPricingHeading,
        contactHeading: model.labels.contactHeading,
        mapHeading: model.labels.mapHeading,
      },
    },
    slotInputs: debugCollector.slotInputs ?? {
      hero: { title: model.title, supportingFact: null, ctaCandidates: [] },
      about: { seed: null, fallback: null, override: null },
      approach: { seed: null, fallback: null, override: null },
      topics: { candidates: [], override: [] },
      servicesPricing: {
        verifiedServices: [],
        retainedServiceFacts: [],
        verifiedPricing: [],
        overrideServices: [],
        overridePricing: [],
      },
      contact: { introOverride: null, email: model.contact.email, phone: model.contact.phone, address: model.contact.address },
      map: { fact: null, override: null },
    },
    finalRenderedSections,
    phaseIssues,
    firstCorruptionPoint,
  };
}

export function buildDeterministicWebsiteArtifactsByLocale(params: {
  projectName: string;
  projectDescription: string;
  verified: VerifiedWebsiteContent;
  locales: AppLanguage[];
  portraitImage?: WebsitePortraitImage | null;
  copySectionsByLocale?: Partial<Record<AppLanguage, Partial<WebsiteCopySections>>>;
}): Record<AppLanguage, DeterministicWebsiteArtifacts> {
  const output = {} as Record<AppLanguage, DeterministicWebsiteArtifacts>;
  params.locales.forEach((locale) => {
    const localeVerified = buildLocaleScopedVerifiedContent(params.verified, locale);
    output[locale] = buildDeterministicWebsiteArtifacts({
      projectName: params.projectName,
      projectDescription: params.projectDescription,
      verified: localeVerified,
      portraitImage: params.portraitImage,
      copySections: params.copySectionsByLocale?.[locale],
      language: locale,
    });
  });
  return output;
}

export function buildBilingualWebsiteArtifacts(params: {
  projectName: string;
  projectDescription: string;
  verified: VerifiedWebsiteContent;
  portraitImage?: WebsitePortraitImage | null;
  copySections?: Partial<WebsiteCopySections>;
}): BilingualWebsiteArtifacts {
  const czModel = buildPublicWebsiteViewModel({
    projectName: params.projectName,
    verified: params.verified,
    copySections: params.copySections,
    language: 'cz',
  });

  const enModel = buildPublicWebsiteViewModel({
    projectName: params.projectName,
    verified: params.verified,
    copySections: params.copySections,
    language: 'en',
  });

  const indexCzHtml = buildPublicHtml({
    model: czModel,
    portraitImage: params.portraitImage,
    altLangHref: 'index-en.html',
  });

  const indexEnHtml = buildPublicHtml({
    model: enModel,
    portraitImage: params.portraitImage,
    altLangHref: 'index.html',
  });

  const czArtifacts = buildDeterministicWebsiteArtifacts({
    projectName: params.projectName,
    projectDescription: params.projectDescription,
    verified: params.verified,
    copySections: params.copySections,
    language: 'cz',
    portraitImage: params.portraitImage,
  });

  return {
    indexCzHtml,
    indexEnHtml,
    stylesCss: czArtifacts.stylesCss,
    scriptJs: czArtifacts.scriptJs,
  };
}
