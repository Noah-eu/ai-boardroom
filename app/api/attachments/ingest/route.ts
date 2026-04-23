import { NextResponse } from 'next/server';
import { z } from 'zod';
import { load as loadHtml } from 'cheerio';
import JSZip from 'jszip';

export const runtime = 'nodejs';

const requestSchema = z.object({
  kind: z.enum(['url', 'image', 'pdf', 'zip', 'file']),
  title: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  downloadUrl: z.string().url().optional(),
  mimeType: z.string().optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
  maxDepth: z.number().int().min(0).max(3).optional(),
});

type IngestPayload = {
  status: 'uploaded' | 'ingested' | 'included' | 'failed' | 'parsed' | 'indexed';
  success?: boolean;
  title?: string;
  pageCount?: number;
  summary?: string;
  extractedText?: string;
  excerpt?: string;
  pageTitle?: string;
  sourceUrl?: string;
  urlPageCount?: number;
  urlCrawlDepth?: number;
  urlCrawlMaxPages?: number;
  urlPages?: Array<{
    url: string;
    title: string;
    metaDescription?: string;
    excerpt: string;
    summary: string;
    extractedText: string;
    depth: number;
    rendered?: boolean;
  }>;
  urlStructuredData?: UrlStructuredData;
  zipFileTree?: string[];
  zipKeyFiles?: Array<{ path: string; content: string }>;
  zipPdfFiles?: Array<{
    path: string;
    status: 'ingested' | 'failed' | 'text_unavailable';
    pageCount?: number;
    extractedText?: string;
    excerpt?: string;
    error?: string;
  }>;
  error?: string;
  crawlEvents?: string[];
};

type StructuredLink = {
  href: string;
  label: string;
  kind: 'http' | 'mailto' | 'tel';
};

type UrlStructuredData = {
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

type UrlPageSnapshot = {
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

const DEFAULT_CRAWL_MAX_PAGES = 12;
const DEFAULT_CRAWL_MAX_DEPTH = 2;
const MIN_TEXT_LENGTH_FOR_STATIC = 220;

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?(?:\d[\s.-]?){7,14}\d/g;
const PRICE_REGEX = /(?:\b(?:od|from)?\s*\d{1,4}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\s?(?:CZK|Kc|Kč|EUR|USD|€|\$))/gi;
const ADDRESS_HINT_REGEX = /(ul\.|ulice|street|st\.|avenue|ave\.|road|rd\.|nam\.|namesti|square|psc|zip|c\.p\.|cp\.|building|office)/i;

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

function trimText(value: string, max = 12000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function excerpt(value: string, max = 320): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function decodePdfToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function extractPdfText(buffer: Buffer): Promise<{ pageCount: number; text: string }> {
  const pdf2jsonModule = await import('pdf2json');
  const PDFParser = pdf2jsonModule.default;

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on('pdfParser_dataError', (errMsg: Error | { parserError: Error }) => {
      const parserError = errMsg instanceof Error ? errMsg : errMsg.parserError;
      const message = parserError instanceof Error ? parserError.message : String(parserError ?? 'Unknown PDF parser error');
      reject(new Error(message));
    });

    parser.on('pdfParser_dataReady', (pdfData: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }) => {
      const pages = Array.isArray(pdfData.Pages) ? pdfData.Pages : [];
      const tokens: string[] = [];

      for (const page of pages) {
        const textBlocks = Array.isArray(page.Texts) ? page.Texts : [];
        for (const block of textBlocks) {
          const runs = Array.isArray(block.R) ? block.R : [];
          for (const run of runs) {
            if (typeof run.T === 'string' && run.T.trim().length > 0) {
              tokens.push(decodePdfToken(run.T));
            }
          }
        }
      }

      resolve({
        pageCount: pages.length,
        text: tokens.join(' '),
      });
    });

    parser.parseBuffer(buffer);
  });
}

