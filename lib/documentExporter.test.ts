import { describe, expect, it } from 'vitest';
import {
  buildDeterministicDocumentExecutionBundle,
  parseInvoiceSummaryResultFromArtifacts,
} from './documentExporter';

describe('documentExporter', () => {
  it('builds deterministic export bundle from Booking-like validated rows', () => {
    const validated = JSON.stringify({
      rows: [
        {
          sourceFileName: 'booking-a.pdf',
          invoiceNumber: 'INV-001',
          issueDate: '2026-01-02',
          billingPeriod: '2025-12',
          dueDate: '2026-01-15',
          accommodationId: 'A-1',
          currency: 'EUR',
          amountInInvoiceCurrency: 120.5,
          amountCzk: 3012.45,
          commission: 10.5,
          paymentServiceFee: 1.2,
          roomSales: 130,
          variableSymbol: '2026001',
        },
        {
          sourceFileName: 'booking-b.pdf',
          invoiceNumber: 'INV-002',
          issueDate: '2026-01-05',
          billingPeriod: '2025-12',
          dueDate: '2026-01-20',
          accommodationId: 'A-2',
          currency: 'EUR',
          amountInInvoiceCurrency: -20,
          amountCzk: -500,
          commission: 0,
          paymentServiceFee: 0,
          roomSales: 0,
          variableSymbol: '2026002',
        },
      ],
    });

    const summary = JSON.stringify({
      filesProcessed: ['booking-a.pdf', 'booking-b.pdf'],
      warnings: ['contains manual corrections'],
    });

    const exportBundle = buildDeterministicDocumentExecutionBundle({
      validatedRowsRaw: validated,
      summaryMetadataRaw: summary,
      language: 'en',
    });

    expect(exportBundle.invoiceSummary.summary.invoiceCount).toBe(2);
    expect(exportBundle.bundle.files.some((file) => file.path === 'invoice-summary.csv')).toBe(true);
    expect(exportBundle.bundle.files.some((file) => file.path === 'invoice-summary.xlsx')).toBe(true);
    expect(exportBundle.bundle.files.some((file) => file.path === 'index.html')).toBe(true);
    expect(exportBundle.bundle.summary).toContain('Deterministic export bundle generated');
  });

  it('handles generic PDF rows with missing optional fields', () => {
    const validated = JSON.stringify({
      rows: [
        {
          sourceFileName: 'generic-invoice.pdf',
          invoiceNumber: 'GEN-001',
          issueDate: '2026-02-10',
          currency: 'CZK',
          amountInInvoiceCurrency: 900,
          variableSymbol: '9001',
          extractionWarning: 'supplierVatId missing',
          qualityFlags: ['missing_supplier_vat'],
        },
      ],
    });

    const parsed = parseInvoiceSummaryResultFromArtifacts(validated, JSON.stringify({}));

    expect(parsed.result.rows).toHaveLength(1);
    expect(parsed.result.summary.invoiceCount).toBe(1);
    expect(parsed.result.summary.warnings.some((entry) => entry.includes('supplierVatId missing'))).toBe(true);
  });

  it('creates readable fallback bundle when validated rows are empty', () => {
    const exportBundle = buildDeterministicDocumentExecutionBundle({
      validatedRowsRaw: JSON.stringify({ rows: [] }),
      summaryMetadataRaw: JSON.stringify({ warnings: ['upstream empty dataset'] }),
      language: 'en',
    });

    expect(exportBundle.invoiceSummary.summary.invoiceCount).toBe(0);
    expect(exportBundle.bundle.notes.join(' ')).toContain('fallback');
    const html = exportBundle.bundle.files.find((file) => file.path === 'index.html')?.content ?? '';
    expect(html).toContain('No rows available');
  });
});
