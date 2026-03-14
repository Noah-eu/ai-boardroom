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
          pricingFields: ['From 1500 Kč / session'],
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
          title: 'Nova Hero Sekce',
          subtitle: 'Personalizovany uvodni text',
          cta: 'Objednat termin',
        },
        about: {
          body: 'Upraveny text O mne.',
        },
      },
      portraitImage: {
        src: 'assets/portrait.jpg',
        alt: 'Portrait',
      },
    });

    expect(artifacts.indexHtml).toContain('</html>');
    expect(artifacts.indexHtml).toContain('Hero');
    expect(artifacts.indexHtml).toContain('Nova Hero Sekce');
    expect(artifacts.indexHtml).toContain('Personalizovany uvodni text');
    expect(artifacts.indexHtml).toContain('Objednat termin');
    expect(artifacts.indexHtml).toContain('Upraveny text O mne.');
    expect(artifacts.indexHtml).toContain('O mne');
    expect(artifacts.indexHtml).toContain('Pristup a vzdelavani');
    expect(artifacts.indexHtml).toContain('Temata');
    expect(artifacts.indexHtml).toContain('Sluzby a ceny');
    expect(artifacts.indexHtml).toContain('Kontakt');
    expect(artifacts.indexHtml).toContain('Mapa');
    expect(artifacts.indexHtml).toContain('hello@example.com');
    expect(artifacts.indexHtml).toContain('Od 1500 Kc');
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
});
