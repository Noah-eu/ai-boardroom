import { describe, expect, it } from 'vitest';
import {
  buildDeterministicWebsiteArtifacts,
  buildDeterministicWebsiteArtifactsByLocale,
  buildDeterministicWebsiteCopySections,
  buildDeterministicWebsiteCopySectionsByLocale,
  diagnoseDeterministicWebsiteRun,
  deriveVerifiedWebsiteContentFromPrompt,
  deriveVerifiedWebsiteContent,
  hasSufficientVerifiedWebsiteContent,
  mergeVerifiedWebsiteContent,
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

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Therapist web',
      projectDescription: 'Create modern therapist website and include debug report from source snapshot.',
      verified,
      copySections: {
        hero: {
          title: 'Therapist Studio - uvodni sekce',
          subtitle: 'Individual sessions for adults - uvodni text',
          cta: 'Book appointment now',
        },
        about: {
          body: 'Individual sessions for adults v overenem bezpecnem prostredi.',
        },
      },
      portraitImage: {
        src: 'assets/portrait.jpg',
        alt: 'Portrait',
      },
    });

    expect(artifacts.indexHtml).toContain('</html>');
    expect(artifacts.indexHtml).toContain('Úvod');
    expect(artifacts.indexHtml).toContain('Therapist Studio - uvodni sekce');
    expect(artifacts.indexHtml).not.toContain('Individual sessions for adults - uvodni text');
    expect(artifacts.indexHtml).toContain('Book appointment now');
    expect(artifacts.indexHtml).not.toContain('Individual sessions for adults v overenem bezpecnem prostredi.');
    expect(artifacts.indexHtml).not.toContain('O nás');
    expect(artifacts.indexHtml).not.toContain('Hlavní oblasti');
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
    expect(servicesJoined).not.toContain('individual consultations');
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

  it('supports prompt-only explicit website facts without source ingestion', () => {
    const promptOnly = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Aster Therapy',
      projectDescription: 'Build a public website from explicit facts listed in prompt.',
      projectPrompt: [
        'Hero: Aster Therapy',
        'About: Poskytuji individualni terapii pro dospele se zamerenim na uzkost a stres.',
        'Services: Individualni terapie, Kratke krizove konzultace',
        'Pricing: Od 1700 Kc / 50 min',
        'Contact: kontakt@astertherapy.cz, +420 777 111 222',
        'Address: Botanicka 12, Brno 602 00',
        'CTA: Domluvit konzultaci',
      ].join('\n'),
      revisionPrompt: 'Zachovej civilni ton a jasnou strukturu sekci.',
    });

    expect(hasSufficientVerifiedWebsiteContent(promptOnly)).toBe(true);
    expect(promptOnly.pageTitle).toContain('Aster Therapy');
    expect(promptOnly.emails).toContain('kontakt@astertherapy.cz');
    expect(promptOnly.phones.join(' ')).toContain('+420 777 111 222');
    expect(promptOnly.pricingFields.join(' ')).toContain('1700');

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Aster Therapy',
      projectDescription: 'Prompt-only website',
      verified: promptOnly,
    });

    expect(artifacts.indexHtml).toContain('Aster Therapy');
    expect(artifacts.indexHtml).toContain('kontakt@astertherapy.cz');
    expect(artifacts.indexHtml).toContain('Od 1700 Kč');
  });

  it('retains verified page title over generic fallback naming', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-title-retention',
        title: 'Source',
        source: 'project',
        pageTitle: 'Studio Harmonie',
        summary: 'Structured source',
        extractedText: 'Support content',
        pages: [{ url: 'https://harmonie.example', title: 'Home', summary: 'Home' }],
        structuredData: {
          sourceUrl: 'https://harmonie.example',
          pageTitle: 'Studio Harmonie',
          visibleTextBlocks: ['Terapeutická podpora'],
          headings: ['Studio Harmonie'],
          paragraphs: ['Citlivá podpora při stresu.'],
          navigationLabels: ['Domů', 'Kontakt'],
          contactFields: {
            emails: ['kontakt@harmonie.example'],
            phones: ['+420777111222'],
            addresses: ['Náměstí 1, Brno'],
            mailtoLinks: ['mailto:kontakt@harmonie.example'],
            telLinks: ['tel:+420777111222'],
          },
          ctaTexts: ['Domluvit konzultaci'],
          serviceNames: ['Individuální terapie'],
          pricingFields: ['Od 1700 Kč / 50 min'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Website',
      projectDescription: 'Public website',
      verified,
    });

    expect(artifacts.indexHtml).toContain('<title>Studio Harmonie</title>');
    expect(artifacts.indexHtml).not.toContain('<title>Website</title>');
  });

  it('renders topics as concise topic-like items instead of sentence dumps', () => {
    const promptOnly = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Topic Lab',
      projectPrompt: [
        'About: Poskytuji podporu pri uzkosti a stresu v bezpecnem prostredi s jasnym planem prace.',
        'Approach: Kombinuji kratkodobe stabilizacni techniky a dlouhodoby rozvoj resilience.',
        'Topics: uzkost a stres, vztahy a hranice, sebehodnota a sebejistota',
        'Services: Individualni terapie',
      ].join('\n'),
    });

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Topic Lab',
      verified: promptOnly,
    });

    expect(sections.topics.items.length).toBeGreaterThan(0);
    sections.topics.items.forEach((item) => {
      expect(item.length).toBeLessThanOrEqual(64);
      expect(item.split(/\s+/).length).toBeLessThanOrEqual(7);
      expect(item).not.toContain('.');
    });
  });

  it('generates public-safe portrait alt text when technical/internal alt is provided', () => {
    const promptOnly = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Portrait Test',
      projectPrompt: 'Hero: Portrait Test\nServices: Individualni terapie\nPricing: Od 1500 Kc',
    });

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Portrait Test',
      projectDescription: 'Public website',
      verified: promptOnly,
      portraitImage: {
        src: 'assets/portrait.jpg',
        alt: 'debug metadata snapshot json payload',
      },
    });

    expect(artifacts.indexHtml).toContain('alt="Portrét: Portrait Test"');
    expect(artifacts.indexHtml).not.toContain('debug metadata snapshot');
  });

  it('keeps prompt-only and attachment-based facts comparably in public sections', () => {
    const promptOnly = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Convergence Studio',
      projectPrompt: [
        'Hero: Convergence Studio',
        'About: Podpora pri uzkosti a dlouhodobem stresu.',
        'Services: Individualni terapie, Kratke krizove konzultace',
        'Pricing: Od 1700 Kc / 50 min',
        'Contact: hello@convergence.example, +420 777 444 333',
        'Address: Kvetna 7, Praha 120 00',
      ].join('\n'),
    });

    const attachmentBased = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-convergence',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Convergence Studio',
        summary: 'Structured source',
        extractedText: 'Structured source',
        pages: [{ url: 'https://convergence.example', title: 'Home', summary: 'Home' }],
        structuredData: {
          sourceUrl: 'https://convergence.example',
          pageTitle: 'Convergence Studio',
          visibleTextBlocks: ['Podpora pri uzkosti a dlouhodobem stresu.'],
          headings: ['Convergence Studio', 'Kontakt'],
          paragraphs: ['Podpora pri uzkosti a dlouhodobem stresu.'],
          navigationLabels: ['Domu', 'Kontakt'],
          contactFields: {
            emails: ['hello@convergence.example'],
            phones: ['+420 777 444 333'],
            addresses: ['Kvetna 7, Praha 120 00'],
            mailtoLinks: ['mailto:hello@convergence.example'],
            telLinks: ['tel:+420777444333'],
          },
          ctaTexts: ['Domluvit konzultaci'],
          serviceNames: ['Individualni terapie', 'Kratke krizove konzultace'],
          pricingFields: ['Od 1700 Kč / 50 min'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const promptSections = buildDeterministicWebsiteCopySections({ projectName: 'Convergence Studio', verified: promptOnly });
    const attachmentSections = buildDeterministicWebsiteCopySections({
      projectName: 'Convergence Studio',
      verified: attachmentBased,
    });

    expect(promptSections.servicesPricing.pricing.join(' ')).toContain('1700');
    expect(attachmentSections.servicesPricing.pricing.join(' ')).toContain('1700');
    expect(promptSections.topics.items.length).toBeGreaterThan(0);
    expect(attachmentSections.topics.items.length).toBeGreaterThan(0);
  });

  it('merges ingestion and prompt-derived website facts deterministically', () => {
    const ingestion = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-merge-1',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Aster Therapy',
        summary: 'Structured source',
        extractedText: 'Individualni terapie',
        pages: [{ url: 'https://aster.example', title: 'Home', summary: 'Home' }],
        structuredData: {
          sourceUrl: 'https://aster.example',
          pageTitle: 'Aster Therapy',
          visibleTextBlocks: ['Individualni terapie'],
          headings: ['Aster Therapy', 'Kontakt'],
          paragraphs: ['Podpora pri uzkosti.'],
          navigationLabels: ['Domu', 'Kontakt'],
          contactFields: {
            emails: ['hello@aster.example'],
            phones: [],
            addresses: [],
            mailtoLinks: ['mailto:hello@aster.example'],
            telLinks: [],
          },
          ctaTexts: ['Kontakt'],
          serviceNames: ['Individualni terapie'],
          pricingFields: [],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const promptOnly = deriveVerifiedWebsiteContentFromPrompt({
      projectPrompt: 'Pricing: Od 1700 Kc / 50 min\nPhone: +420 777 111 222',
    });

    const merged = mergeVerifiedWebsiteContent(ingestion, promptOnly);
    expect(merged.emails).toContain('hello@aster.example');
    expect(merged.phones.join(' ')).toContain('+420 777 111 222');
    expect(merged.pricingFields.join(' ')).toContain('1700');
  });

  it('detects prompt/debug leakage markers in generated HTML', () => {
    const errors = validatePublicWebsiteHtml(
      '<!doctype html><html><body><p>Project prompt: expose internals</p><p>{{ TEMPLATE }}</p></body></html>',
      'Create website from verified facts only.'
    );

    expect(errors.join(' | ')).toContain('internal marker: project prompt:');
    expect(errors.join(' | ')).toContain('unresolved template tokens');
  });

  it('prevents cross-domain contamination from stale copy overrides between runs', () => {
    const psychologistVerified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Calm Mind Studio',
      projectPrompt: [
        'About: Poskytuji individualni terapii se zamerenim na uzkost a dlouhodoby stres.',
        'Approach: Kombinuji stabilizacni techniky a dlouhodoby terapeuticky plan.',
        'Services: Individualni terapie, Krizova podpora',
      ].join('\n'),
    });

    const psychologistSections = buildDeterministicWebsiteCopySections({
      projectName: 'Calm Mind Studio',
      verified: psychologistVerified,
    });

    const hotelVerified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Alpine Harbor Hotel',
      projectPrompt: [
        'Hero: Alpine Harbor Hotel',
        'Services: Ubytovani, Wellness, Restaurace',
        'Pricing: Od 3200 Kc / noc',
        'Contact: reception@alpineharbor.example, +420 777 555 111',
      ].join('\n'),
    });

    const hotelArtifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Alpine Harbor Hotel',
      projectDescription: 'Public website',
      verified: hotelVerified,
      copySections: {
        about: psychologistSections.about,
        approach: psychologistSections.approach,
      },
    });

    expect(hotelArtifacts.indexHtml).toContain('Alpine Harbor Hotel');
    expect(hotelArtifacts.indexHtml.toLowerCase()).not.toContain('terapi');
    expect(hotelArtifacts.indexHtml.toLowerCase()).not.toContain('terapeut');
    expect(hotelArtifacts.indexHtml.toLowerCase()).not.toContain('uzkost');
  });

  it('omits about and approach copy when source facts are missing', () => {
    const hotelVerified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Harbor View Hotel',
      projectPrompt: [
        'Hero: Harbor View Hotel',
        'Contact: reception@harborview.example',
      ].join('\n'),
    });

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Harbor View Hotel',
      verified: hotelVerified,
    });

    const mergedCopy = `${sections.about.body} ${sections.approach.body}`.toLowerCase().trim();
    expect(mergedCopy).toBe('');
    expect(mergedCopy).not.toContain('terapi');
    expect(mergedCopy).not.toContain('personal growth');
  });

  it('keeps website content model isolated across sequential runs', () => {
    const runA = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Psychology Room',
      projectPrompt: 'About: Terapie pro uzkost a stres. Services: Individualni terapie.',
    });
    const runAArtifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Psychology Room',
      projectDescription: 'Public website',
      verified: runA,
    });

    const runB = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Mountain Lake Hotel',
      projectPrompt: 'Services: Ubytovani, Snidane, Wellness. Pricing: Od 2800 Kc / noc.',
    });
    const runBArtifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Mountain Lake Hotel',
      projectDescription: 'Public website',
      verified: runB,
    });

    expect(runAArtifacts.indexHtml.toLowerCase()).toContain('terapi');
    expect(runBArtifacts.indexHtml).toContain('Mountain Lake Hotel');
    expect(runBArtifacts.indexHtml.toLowerCase()).not.toContain('psychology room');
    expect(runBArtifacts.indexHtml.toLowerCase()).not.toContain('terapi');
  });

  it('prevents contamination across A/B/C cross-domain run sequence', () => {
    const runA = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Insight Therapy',
      projectPrompt: 'About: Terapie zamerena na uzkost. Approach: Individualni terapeuticky plan.',
    });
    const runAHtml = buildDeterministicWebsiteArtifacts({
      projectName: 'Insight Therapy',
      projectDescription: 'Public website',
      verified: runA,
    }).indexHtml;

    const runB = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Harbor City Hotel',
      projectPrompt: 'Services: Ubytovani, Wellness. Pricing: Od 3400 Kc / noc. Contact: reception@harborcity.example',
    });
    const runBHtml = buildDeterministicWebsiteArtifacts({
      projectName: 'Harbor City Hotel',
      projectDescription: 'Public website',
      verified: runB,
    }).indexHtml;

    const runC = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Northwind Legal Services',
      projectPrompt: 'Services: Pravni konzultace, Smluvni agenda. Contact: office@northwindlegal.example',
    });
    const runCHtml = buildDeterministicWebsiteArtifacts({
      projectName: 'Northwind Legal Services',
      projectDescription: 'Public website',
      verified: runC,
    }).indexHtml;

    expect(runAHtml.toLowerCase()).toContain('terapi');
    expect(runBHtml.toLowerCase()).not.toContain('terapi');
    expect(runCHtml.toLowerCase()).not.toContain('terapi');
    expect(runCHtml.toLowerCase()).not.toContain('wellness');
    expect(runCHtml).toContain('Northwind Legal Services');
  });

  it('isolates section schema per run and prevents personal-profile schema bleed into company sites', () => {
    const runA = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Personal Therapy Profile',
      projectPrompt: 'About: Poskytuji individualni podporu a vedu osobni konzultace. Services: Individualni konzultace.',
    });
    const runAHtml = buildDeterministicWebsiteArtifacts({
      projectName: 'Personal Therapy Profile',
      projectDescription: 'Public website',
      verified: runA,
    }).indexHtml;

    const runB = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Cityline Hotel',
      projectPrompt: 'Services: Ubytovani, Wellness, Snidane. Contact: reception@cityline.example',
    });
    const runBHtml = buildDeterministicWebsiteArtifacts({
      projectName: 'Cityline Hotel',
      projectDescription: 'Public website',
      verified: runB,
    }).indexHtml;

    expect(runAHtml).toContain('<h2>O mně</h2>');
    expect(runAHtml).toContain('<h2>Témata</h2>');
    expect(runAHtml).not.toContain('<h2>Přehled služeb</h2>');

    expect(runBHtml).toContain('<h2>O nás</h2>');
    expect(runBHtml).not.toContain('<h2>O mně</h2>');
    expect(runBHtml).not.toContain('<h2>Přístup a vzdělávání</h2>');
    expect(runBHtml).not.toContain('<h2>Témata</h2>');
  });

  it('keeps uncertain archetype output free of personal schema labels', () => {
    const uncertain = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Neutral Public Site',
      projectPrompt: 'Hero: Neutral Public Site\nContact: hello@neutral.example',
    });

    const html = buildDeterministicWebsiteArtifacts({
      projectName: 'Neutral Public Site',
      projectDescription: 'Public website',
      verified: uncertain,
    }).indexHtml;

    expect(html).toContain('<h2>Kontakt</h2>');
    expect(html).not.toContain('<h2>O mně</h2>');
    expect(html).not.toContain('<h2>Přístup a vzdělávání</h2>');
  });

  it('omits uncertain semantic slots instead of injecting foreign copy', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Minimal Service Site',
      projectPrompt: 'Hero: Minimal Service Site\nContact: hello@minimal.example',
    });

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Minimal Service Site',
      verified,
    });

    expect(sections.topics.items).toEqual([]);
    expect(sections.servicesPricing.services).toEqual([]);
    expect(sections.servicesPricing.pricing).toEqual([]);
    const combined = `${sections.about.body} ${sections.approach.body}`.toLowerCase().trim();
    expect(combined).toBe('');
    expect(combined).not.toContain('therapy');
    expect(combined).not.toContain('hotel');
  });

  it('retains company contact, address, and map facts when verified facts exist', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Grand River Hotel',
      projectPrompt: [
        'Hero: Grand River Hotel',
        'Services: Ubytovani, Wellness centrum, Snidane formou bufetu',
        'Pricing: Od 3900 Kc / noc',
        'Contact: reservations@grandriver.example, +420 777 333 222',
        'Address: Riverside 21, Brno 602 00',
        'CTA: Rezervovat pobyt',
      ].join('\n'),
    });

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Grand River Hotel',
      projectDescription: 'Public website',
      verified,
      language: 'cz',
    });

    expect(artifacts.indexHtml).toContain('reservations@grandriver.example');
    expect(artifacts.indexHtml).toContain('+420 777 333 222');
    expect(artifacts.indexHtml).toContain('Riverside 21, Brno 602 00');
    expect(artifacts.indexHtml).toContain('google.com/maps/search');
    expect(artifacts.indexHtml).toContain('Rezervovat pobyt');
  });

  it('filters noisy scrape fragments from public list items', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-noise',
        title: 'Noise source',
        source: 'project',
        pageTitle: 'Harbor Suites',
        summary: 'Structured source',
        extractedText: 'services and pricing',
        pages: [{ url: 'https://harbor.example', title: 'Home', summary: 'Home' }],
        structuredData: {
          sourceUrl: 'https://harbor.example',
          pageTitle: 'Harbor Suites',
          visibleTextBlocks: [
            'mailto:hello@harbor.example',
            'Praha 120 00',
            'Od 3500 Kc / noc',
            'Snídaně formou bufetu a wellness',
          ],
          headings: ['Home', 'Services'],
          paragraphs: ['Business hotel services pro kratkodobe i dlouhodobe pobyty.'],
          navigationLabels: ['Home', 'Services', 'Contact'],
          contactFields: {
            emails: ['hello@harbor.example'],
            phones: ['+420777123123'],
            addresses: ['Trida 4, Praha 120 00'],
            mailtoLinks: ['mailto:hello@harbor.example'],
            telLinks: ['tel:+420777123123'],
          },
          ctaTexts: ['Book now'],
          serviceNames: ['Wellness', 'mailto:hello@harbor.example', 'Praha 120 00'],
          pricingFields: ['Od 3500 Kc / noc'],
          extractedLinks: [],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Harbor Suites',
      verified,
      language: 'cz',
    });

    const topics = sections.topics.items.join(' ').toLowerCase();
    const services = sections.servicesPricing.services.join(' ').toLowerCase();
    expect(topics).not.toContain('mailto:');
    expect(topics).not.toContain('praha 120 00');
    expect(topics).not.toContain('3500');
    expect(services).not.toContain('mailto:');
    expect(services).not.toContain('praha 120 00');
  });

  it('keeps locale-consistent hero, cta and section content for target language', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Cityline Services',
      projectPrompt: [
        'Hero: Cityline Services',
        'About: Poskytujeme moderni servis pro firemni klienty.',
        'Services: Firemni podpora, Provozni servis',
        'CTA: Book now',
      ].join('\n'),
    });

    const sections = buildDeterministicWebsiteCopySections({
      projectName: 'Cityline Services',
      verified,
      language: 'cz',
    });

    expect(sections.hero.cta).toBe('Kontaktovat tym');
    expect(sections.about.body.toLowerCase()).not.toContain('book now');
    expect(sections.approach.body.toLowerCase()).not.toContain('book now');
  });

  it('keeps placeholders empty and uses verified facts when available', () => {
    const noFacts = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Empty Service Site',
      projectPrompt: 'Hero: Empty Service Site',
    });

    const withFacts = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Active Service Site',
      projectPrompt: [
        'Hero: Active Service Site',
        'About: Poskytujeme podporu pro provoz sluzeb a rezervaci.',
        'Services: Podpora rezervaci, Zakaznicky servis',
      ].join('\n'),
    });

    const noFactsSections = buildDeterministicWebsiteCopySections({
      projectName: 'Empty Service Site',
      verified: noFacts,
      language: 'cz',
    });
    const withFactsSections = buildDeterministicWebsiteCopySections({
      projectName: 'Active Service Site',
      verified: withFacts,
      language: 'cz',
    });

    expect(noFactsSections.about.body).toBe('');
    expect(withFactsSections.about.body.toLowerCase()).toContain('podpor');
    expect(withFactsSections.about.body.toLowerCase()).not.toContain('doplneny po overeni');
  });

  it('keeps single-language output language-consistent without mixed-locale leakage', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Run B Service Site',
      projectPrompt: [
        'Hero: Run B Service Site',
        'About: Poskytujeme podporu pro klientsky servis.',
        'Services: Klientsky servis, Rezervace',
        'CTA: Contact the team',
        'Contact: team@runb.example, +420 777 111 333',
      ].join('\n'),
    });

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Run B Service Site',
      projectDescription: 'Single-language task',
      verified,
      language: 'cz',
    });

    expect(artifacts.indexHtml.toLowerCase()).not.toContain('contact the team');
    expect(artifacts.indexHtml).toContain('Kontaktovat tym');
  });

  it('builds one locale-scoped model per locale with no cross-locale text leakage', () => {
    const verified = deriveVerifiedWebsiteContentFromPrompt({
      projectName: 'Multilingual Service Task',
      projectPrompt: [
        'Hero: Multilingual Service Task',
        'About: Poskytujeme servisni podporu pro provoz.',
        'Services: Provozni servis, Zakaznicky servis',
        'Pricing: Od 2500 Kc',
        'CTA: Contact the team',
        'Contact: info@multi.example',
      ].join('\n'),
    });

    const perLocaleSections = buildDeterministicWebsiteCopySectionsByLocale({
      projectName: 'Multilingual Service Task',
      verified,
      locales: ['cz', 'en'],
    });
    const perLocaleArtifacts = buildDeterministicWebsiteArtifactsByLocale({
      projectName: 'Multilingual Service Task',
      projectDescription: 'Multilingual task',
      verified,
      locales: ['cz', 'en'],
    });

    expect(perLocaleSections.cz.hero.cta).toBe('Kontaktovat tym');
    expect(perLocaleSections.en.hero.cta).toBe('Contact the team');
    expect(perLocaleArtifacts.cz.indexHtml).toContain('Kontaktovat tym');
    expect(perLocaleArtifacts.cz.indexHtml.toLowerCase()).not.toContain('contact the team');
    expect(perLocaleArtifacts.en.indexHtml).toContain('Contact the team');
    expect(perLocaleArtifacts.en.indexHtml).toContain('<html lang="en">');
  });

  it('diagnoses one failed run path and keeps corruption out after locale-filter stage', () => {
    const verified = deriveVerifiedWebsiteContent([
      {
        attachmentId: 'url-diagnostic-1',
        title: 'Source site',
        source: 'project',
        pageTitle: 'Unified Service Studio',
        summary: 'Structured source',
        extractedText: 'Poskytujeme provozni podporu. Individual sessions for enterprise teams.',
        pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
        structuredData: {
          sourceUrl: 'https://example.com',
          pageTitle: 'Unified Service Studio',
          visibleTextBlocks: [
            'Poskytujeme provozni podporu pro firemni klienty.',
            'Individual sessions for enterprise teams.',
          ],
          headings: ['Úvod', 'Services'],
          paragraphs: [
            'Poskytujeme provozni podporu pro firemni klienty.',
            'Individual sessions for enterprise teams.',
          ],
          navigationLabels: ['Home', 'Contact'],
          contactFields: {
            emails: ['hello@example.com'],
            phones: ['+420777888999'],
            addresses: ['Main Street 1, Prague'],
            mailtoLinks: ['mailto:hello@example.com'],
            telLinks: ['tel:+420777888999'],
          },
          ctaTexts: ['Contact us'],
          serviceNames: ['Provozni podpora', 'Individual sessions'],
          pricingFields: ['From 80 EUR'],
          extractedLinks: [{ href: 'https://example.com/services', label: 'Services', kind: 'http' }],
          missingFields: [],
          extractionWarnings: [],
        },
      },
    ] as never);

    const diagnostics = diagnoseDeterministicWebsiteRun({
      projectName: 'Unified Service Studio',
      projectDescription: 'Public website',
      verified,
      language: 'cz',
    });

    expect(
      diagnostics.rawExtractedSourceFacts.bodyTextBlocks.some((entry) =>
        entry.toLowerCase().includes('individual sessions for enterprise teams')
      )
    ).toBe(true);

    expect(
      diagnostics.localeFilteredFacts.bodyFacts.some((entry) =>
        entry.toLowerCase().includes('individual sessions for enterprise teams')
      )
    ).toBe(false);

    expect(
      diagnostics.normalizedContentModel.services.some((entry) =>
        entry.toLowerCase().includes('individual sessions')
      )
    ).toBe(false);

    expect(diagnostics.phaseIssues.localeFilteredFacts.mixedLanguageLeakage).toBe(false);
    expect(diagnostics.phaseIssues.normalizedWebsiteContentModel).toEqual({
      mixedLanguageLeakage: false,
      wrongSchemaOrArchetype: false,
      noisyFragmentInclusion: false,
      factLossToPlaceholder: false,
      crossSlotContamination: false,
    });
    expect(diagnostics.firstCorruptionPoint).toBeNull();
  });
});
