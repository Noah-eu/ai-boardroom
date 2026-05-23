import { load as loadHtml } from 'cheerio';

export type StructuredLink = {
  href: string;
  label: string;
  kind: 'http' | 'mailto' | 'tel';
};

export type UrlStructuredData = {
  sourceUrl: string;
  pageTitle: string;
  visibleTextBlocks: string[];
  headings: string[];
  paragraphs: string[];
  navigationLabels: string[];
  contactFields: {
    emails: string[];
    phones: string[];
    addresses: string[];
    mailtoLinks: string[];
    telLinks: string[];
  };
  ctaTexts: string[];
  serviceNames: string[];
  pricingFields: string[];
  extractedLinks: StructuredLink[];
  missingFields: string[];
  extractionWarnings: string[];
};

export type UrlPageSnapshot = {
  url: string;
  title: string;
  metaDescription?: string;
  extractedText: string;
  excerpt: string;
  summary: string;
  links: string[];
  structuredLinks: StructuredLink[];
  headings: string[];
  paragraphs: string[];
  navigationLabels: string[];
  ctaTexts: string[];
  mailtoLinks: string[];
  telLinks: string[];
  depth: number;
  rendered?: boolean;
};

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?(?:\d[\s.-]?){7,14}\d/g;
const PRICE_REGEX = /(?:\b(?:od|from)?\s*\d{1,4}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\s?(?:CZK|Kc|Kč|EUR|USD|€|\$))/gi;
const ADDRESS_HINT_REGEX = /(ul\.|ulice|street|st\.|avenue|ave\.|road|rd\.|nam\.|namesti|square|psc|zip|c\.p\.|cp\.|building|office)/i;

function trimText(value: string, max = 12000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function excerpt(value: string, max = 320): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function uniqueList(values: string[], max = 25): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= max) break;
  }
  return result;
}

function textFromMatches(regex: RegExp, text: string, max = 20): string[] {
  const hits = text.match(regex) ?? [];
  return uniqueList(hits, max);
}

