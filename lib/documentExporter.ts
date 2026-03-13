import * as XLSX from 'xlsx';
import {
  AppLanguage,
  ExecutionOutputBundle,
  InvoiceAmountType,
  InvoiceSummaryResult,
  InvoiceSummaryRow,
} from '@/types';
import {
  deriveDocumentTableIntent,
  resolveDocumentColumnValue,
  type DocumentTableColumnSpec,
} from './documentTableIntent';

type JsonRecord = Record<string, unknown>;

const XLSX_BASE64_PREFIX = 'base64:';

type GenericTableRow = Record<string, string | number | null>;

const INVOICE_EXPORT_COLUMNS: Array<{ key: keyof InvoiceSummaryRow; header: string }> = [
  { key: 'sourceFileName', header: 'sourceFileName' },
  { key: 'invoiceNumber', header: 'invoiceNumber' },
  { key: 'accommodationId', header: 'accommodationId' },
  { key: 'currency', header: 'currency' },
  { key: 'amountInInvoiceCurrency', header: 'amountInInvoiceCurrency' },
  { key: 'amountCzk', header: 'amountCzk' },
  { key: 'commission', header: 'commission' },
  { key: 'paymentServiceFee', header: 'paymentServiceFee' },
  { key: 'roomSales', header: 'roomSales' },
  { key: 'supplierVatId', header: 'supplierVatId' },
  { key: 'customerVatId', header: 'customerVatId' },
  { key: 'variableSymbol', header: 'variableSymbol' },
  { key: 'amount', header: 'amount' },
  { key: 'amountType', header: 'amountType' },
  { key: 'normalizedSign', header: 'normalizedSign' },
  { key: 'billingPeriod', header: 'billingPeriod' },
  { key: 'issueDate', header: 'issueDate' },
  { key: 'dueDate', header: 'dueDate' },
  { key: 'supplierName', header: 'supplierName' },
  { key: 'supplyPoint', header: 'supplyPoint' },
  { key: 'note', header: 'note' },
  { key: 'extractionWarning', header: 'extractionWarning' },
  { key: 'confidence', header: 'confidence' },
];

function toRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9+\-.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAmountType(value: unknown): InvoiceAmountType {
  const raw = toStringOrNull(value)?.toLowerCase() ?? '';
  if (!raw) return 'unknown';
  if (raw.includes('overpayment') || raw.includes('preplatek') || raw.includes('přeplatek')) return 'overpayment';
  if (raw.includes('underpayment') || raw.includes('nedoplatek')) return 'underpayment';
  return 'unknown';
}

function normalizeSign(value: unknown): -1 | 0 | 1 | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0) return 1;
    if (value < 0) return -1;
    return 0;
  }

  const normalized = toStringOrNull(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  if (['1', '+1', 'plus', 'positive', 'credit'].includes(normalized)) return 1;
  if (['-1', 'minus', 'negative', 'debit'].includes(normalized)) return -1;
  if (['0', 'zero', 'neutral'].includes(normalized)) return 0;
  return null;
}

function normalizeAmountContext(row: JsonRecord): {
  amount: number | null;
  amountType: InvoiceAmountType;
  normalizedSign: -1 | 0 | 1 | null;
} {
  const amountRaw =
    row.amountInInvoiceCurrency ??
    row.amount ??
    row.total ??
    row.balance ??
    row.paymentAmount ??
    row.value ??
    row.valueCzk ??
    null;

  const amount = toNumberOrNull(amountRaw);
  const explicitType = normalizeAmountType(row.amountType ?? row.type);
  const explicitSign = normalizeSign(row.normalizedSign ?? row.sign);

  let inferredType: InvoiceAmountType = explicitType;
  let inferredSign: -1 | 0 | 1 | null = explicitSign;

  if (!inferredSign && amount !== null) {
    if (amount > 0) inferredSign = 1;
    if (amount < 0) inferredSign = -1;
    if (amount === 0) inferredSign = 0;
  }

  if (inferredType === 'unknown' && inferredSign !== null) {
    if (inferredSign > 0) inferredType = 'overpayment';
    if (inferredSign < 0) inferredType = 'underpayment';
  }

  return {
    amount,
    amountType: inferredType,
    normalizedSign: inferredSign,
  };
}

