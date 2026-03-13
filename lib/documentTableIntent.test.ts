import { describe, expect, it } from 'vitest';
import { deriveDocumentTableIntent, resolveDocumentColumnValue } from './documentTableIntent';

describe('documentTableIntent Czech aliases', () => {
  it('maps prompt columns: variabilni symbol, k uhrade, preplatek', () => {
    const intent = deriveDocumentTableIntent(
      'Vytvor XLSX tabulku. Sloupce: variabilni symbol, k uhrade, preplatek. Dole soucet.'
    );

    expect(intent.mode).toBe('generic');
    expect(intent.includeTotalsRow).toBe(true);
    expect(intent.columns.map((column) => column.key)).toEqual([
      'variableSymbol',
      'amountDueInclVat',
      'overpaymentInclVat',
    ]);
    expect(intent.columns.map((column) => column.header)).toEqual([
      'Variabilni symbol',
      'K uhrade s DPH',
      'Preplatek s DPH',
    ]);
  });

  it('maps phrase castka k uhrade s DPH to amountDueInclVat', () => {
    const intent = deriveDocumentTableIntent(
      'Vytvor CSV se sloupci: castka k uhrade s dph, variabilni symbol.'
    );

    expect(intent.mode).toBe('generic');
    expect(intent.columns.map((column) => column.key)).toEqual([
      'amountDueInclVat',
      'variableSymbol',
    ]);
  });

  it('maps dluzna castka and VS aliases in bullet prompt', () => {
    const intent = deriveDocumentTableIntent(`Udelej tabulku:\n- dluzna castka\n- preplatek\n- VS`);

    expect(intent.mode).toBe('generic');
    expect(intent.columns.map((column) => column.key)).toEqual([
      'amountDueInclVat',
      'overpaymentInclVat',
      'variableSymbol',
    ]);
  });

  it('prefers amountInInvoiceCurrency over amountCzk for amountDueInclVat', () => {
    const intent = deriveDocumentTableIntent('Sloupce: castka k uhrade, variabilni symbol');
    const dueColumn = intent.columns.find((column) => column.key === 'amountDueInclVat');
    expect(dueColumn).toBeTruthy();

    const resolved = resolveDocumentColumnValue(
      {
        amountInInvoiceCurrency: 1234,
        amountCzk: 28000,
      },
      dueColumn!
    );

    // Ambiguity choice: generic due amount maps primarily to invoice-currency amount.
    expect(resolved).toBe(1234);
  });

  it('falls back to unknown column key when phrase is not recognized', () => {
    const intent = deriveDocumentTableIntent('Sloupce: castka idealni, variabilni symbol');
    expect(intent.columns.map((column) => column.key)).toEqual(['castkaIdealni', 'variableSymbol']);
  });

  it('ignores trailing total fragment in one-line prompt', () => {
    const intent = deriveDocumentTableIntent(
      'Create XLSX from attached PDFs with 3 columns: variable symbol, amount due incl. VAT, overpayment incl. VAT, and total at the bottom'
    );

    expect(intent.mode).toBe('generic');
    expect(intent.includeTotalsRow).toBe(true);
    expect(intent.columns.map((column) => column.key)).toEqual([
      'variableSymbol',
      'amountDueInclVat',
      'overpaymentInclVat',
    ]);
  });
});