function normalizePhone(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseMailtoValue(href: string): string | null {
  const raw = href.replace(/^mailto:/i, '').split('?')[0]?.trim();
  if (!raw) return null;
  const match = raw.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  return match ? raw : null;
}

function parseTelValue(href: string): string | null {
  const raw = href.replace(/^tel:/i, '').trim();
  if (!raw) return null;
  const normalized = normalizePhone(raw);
  return normalized.length >= 7 ? normalized : null;
}

function normalizeHref(baseUrl: string, href: string): string | null {
  const normalized = href.trim();
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('javascript:')) {
    return null;
  }
  if (normalized.startsWith('mailto:') || normalized.startsWith('tel:')) {
    return null;
  }
  try {
    const parsed = new URL(normalized, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeAnyHref(baseUrl: string, href: string): string | null {
  const normalized = href.trim();
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('javascript:')) {
    return null;
  }
  if (normalized.startsWith('mailto:') || normalized.startsWith('tel:')) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractPageSnapshot(html: string, pageUrl: string, depth: number): UrlPageSnapshot {
  const $ = loadHtml(html);
  $('script,style,noscript').remove();

  const title =
    $('title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    pageUrl;

  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    undefined;

  const extractedText = trimText($('body').text(), 9000);
  const pageExcerpt = excerpt(metaDescription || extractedText || title, 260);

  const headings = uniqueList(
    $('h1,h2,h3')
      .map((_, element) => $(element).text())
      .get(),
    40
  );

  const paragraphs = uniqueList(
    $('p,li')
      .map((_, element) => $(element).text())
      .get()
      .filter((value) => value.trim().length >= 20),
    80
  );

  const navigationLabels = uniqueList(
    $('nav a, header a')
      .map((_, element) => $(element).text())
      .get()
      .filter((value) => value.trim().length >= 2),
    40
  );

  const ctaTexts = uniqueList(
    $('a,button')
      .map((_, element) => $(element).text())
      .get()
      .filter((text) => /\b(contact|call|book|reserve|get started|request|quote|appointment|objednat|kontakt|rezerv|zacit|nezavazna)\b/i.test(text)),
    30
  );

  const structuredLinks = uniqueList(
    $('a[href]')
      .map((_, element) => {
        const href = $(element).attr('href') ?? '';
        const normalized = normalizeAnyHref(pageUrl, href);
        if (!normalized) return '';
        const label = trimText($(element).text(), 120);
        const kind: StructuredLink['kind'] = normalized.startsWith('mailto:')
          ? 'mailto'
          : normalized.startsWith('tel:')
          ? 'tel'
          : 'http';
        return JSON.stringify({ href: normalized, label, kind });
      })
      .get()
      .filter(Boolean),
    300
  ).map((value) => JSON.parse(value) as StructuredLink);

  const mailtoLinks = structuredLinks.filter((link) => link.kind === 'mailto').map((link) => link.href);
  const telLinks = structuredLinks.filter((link) => link.kind === 'tel').map((link) => link.href);

  const links = $('a[href]')
    .map((_, element) => $(element).attr('href') ?? '')
    .get()
    .map((href) => normalizeHref(pageUrl, href))
    .filter((href): href is string => Boolean(href));

  return {
    url: pageUrl,
    title,
    metaDescription,
    extractedText,
    excerpt: pageExcerpt,
    summary: `${title} - ${pageExcerpt}`,
    links,
    structuredLinks,
    headings,
    paragraphs,
    navigationLabels,
    ctaTexts,
    mailtoLinks,
    telLinks,
    depth,
  };
}

function extractAddressCandidates(lines: string[]): string[] {
  return uniqueList(
    lines.filter((line) => {
      const normalized = line.trim();
      if (normalized.length < 12 || normalized.length > 140) return false;
      const hasNumber = /\d/.test(normalized);
      return hasNumber && ADDRESS_HINT_REGEX.test(normalized);
    }),
    20
  );
}

function extractServiceCandidates(headings: string[], paragraphs: string[]): string[] {
  const headingCandidates = headings.filter(
    (value) => !/\b(kontakt|contact|cenik|pricing|about|o nas|reference|home|domu|blog)\b/i.test(value)
  );
  const paragraphCandidates = paragraphs
    .filter((value) => /\b(therapy|therap|consult|service|treatment|coaching|masaz|terapie|sluzb|poradenstvi)\b/i.test(value))
    .map((value) => value.split(/[.!?]/)[0] ?? value);
  return uniqueList([...headingCandidates, ...paragraphCandidates], 30);
}

export function buildStructuredUrlSnapshot(sourceUrl: string, pages: UrlPageSnapshot[]): UrlStructuredData {
  const fullText = pages.map((page) => page.extractedText).join('\n');
  const allParagraphs = pages.flatMap((page) => page.paragraphs);
  const allHeadings = pages.flatMap((page) => page.headings);
  const allNavLabels = pages.flatMap((page) => page.navigationLabels);
  const allCtaTexts = pages.flatMap((page) => page.ctaTexts);
  const allStructuredLinks = pages.flatMap((page) => page.structuredLinks);

  const mailtoLinks = uniqueList(pages.flatMap((page) => page.mailtoLinks), 20);
  const telLinks = uniqueList(pages.flatMap((page) => page.telLinks), 20);

  const emailsFromMailto = mailtoLinks
    .map((href) => parseMailtoValue(href))
    .filter((value): value is string => Boolean(value));
  const phonesFromTel = telLinks
    .map((href) => parseTelValue(href))
    .filter((value): value is string => Boolean(value));

  const emails = uniqueList([...emailsFromMailto, ...textFromMatches(EMAIL_REGEX, fullText)], 25);
  const phones = uniqueList(
    [...phonesFromTel, ...textFromMatches(PHONE_REGEX, fullText).map((value) => normalizePhone(value))],
    25
  );
  const pricingFields = uniqueList(textFromMatches(PRICE_REGEX, fullText), 30);

  const lineCandidates = uniqueList([...allParagraphs, ...allHeadings], 500);
  const addresses = extractAddressCandidates(lineCandidates);

  const structuredLinks = uniqueList(
    allStructuredLinks.map((link) => JSON.stringify(link)),
    120
  ).map((entry) => JSON.parse(entry) as StructuredLink);

  const missingFields: string[] = [];
  if (emails.length === 0) missingFields.push('email');
  if (phones.length === 0) missingFields.push('phone');
  if (addresses.length === 0) missingFields.push('address');
  if (pricingFields.length === 0) missingFields.push('pricing');

  const extractionWarnings: string[] = [];
  if (pages.length === 0) {
    extractionWarnings.push('No pages were extracted.');
  }
  if (fullText.length < 500) {
    extractionWarnings.push('Visible website text is short; some fields may be missing due to limited readable content.');
  }

  return {
    sourceUrl,
    pageTitle: pages[0]?.title ?? sourceUrl,
    visibleTextBlocks: uniqueList([...allHeadings, ...allParagraphs], 120),
    headings: uniqueList(allHeadings, 60),
    paragraphs: uniqueList(allParagraphs, 120),
    navigationLabels: uniqueList(allNavLabels, 50),
    contactFields: {
      emails,
      phones,
      addresses,
      mailtoLinks,
      telLinks,
    },
    ctaTexts: uniqueList(allCtaTexts, 40),
    serviceNames: extractServiceCandidates(allHeadings, allParagraphs),
    pricingFields,
    extractedLinks: structuredLinks,
    missingFields,
    extractionWarnings,
  };
}