function parseJsonCandidate(raw: string | null | undefined): unknown | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function extractInvoiceRows(root: JsonRecord): InvoiceSummaryRow[] {
  const rowCandidate = [root.rows, root.invoices, root.records, root.items].find((value) => Array.isArray(value));
  if (!Array.isArray(rowCandidate)) return [];

  return rowCandidate
    .map((entry) => toRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((row) => {
      const amountContext = normalizeAmountContext(row);
      return {
        sourceFileName:
          toStringOrNull(row.sourceFileName) ?? toStringOrNull(row.sourceTitle) ?? toStringOrNull(row.fileName),
        invoiceNumber:
          toStringOrNull(row.invoiceNumber) ?? toStringOrNull(row.documentNumber) ?? toStringOrNull(row.number),
        accommodationId:
          toStringOrNull(row.accommodationId) ??
          toStringOrNull(row.propertyId) ??
          toStringOrNull(row.identificationNumber),
        currency: toStringOrNull(row.currency),
        amountInInvoiceCurrency:
          toNumberOrNull(row.amountInInvoiceCurrency) ??
          toNumberOrNull(row.totalPayableAmountInInvoiceCurrency) ??
          toNumberOrNull(row.totalPayable),
        amountCzk: toNumberOrNull(row.amountCzk) ?? toNumberOrNull(row.totalPayableAmountCzk),
        commission: toNumberOrNull(row.commission),
        paymentServiceFee:
          toNumberOrNull(row.paymentServiceFee) ?? toNumberOrNull(row.paymentFee),
        roomSales: toNumberOrNull(row.roomSales),
        supplierVatId:
          toStringOrNull(row.supplierVatId) ?? toStringOrNull(row.supplierVat) ?? toStringOrNull(row.vendorVatId),
        customerVatId:
          toStringOrNull(row.customerVatId) ?? toStringOrNull(row.buyerVatId) ?? toStringOrNull(row.vatId),
        variableSymbol:
          toStringOrNull(row.variableSymbol) ??
          toStringOrNull(row.varSymbol) ??
          toStringOrNull(row.vs) ??
          toStringOrNull(row.variable),
        amount: amountContext.amount,
        amountType: amountContext.amountType,
        normalizedSign: amountContext.normalizedSign,
        billingPeriod: toStringOrNull(row.billingPeriod) ?? toStringOrNull(row.period),
        issueDate: toStringOrNull(row.issueDate) ?? toStringOrNull(row.dateIssued),
        dueDate: toStringOrNull(row.dueDate) ?? toStringOrNull(row.maturityDate),
        supplierName: toStringOrNull(row.supplierName) ?? toStringOrNull(row.supplier) ?? toStringOrNull(row.vendor),
        supplyPoint: toStringOrNull(row.supplyPoint) ?? toStringOrNull(row.address) ?? toStringOrNull(row.deliveryPoint),
        note: toStringOrNull(row.note),
        extractionWarning: toStringOrNull(row.extractionWarning) ?? toStringOrNull(row.warning),
        confidence: toNumberOrNull(row.confidence ?? row.score),
      };
    });
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toStringOrNull(entry)).filter((entry): entry is string => Boolean(entry));
}

function extractFileList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  value.forEach((entry) => {
    if (typeof entry === 'string' && entry.trim()) {
      list.push(entry.trim());
      return;
    }
    const record = toRecord(entry);
    if (!record) return;
    const fileName =
      toStringOrNull(record.fileName) ??
      toStringOrNull(record.sourceFileName) ??
      toStringOrNull(record.sourceTitle) ??
      toStringOrNull(record.title);
    if (fileName) list.push(fileName);
  });
  return list;
}

function inferVatNote(root: JsonRecord, rows: InvoiceSummaryRow[]): string | null {
  const direct = toStringOrNull(root.vatNote) ?? toStringOrNull(toRecord(root.summary)?.vatNote);
  if (direct) return direct;
  const vatRow = rows.find((row) => /\b(vat|dph)\b/i.test(`${row.note ?? ''} ${row.extractionWarning ?? ''}`));
  return vatRow?.note ?? vatRow?.extractionWarning ?? null;
}

