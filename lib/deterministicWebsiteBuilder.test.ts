import { describe, expect, it } from 'vitest';
import {
  buildDeterministicWebsiteArtifacts,
  deriveVerifiedWebsiteContent,
  hasSufficientVerifiedWebsiteContent,
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

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Therapist web',
      projectDescription: 'Modern therapist website',
      verified,
    });

    expect(artifacts.indexHtml).toContain('</html>');
    expect(artifacts.indexHtml).toContain('hello@example.com');
    expect(artifacts.indexHtml).toContain('From 1500 Kč / session');
    expect(artifacts.stylesCss).toContain(':root');
    expect(artifacts.scriptJs).toContain('scrollIntoView');
  });

  it('flags insufficient verified content', () => {
    const verified = deriveVerifiedWebsiteContent([] as never);
    expect(hasSufficientVerifiedWebsiteContent(verified)).toBe(false);
  });
});
