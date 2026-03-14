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

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Verified Practice',
      verified,
    });

    expect(sections.topics.items.join(' ').toLowerCase()).not.toContain('home');
    expect(sections.servicesPricing.services.join(' ').toLowerCase()).not.toContain('services');
  });

  it('keeps navigation labels out of topics/services collections', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-bleed',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Practice',
        summary: 'Structured source',
        extractedText: 'Obsah webu',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Practice',
          visibleTextBlocks: ['Podpora při úzkosti a stresu.', 'Dlouhodobá spolupráce podle potřeb klienta.'],
          headings: ['Home', 'About', 'Contact'],
          paragraphs: ['Terapeutická podpora zaměřená na stabilizaci a zvládání stresu.'],
          navigationLabels: ['Home', 'About', 'Services', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Ulice 1, Praha'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Book consultation'],
          serviceNames: ['Services', 'Individual consultations', 'Contact'],
          pricingFields: ['Od 1500 Kč / 50 min'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const sections = buildDeterministicWebsiteCopySections({ projectName: 'Practice', verified });
    const topicsJoined = sections.topics.items.join(' ').toLowerCase();
    const servicesJoined = sections.servicesPricing.services.join(' ').toLowerCase();

    expect(topicsJoined).not.toContain('home');
    expect(topicsJoined).not.toContain('about');
    expect(servicesJoined).not.toContain('services');
    expect(servicesJoined).toContain('individual consultations');
  });

  it('prefers verified pricing over generic placeholders in slot overrides', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-pricing',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Practice',
        summary: 'Structured source',
        extractedText: 'Od 1800 Kč za sezení',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Practice',
          visibleTextBlocks: ['Od 1800 Kč za sezení'],
          headings: ['Practice'],
          paragraphs: ['Individuální konzultace'],
          navigationLabels: ['Home', 'Pricing'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Ulice 1, Praha'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Book consultation'],
          serviceNames: ['Individuální konzultace'],
          pricingFields: ['Od 1800 Kč / 50 min'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Practice',
      projectDescription: 'Public website',
      verified,
      copySections: {
        servicesPricing: {
          services: ['Individuální konzultace'],
          pricing: ['Ceník na vyžádání'],
        },
      },
    });

    expect(artifacts.indexHtml).toContain('Od 1800 Kč');
    expect(artifacts.indexHtml).not.toContain('Ceník na vyžádání');
  });

  it('normalizes address by stripping phone/email contamination', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-address',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Practice',
        summary: 'Structured source',
        extractedText: 'Kontakt',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Practice',
          visibleTextBlocks: ['Kontaktní údaje'],
          headings: ['Practice'],
          paragraphs: ['Objednání konzultace po domluvě.'],
          navigationLabels: ['Home', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420 777 888 999'],
            addresses: ['Address: Ulice 12, Praha; Email: hello@example.com; Telefon: +420 777 888 999'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Domluvit konzultaci'],
          serviceNames: ['Individuální konzultace'],
          pricingFields: ['Od 1500 Kč / sezení'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Practice',
      projectDescription: 'Public website',
      verified,
    });

    expect(artifacts.indexHtml).toContain('Ulice 12, Praha');
    expect(artifacts.indexHtml).toContain('<strong>Adresa:</strong> Ulice 12, Praha');
    expect(artifacts.indexHtml).not.toContain('<strong>Adresa:</strong> Ulice 12, Praha; Email');
    expect(artifacts.indexHtml).not.toContain('<strong>Adresa:</strong> Ulice 12, Praha; Telefon');
  });

  it('builds hero subtitle from content-bearing body text instead of repeated heading', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-hero',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Calm Practice',
        summary: 'Structured source',
        extractedText: 'Body text',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Calm Practice',
          visibleTextBlocks: ['Calm Practice', 'Podpora při úzkosti a dlouhodobém stresu v bezpečném prostředí.'],
          headings: ['Calm Practice', 'Services'],
          paragraphs: ['Podpora při úzkosti a dlouhodobém stresu v bezpečném prostředí.'],
          navigationLabels: ['Home', 'Services', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Ulice 12, Praha'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Domluvit konzultaci'],
          serviceNames: ['Individuální konzultace'],
          pricingFields: ['Od 1500 Kč / sezení'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const sections = buildDeterministicWebsiteCopySections({ projectName: 'Calm Practice', verified });

    expect(sections.hero.subtitle).toContain('Podpora při úzkosti');
    expect(sections.hero.subtitle).not.toBe('Calm Practice');
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
