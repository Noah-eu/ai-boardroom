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

type LocalizedWebsiteLabels = {
  htmlLang: 'cs' | 'en';
  heroSectionLabel: string;
  aboutHeading: string;
  approachHeading: string;
  topicsHeading: string;
  servicesPricingHeading: string;
  servicesHeading: string;
  pricingHeading: string;
  contactHeading: string;
  mapHeading: string;
  mapLinkLabel: string;
  emptyListNote: string;
  noContactNote: string;
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

const CONTENT_BEARING_TEXT_HINT = /\b(od|from|podpora|support|konzult|session|sezen|terapi|counsel|care|approach|metoda|experience|specializ|zam[eě]r|pracuji|offer|provide)\b/i;

function getLocalizedWebsiteLabels(language: AppLanguage): LocalizedWebsiteLabels {
  if (language === 'en') {
    return {
      htmlLang: 'en',
      heroSectionLabel: 'Intro',
      aboutHeading: 'About',
      approachHeading: 'Approach and Education',
      topicsHeading: 'Topics',
      servicesPricingHeading: 'Services and Pricing',
      servicesHeading: 'Services',
      pricingHeading: 'Pricing',
      contactHeading: 'Contact',
      mapHeading: 'Map',
      mapLinkLabel: 'Open map',
      emptyListNote: 'Details will be added after source verification.',
      noContactNote: 'Contact details are not publicly listed yet.',
    };
  }

  return {
    htmlLang: 'cs',
    heroSectionLabel: 'Úvod',
    aboutHeading: 'O mně',
    approachHeading: 'Přístup a vzdělávání',
    topicsHeading: 'Témata',
    servicesPricingHeading: 'Služby a ceny',
    servicesHeading: 'Služby',
    pricingHeading: 'Ceny',
    contactHeading: 'Kontakt',
    mapHeading: 'Mapa',
    mapLinkLabel: 'Otevřít mapu',
    emptyListNote: 'Detaily budou doplněny po ověření zdrojů.',
    noContactNote: 'Kontaktní údaje zatím nejsou veřejně uvedeny.',
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
  return /\b(adresa|address|ulice|street|praha|brno|\d{3}\s?\d{2})\b/i.test(value);
}

function looksLikeServiceFact(value: string): boolean {
  return /\b(sluzb|service|konzultac|therapy|terapie|coaching|session|sezeni)\b/i.test(value);
}

function looksLikePricingFact(value: string): boolean {
  return /\b(od|from|cena|cenik|pricing|price)\b/i.test(value) || /(Kc|Kč|CZK|EUR|USD|€|\$)/i.test(value);
}

function looksLikeCtaFact(value: string): boolean {
  return /\b(objednat|book|contact|kontakt|domluvit|rezervovat|appointment|call)\b/i.test(value);
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

  // Require a pricing-like context to avoid dumping unrelated extracted numeric labels.
  if (!/(od|from|cena|ceník|cenik|konzultac|sezen|sezení|min|za|\/)/i.test(cleaned)) {
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
}): PublicWebsiteViewModel {
  const language = params.language ?? 'cz';
  const labels = getLocalizedWebsiteLabels(language);
  const title = humanTitle(sanitizePublicText(params.verified.pageTitle) || params.projectName || 'Website');

  const sanitizedNavigationLabels = sanitizePublicList(params.verified.navigationLabels, 30, {
    rejectNavigationLabels: false,
  });
  const sanitizedHeadings = sanitizePublicList(params.verified.headings, 30, {
    rejectNavigationLabels: true,
  });
  const structuralLabels = toComparableSet([...sanitizedNavigationLabels, ...sanitizedHeadings]);
  const sanitizedBodyTextBlocks = stripStructuralLabels(params.verified.bodyTextBlocks, structuralLabels, 36);
  const bodyFacts = deriveContentLikeSentences(sanitizedBodyTextBlocks, 16);

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

  const verifiedServices = stripStructuralLabels(sanitizedServiceNames, structuralLabels, 12);
  const services = uniq(verifiedServices, 8);

  const topics = uniq(
    deriveContentLikeSentences(sanitizedBodyTextBlocks, 16)
      .filter((entry) => !/kontakt|contact|mapa|pricing|price|cen/i.test(entry))
      .slice(0, 10),
    6
  );

  const verifiedPricing = normalizePricingRows(sanitizedPricingFields);

  const contact = {
    email: extractFirstEmail(sanitizedEmails[0] ?? null),
    phone: normalizePhoneDisplay(sanitizedPhones[0] ?? null),
    address: normalizeAddressDisplay(sanitizedAddresses[0] ?? null),
  };

  const primaryService = services[0] ?? topics[0] ?? null;
  const heroSupportingFact = pickFirstContentBearingFact(bodyFacts, [title, ...sanitizedHeadings]);
  const defaultHeroSubtitle =
    heroSupportingFact ??
    (language === 'cz'
      ? primaryService
        ? `Bezpečný prostor pro změnu a porozumění se zaměřením na ${primaryService}.`
        : 'Bezpečný prostor pro změnu a porozumění.'
      : primaryService
      ? `Professional support focused on ${primaryService}.`
      : 'Professional support for sustainable personal growth.');
  const defaultAboutCopy =
    bodyFacts[0] ??
    language === 'cz'
      ? services.length > 0
        ? `Nabízím citlivý a praktický přístup zaměřený na ${services.slice(0, 2).join(' a ')}.`
        : 'Nabízím bezpečný prostor pro hledání stabilního a dlouhodobě udržitelného směru.'
      : services.length > 0
      ? `I offer a practical and sensitive approach focused on ${services.slice(0, 2).join(' and ')}.`
      : 'I offer a safe and practical space for long-term personal growth.';
  const defaultApproachCopy =
    bodyFacts[1] ??
    language === 'cz'
      ? topics.length > 0
        ? `Pracuji strukturovaně a srozumitelně. Vzdělávání a dlouhodobý rozvoj propojuji s tématy: ${topics
            .slice(0, 3)
            .join(', ')}.`
        : 'Pracuji strukturovaně, s důrazem na bezpečí, respekt a dlouhodobý rozvoj.'
      : topics.length > 0
      ? `I work in a structured way and connect education with long-term growth around: ${topics.slice(0, 3).join(', ')}.`
      : 'I work in a structured way with emphasis on safety, respect, and long-term growth.';

  const sectionOverrides = params.copySections ?? {};

  const heroOverrideTitle = sanitizePublicText(sectionOverrides.hero?.title);
  const heroOverrideSubtitle = sanitizePublicText(sectionOverrides.hero?.subtitle);
  const heroOverrideCta = sanitizePublicText(sectionOverrides.hero?.cta);
  const aboutOverride = sanitizePublicText(sectionOverrides.about?.body);
  const approachOverride = sanitizePublicText(sectionOverrides.approach?.body);
  const topicsOverride = sanitizePublicList(sectionOverrides.topics?.items ?? [], 6, {
    rejectNavigationLabels: true,
  });
  const servicesOverride = sanitizePublicList(sectionOverrides.servicesPricing?.services ?? [], 8, {
    rejectNavigationLabels: true,
  });
  const pricingOverride = normalizePricingRows(sanitizePublicList(sectionOverrides.servicesPricing?.pricing ?? [], 20));
  const contactIntroOverride = sanitizePublicText(sectionOverrides.contact?.intro);
  const mapOverride = sanitizePublicText(sectionOverrides.map?.body);

  const heroTitle = normalizeWhitespace(heroOverrideTitle ?? title);
  const heroSubtitle = normalizeWhitespace(heroOverrideSubtitle ?? defaultHeroSubtitle);
  const primaryCta = normalizeWhitespace(
    heroOverrideCta ?? (sanitizedCtaTexts[0] ?? (language === 'cz' ? 'Domluvit konzultaci' : 'Book a consultation'))
  );

  const aboutCopy = normalizeWhitespace(aboutOverride ?? defaultAboutCopy);
  const approachCopy = normalizeWhitespace(approachOverride ?? defaultApproachCopy);
  const topicItems = uniq(
    stripStructuralLabels(topicsOverride.length > 0 ? topicsOverride : topics, structuralLabels, 6),
    6
  );
  const serviceItems = uniq(
    stripStructuralLabels(
      verifiedServices.length > 0
        ? [...verifiedServices, ...servicesOverride]
        : servicesOverride.length > 0
        ? servicesOverride
        : services,
      structuralLabels,
      8
    ),
    8
  );
  const filteredPricingOverride = pricingOverride.filter((entry) => !isGenericPricingPlaceholder(entry));
  const pricingItems = uniq(
    verifiedPricing.length > 0
      ? filteredPricingOverride.length > 0
        ? [...verifiedPricing, ...filteredPricingOverride]
        : verifiedPricing
      : pricingOverride,
    8
  );
  const contactIntro = normalizeWhitespace(
    contactIntroOverride ??
      (language === 'cz'
        ? 'Pro objednání termínu mě prosím kontaktujte e-mailem nebo telefonicky.'
        : 'Please contact me by email or phone to book an appointment.')
  );
  const mapCopy = normalizeWhitespace(
    mapOverride ??
      (language === 'cz'
        ? 'Setkání probíhá po domluvě na adrese uvedené níže.'
        : 'Sessions take place at the address below by appointment.')
  );

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
    pricing: pricingItems,
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

function buildPublicHtml(params: {
  model: PublicWebsiteViewModel;
  portraitImage?: WebsitePortraitImage | null;
}): string {
  const { model, portraitImage } = params;
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
        `  <img src="${escapeHtml(portraitImage.src)}" alt="${escapeHtml(portraitImage.alt)}" loading="lazy" decoding="async" />`,
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
    '  <header id="hero" class="hero">',
    `    <p class="section-label">${escapeHtml(model.labels.heroSectionLabel)}</p>`,
    `    <h1>${escapeHtml(model.heroTitle)}</h1>`,
    `    <p class="hero-subtitle">${escapeHtml(model.heroSubtitle)}</p>`,
    '    <a class="cta" href="#kontakt">',
    `      ${escapeHtml(model.primaryCta)}`,
    '    </a>',
    portraitMarkup,
    '  </header>',
    '',
    '  <main>',
    '    <section id="o-mne" class="card">',
    `      <h2>${escapeHtml(model.labels.aboutHeading)}</h2>`,
    `      <p>${escapeHtml(model.aboutCopy)}</p>`,
    '    </section>',
    '',
    '    <section id="pristup-vzdelavani" class="card">',
    `      <h2>${escapeHtml(model.labels.approachHeading)}</h2>`,
    `      <p>${escapeHtml(model.approachCopy)}</p>`,
    '    </section>',
    '',
    '    <section id="temata" class="card">',
    `      <h2>${escapeHtml(model.labels.topicsHeading)}</h2>`,
    topicsMarkup,
    '    </section>',
    '',
    '    <section id="sluzby-ceny" class="card">',
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
    '    <section id="kontakt" class="card">',
    `      <h2>${escapeHtml(model.labels.contactHeading)}</h2>`,
    `      <p>${escapeHtml(model.contactIntro)}</p>`,
    contactMarkup,
    '    </section>',
    '',
    '    <section id="mapa" class="card">',
    `      <h2>${escapeHtml(model.labels.mapHeading)}</h2>`,
    mapMarkup,
    '    </section>',
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
