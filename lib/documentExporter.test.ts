import { describe, expect, it } from 'vitest';
import {
  buildDeterministicDocumentExecutionBundle,
  decodeBase64BundleFileContent,
  parseInvoiceSummaryResultFromArtifacts,
} from './documentExporter';
import * as XLSX from 'xlsx';

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

  it('builds generic requested table export with totals row', () => {
    const validated = JSON.stringify({
      rows: [
        {
          sourceFileName: 'invoice-1.pdf',
          variableSymbol: '2026001',
          amountInInvoiceCurrency: 1200,
          overpaymentInclVat: 200,
        },
        {
          sourceFileName: 'invoice-2.pdf',
          variableSymbol: '2026002',
          amountInInvoiceCurrency: 1800,
          overpaymentInclVat: 50,
        },
      ],
    });

    const exportBundle = buildDeterministicDocumentExecutionBundle({
      validatedRowsRaw: validated,
      summaryMetadataRaw: JSON.stringify({}),
      language: 'en',
      requestedOutputPrompt: `Create XLSX table from attached PDFs. Make 3 columns:
    - variable symbol
    - amount due incl. VAT
    - overpayment incl. VAT
    Add a total at the bottom.`,
    });

    const csv = exportBundle.bundle.files.find((file) => file.path === 'requested-table.csv')?.content ?? '';
    expect(csv.split('\n')[0]).toBe('Variabilni symbol,K uhrade s DPH,Preplatek s DPH');
    expect(csv).toContain('TOTAL,3000,250');

    const xlsxFile = exportBundle.bundle.files.find((file) => file.path === 'requested-table.xlsx');
    expect(xlsxFile).toBeTruthy();
    const workbook = XLSX.read(decodeBase64BundleFileContent(xlsxFile?.content ?? ''), { type: 'base64' });
    const sheet = workbook.Sheets.table_rows;
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    expect(matrix[0]).toEqual(['Variabilni symbol', 'K uhrade s DPH', 'Preplatek s DPH']);
    expect(matrix[matrix.length - 1]).toEqual(['TOTAL', 3000, 250]);
  });

  it('maps nested values rows into generic CSV/XLSX export', () => {
    const validated = JSON.stringify({
      rows: [
        {
          sourceAttachmentId: 'att-1',
          sourceTitle: 'invoice-1.pdf',
          values: {
            variableSymbol: '3001001',
            amountDueInclVat: 1200,
            overpaymentInclVat: 200,
            extractionStatus: 'ok',
          },
        },
        {
          sourceAttachmentId: 'att-2',
          sourceTitle: 'invoice-2.pdf',
          values: {
            variableSymbol: '3001002',
            amountDueInclVat: 1800,
            overpaymentInclVat: 50,
            extractionStatus: 'ok',
          },
        },
      ],
    });

    const exportBundle = buildDeterministicDocumentExecutionBundle({
      validatedRowsRaw: validated,
      summaryMetadataRaw: JSON.stringify({}),
      language: 'cz',
      requestedOutputPrompt:
        'Create XLSX from attached PDFs with 3 columns: variable symbol, amount due incl. VAT, overpayment incl. VAT, and total at the bottom',
    });

    const csv = exportBundle.bundle.files.find((file) => file.path === 'requested-table.csv')?.content ?? '';
    const rows = csv.split('\n');
    expect(rows[0]).toBe('Variabilni symbol,K uhrade s DPH,Preplatek s DPH');
    expect(rows[1]).toBe('3001001,1200,200');
    expect(rows[2]).toBe('3001002,1800,50');
    expect(rows[3]).toBe('TOTAL,3000,250');
  });
});