function normalizeHref(baseUrl: string, href: string): string | null {
  const normalized = href.trim();
  if (!normalized) return null;

  if (normalized.startsWith('#') || normalized.startsWith('javascript:')) {
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

function shouldSkipInternalUrl(candidateUrl: string): boolean {
  const lower = candidateUrl.toLowerCase();

  if (
    /\b(logout|log-out|log_out|signout|sign-out|sign_out)\b/.test(lower) ||
    /[?&](logout|signout)=/i.test(lower)
  ) {
    return true;
  }

  if (/\.(pdf|zip|rar|7z|gz|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|avi|mov|css|js)(\?|$)/i.test(lower)) {
    return true;
  }

  if (/(\/download\/|[?&]download=|\/wp-login\.php)/i.test(lower)) {
    return true;
  }

  return false;
}

async function fetchHtmlPage(url: string): Promise<{ finalUrl: string; html: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AI-Boardroom-Ingest/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`URL fetch failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('html')) {
    throw new Error(`Non-HTML content (${contentType || 'unknown'})`);
  }

  return {
    finalUrl: response.url || url,
    html: await response.text(),
  };
}

async function tryRenderHtmlPage(url: string): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const playwright = await import('playwright');
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1200);
    const finalUrl = page.url();
    const html = await page.content();
    await browser.close();
    return { finalUrl, html };
  } catch {
    return null;
  }
}

function extractPageSnapshot(html: string, pageUrl: string, depth: number): UrlPageSnapshot {
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

function buildStructuredUrlSnapshot(sourceUrl: string, pages: UrlPageSnapshot[]): UrlStructuredData {
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

function buildSiteSnapshotText(sourceUrl: string, pages: UrlPageSnapshot[]): string {
  const structured = buildStructuredUrlSnapshot(sourceUrl, pages);
  const pageLines = pages.map(
    (page, index) =>
      `${index + 1}. ${page.title} (${page.url})${page.metaDescription ? `\nMeta: ${page.metaDescription}` : ''}\nSummary: ${page.excerpt}`
  );

  const combinedPageContent = pages
    .map((page, index) => `[Page ${index + 1}] ${page.title}\nURL: ${page.url}\n${page.extractedText}`)
    .join('\n\n');

  return trimText(
    [
      `Site snapshot source URL: ${sourceUrl}`,
      `Pages visited: ${pages.length}`,
      `Structured snapshot missing fields: ${structured.missingFields.length > 0 ? structured.missingFields.join(', ') : 'none'}`,
      'Page summaries:',
      pageLines.join('\n\n'),
      'Structured snapshot (JSON):',
      JSON.stringify(structured, null, 2),
      'Combined extracted content:',
      combinedPageContent,
    ].join('\n\n'),
    26000
  );
}

async function ingestUrl(sourceUrl: string, maxPages: number, maxDepth: number): Promise<IngestPayload> {
  const crawlEvents: string[] = [];
  crawlEvents.push(`URL crawl started: source=${sourceUrl} maxPages=${maxPages} maxDepth=${maxDepth}`);
  console.info(`[attachments/ingest] ${crawlEvents[crawlEvents.length - 1]}`);

  const rootUrl = new URL(sourceUrl);
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl.toString(), depth: 0 }];
  const visited = new Set<string>();
  const indexedPages: UrlPageSnapshot[] = [];
  const importantLinks = new Set<string>();

  while (queue.length > 0 && indexedPages.length < maxPages) {
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.url)) continue;
    if (current.depth > maxDepth) continue;

    visited.add(current.url);

    try {
      crawlEvents.push(`page fetched: depth=${current.depth} url=${current.url}`);
      console.info(`[attachments/ingest] ${crawlEvents[crawlEvents.length - 1]}`);

      let fetched = await fetchHtmlPage(current.url);
      let pageSnapshot = extractPageSnapshot(fetched.html, fetched.finalUrl, current.depth);
      let rendered = false;

      const shouldRender =
        pageSnapshot.extractedText.length < MIN_TEXT_LENGTH_FOR_STATIC &&
        (current.depth === 0 || importantLinks.has(current.url));

      if (shouldRender) {
        const renderedPage = await tryRenderHtmlPage(current.url);
        if (renderedPage) {
          crawlEvents.push(`page rendered: depth=${current.depth} url=${current.url}`);
          console.info(`[attachments/ingest] ${crawlEvents[crawlEvents.length - 1]}`);
          fetched = renderedPage;
          pageSnapshot = extractPageSnapshot(fetched.html, fetched.finalUrl, current.depth);
          rendered = true;
        }
      }

      pageSnapshot.rendered = rendered;
      indexedPages.push(pageSnapshot);

      crawlEvents.push(`page extracted: depth=${current.depth} url=${pageSnapshot.url} chars=${pageSnapshot.extractedText.length}`);
      console.info(`[attachments/ingest] ${crawlEvents[crawlEvents.length - 1]}`);

      if (current.depth === 0) {
        pageSnapshot.links.slice(0, 3).forEach((link) => importantLinks.add(link));
      }

      if (current.depth < maxDepth) {
        for (const link of pageSnapshot.links) {
          if (queue.length + indexedPages.length >= maxPages * 3) break;
          if (visited.has(link)) continue;
          if (shouldSkipInternalUrl(link)) continue;

          const parsed = new URL(link);
          if (parsed.origin !== rootUrl.origin) {
            continue;
          }
          queue.push({ url: parsed.toString(), depth: current.depth + 1 });
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      crawlEvents.push(`page fetch failed: depth=${current.depth} url=${current.url} error=${detail}`);
      console.warn(`[attachments/ingest] ${crawlEvents[crawlEvents.length - 1]}`);
    }
  }

  if (indexedPages.length === 0) {
    throw new Error('URL crawl produced no readable pages.');
  }

  const structuredData = buildStructuredUrlSnapshot(sourceUrl, indexedPages);
  const snapshotText = buildSiteSnapshotText(sourceUrl, indexedPages);
  const primaryTitle = indexedPages[0]?.title || sourceUrl;
  const crawlComplete = `crawl completed: pages=${indexedPages.length}`;
  crawlEvents.push(crawlComplete);
  console.info(`[attachments/ingest] ${crawlComplete}`);

  const pagesForMetadata = indexedPages.map((page) => ({
    url: page.url,
    title: page.title,
    metaDescription: page.metaDescription,
    excerpt: page.excerpt,
    summary: page.summary,
    extractedText: trimText(page.extractedText, 4500),
    depth: page.depth,
    rendered: page.rendered,
  }));

  return {
    status: 'parsed',
    summary: `Crawled ${indexedPages.length} page(s) and built site snapshot (${primaryTitle}).`,
    pageTitle: primaryTitle,
    sourceUrl,
    extractedText: snapshotText,
    excerpt: excerpt(snapshotText, 360),
    urlPageCount: indexedPages.length,
    urlCrawlDepth: maxDepth,
    urlCrawlMaxPages: maxPages,
    urlPages: pagesForMetadata,
    urlStructuredData: structuredData,
    crawlEvents,
  };
}

async function ingestPdf(downloadUrl: string, title: string): Promise<IngestPayload> {
  const response = await fetch(downloadUrl, {
    headers: {
      'Accept': 'application/pdf',
      'User-Agent': 'AI-Boardroom-Ingest/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`PDF download failed (HTTP ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';

  // Validate that we got a PDF, not HTML or other content
  if (!contentType.toLowerCase().includes('pdf') &&
    !contentType.toLowerCase().includes('octet-stream')) {
    console.error(`[PDF-INGEST] Wrong content-type: ${contentType}. Expected PDF.`);
    throw new Error(`Expected PDF content-type, got: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Validate that buffer looks like a PDF (starts with %PDF)
  const pdfHeader = buffer.subarray(0, 4).toString('ascii');
  if (!pdfHeader.startsWith('%PDF')) {
    const preview = buffer.subarray(0, 50).toString('utf-8').replace(/[^\x20-\x7E]/g, '?');
    console.error(`[PDF-INGEST] Invalid PDF header. First 50 chars: "${preview}"`);
    throw new Error(`Invalid PDF format: buffer does not start with %PDF marker`);
  }

  const parsed = await extractPdfText(buffer);
  const cleanText = trimText(parsed.text);
  if (!cleanText || cleanText.length < 10) {
    console.warn(`[PDF-INGEST] Few/no text extracted from PDF at ${downloadUrl}`);
  }

  return {
    success: true,
    status: 'ingested',
    title,
    pageCount: parsed.pageCount,
    summary: 'Extracted PDF text content.',
    extractedText: cleanText,
    excerpt: excerpt(cleanText),
    pageTitle: title,
  };
}

function isKeyTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [
    '.txt',
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.xml',
    '.csv',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.html',
    '.css',
    '.sql',
  ].some((ext) => lower.endsWith(ext));
}

function isPdfZipEntry(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

async function ingestZip(downloadUrl: string): Promise<IngestPayload> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`ZIP download failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = Object.values(zip.files);
  const fileTree = entries.map((entry) => entry.name);

  const keyFiles: Array<{ path: string; content: string }> = [];
  const zipPdfFiles: NonNullable<IngestPayload['zipPdfFiles']> = [];

  for (const entry of entries) {
    if (entry.dir) continue;

    if (isPdfZipEntry(entry.name)) {
      try {
        const pdfBuffer = await entry.async('nodebuffer');
        const parsed = await extractPdfText(pdfBuffer);
        const cleanText = trimText(parsed.text, 24_000);

        if (!cleanText || cleanText.length < 10) {
          zipPdfFiles.push({
            path: entry.name,
            status: 'text_unavailable',
            pageCount: parsed.pageCount,
            error: 'No readable text extracted from PDF content.',
          });
        } else {
          zipPdfFiles.push({
            path: entry.name,
            status: 'ingested',
            pageCount: parsed.pageCount,
            extractedText: cleanText,
            excerpt: excerpt(cleanText),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown PDF extraction error';
        zipPdfFiles.push({
          path: entry.name,
          status: 'failed',
          error: message,
        });
      }
      continue;
    }

    if (isKeyTextFile(entry.name) && keyFiles.length < 8) {
      try {
        const content = await entry.async('text');
        keyFiles.push({
          path: entry.name,
          content: trimText(content, 4000),
        });
      } catch {
        // Ignore binary-like or unreadable entries.
      }
    }
  }

  const zipPdfSuccessCount = zipPdfFiles.filter((file) => file.status === 'ingested').length;
  const zipPdfFailedCount = zipPdfFiles.length - zipPdfSuccessCount;
  const zipSummary =
    zipPdfFiles.length > 0
      ? `ZIP unpacked and indexed. PDF files: ${zipPdfFiles.length}, extracted: ${zipPdfSuccessCount}, unavailable/failed: ${zipPdfFailedCount}.`
      : 'ZIP unpacked and indexed.';

  return {
    status: 'indexed',
    summary: zipSummary,
    zipFileTree: fileTree,
    zipKeyFiles: keyFiles,
    zipPdfFiles,
    excerpt: excerpt(fileTree.slice(0, 12).join(' | '), 320),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
    }

    const payload = parsed.data;

    if (payload.kind === 'url') {
      if (!payload.sourceUrl) {
        return NextResponse.json({ error: 'URL is required for URL ingestion.' }, { status: 400 });
      }
      const maxPages = payload.maxPages ?? DEFAULT_CRAWL_MAX_PAGES;
      const maxDepth = payload.maxDepth ?? DEFAULT_CRAWL_MAX_DEPTH;
      const result = await ingestUrl(payload.sourceUrl, maxPages, maxDepth);
      return NextResponse.json({ ingest: result });
    }

    if (payload.kind === 'image') {
      const ingest: IngestPayload = {
        status: 'parsed',
        summary: 'Image attached and ready for multimodal context.',
        excerpt: payload.title,
      };
      return NextResponse.json({ ingest });
    }

    if (payload.kind === 'pdf') {
      if (!payload.downloadUrl) {
        return NextResponse.json({ error: 'downloadUrl is required for PDF ingestion.' }, { status: 400 });
      }
      const result = await ingestPdf(payload.downloadUrl, payload.title);
      return NextResponse.json({
        success: true,
        title: result.title ?? payload.title,
        pageCount: result.pageCount ?? 0,
        excerpt: result.excerpt ?? '',
        extractedText: result.extractedText ?? '',
        ingest: result,
      });
    }

    if (payload.kind === 'zip') {
      if (!payload.downloadUrl) {
        return NextResponse.json({ error: 'downloadUrl is required for ZIP ingestion.' }, { status: 400 });
      }
      const result = await ingestZip(payload.downloadUrl);
      return NextResponse.json({ ingest: result });
    }

    const ingest: IngestPayload = {
      status: 'uploaded',
      summary: 'File uploaded. No specialized parser applied.',
      excerpt: payload.title,
    };
    return NextResponse.json({ ingest });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ingestion error';
    return NextResponse.json(
      {
        ingest: {
          status: 'failed',
          error: message,
        },
      },
      { status: 500 }
    );
  }
}
