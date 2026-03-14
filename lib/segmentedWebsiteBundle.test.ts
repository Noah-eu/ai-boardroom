import { describe, expect, it } from 'vitest';
import { buildDeterministicWebsiteArtifacts, deriveVerifiedWebsiteContent } from './deterministicWebsiteBuilder';
import { assembleSegmentedWebsiteSeedBundle } from './segmentedWebsiteBundle';

describe('segmentedWebsiteBundle integration', () => {
  const verified = deriveVerifiedWebsiteContent([
    {
      attachmentId: 'url-1',
      title: 'Source site',
      source: 'project',
      pageTitle: 'Terapeuticka praxe',
      summary: 'Structured source',
      extractedText: 'Kontakt hello@example.com. Cena od 1500 Kc.',
      pages: [{ url: 'https://example.com', title: 'Home', summary: 'Home summary' }],
      structuredData: {
        sourceUrl: 'https://example.com',
        pageTitle: 'Terapeuticka praxe',
        visibleTextBlocks: ['Podpora v narocnem obdobi', 'Od 1500 Kc'],
        headings: ['Podpora', 'Vztahy', 'Kontakt'],
        paragraphs: ['Individualni konzultace.'],
        navigationLabels: ['Domu', 'Sluzby', 'Kontakt'],
        contactFields: {
          emails: ['hello@example.com'],
          phones: ['+420777888999'],
          addresses: ['Ulice 12, Praha 2, 120 00'],
          mailtoLinks: ['mailto:hello@example.com'],
          telLinks: ['tel:+420777888999'],
        },
        ctaTexts: ['Domluvit konzultaci'],
        serviceNames: ['Individualni konzultace'],
        pricingFields: ['Od 1500 Kc / 50 min'],
        extractedLinks: [{ href: 'https://example.com/services', label: 'Services', kind: 'http' }],
        missingFields: [],
        extractionWarnings: [],
      },
    },
  ] as never);

  it('includes portrait asset in bundle and keeps public html sanitized', () => {
    const approvedPortraitInput = {
      sourceUrl: 'https://example.com/portrait.jpg',
      assetPath: 'assets/portrait.jpg',
      alt: 'Portrait',
    };

    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Terapeuticka praxe',
      projectDescription:
        'RAW PROMPT: Udelej web a vypis interni debug snapshot i missing fields report.',
      verified,
      portraitImage: {
        src: approvedPortraitInput.assetPath,
        alt: approvedPortraitInput.alt,
      },
    });

    const assembled = assembleSegmentedWebsiteSeedBundle({
      indexHtml: artifacts.indexHtml,
      stylesCss: artifacts.stylesCss,
      scriptJsRaw: artifacts.scriptJs,
      noScriptMarker: '__NO_SCRIPT__',
      sourceUrl: 'https://example.com',
      rawProjectPrompt:
        'RAW PROMPT: Udelej web a vypis interni debug snapshot i missing fields report.',
      portraitRequirement: {
        assetPath: approvedPortraitInput.assetPath,
        materializedFile: {
          path: approvedPortraitInput.assetPath,
          content: 'base64:ZmFrZS1pbWFnZS1ieXRlcw==',
        },
      },
    });

    expect(approvedPortraitInput.sourceUrl).toContain('portrait');
    expect(assembled.ok).toBe(true);

    if (!assembled.ok) {
      throw new Error('Expected assembled bundle to succeed');
    }

    const indexFile = assembled.bundle.files.find((file) => file.path === 'index.html');
    const portraitFile = assembled.bundle.files.find((file) => file.path.startsWith('assets/portrait.'));

    expect(indexFile?.content).toContain('assets/portrait.jpg');
    expect(indexFile?.content).toContain('Hero');
    expect(indexFile?.content).toContain('O mne');
    expect(indexFile?.content).toContain('Pristup a vzdelavani');
    expect(indexFile?.content).toContain('Temata');
    expect(indexFile?.content).toContain('Sluzby a ceny');
    expect(indexFile?.content).toContain('Kontakt');
    expect(indexFile?.content).toContain('Mapa');

    expect(indexFile?.content.toLowerCase()).not.toContain('verified source snapshot');
    expect(indexFile?.content.toLowerCase()).not.toContain('missing fields reported by ingestion');
    expect(indexFile?.content).not.toContain(
      'RAW PROMPT: Udelej web a vypis interni debug snapshot i missing fields report.'
    );

    expect(portraitFile).toBeDefined();
    expect(portraitFile?.content.startsWith('base64:')).toBe(true);
  });

  it('fails clearly when approved portrait exists but asset cannot be materialized', () => {
    const artifacts = buildDeterministicWebsiteArtifacts({
      projectName: 'Terapeuticka praxe',
      projectDescription: 'Public website',
      verified,
      portraitImage: {
        src: 'assets/portrait.jpg',
        alt: 'Portrait',
      },
    });

    const assembled = assembleSegmentedWebsiteSeedBundle({
      indexHtml: artifacts.indexHtml,
      stylesCss: artifacts.stylesCss,
      scriptJsRaw: artifacts.scriptJs,
      noScriptMarker: '__NO_SCRIPT__',
      sourceUrl: 'https://example.com',
      rawProjectPrompt: 'Public website',
      portraitRequirement: {
        assetPath: 'assets/portrait.jpg',
        materializedFile: null,
      },
    });

    expect(assembled.ok).toBe(false);
    if (assembled.ok) {
      throw new Error('Expected assembled bundle to fail');
    }
    expect(assembled.error).toContain('approved portrait image could not be materialized');
  });
});
