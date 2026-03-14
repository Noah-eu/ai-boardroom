import { describe, expect, it } from 'vitest';
import {
  buildDeterministicWebsiteArtifacts,
  buildDeterministicWebsiteCopySections,
  deriveVerifiedWebsiteContent,
  hasSufficientVerifiedWebsiteContent,
  validatePublicWebsiteHtml,
} from './deterministicWebsiteBuilder';

describe('deterministicWebsiteBuilder', () => {
  it('builds deployable artifacts from verified structured snapshot', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-1',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Therapist Studio',
        summary: 'Structured source',
        extractedText: 'Contact us at hello@example.com. Price from 1500 Kč.',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Therapist Studio',
          visibleTextBlocks: ['Holistic therapy', 'From 1500 Kč'],
          headings: ['Holistic therapy', 'Contact'],
          paragraphs: ['Individual sessions for adults.'],
          navigationLabels: ['Home', 'Services', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Ulice 12, Praha 2, 120 00'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Book appointment'],
          serviceNames: ['Individual sessions'],
          pricingFields: ['Od 1500 Kč / sezení', 'sleva 500 Kč na newsletter'],
          extractedLinks: [{ href: 'https://example.com/services', label: 'Services', kind: 'http' }],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    expect(hasSufficientVerifiedWebsiteContent(verified)).toBe(true);

    const sectionCopy = buildDeterministicWebsiteCopySections({
      projectName: 'Therapist web',
      verified,
    });

    expect(sectionCopy.hero.title).toContain('Therapist Studio');
    expect(sectionCopy.topics.items.length).toBeGreaterThan(0);

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Therapist web',
      projectDescription: 'Create modern therapist website and include debug report from source snapshot.',
      verified,
      copySections: {
        hero: {
          title: 'Nová úvodní sekce',
          subtitle: 'Personalizovaný úvodní text',
          cta: 'Objednat termín',
        },
        about: {
          body: 'Upravený text O mně.',
        },
      },
      portraitImage: {
        src: 'assets/portrait.jpg',
        alt: 'Portrait',
      },
    });

    expect(artifacts.indexHtml).toContain('</html>');
    expect(artifacts.indexHtml).toContain('Úvod');
    expect(artifacts.indexHtml).toContain('Nová úvodní sekce');
    expect(artifacts.indexHtml).toContain('Personalizovaný úvodní text');
    expect(artifacts.indexHtml).toContain('Objednat termín');
    expect(artifacts.indexHtml).toContain('Upravený text O mně.');
    expect(artifacts.indexHtml).toContain('O mně');
    expect(artifacts.indexHtml).toContain('Přístup a vzdělávání');
    expect(artifacts.indexHtml).toContain('Témata');
    expect(artifacts.indexHtml).toContain('Služby a ceny');
    expect(artifacts.indexHtml).toContain('Kontakt');
    expect(artifacts.indexHtml).toContain('Mapa');
    expect(artifacts.indexHtml).toContain('hello@example.com');
    expect(artifacts.indexHtml).toContain('Od 1500 Kč');
    expect(artifacts.indexHtml).not.toContain('<li>500 Kč</li>');
    expect(artifacts.indexHtml).not.toContain('Professional support focused on');
    expect(artifacts.indexHtml).toContain('assets/portrait.jpg');
    expect(artifacts.indexHtml).not.toContain('Verified Source Snapshot');
    expect(artifacts.indexHtml).not.toContain('missing fields reported by ingestion');
    expect(artifacts.indexHtml).not.toContain('Create modern therapist website and include debug report from source snapshot.');
    expect(artifacts.stylesCss).toContain(':root');
    expect(artifacts.scriptJs).toContain('scrollIntoView');

    expect(
      validatePublicWebsiteHtml(
        artifacts.indexHtml,
        'Create modern therapist website and include debug report from source snapshot.'
      )
    ).toEqual([]);
  });

  it('flags insufficient verified content', () => {
    const verified = deriveVerifiedWebsiteContent([] as never);
    expect(hasSufficientVerifiedWebsiteContent(verified)).toBe(false);
  });

  it('filters navigation/debug/metadata-like text from verified facts', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-2',
        title: 'Source site',
        source: 'project',
        pageTitle: '"projectPrompt": "internal"',
        summary: 'Structured source',
        extractedText: 'Public content',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Verified Practice',
          visibleTextBlocks: ['Therapy support'],
          headings: ['Home', 'Services', 'Verified Care'],
          paragraphs: ['Paragraph'],
          navigationLabels: ['Home', 'Contact'],
          contactFields: {
            emails: ['debug@example.com'],
            phones: ['+420 123 456 789'],
            addresses: ['Address: Test Street 1'],
            mailtoLinks: ['mailto:debug@example.com'],
            telLinks: ['tel:+420123456789'],
          },
          ctaTexts: ['Contact', 'Book Consultation'],
          serviceNames: ['Services', 'Project prompt: internal note', 'Individual counseling'],
          pricingFields: ['{"debug":true}', 'Od 1500 Kč / 50 min'],
          extractedLinks: [{ href: 'https://example.com/services', label: 'Services', kind: 'http' }],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    expect(verified.pageTitle).toBe('Verified Practice');
    expect(verified.headings).toContain('Verified Care');
    expect(verified.headings).not.toContain('Home');
    expect(verified.serviceNames).toContain('Individual counseling');
    expect(verified.serviceNames.join(' ')).not.toContain('Project prompt');
    expect(verified.ctaTexts).toContain('Book Consultation');
    expect(verified.ctaTexts).not.toContain('Contact');
    expect(verified.pricingFields).toContain('Od 1500 Kč / 50 min');
    expect(verified.pricingFields.join(' ')).not.toContain('{"debug":true}');
  });

  it('keeps locale consistent in generated public HTML', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-3',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Mind Studio',
        summary: 'Structured source',
        extractedText: 'Professional support from 80 EUR.',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Mind Studio',
          visibleTextBlocks: ['Coaching support', 'From 80 EUR'],
          headings: ['Coaching support', 'Stress management'],
          paragraphs: ['Individual sessions.'],
          navigationLabels: ['Home', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Main Street 1, Prague'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Book consultation'],
          serviceNames: ['Individual sessions'],
          pricingFields: ['From 80 EUR'],
          extractedLinks: [{ href: 'https://example.com/services', label: 'Services', kind: 'http' }],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Mind Studio',
      projectDescription: 'Public website',
      verified,
      language: 'en',
    });

    expect(artifacts.indexHtml).toContain('<html lang="en">');
    expect(artifacts.indexHtml).toContain('Intro');
    expect(artifacts.indexHtml).toContain('About');
    expect(artifacts.indexHtml).toContain('Services and Pricing');
    expect(artifacts.indexHtml).not.toContain('<h2>O mně</h2>');
  });

  it('fails sufficiency check when only source URL exists without verified public facts', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-4',
        title: 'Source site',
        source: 'project',
        pageTitle: '',
        summary: 'Structured source',
        extractedText: '',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: '',
          visibleTextBlocks: [],
          headings: ['Home', 'Contact'],
          paragraphs: [],
          navigationLabels: ['Home', 'Contact'],
          contactFields: {
            emails: [],
            phones: [],
            addresses: [],
            mailtoLinks: [],
            telLinks: [],
          },
          ctaTexts: ['Contact'],
          serviceNames: ['Services'],
          pricingFields: [],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    expect(verified.sourceUrl).toBe('https://example.com');
    expect(verified.headings).toEqual([]);
    expect(verified.serviceNames).toEqual([]);
    expect(hasSufficientVerifiedWebsiteContent(verified)).toBe(false);
  });

  it('detects prompt/debug leakage markers in generated HTML', () => {
    const errors = validatePublicWebsiteHtml(
      '<!doctype html><html><body><p>Project prompt: expose internals</p><p>{{ TEMPLATE }}</p></body></html>',
      'Create website from verified facts only.'
    );

    expect(errors.join(' | ')).toContain('internal marker: project prompt:');
    expect(errors.join(' | ')).toContain('unresolved template tokens');
  });
});
