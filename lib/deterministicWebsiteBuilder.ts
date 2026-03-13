import { ExecutionSnapshot } from '@/types';

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
}): DeterministicWebsiteArtifacts {
  const title = humanTitle(params.verified.pageTitle || params.projectName || 'Website');
  const heroSubtitle = params.projectDescription.trim() || 'Generated from approved plan and verified source snapshot.';

  const navItems = params.verified.headings.slice(0, 5);
  const serviceItems = (params.verified.serviceNames.length > 0 ? params.verified.serviceNames : params.verified.headings).slice(0, 8);
  const priceItems = params.verified.pricingFields.slice(0, 8);
  const cta = params.verified.ctaTexts[0] ?? 'Contact us';

  const missingFieldsText =
    params.verified.missingFields.length > 0
      ? params.verified.missingFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('\n')
      : '<li>none</li>';

  const emailLines = params.verified.emails.length
    ? params.verified.emails
        .map((email) => `<li><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></li>`)
        .join('\n')
    : '<li>Not available in source snapshot</li>';

  const phoneLines = params.verified.phones.length
    ? params.verified.phones
        .map((phone) => `<li><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></li>`)
        .join('\n')
    : '<li>Not available in source snapshot</li>';

  const addressLines = params.verified.addresses.length
    ? params.verified.addresses.map((address) => `<li>${escapeHtml(address)}</li>`).join('\n')
    : '<li>Not available in source snapshot</li>';

  const serviceLines = serviceItems.length
    ? serviceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')
    : '<li>Service information not available in source snapshot</li>';

  const priceLines = priceItems.length
    ? priceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')
    : '<li>Pricing information not available in source snapshot</li>';

  const navLinks = navItems
    .map((item, index) => `<a href="#section-${index + 1}">${escapeHtml(item)}</a>`)
    .join('\n');

  const sourceUrl = params.verified.sourceUrl ?? '';

  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    sourceUrl ? `  <meta name="source-url" content="${escapeHtml(sourceUrl)}" />` : '',
    '  <link rel="stylesheet" href="styles.css" />',
    '</head>',
    '<body>',
    '  <header class="site-header">',
    `    <h1>${escapeHtml(title)}</h1>`,
    `    <p>${escapeHtml(heroSubtitle)}</p>`,
    '    <nav class="site-nav">',
    navLinks || '      <a href="#services">Services</a>\n      <a href="#contact">Contact</a>',
    '    </nav>',
    `    <a class="cta" href="#contact">${escapeHtml(cta)}</a>`,
    '  </header>',
    '',
    '  <main>',
    '    <section id="services" class="card">',
    '      <h2>Services</h2>',
    '      <ul>',
    serviceLines,
    '      </ul>',
    '    </section>',
    '',
    '    <section id="pricing" class="card">',
    '      <h2>Pricing</h2>',
    '      <ul>',
    priceLines,
    '      </ul>',
    '    </section>',
    '',
    '    <section id="contact" class="card">',
    '      <h2>Contact</h2>',
    '      <h3>Email</h3>',
    '      <ul>',
    emailLines,
    '      </ul>',
    '      <h3>Phone</h3>',
    '      <ul>',
    phoneLines,
    '      </ul>',
    '      <h3>Address</h3>',
    '      <ul>',
    addressLines,
    '      </ul>',
    '    </section>',
    '',
    '    <section id="verified-source" class="card">',
    '      <h2>Verified Source Snapshot</h2>',
    sourceUrl ? `      <p><strong>Source URL:</strong> <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>` : '      <p><strong>Source URL:</strong> not provided</p>',
    '      <p><strong>Missing fields reported by ingestion:</strong></p>',
    '      <ul>',
    missingFieldsText,
    '      </ul>',
    '    </section>',
    '  </main>',
    '',
    '  <footer class="site-footer">',
    '    <p>Built from approved execution plan and verified structured source content.</p>',
    '  </footer>',
    '',
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');

  const stylesCss = [
    ':root {',
    '  --bg: #f5f1e8;',
    '  --ink: #1f2937;',
    '  --accent: #b45309;',
    '  --card: #fffdf7;',
    '}',
    '* { box-sizing: border-box; }',
    'body { margin: 0; font-family: "Georgia", "Times New Roman", serif; color: var(--ink); background: radial-gradient(circle at top right, #fff2d5, var(--bg)); }',
    '.site-header { padding: 2rem 1.25rem; max-width: 980px; margin: 0 auto; }',
    '.site-nav { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; }',
    '.site-nav a { color: var(--ink); text-decoration: none; border-bottom: 1px solid transparent; }',
    '.site-nav a:hover { border-color: var(--accent); }',
    '.cta { display: inline-block; background: var(--accent); color: white; text-decoration: none; padding: 0.6rem 1rem; border-radius: 999px; }',
    'main { max-width: 980px; margin: 0 auto; padding: 0 1.25rem 2.5rem; display: grid; gap: 1rem; }',
    '.card { background: var(--card); border: 1px solid #eadfcb; border-radius: 14px; padding: 1rem 1.1rem; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05); }',
    '.site-footer { max-width: 980px; margin: 0 auto; padding: 0 1.25rem 2rem; color: #6b7280; }',
    '@media (max-width: 640px) {',
    '  .site-header { padding-top: 1.25rem; }',
    '  .cta { width: 100%; text-align: center; }',
    '}',
  ].join('\n');

  const scriptJs = [
    "document.querySelectorAll('.site-nav a').forEach((anchor) => {",
    "  anchor.addEventListener('click', (event) => {",
    "    const href = anchor.getAttribute('href');",
    "    if (!href || !href.startsWith('#')) return;",
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
