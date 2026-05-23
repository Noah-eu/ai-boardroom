import { describe, expect, it } from 'vitest';
import { buildStructuredUrlSnapshot, extractPageSnapshot } from '../../../../lib/urlStructuredSnapshot';

describe('URL ingestion structured snapshot', () => {
  it('extracts contact, pricing, links, and navigation from visible page content', () => {
    const html = `
      <html>
        <head><title>Therapist Studio Prague</title></head>
        <body>
          <header>
            <nav>
              <a href="/">Home</a>
              <a href="/services">Services</a>
              <a href="#contact">Contact</a>
            </nav>
          </header>
          <main>
            <section>
              <h1>Holistic Therapy</h1>
              <p>Individual therapy for adults and couples.</p>
              <a href="mailto:hello@therapist.example">Email us</a>
              <a href="tel:+420777888999">Call now</a>
            </section>
            <section id="services">
              <h2>Services</h2>
              <p>Anxiety support session</p>
              <p>Relationship counseling package</p>
            </section>
            <section id="pricing">
              <h2>Pricing</h2>
              <p>From 1 500 Kč / session</p>
            </section>
            <section id="contact">
              <h2>Contact</h2>
              <p>Therapist Studio, Ulice 12, Praha 2, 120 00</p>
              <button>Book appointment</button>
            </section>
          </main>
        </body>
      </html>
    `;

    const page = extractPageSnapshot(html, 'https://therapist.example', 0);
    const structured = buildStructuredUrlSnapshot('https://therapist.example', [page]);

    expect(structured.pageTitle).toContain('Therapist Studio Prague');
    expect(structured.navigationLabels).toContain('Home');
    expect(structured.navigationLabels).toContain('Services');
    expect(structured.contactFields.emails).toContain('hello@therapist.example');
    expect(structured.contactFields.phones.some((value) => value.includes('+420777888999'))).toBe(true);
    expect(structured.contactFields.addresses.length).toBeGreaterThan(0);
    expect(structured.pricingFields.some((value) => value.toLowerCase().includes('kč'))).toBe(true);
    expect(structured.ctaTexts.some((value) => /book/i.test(value))).toBe(true);
    expect(structured.missingFields).not.toContain('email');
    expect(structured.missingFields).not.toContain('phone');
  });

  it('marks missing fields explicitly instead of fabricating them', () => {
    const html = `
      <html>
        <head><title>Minimal Page</title></head>
        <body>
          <h1>Simple profile</h1>
          <p>This page intentionally has no explicit contact or pricing details.</p>
        </body>
      </html>
    `;

    const page = extractPageSnapshot(html, 'https://minimal.example', 0);
    const structured = buildStructuredUrlSnapshot('https://minimal.example', [page]);

    expect(structured.contactFields.emails.length).toBe(0);
    expect(structured.contactFields.phones.length).toBe(0);
    expect(structured.pricingFields.length).toBe(0);
    expect(structured.missingFields).toContain('email');
    expect(structured.missingFields).toContain('phone');
    expect(structured.missingFields).toContain('pricing');
  });
});