function summarizeRows(rows: InvoiceSummaryRow[], summaryRoot: JsonRecord): InvoiceSummaryResult['summary'] {
  const variableSymbols = rows
    .map((row) => row.variableSymbol)
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());

  const symbolFrequency = variableSymbols.reduce<Record<string, number>>((acc, symbol) => {
    acc[symbol] = (acc[symbol] ?? 0) + 1;
    return acc;
  }, {});

  const duplicateVariableSymbols = Object.keys(symbolFrequency).filter((symbol) => symbolFrequency[symbol] > 1);

  const totalOverpayment = rows.reduce((acc, row) => {
    if (row.amount === null) return acc;
    const isOver = row.amountType === 'overpayment' || row.normalizedSign === 1;
    return isOver ? acc + Math.abs(row.amount) : acc;
  }, 0);

  const totalUnderpayment = rows.reduce((acc, row) => {
    if (row.amount === null) return acc;
    const isUnder = row.amountType === 'underpayment' || row.normalizedSign === -1;
    return isUnder ? acc + Math.abs(row.amount) : acc;
  }, 0);

  const netTotal = rows.reduce((acc, row) => {
    if (row.amount === null) return acc;
    const sign = row.normalizedSign ?? (row.amount > 0 ? 1 : row.amount < 0 ? -1 : 0);
    return acc + Math.abs(row.amount) * sign;
  }, 0);

  const rowWarnings = rows
    .map((row) => row.extractionWarning)
    .filter((warning): warning is string => Boolean(warning));

  const warnings = Array.from(new Set([...extractStringArray(summaryRoot.warnings), ...rowWarnings]));
  if (rows.length === 0) {
    warnings.push('No validated rows available for export. Bundle was generated with an empty dataset.');
  }

  const filesProcessed = Array.from(
    new Set([
      ...extractFileList(summaryRoot.filesProcessed),
      ...rows
        .map((row) => row.sourceFileName)
        .filter((fileName): fileName is string => Boolean(fileName)),
    ])
  );

  return {
    invoiceCount: rows.length,
    uniqueVariableSymbolCount: new Set(variableSymbols).size,
    duplicateVariableSymbolCount: duplicateVariableSymbols.length,
    totalOverpayment,
    totalUnderpayment,
    netTotal,
    vatNote: inferVatNote(summaryRoot, rows),
    warnings,
    duplicateVariableSymbols,
    filesProcessed,
    filesFailed: extractFileList(summaryRoot.filesFailed),
  };
}

function toCsvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[,"\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function extractGenericRows(root: JsonRecord): JsonRecord[] {
  const rowCandidate = [root.rows, root.invoices, root.records, root.items].find((value) => Array.isArray(value));
  if (!Array.isArray(rowCandidate)) return [];
  return rowCandidate
    .map((entry) => toRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((row) => {
      const nestedValues = toRecord(row.values);
      if (!nestedValues) return row;
      return {
        ...nestedValues,
        sourceAttachmentId: toStringOrNull(row.sourceAttachmentId) ?? toStringOrNull(nestedValues.sourceAttachmentId),
        sourceTitle: toStringOrNull(row.sourceTitle) ?? toStringOrNull(nestedValues.sourceTitle),
        sourceFileName:
          toStringOrNull(nestedValues.sourceFileName) ??
          toStringOrNull(row.sourceTitle) ??
          toStringOrNull(row.sourceFileName),
      };
    });
}

function buildGenericTableRows(sourceRows: JsonRecord[], columns: DocumentTableColumnSpec[]): GenericTableRow[] {
  return sourceRows.map((row) => {
    const record: GenericTableRow = {};
    columns.forEach((column) => {
      record[column.header] = resolveDocumentColumnValue(row, column);
    });
    return record;
  });
}

function buildGenericTotalsRow(columns: DocumentTableColumnSpec[], rows: GenericTableRow[]): GenericTableRow {
  const totals: GenericTableRow = {};
  columns.forEach((column, index) => {
    if (index === 0) {
      totals[column.header] = 'TOTAL';
      return;
    }

    if (!column.numeric) {
      totals[column.header] = null;
      return;
    }

    const sum = rows.reduce((acc, row) => {
      const value = row[column.header];
      if (typeof value !== 'number' || !Number.isFinite(value)) return acc;
      return acc + value;
    }, 0);
    totals[column.header] = sum;
  });
  return totals;
}

function buildGenericRowsCsv(columns: DocumentTableColumnSpec[], rows: GenericTableRow[], includeTotalsRow: boolean): string {
  const headers = columns.map((column) => column.header).join(',');
  const dataRows = includeTotalsRow ? [...rows, buildGenericTotalsRow(columns, rows)] : rows;
  const lines = dataRows.map((row) =>
    columns
      .map((column) => {
        const value = row[column.header] ?? null;
        return toCsvCell(typeof value === 'number' || typeof value === 'string' ? value : null);
      })
      .join(',')
  );
  return [headers, ...lines].join('\n');
}

function buildGenericXlsxBase64(columns: DocumentTableColumnSpec[], rows: GenericTableRow[], includeTotalsRow: boolean): string {
  const dataRows = includeTotalsRow ? [...rows, buildGenericTotalsRow(columns, rows)] : rows;
  const workbook = XLSX.utils.book_new();
  const rowsSheet = XLSX.utils.json_to_sheet(dataRows, {
    header: columns.map((column) => column.header),
  });
  XLSX.utils.book_append_sheet(workbook, rowsSheet, 'table_rows');
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

function buildGenericIndexHtml(
  columns: DocumentTableColumnSpec[],
  rows: GenericTableRow[],
  includeTotalsRow: boolean,
  language: AppLanguage
): string {
  const title = language === 'cz' ? 'Vlastni tabulkovy export' : 'Custom table export';
  const renderedRows = includeTotalsRow ? [...rows, buildGenericTotalsRow(columns, rows)] : rows;
  const bodyRows = renderedRows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${escapeHtml(String(row[column.header] ?? ''))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const headCells = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    '    body { font-family: "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }',
    '    table { width: 100%; border-collapse: collapse; font-size: 13px; }',
    '    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }',
    '    th { background: #f1f5f9; }',
    '  </style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(title)}</h1>`,
    '  <table>',
    `    <thead><tr>${headCells}</tr></thead>`,
    `    <tbody>${bodyRows || `<tr><td colspan="${columns.length}">No rows available.</td></tr>`}</tbody>`,
    '  </table>',
    '</body>',
    '</html>',
  ].join('\n');
}

export function buildInvoiceRowsCsv(result: InvoiceSummaryResult): string {
  const headers = INVOICE_EXPORT_COLUMNS.map((column) => column.header).join(',');
  const lines = result.rows.map((row) =>
    INVOICE_EXPORT_COLUMNS.map((column) => {
      const value = row[column.key];
      if (
        column.key === 'amount' ||
        column.key === 'amountInInvoiceCurrency' ||
        column.key === 'amountCzk' ||
        column.key === 'commission' ||
        column.key === 'paymentServiceFee' ||
        column.key === 'roomSales' ||
        column.key === 'confidence'
      ) {
        return toCsvCell(typeof value === 'number' ? value : null);
      }
      if (column.key === 'normalizedSign') {
        return toCsvCell(typeof value === 'number' ? value : null);
      }
      return toCsvCell(typeof value === 'string' ? value : null);
    }).join(',')
  );
  return [headers, ...lines].join('\n');
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildIndexHtml(result: InvoiceSummaryResult, language: AppLanguage): string {
  const title = language === 'cz' ? 'Export faktur - deterministic bundle' : 'Invoice export - deterministic bundle';
  const warningItems = result.summary.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join('');
  const rowItems = result.rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.sourceFileName ?? '-')}</td><td>${escapeHtml(row.invoiceNumber ?? '-')}</td><td>${escapeHtml(
          row.variableSymbol ?? '-'
        )}</td><td>${escapeHtml(row.currency ?? '-')}</td><td>${
          typeof row.amountInInvoiceCurrency === 'number' ? formatNumber(row.amountInInvoiceCurrency) : '-'
        }</td><td>${typeof row.amountCzk === 'number' ? formatNumber(row.amountCzk) : '-'}</td><td>${escapeHtml(
          row.issueDate ?? '-'
        )}</td><td>${escapeHtml(row.dueDate ?? '-')}</td><td>${escapeHtml(
          row.extractionWarning ?? row.note ?? '-'
        )}</td></tr>`
    )
    .join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    '    body { font-family: "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }',
    '    h1 { margin: 0 0 16px; }',
    '    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }',
    '    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #f8fafc; }',
    '    table { width: 100%; border-collapse: collapse; font-size: 13px; }',
    '    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }',
    '    th { background: #f1f5f9; }',
    '    .warn { margin-top: 16px; padding: 10px 12px; border: 1px solid #f59e0b; background: #fffbeb; border-radius: 8px; }',
    '  </style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(title)}</h1>`,
    '  <div class="grid">',
    `    <div class="card"><strong>Invoices</strong><div>${result.summary.invoiceCount}</div></div>`,
    `    <div class="card"><strong>Total overpayment</strong><div>${formatNumber(result.summary.totalOverpayment)}</div></div>`,
    `    <div class="card"><strong>Total underpayment</strong><div>${formatNumber(result.summary.totalUnderpayment)}</div></div>`,
    `    <div class="card"><strong>Net total</strong><div>${formatNumber(result.summary.netTotal)}</div></div>`,
    '  </div>',
    '  <table>',
    '    <thead><tr><th>Source</th><th>Invoice</th><th>Variable symbol</th><th>Currency</th><th>Amount (inv)</th><th>Amount (CZK)</th><th>Issue date</th><th>Due date</th><th>Warning/Note</th></tr></thead>',
    `    <tbody>${rowItems || '<tr><td colspan="9">No rows available.</td></tr>'}</tbody>`,
    '  </table>',
    warningItems
      ? `  <div class="warn"><strong>Warnings</strong><ul>${warningItems}</ul></div>`
      : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInvoiceXlsxBase64(result: InvoiceSummaryResult): string {
  const rowRecords = result.rows.map((row) => {
    const output: Record<string, string | number | null> = {};
    INVOICE_EXPORT_COLUMNS.forEach(({ key, header }) => {
      output[header] = row[key] as string | number | null;
    });
    return output;
  });

  const summaryRows: Array<{ key: string; value: string | number | null }> = [
    { key: 'invoiceCount', value: result.summary.invoiceCount },
    { key: 'uniqueVariableSymbolCount', value: result.summary.uniqueVariableSymbolCount },
    { key: 'duplicateVariableSymbolCount', value: result.summary.duplicateVariableSymbolCount },
    { key: 'totalOverpayment', value: result.summary.totalOverpayment },
    { key: 'totalUnderpayment', value: result.summary.totalUnderpayment },
    { key: 'netTotal', value: result.summary.netTotal },
    { key: 'vatNote', value: result.summary.vatNote },
    { key: 'warnings', value: result.summary.warnings.join('; ') },
    { key: 'duplicateVariableSymbols', value: result.summary.duplicateVariableSymbols.join('; ') },
    { key: 'filesProcessed', value: result.summary.filesProcessed.join('; ') },
    { key: 'filesFailed', value: result.summary.filesFailed.join('; ') },
  ];

  const workbook = XLSX.utils.book_new();
  const rowsSheet = XLSX.utils.json_to_sheet(rowRecords);
  XLSX.utils.book_append_sheet(workbook, rowsSheet, 'invoice_rows');

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'summary');

  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

export function isBase64EncodedBundleFileContent(filePath: string, content: string): boolean {
  return filePath.toLowerCase().endsWith('.xlsx') && content.startsWith(XLSX_BASE64_PREFIX);
}

export function decodeBase64BundleFileContent(content: string): string {
  return content.slice(XLSX_BASE64_PREFIX.length);
}

export function parseInvoiceSummaryResultFromArtifacts(
  validatedRowsRaw: string | null | undefined,
  summaryMetadataRaw: string | null | undefined
): {
  result: InvoiceSummaryResult;
  validatedRoot: JsonRecord;
  summaryRoot: JsonRecord;
} {
  const validatedParsed = parseJsonCandidate(validatedRowsRaw);
  const summaryParsed = parseJsonCandidate(summaryMetadataRaw);

  const validatedRoot = toRecord(validatedParsed) ?? { rows: [] };
  const summaryRoot = toRecord(summaryParsed) ?? {};

  const rows = extractInvoiceRows(validatedRoot);
  const summary = summarizeRows(rows, summaryRoot);

  return {
    result: {
      rows,
      summary,
    },
    validatedRoot,
    summaryRoot,
  };
}

export function buildDeterministicDocumentExecutionBundle(params: {
  validatedRowsRaw: string | null | undefined;
  summaryMetadataRaw: string | null | undefined;
  language: AppLanguage;
  requestedOutputPrompt?: string | null;
}): {
  bundle: ExecutionOutputBundle;
  invoiceSummary: InvoiceSummaryResult;
} {
  const exportIntent = deriveDocumentTableIntent(params.requestedOutputPrompt, { defaultMode: 'booking' });

  if (exportIntent.mode === 'generic' && exportIntent.columns.length > 0) {
    const validatedParsed = parseJsonCandidate(params.validatedRowsRaw);
    const validatedRoot = toRecord(validatedParsed) ?? { rows: [] };
    const sourceRows = extractGenericRows(validatedRoot);
    const genericRows = buildGenericTableRows(sourceRows, exportIntent.columns);
    const csv = buildGenericRowsCsv(exportIntent.columns, genericRows, exportIntent.includeTotalsRow);
    const xlsxBase64 = buildGenericXlsxBase64(exportIntent.columns, genericRows, exportIntent.includeTotalsRow);
    const indexHtml = buildGenericIndexHtml(
      exportIntent.columns,
      genericRows,
      exportIntent.includeTotalsRow,
      params.language
    );
    const summaryPayload = {
      invoiceCount: genericRows.length,
      uniqueVariableSymbolCount: 0,
      duplicateVariableSymbolCount: 0,
      totalOverpayment: 0,
      totalUnderpayment: 0,
      netTotal: 0,
      vatNote: null,
      warnings: [],
      duplicateVariableSymbols: [],
      filesProcessed: sourceRows
        .map((row) => toStringOrNull(row.sourceFileName) ?? toStringOrNull(row.sourceTitle))
        .filter((value): value is string => Boolean(value)),
      filesFailed: [],
    };

    const bundle: ExecutionOutputBundle = {
      status: 'success',
      summary:
        `Deterministic custom table export generated (${genericRows.length} row(s), ` +
        `${exportIntent.columns.length} column(s)${exportIntent.includeTotalsRow ? ', totals row included' : ''}).`,
      files: [
        { path: 'index.html', content: indexHtml },
        { path: 'requested-table.csv', content: csv },
        { path: 'requested-table.xlsx', content: `${XLSX_BASE64_PREFIX}${xlsxBase64}` },
        { path: 'validated-rows.json', content: JSON.stringify(validatedRoot, null, 2) },
        { path: 'summary-metadata.json', content: JSON.stringify(summaryPayload, null, 2) },
      ],
      notes: ['Exporter bundle generated deterministically from structured artifacts only.'],
      removePaths: [],
    };

    return {
      bundle,
      invoiceSummary: {
        rows: [],
        summary: summaryPayload,
      },
    };
  }

  const parsed = parseInvoiceSummaryResultFromArtifacts(params.validatedRowsRaw, params.summaryMetadataRaw);
  const summaryPayload = parsed.result.summary;

  const summaryJson = JSON.stringify(summaryPayload, null, 2);
  const validatedJson = JSON.stringify(parsed.validatedRoot, null, 2);
  const csv = buildInvoiceRowsCsv(parsed.result);
  const xlsxBase64 = buildInvoiceXlsxBase64(parsed.result);
  const indexHtml = buildIndexHtml(parsed.result, params.language);

  const bundle: ExecutionOutputBundle = {
    status: 'success',
    summary:
      parsed.result.rows.length > 0
        ? `Deterministic export bundle generated from validated rows (${parsed.result.rows.length} rows).`
        : 'Deterministic export bundle generated with empty validated rows (fallback mode).',
    files: [
      { path: 'index.html', content: indexHtml },
      { path: 'invoice-summary.csv', content: csv },
      { path: 'invoice-summary.xlsx', content: `${XLSX_BASE64_PREFIX}${xlsxBase64}` },
      { path: 'validated-rows.json', content: validatedJson },
      { path: 'summary-metadata.json', content: summaryJson },
    ],
    notes: parsed.result.rows.length > 0
      ? ['Exporter bundle generated deterministically from structured artifacts only.']
      : [
          'Exporter bundle generated deterministically from structured artifacts only.',
          'No validated rows were available. Produced readable fallback files instead of failing.',
        ],
    removePaths: [],
  };

  return {
    bundle,
    invoiceSummary: parsed.result,
  };
}
