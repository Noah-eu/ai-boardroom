import { AppLanguage, ExecutionSnapshot } from '@/types';

export type VerifiedWebsiteContent = {
  sourceUrl: string | null;
  pageTitle: string;
  headings: string[];
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

type PublicWebsiteViewModel = {
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
  const cleaned = value
    .replace(/\b(adresa|address|sidlo|sídlo|provozovna)\s*[:\-]/gi, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '')
    .trim();
  return cleaned || null;
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
  const title = humanTitle(params.verified.pageTitle || params.projectName || 'Website');

  const services = uniq(
    (params.verified.serviceNames.length > 0 ? params.verified.serviceNames : params.verified.headings).slice(0, 12),
    8
  );

  const topics = uniq(
    params.verified.headings
      .filter((entry) => !/kontakt|contact|mapa|pricing|price|cen/i.test(entry))
      .slice(0, 10),
    6
  );

  const pricing = normalizePricingRows(params.verified.pricingFields);

  const contact = {
    email: extractFirstEmail(params.verified.emails[0] ?? null),
    phone: normalizePhoneDisplay(params.verified.phones[0] ?? null),
    address: normalizeAddressDisplay(params.verified.addresses[0] ?? null),
  };

  const primaryService = services[0] ?? topics[0] ?? (language === 'cz' ? 'osobní podporu' : 'individual support');
  const defaultHeroSubtitle =
    language === 'cz'
      ? `Bezpečný prostor pro změnu a porozumění se zaměřením na ${primaryService}.`
      : `Professional support focused on ${primaryService}.`;
  const defaultAboutCopy =
    language === 'cz'
      ? services.length > 0
        ? `Nabízím citlivý a praktický přístup zaměřený na ${services.slice(0, 2).join(' a ')}.`
        : 'Nabízím bezpečný prostor pro hledání stabilního a dlouhodobě udržitelného směru.'
      : services.length > 0
      ? `I offer a practical and sensitive approach focused on ${services.slice(0, 2).join(' and ')}.`
      : 'I offer a safe and practical space for long-term personal growth.';
  const defaultApproachCopy =
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

  const heroTitle = normalizeWhitespace(sectionOverrides.hero?.title ?? title);
  const heroSubtitle = normalizeWhitespace(sectionOverrides.hero?.subtitle ?? defaultHeroSubtitle);
  const primaryCta = normalizeWhitespace(
    sectionOverrides.hero?.cta ?? (params.verified.ctaTexts[0] ?? (language === 'cz' ? 'Domluvit konzultaci' : 'Book a consultation'))
  );

  const aboutCopy = normalizeWhitespace(sectionOverrides.about?.body ?? defaultAboutCopy);
  const approachCopy = normalizeWhitespace(sectionOverrides.approach?.body ?? defaultApproachCopy);
  const topicItems = uniq(sectionOverrides.topics?.items ?? topics, 6);
  const serviceItems = uniq(sectionOverrides.servicesPricing?.services ?? services, 8);
  const pricingItems = uniq(sectionOverrides.servicesPricing?.pricing ?? pricing, 8);
  const contactIntro = normalizeWhitespace(
    sectionOverrides.contact?.intro ??
      (language === 'cz'
        ? 'Pro objednání termínu mě prosím kontaktujte e-mailem nebo telefonicky.'
        : 'Please contact me by email or phone to book an appointment.')
  );
  const mapCopy = normalizeWhitespace(
    sectionOverrides.map?.body ??
      (language === 'cz'
        ? 'Setkání probíhá po domluvě na adrese uvedené níže.'
        : 'Sessions take place at the address below by appointment.')
  );

  return {
    title,
    heroTitle,
    heroSubtitle,
    aboutCopy,
    approachCopy,
    topics: topicItems.length > 0 ? topicItems : ['Podpora v náročných životních situacích', 'Stabilizace a prevence přetížení'],
    services: serviceItems.length > 0 ? serviceItems : ['Individuální konzultace', 'Dlouhodobá podpora'],
    pricing: pricingItems.length > 0 ? pricingItems : ['Ceník na vyžádání'],
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
  const contactEmail = model.contact.email
    ? `<p><strong>E-mail:</strong> <a href="mailto:${escapeHtml(model.contact.email)}">${escapeHtml(model.contact.email)}</a></p>`
    : '<p><strong>E-mail:</strong> Na vyzadani.</p>';

  const contactPhone = model.contact.phone
    ? `<p><strong>Telefon:</strong> <a href="tel:${escapeHtml(normalizePhoneForTel(model.contact.phone))}">${escapeHtml(model.contact.phone)}</a></p>`
    : '<p><strong>Telefon:</strong> Na vyzadani.</p>';

  const contactAddress = model.contact.address
    ? `<p><strong>Adresa:</strong> ${escapeHtml(model.contact.address)}</p>`
    : '<p><strong>Adresa:</strong> Upřesníme při domluvě.</p>';

  const topicsMarkup = model.topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join('\n');
  const servicesMarkup = model.services.map((service) => `<li>${escapeHtml(service)}</li>`).join('\n');
  const pricingMarkup = model.pricing.map((price) => `<li>${escapeHtml(price)}</li>`).join('\n');

  const portraitMarkup = portraitImage
    ? [
        '<figure class="portrait">',
        `  <img src="${escapeHtml(portraitImage.src)}" alt="${escapeHtml(portraitImage.alt)}" loading="lazy" decoding="async" />`,
        '</figure>',
      ].join('\n')
    : '';

  const mapMarkup = model.mapUrl
    ? `<p>${escapeHtml(model.mapCopy)}</p><p><a class="map-link" href="${escapeHtml(model.mapUrl)}" target="_blank" rel="noreferrer">Otevřít mapu</a></p>`
    : `<p>${escapeHtml(model.mapCopy)}</p>`;

  return [
    '<!doctype html>',
    '<html lang="cs">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(model.title)}</title>`,
    model.sourceUrl ? `  <meta name="source-url" content="${escapeHtml(model.sourceUrl)}" />` : '',
    '  <link rel="stylesheet" href="styles.css" />',
    '</head>',
    '<body>',
    '  <header id="hero" class="hero">',
    '    <p class="section-label">Úvod</p>',
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
    '      <h2>O mně</h2>',
    `      <p>${escapeHtml(model.aboutCopy)}</p>`,
    '    </section>',
    '',
    '    <section id="pristup-vzdelavani" class="card">',
    '      <h2>Přístup a vzdělávání</h2>',
    `      <p>${escapeHtml(model.approachCopy)}</p>`,
    '    </section>',
    '',
    '    <section id="temata" class="card">',
    '      <h2>Témata</h2>',
    '      <ul>',
    topicsMarkup,
    '      </ul>',
    '    </section>',
    '',
    '    <section id="sluzby-ceny" class="card">',
    '      <h2>Služby a ceny</h2>',
    '      <div class="split">',
    '        <div>',
    '          <h3>Služby</h3>',
    '          <ul>',
    servicesMarkup,
    '          </ul>',
    '        </div>',
    '        <div>',
    '          <h3>Ceny</h3>',
    '          <ul>',
    pricingMarkup,
    '          </ul>',
    '        </div>',
    '      </div>',
    '    </section>',
    '',
    '    <section id="kontakt" class="card">',
    '      <h2>Kontakt</h2>',
    `      <p>${escapeHtml(model.contactIntro)}</p>`,
    contactEmail,
    contactPhone,
    contactAddress,
    '    </section>',
    '',
    '    <section id="mapa" class="card">',
    '      <h2>Mapa</h2>',
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
  ];

  forbiddenLabels.forEach((marker) => {
    if (lower.includes(marker)) {
      errors.push(`Public HTML contains internal marker: ${marker}`);
    }
  });

  const prompt = normalizeWhitespace(rawPrompt ?? '');
  if (prompt.length >= 24) {
    const promptNeedles = uniq(
      prompt
        .split(/[\n.!?]/)
        .map((entry) => normalizeWhitespace(entry))
        .filter((entry) => entry.length >= 24),
      3
    ).map((entry) => entry.toLowerCase());

    if (promptNeedles.some((needle) => lower.includes(needle))) {
      errors.push('Public HTML appears to include raw user prompt text.');
    }
  }

  return errors;
}

export function deriveVerifiedWebsiteContent(siteSnapshots: ExecutionSnapshot['siteSnapshots']): VerifiedWebsiteContent {
  const structured = siteSnapshots
    .map((entry) => entry.structuredData)
    .filter((entry): entry is NonNullable<ExecutionSnapshot['siteSnapshots'][number]['structuredData']> => Boolean(entry));

  const sourceUrl = structured.map((entry) => entry.sourceUrl).find((value) => Boolean(value)) ?? null;
  const pageTitle =
    structured.map((entry) => entry.pageTitle).find((value) => Boolean(value)) ??
    siteSnapshots.map((entry) => entry.pageTitle).find((value) => Boolean(value)) ??
    'Website';

  const headings = uniq(structured.flatMap((entry) => entry.headings), 30);
  const serviceNames = uniq(structured.flatMap((entry) => entry.serviceNames), 20);
  const pricingFields = uniq(structured.flatMap((entry) => entry.pricingFields), 20);
  const ctaTexts = uniq(structured.flatMap((entry) => entry.ctaTexts), 20);
  const emails = uniq(structured.flatMap((entry) => entry.contactFields.emails), 12);
  const phones = uniq(structured.flatMap((entry) => entry.contactFields.phones), 12);
  const addresses = uniq(structured.flatMap((entry) => entry.contactFields.addresses), 8);
  const missingFields = uniq(structured.flatMap((entry) => entry.missingFields), 20);
  const warnings = uniq(structured.flatMap((entry) => entry.extractionWarnings), 20);

  return {
    sourceUrl,
    pageTitle,
    headings,
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
  return Boolean(
    content.sourceUrl ||
      content.headings.length > 0 ||
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
