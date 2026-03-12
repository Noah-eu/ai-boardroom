'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/context/AppContext';
import { translate, translateWithVars } from '@/i18n';
import {
  ExecutionOutputBundle,
  ExecutionOutputFile,
  InvoiceAmountType,
  InvoiceSummaryResult,
  InvoiceSummaryRow,
  ProjectAttachment,
  Task,
  TaskArtifact,
  TaskStatus,
} from '@/types';

const DEFAULT_EXECUTION_TASK_TIMEOUT_MS = 90_000;

function resolveExecutionTaskTimeoutMs(): number {
  const raw = Number(process.env.NEXT_PUBLIC_EXECUTION_TASK_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_EXECUTION_TASK_TIMEOUT_MS;
  return Math.max(60_000, Math.min(120_000, Math.floor(raw)));
}

function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatAttachmentSize(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownArtifact(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function extractMarkdownSection(markdown: string, headingAliases: string[]): string {
  const lines = markdown.split('\n');
  const normalizedAliases = headingAliases.map((alias) => alias.toLowerCase());
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#')) continue;
    const title = line.replace(/^#+\s*/, '').trim().toLowerCase();
    if (normalizedAliases.includes(title)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';

  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith('#')) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function buildExecutionCompletionStatus(tasks: Task[]): 'completed' | 'completed_with_fallback' | 'failed' | 'in_progress' {
  if (tasks.some((task) => task.status === 'failed' || task.status === 'canceled_due_to_failed_dependency')) {
    return 'failed';
  }
  const hasActive = tasks.some((task) => ['queued', 'blocked', 'running'].includes(task.status));
  if (hasActive) return 'in_progress';
  if (tasks.some((task) => task.status === 'completed_with_fallback')) return 'completed_with_fallback';
  return 'completed';
}

function buildArtifactFallbackPreview(
  artifact: { path: string; label: string; kind: string },
  task?: Task | null
): string {
  const source = task ? `${task.agent} / ${task.title}` : 'Unknown task';
  return [
    `# ${artifact.label}`,
    '',
    '## Preview',
    'Obsah artefaktu zatim neni k dispozici jako markdown/text v pameti UI.',
    '',
    `- Soubor: ${artifact.path}`,
    `- Typ: ${artifact.kind}`,
    `- Zdroj: ${source}`,
    '',
    '## Co udelat dal',
    '- Zkontrolujte, zda se artefakt uspesne vygeneroval a ulozil.',
    '- Pokud task selhal, podivejte se na raw output nebo execution log pro detail chyby.',
  ].join('\n');
}

function formatTaskModelLabel(task: Task): string {
  return `${task.provider}/${task.model}`;
}

function normalizeBundleFilePath(filePath: string): string {
  return filePath.replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function findBundleFile(bundle: ExecutionOutputBundle, targetPath: string): ExecutionOutputFile | null {
  const normalizedTarget = normalizeBundleFilePath(targetPath);
  return bundle.files.find((file) => normalizeBundleFilePath(file.path) === normalizedTarget) ?? null;
}

function getPreferredBundleFile(bundle: ExecutionOutputBundle): string | null {
  const preferred = ['index.html', 'style.css', 'script.js'];
  for (const path of preferred) {
    if (findBundleFile(bundle, path)) {
      return path;
    }
  }
  return bundle.files[0]?.path ?? null;
}

function resolveBundlePreviewHtml(bundle: ExecutionOutputBundle): string | null {
  const indexFile = findBundleFile(bundle, 'index.html');
  if (!indexFile) return null;

  const inlineLinkedStyles = indexFile.content.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (match, _before, href) => {
      const linkedFile = findBundleFile(bundle, href);
      if (!linkedFile || !linkedFile.path.toLowerCase().endsWith('.css')) {
        return /^(https?:)?\/\//i.test(href) ? '' : match;
      }
      return `<style data-source="${linkedFile.path}">\n${linkedFile.content}\n</style>`;
    }
  );

  const inlineLinkedScripts = inlineLinkedStyles.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (match, _before, src) => {
      const linkedFile = findBundleFile(bundle, src);
      if (!linkedFile || !linkedFile.path.toLowerCase().endsWith('.js')) {
        return /^(https?:)?\/\//i.test(src) ? '' : match;
      }
      return `<script data-source="${linkedFile.path}">\n${linkedFile.content}\n<\/script>`;
    }
  );

  let html = inlineLinkedScripts;
  const hasInlineStyle = /<style\b/i.test(html);
  const hasInlineScript = /<script\b/i.test(html);
  const defaultStyle = findBundleFile(bundle, 'style.css');
  const defaultScript = findBundleFile(bundle, 'script.js');

  if (!hasInlineStyle && defaultStyle) {
    html = html.includes('</head>')
      ? html.replace('</head>', `<style data-source="${defaultStyle.path}">\n${defaultStyle.content}\n</style>\n</head>`)
      : `<style data-source="${defaultStyle.path}">\n${defaultStyle.content}\n</style>\n${html}`;
  }

  if (!hasInlineScript && defaultScript) {
    html = html.includes('</body>')
      ? html.replace('</body>', `<script data-source="${defaultScript.path}">\n${defaultScript.content}\n<\/script>\n</body>`)
      : `${html}\n<script data-source="${defaultScript.path}">\n${defaultScript.content}\n<\/script>`;
  }

  return html;
}

function isBundleMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md');
}

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

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function normalizeAmountContext(row: Record<string, unknown>): {
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

function parseJsonCandidate(raw: string): unknown | null {
  const trimmed = raw.trim();
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

function extractInvoiceRows(root: Record<string, unknown>): InvoiceSummaryRow[] {
  const rowCandidate = [root.rows, root.invoices, root.records, root.items].find((value) => Array.isArray(value));
  if (!Array.isArray(rowCandidate)) return [];

  return rowCandidate
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
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

function inferVatNote(root: Record<string, unknown>, rows: InvoiceSummaryRow[]): string | null {
  const direct = toStringOrNull(root.vatNote) ?? toStringOrNull(toRecord(root.summary)?.vatNote);
  if (direct) return direct;
  const vatRow = rows.find((row) => /\b(vat|dph)\b/i.test(`${row.note ?? ''} ${row.extractionWarning ?? ''}`));
  return vatRow?.note ?? vatRow?.extractionWarning ?? null;
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

function parseInvoiceSummaryResult(raw: string): InvoiceSummaryResult | null {
  const parsed = parseJsonCandidate(raw);
  const root = toRecord(parsed);
  if (!root) return null;

  const rows = extractInvoiceRows(root);

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

  const summaryRoot = toRecord(root.summary) ?? root;
  const rootWarnings = extractStringArray(summaryRoot.warnings ?? root.warnings);
  const hasInvoiceSignal =
    rows.length > 0 ||
    rootWarnings.length > 0 ||
    [
      'invoiceCount',
      'totalOverpayment',
      'totalUnderpayment',
      'netTotal',
      'duplicateVariableSymbols',
      'filesProcessed',
      'filesFailed',
      'vatNote',
    ].some((key) => key in summaryRoot || key in root);
  if (!hasInvoiceSignal) return null;

  const rowWarnings = rows
    .map((row) => row.extractionWarning)
    .filter((warning): warning is string => Boolean(warning));
  const completenessWarnings: string[] = [];
  if (rows.length === 0) {
    completenessWarnings.push('Extraction failed: no structured invoice rows were produced.');
  }

  const requiredKeys: Array<keyof InvoiceSummaryRow> = [
    'invoiceNumber',
    'issueDate',
    'billingPeriod',
    'dueDate',
    'accommodationId',
    'currency',
    'amountInInvoiceCurrency',
    'amountCzk',
    'commission',
    'paymentServiceFee',
    'roomSales',
  ];
  const nearEmptyRows = rows.filter((row) => {
    const populated = requiredKeys.filter((key) => {
      const value = row[key];
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') return value.trim().length > 0;
      return false;
    }).length;
    return populated <= 2;
  }).length;
  if (rows.length > 0 && nearEmptyRows === rows.length) {
    completenessWarnings.push(
      'Extraction failed: rows are nearly empty and required invoice/accounting fields are missing.'
    );
  }

  const warnings = Array.from(new Set([...rootWarnings, ...rowWarnings, ...completenessWarnings]));

  const filesProcessed = Array.from(
    new Set([
      ...extractFileList(summaryRoot.filesProcessed ?? root.filesProcessed),
      ...rows
        .map((row) => row.sourceFileName)
        .filter((fileName): fileName is string => Boolean(fileName)),
    ])
  );
  const filesFailed = extractFileList(summaryRoot.filesFailed ?? root.filesFailed);

  return {
    rows,
    summary: {
      invoiceCount: rows.length,
      uniqueVariableSymbolCount: new Set(variableSymbols).size,
      duplicateVariableSymbolCount: duplicateVariableSymbols.length,
      totalOverpayment,
      totalUnderpayment,
      netTotal,
      vatNote: inferVatNote(root, rows),
      warnings,
      duplicateVariableSymbols,
      filesProcessed,
      filesFailed,
    },
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

function buildInvoiceRowsCsv(result: InvoiceSummaryResult): string {
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

function formatCzk(value: number): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function MarkdownArtifactView({ content, isMobile = false }: { content: string; isMobile?: boolean }) {
  return (
    <div className={`prose prose-invert max-w-none break-words prose-pre:border prose-pre:border-gray-700 prose-pre:bg-black prose-code:text-blue-200 [overflow-wrap:anywhere] ${isMobile ? 'text-sm' : 'text-[12px]'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="overflow-x-hidden whitespace-pre-wrap break-words rounded-md border border-gray-700 bg-black p-4 text-inherit">
              {children}
            </pre>
          ),
          code: ({ className, children }) => (
            <code className={`${className ?? ''} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
              {children}
            </code>
          ),
          p: ({ children }) => <p className="break-words [overflow-wrap:anywhere]">{children}</p>,
          li: ({ children }) => <li className="break-words [overflow-wrap:anywhere]">{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PreformattedArtifactView({ content, isMobile = false }: { content: string; isMobile?: boolean }) {
  return (
    <pre
      className={`overflow-x-auto whitespace-pre rounded border border-gray-800 bg-black/40 px-3 py-3 font-mono leading-relaxed text-gray-200 ${
        isMobile ? 'text-xs' : 'text-[11px]'
      }`}
    >
      {content}
    </pre>
  );
}

function InvoiceSummaryView({
  result,
  isMobile,
  onDownloadCsv,
  onDownloadXlsx,
}: {
  result: InvoiceSummaryResult;
  isMobile?: boolean;
  onDownloadCsv: () => void;
  onDownloadXlsx: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-emerald-800/60 bg-emerald-950/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300">Invoice summary</p>
          <button
            type="button"
            onClick={onDownloadCsv}
            className="ml-auto rounded border border-cyan-700/60 bg-cyan-950/30 px-2 py-1 text-[10px] text-cyan-100 hover:border-cyan-500"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={onDownloadXlsx}
            className="rounded border border-blue-700/60 bg-blue-950/30 px-2 py-1 text-[10px] text-blue-100 hover:border-blue-500"
          >
            Download XLSX
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-200 md:grid-cols-3">
          <p>Invoices: {result.summary.invoiceCount}</p>
          <p>Unique VS: {result.summary.uniqueVariableSymbolCount}</p>
          <p>Duplicate VS: {result.summary.duplicateVariableSymbolCount}</p>
          <p className="text-emerald-200">Overpayment: {formatCzk(result.summary.totalOverpayment)}</p>
          <p className="text-amber-200">Underpayment: {formatCzk(result.summary.totalUnderpayment)}</p>
          <p className={`${result.summary.netTotal >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
            Net total: {formatCzk(result.summary.netTotal)}
          </p>
        </div>

        {result.summary.vatNote && (
          <p className="mt-2 text-[11px] text-gray-200">VAT note: {result.summary.vatNote}</p>
        )}
        {result.summary.duplicateVariableSymbols.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-200">
            Duplicates: {result.summary.duplicateVariableSymbols.join(', ')}
          </p>
        )}
        {result.summary.warnings.length > 0 && (
          <div className="mt-2 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5">
            {result.summary.warnings.map((warning) => (
              <p key={warning} className="text-[11px] text-amber-100">
                - {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="min-w-full divide-y divide-gray-800 text-left text-[11px] text-gray-200">
          <thead className="bg-gray-900/80 text-[10px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-2 py-1.5">Source</th>
              <th className="px-2 py-1.5">Invoice no.</th>
              <th className="px-2 py-1.5">Accommodation ID</th>
              <th className="px-2 py-1.5">Currency</th>
              <th className="px-2 py-1.5">Payable (inv ccy)</th>
              <th className="px-2 py-1.5">Payable (CZK)</th>
              <th className="px-2 py-1.5">Commission</th>
              <th className="px-2 py-1.5">Payment fee</th>
              <th className="px-2 py-1.5">Room sales</th>
              <th className="px-2 py-1.5">Variable symbol</th>
              <th className="px-2 py-1.5">Amount</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5">Billing period</th>
              <th className="px-2 py-1.5">Issue date</th>
              <th className="px-2 py-1.5">Due date</th>
              <th className="px-2 py-1.5">Supplier</th>
              <th className="px-2 py-1.5">Supplier VAT</th>
              <th className="px-2 py-1.5">Customer VAT</th>
              <th className="px-2 py-1.5">Supply point</th>
              <th className="px-2 py-1.5">Warnings / note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-900/70 bg-black/30">
            {result.rows.map((row, index) => {
              const amountClass =
                row.normalizedSign === 1
                  ? 'text-emerald-200'
                  : row.normalizedSign === -1
                  ? 'text-red-200'
                  : 'text-gray-200';
              return (
                <tr key={`${row.sourceFileName ?? 'row'}-${row.variableSymbol ?? 'na'}-${index}`}>
                  <td className="px-2 py-1.5 align-top">{row.sourceFileName ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.invoiceNumber ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.accommodationId ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.currency ?? '-'}</td>
                  <td className={`px-2 py-1.5 align-top ${amountClass}`}>
                    {typeof row.amountInInvoiceCurrency === 'number' ? row.amountInInvoiceCurrency : '-'}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {typeof row.amountCzk === 'number' ? formatCzk(row.amountCzk) : '-'}
                  </td>
                  <td className="px-2 py-1.5 align-top">{typeof row.commission === 'number' ? row.commission : '-'}</td>
                  <td className="px-2 py-1.5 align-top">
                    {typeof row.paymentServiceFee === 'number' ? row.paymentServiceFee : '-'}
                  </td>
                  <td className="px-2 py-1.5 align-top">{typeof row.roomSales === 'number' ? row.roomSales : '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.variableSymbol ?? '-'}</td>
                  <td className={`px-2 py-1.5 align-top ${amountClass}`}>
                    {typeof row.amount === 'number' ? formatCzk(row.amount) : '-'}
                  </td>
                  <td className="px-2 py-1.5 align-top">{row.amountType}</td>
                  <td className="px-2 py-1.5 align-top">{row.billingPeriod ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.issueDate ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.dueDate ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.supplierName ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.supplierVatId ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.customerVatId ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">{row.supplyPoint ?? '-'}</td>
                  <td className="px-2 py-1.5 align-top">
                    {row.extractionWarning && (
                      <p className="text-amber-200">{row.extractionWarning}</p>
                    )}
                    <p className={row.extractionWarning ? 'text-gray-300' : ''}>{row.note ?? '-'}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(result.summary.filesProcessed.length > 0 || result.summary.filesFailed.length > 0) && (
        <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className="rounded border border-gray-800 bg-gray-950/60 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Files processed</p>
            <p className="mt-1 text-[11px] text-gray-200">
              {result.summary.filesProcessed.length > 0 ? result.summary.filesProcessed.join(', ') : '-'}
            </p>
          </div>
          <div className="rounded border border-gray-800 bg-gray-950/60 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Files failed</p>
            <p className="mt-1 text-[11px] text-red-200">
              {result.summary.filesFailed.length > 0 ? result.summary.filesFailed.join(', ') : '-'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function getPreferredArtifactSelection(tasks: Task[]): { taskId: string; artifactPath: string } | null {
  for (const task of [...tasks].reverse()) {
    const bundleArtifact = task.producesArtifacts.find((artifact) => artifact.executionOutput?.files.length);
    if (bundleArtifact) {
      return { taskId: task.id, artifactPath: bundleArtifact.path };
    }
  }

  for (const task of [...tasks].reverse()) {
    const filledArtifact = task.producesArtifacts.find(
      (artifact) => artifact.content?.trim() || artifact.rawContent?.trim()
    );
    if (filledArtifact) {
      return { taskId: task.id, artifactPath: filledArtifact.path };
    }
  }

  return tasks[0]?.producesArtifacts[0]
    ? { taskId: tasks[0].id, artifactPath: tasks[0].producesArtifacts[0].path }
    : null;
}

function buildImageAiStatusKeys(attachment: ProjectAttachment): Array<Parameters<typeof translate>[1]> {
  const keys: Array<Parameters<typeof translate>[1]> = ['attachments.aiStatus.uploaded'];
  if (attachment.ingestion?.linkedToAi || attachment.ingestion?.includedInContext) {
    keys.push('attachments.aiStatus.linked');
  }
  if (attachment.ingestion?.analyzedAt || attachment.ingestion?.lastIncludedAt) {
    keys.push('attachments.aiStatus.analyzed');
  }
  return keys;
}

function buildAttachmentStatusChips(
  attachment: ProjectAttachment,
  t: ReturnType<typeof useApp>['t'],
  tf: ReturnType<typeof useApp>['tf']
): string[] {
  const chips: string[] = [];
  chips.push(t(`attachments.status.${attachment.ingestion?.status ?? 'uploaded'}` as Parameters<typeof translate>[1]));

  const ingestion = attachment.ingestion;
  const isIngested = Boolean(
    ingestion?.extractedText || ingestion?.excerpt || ingestion?.zipFileTree || ingestion?.pageTitle
  );
  if (isIngested) {
    chips.push(t('attachments.status.ingested'));
  }
  if (ingestion?.queuedForNextRound) {
    chips.push(t('attachments.status.queuedNextRound'));
  }
  if (typeof ingestion?.includedInRound === 'number' && ingestion.includedInRound > 0) {
    chips.push(tf('attachments.status.includedRound', { round: ingestion.includedInRound }));
  }

  return chips;
}

interface PreviewPanelProps {
  mode?: 'desktop' | 'mobile';
}

export function PreviewPanel({ mode = 'desktop' }: PreviewPanelProps) {
  const {
    state,
    language,
    schedulerState,
    pauseExecution,
    resumeExecution,
    stepExecution,
    setExecutionSpeed,
    setAutoPauseCheckpoints,
    repairDeadlock,
  } = useApp();
  const project = state.activeProject;
  const projectLanguage = project?.language ?? language;
  const t = useCallback(
    (key: Parameters<typeof translate>[1]) => translate(projectLanguage, key),
    [projectLanguage]
  );
  const tf = useCallback(
    (key: Parameters<typeof translate>[1], vars: Record<string, string | number>) =>
      translateWithVars(projectLanguage, key, vars),
    [projectLanguage]
  );
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedGeneratedFilePath, setSelectedGeneratedFilePath] = useState<string | null>(null);
  const [isResultExpanded, setIsResultExpanded] = useState(false);
  const [autoExpandedOnce, setAutoExpandedOnce] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const executionTimeoutMs = useMemo(() => resolveExecutionTaskTimeoutMs(), []);
  const isMobile = mode === 'mobile';

  const tasks = useMemo(() => project?.taskGraph?.tasks ?? project?.tasks ?? [], [project]);
  const hasArtifacts = tasks.some((task) => task.producesArtifacts.length > 0);
  const doneTasksCount = tasks.filter((task) => task.status === 'done').length;
  const totalTasksCount = tasks.length;
  const isComplete = state.currentPhase === 'complete' || project?.status === 'complete';
  const debateSummary = useMemo(() => {
    if (!project) return '';
    const summaryMessage = [...project.messages]
      .reverse()
      .find((message) => message.sender === 'orchestrator' && message.type === 'system');
    return summaryMessage?.content ?? t('preview.noDebateSummary');
  }, [project, t]);
  const artifactItems = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'done' || task.status === 'failed')
        .flatMap((task) =>
          task.producesArtifacts.map((artifact) => ({
            taskId: task.id,
            taskTitle: task.title,
            ...artifact,
          }))
        ),
    [tasks]
  );
  const executionResultItems = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.producesArtifacts.map((artifact) => ({
          ...artifact,
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          taskAgent: task.agent,
          provider: task.provider,
          model: task.model,
        }))
      ),
    [tasks]
  );
  const preferredResultSelection = useMemo(() => getPreferredArtifactSelection(tasks), [tasks]);
  const executionCompletionStatus = useMemo(() => buildExecutionCompletionStatus(tasks), [tasks]);
  const integratorFinalArtifact = useMemo(() => {
    const integratorTask = [...tasks].reverse().find((task) => task.agent === 'Integrator');
    if (!integratorTask) return null;
    const artifact = integratorTask.producesArtifacts.find((item) => item.path === 'final-summary.md') ?? null;
    if (!artifact?.content) return null;

    const whatToDoNow =
      extractMarkdownSection(artifact.content, ['What to do now', 'Co udelat ted']) ||
      extractMarkdownSection(artifact.content, ['Next steps', 'Doporuceny dalsi krok']);
    const filesAffected = extractMarkdownSection(
      artifact.content,
      ['Files likely affected', 'Pravdepodobne dotcene soubory']
    );
    const recommendedNextAction =
      extractMarkdownSection(artifact.content, ['Recommended next action', 'Doporuceny dalsi krok']) ||
      extractMarkdownSection(artifact.content, ['Next steps', 'Dalsi kroky']);

    return {
      task: integratorTask,
      artifact,
      whatToDoNow,
      filesAffected,
      recommendedNextAction,
    };
  }, [tasks]);
  const projectAttachments = useMemo<ProjectAttachment[]>(() => project?.attachments ?? [], [project]);
  const groupedAttachments = useMemo(() => {
    const projectLevel = projectAttachments.filter((attachment) => (attachment.source ?? 'message') === 'project');
    const messageLevel = projectAttachments.filter((attachment) => (attachment.source ?? 'message') === 'message');
    return { projectLevel, messageLevel };
  }, [projectAttachments]);

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      blocked: [],
      blocked_due_to_failed_dependency: [],
      queued: [],
      running: [],
      done: [],
      failed: [],
      canceled_due_to_failed_dependency: [],
      completed_with_fallback: [],
    };
    tasks.forEach((task) => {
      groups[task.status].push(task);
    });
    return groups;
  }, [tasks]);

  const taskTitleMap = useMemo(() => {
    return tasks.reduce<Record<string, string>>((acc, task) => {
      acc[task.id] = task.title;
      return acc;
    }, {});
  }, [tasks]);

  const isAppProject = useMemo(() => {
    return project?.outputType === 'app' || project?.outputType === 'website';
  }, [project]);

  useEffect(() => {
    if (!selectedTaskId && preferredResultSelection) {
      setSelectedTaskId(preferredResultSelection.taskId);
      setSelectedArtifact(preferredResultSelection.artifactPath);
    }
  }, [preferredResultSelection, selectedTaskId]);

  useEffect(() => {
    if (
      !autoExpandedOnce &&
      executionCompletionStatus === 'completed' &&
      preferredResultSelection
    ) {
      setSelectedTaskId(preferredResultSelection.taskId);
      setSelectedArtifact(preferredResultSelection.artifactPath);
      setIsResultExpanded(true);
      setAutoExpandedOnce(true);
    }
  }, [autoExpandedOnce, executionCompletionStatus, preferredResultSelection]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedArtifactMeta = selectedTask?.producesArtifacts.find(
    (artifact) => artifact.path === selectedArtifact
  );
  const selectedArtifactOwner = selectedArtifactMeta?.producedBy ?? selectedTask?.agent ?? null;
  const selectedExecutionBundle = selectedArtifactMeta?.executionOutput ?? null;
  const selectedArtifactContent = useMemo(() => {
    if (!selectedArtifactMeta) return '';
    return selectedArtifactMeta.content?.trim()
      ? selectedArtifactMeta.content
      : buildArtifactFallbackPreview(selectedArtifactMeta, selectedTask);
  }, [selectedArtifactMeta, selectedTask]);
  const selectedGeneratedFile = useMemo(() => {
    if (!selectedExecutionBundle || !selectedGeneratedFilePath) return null;
    return findBundleFile(selectedExecutionBundle, selectedGeneratedFilePath);
  }, [selectedExecutionBundle, selectedGeneratedFilePath]);
  const selectedArtifactPreviewHtml = useMemo(
    () => (selectedExecutionBundle ? resolveBundlePreviewHtml(selectedExecutionBundle) : null),
    [selectedExecutionBundle]
  );
  const selectedInvoiceResult = useMemo(() => {
    const fromArtifactRaw = selectedArtifactMeta?.rawContent ? parseInvoiceSummaryResult(selectedArtifactMeta.rawContent) : null;
    if (fromArtifactRaw) return fromArtifactRaw;

    const fromArtifactContent = selectedArtifactMeta?.content ? parseInvoiceSummaryResult(selectedArtifactMeta.content) : null;
    if (fromArtifactContent) return fromArtifactContent;

    if (!selectedExecutionBundle) return null;
    for (const file of selectedExecutionBundle.files) {
      if (!file.path.toLowerCase().endsWith('.json')) continue;
      const fromBundleFile = parseInvoiceSummaryResult(file.content);
      if (fromBundleFile) return fromBundleFile;
    }

    return null;
  }, [selectedArtifactMeta, selectedExecutionBundle]);
  const stableBaselineBundle = project?.latestStableBundle ?? null;

  const resultModalTitle = selectedExecutionBundle
    ? selectedGeneratedFile?.path ?? selectedArtifactMeta?.path ?? 'Generated result'
    : selectedArtifactMeta?.path ?? 'Result';

  useEffect(() => {
    if (!selectedTask) return;
    if (!selectedTask.producesArtifacts.length) {
      setSelectedArtifact(null);
      return;
    }
    if (!selectedArtifact || !selectedTask.producesArtifacts.some((artifact) => artifact.path === selectedArtifact)) {
      setSelectedArtifact(selectedTask.producesArtifacts[0].path);
    }
  }, [selectedArtifact, selectedTask]);

  useEffect(() => {
    if (!preferredResultSelection) return;
    if (!selectedTask || !selectedArtifactMeta) {
      setSelectedTaskId(preferredResultSelection.taskId);
      setSelectedArtifact(preferredResultSelection.artifactPath);
    }
  }, [preferredResultSelection, selectedArtifactMeta, selectedTask]);

  useEffect(() => {
    if (!selectedExecutionBundle) {
      setSelectedGeneratedFilePath(null);
      return;
    }
    if (
      !selectedGeneratedFilePath ||
      !selectedExecutionBundle.files.some(
        (file) => normalizeBundleFilePath(file.path) === normalizeBundleFilePath(selectedGeneratedFilePath)
      )
    ) {
      setSelectedGeneratedFilePath(getPreferredBundleFile(selectedExecutionBundle));
    }
  }, [selectedExecutionBundle, selectedGeneratedFilePath]);

  const downloadBundleAsZip = useCallback(async (bundle: ExecutionOutputBundle, bundleName: string) => {
    if (!bundle) return;

    const zip = new JSZip();
    bundle.files.forEach((file) => {
      zip.file(normalizeBundleFilePath(file.path), file.content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const safeBundleName = normalizeBundleFilePath(bundleName).replace(/\.[^.]+$/, '') || 'execution-output';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeBundleName}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadExecutionBundle = useCallback(async (artifact: TaskArtifact) => {
    if (!artifact.executionOutput) return;
    await downloadBundleAsZip(artifact.executionOutput, artifact.path);
  }, [downloadBundleAsZip]);

  const downloadInvoiceCsv = useCallback((result: InvoiceSummaryResult) => {
    const csv = buildInvoiceRowsCsv(result);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'invoice-summary.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadInvoiceXlsx = useCallback((result: InvoiceSummaryResult) => {
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

    XLSX.writeFile(workbook, 'invoice-summary.xlsx');
  }, []);

  if (!project) {
    return (
      <div className={`h-full flex flex-col items-center justify-center bg-gray-950 text-center px-6 ${isMobile ? '' : 'border-t border-gray-800'}`}>
        <div className="text-2xl mb-2">🖼</div>
        <p className="text-xs text-gray-400">{t('preview.empty')}</p>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col bg-gray-950 ${isMobile ? '' : 'border-t border-gray-800'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center gap-3 border-b border-gray-800 ${isMobile ? 'px-6 py-5' : 'px-4 py-2'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-xs'} font-semibold text-gray-100`}>{t('preview.title')}</h3>
        {schedulerState.concurrencyLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.concurrency')}: {schedulerState.concurrencyLimit}
          </span>
        )}
        {schedulerState.concurrencyLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.runningNow')}: {schedulerState.runningTasks}
          </span>
        )}
        {schedulerState.retryLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.retryLimit')}: {schedulerState.retryLimit}
          </span>
        )}
        {totalTasksCount > 0 && (
          <span className={`${isMobile ? 'text-sm' : 'text-[10px]'} ml-auto text-gray-400`}>
            {doneTasksCount}/{totalTasksCount} {t('preview.tasks')}
          </span>
        )}
        {preferredResultSelection && (
          <button
            type="button"
            onClick={() => {
              setSelectedTaskId(preferredResultSelection.taskId);
              setSelectedArtifact(preferredResultSelection.artifactPath);
              setIsResultExpanded(true);
            }}
            className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-2 py-1 rounded'} border border-emerald-700/60 bg-emerald-950/30 text-emerald-100 hover:border-emerald-500`}
          >
            Open result
          </button>
        )}
      </div>

      {schedulerState.total > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800 bg-gray-900/40">
          <p className="text-[11px] text-gray-200">
            {tf('preview.progressSummary', {
              done: schedulerState.done,
              total: schedulerState.total,
              running: schedulerState.runningTasks,
              queued: schedulerState.queued,
              blocked: schedulerState.blocked,
              failed: schedulerState.failed,
            })}
          </p>
          <p className="mt-1 text-[11px] text-gray-300">
            Execution status:{' '}
            <span
              className={`rounded px-1.5 py-0.5 ${
                executionCompletionStatus === 'completed'
                  ? 'bg-green-900/40 text-green-200'
                  : executionCompletionStatus === 'completed_with_fallback'
                  ? 'bg-cyan-900/40 text-cyan-200'
                  : executionCompletionStatus === 'failed'
                  ? 'bg-red-900/40 text-red-200'
                  : 'bg-blue-900/40 text-blue-200'
              }`}
            >
              {executionCompletionStatus}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            {t('preview.cycleHistory')}: {project.revisionHistory.length} · {t('preview.stableBaseline')}: {project.latestStableFiles.length}
          </p>
        </div>
      )}

      {schedulerState.concurrencyLimit > 0 && (
        <div className="flex-shrink-0 sticky top-0 z-20 border-b border-gray-800 bg-gray-900/95 backdrop-blur-sm overflow-visible">
          <div className="px-4 py-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-gray-300 mr-1">{t('preview.schedulerControls')}</span>

            <button
              onClick={schedulerState.isPaused ? resumeExecution : pauseExecution}
              disabled={schedulerState.isComplete}
              className={`rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {schedulerState.isPaused ? t('preview.resume') : t('preview.pause')}
            </button>
            <button
              onClick={stepExecution}
              disabled={schedulerState.isComplete}
              className={`rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {t('preview.step')}
            </button>

            <div className="hidden min-[520px]:flex items-center gap-1 rounded border border-gray-700 bg-gray-900 p-0.5">
            {(['slow', 'normal', 'fast'] as const).map((speed) => (
              <button
                key={speed}
                onClick={() => setExecutionSpeed(speed)}
                disabled={schedulerState.isComplete}
                className={`rounded px-2 py-1 text-[10px] transition-colors ${
                  schedulerState.executionSpeed === speed
                    ? 'bg-blue-700/70 text-blue-100'
                    : 'text-gray-300 hover:bg-gray-800'
                } ${schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {t(`preview.speed.${speed}` as const)}
              </button>
            ))}
            </div>

            <button
              onClick={() => setAutoPauseCheckpoints(!schedulerState.autoPauseCheckpoints)}
              disabled={schedulerState.isComplete}
              className={`hidden min-[520px]:inline-flex rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {schedulerState.autoPauseCheckpoints
                ? t('preview.autoPauseOn')
                : t('preview.autoPauseOff')}
            </button>

            <details className="relative min-[520px]:hidden">
              <summary className="list-none cursor-pointer rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 select-none">
                {t('preview.more')}
              </summary>
              <div className="absolute right-0 mt-1 w-44 rounded border border-gray-700 bg-gray-950 p-2 shadow-xl space-y-1">
                <div className="grid grid-cols-3 gap-1">
                  {(['slow', 'normal', 'fast'] as const).map((speed) => (
                    <button
                      key={`more-${speed}`}
                      onClick={() => setExecutionSpeed(speed)}
                      disabled={schedulerState.isComplete}
                      className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                        schedulerState.executionSpeed === speed
                          ? 'bg-blue-700/70 text-blue-100'
                          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                      } ${schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {t(`preview.speed.${speed}` as const)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setAutoPauseCheckpoints(!schedulerState.autoPauseCheckpoints)}
                  disabled={schedulerState.isComplete}
                  className={`w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 ${
                    schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {schedulerState.autoPauseCheckpoints
                    ? t('preview.autoPauseOn')
                    : t('preview.autoPauseOff')}
                </button>
              </div>
            </details>

          {schedulerState.isComplete && (
              <span className="text-[10px] text-green-300 ml-auto">{t('preview.completeControls')}</span>
          )}
          {schedulerState.isPaused && (
              <span className="text-[10px] text-amber-300 ml-auto">{t('preview.schedulerPaused')}</span>
          )}
          </div>
        </div>
      )}

      {/* Content */}
      <div
        className={`flex-1 overflow-y-auto overflow-x-hidden ${isMobile ? 'px-5 py-5' : 'px-4 py-3'}`}
        style={isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}
      >
        {schedulerState.deadlock && !isComplete && (
          <div className="mb-3 rounded-lg border border-red-700/60 bg-red-950/30 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-red-300">
                {t('preview.deadlockTitle')}
              </span>
              <button
                onClick={repairDeadlock}
                className="ml-auto rounded border border-red-600/60 bg-red-900/40 px-2 py-1 text-[10px] text-red-100 hover:bg-red-800/50"
              >
                {t('preview.deadlockRepair')}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-red-100 leading-relaxed">{schedulerState.deadlock.message}</p>
          </div>
        )}

        <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('attachments.sectionTitle')}</p>
            <span className="text-[10px] text-gray-500">{projectAttachments.length}</span>
          </div>
          {projectAttachments.length === 0 ? (
            <p className="mt-1 text-[11px] text-gray-400">{t('attachments.none')}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {([
                { label: t('attachments.source.project'), items: groupedAttachments.projectLevel },
                { label: t('attachments.source.message'), items: groupedAttachments.messageLevel },
              ] as const).map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <div key={group.label} className="space-y-1.5">
                    <p className="text-[10px] text-gray-500">{group.label}</p>
                    {group.items.map((attachment) => (
                      <div key={attachment.id} className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-300">
                            {t(`attachments.kind.${attachment.kind}` as Parameters<typeof translate>[1])}
                          </span>
                          {buildAttachmentStatusChips(attachment, t, tf).map((statusChip) => (
                            <span key={`${attachment.id}-${statusChip}`} className="rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-[10px] text-gray-400">
                              {statusChip}
                            </span>
                          ))}
                          <p className="truncate text-[11px] text-gray-100">{attachment.title}</p>
                          {attachment.size && (
                            <span className="ml-auto text-[10px] text-gray-500">{formatAttachmentSize(attachment.size)}</span>
                          )}
                        </div>

                        {attachment.kind === 'image' && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {buildImageAiStatusKeys(attachment).map((key) => (
                              <span
                                key={`${attachment.id}-${key}`}
                                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200"
                              >
                                {t(key)}
                              </span>
                            ))}
                          </div>
                        )}

                        {attachment.ingestion?.excerpt && (
                          <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">{attachment.ingestion.excerpt}</p>
                        )}

                        {attachment.kind === 'zip' && attachment.ingestion?.zipFileTree && (
                          <div className="mt-1 rounded border border-gray-800 bg-black/30 px-1.5 py-1">
                            <p className="text-[10px] text-gray-500">{t('attachments.zipTree')}</p>
                            <p className="text-[10px] text-gray-300 whitespace-pre-wrap">
                              {attachment.ingestion.zipFileTree.slice(0, 12).join('\n')}
                            </p>
                          </div>
                        )}

                        {attachment.ingestion?.error && (
                          <p className="mt-1 text-[10px] text-red-300">{attachment.ingestion.error}</p>
                        )}

                        {attachment.kind === 'image' && attachment.downloadUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={attachment.downloadUrl}
                            alt={attachment.title}
                            className="mt-1 max-h-24 w-full rounded border border-gray-700 object-cover"
                          />
                        )}

                        {attachment.kind === 'url' && attachment.downloadUrl && (
                          <div className="mt-1 space-y-1 rounded border border-gray-800 bg-black/20 px-1.5 py-1">
                            <p className="text-[10px] text-gray-300">
                              {attachment.ingestion?.pageTitle ?? attachment.title}
                            </p>
                            <a
                              href={attachment.sourceUrl ?? attachment.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-[10px] text-blue-300 underline break-all"
                            >
                              {attachment.sourceUrl ?? attachment.downloadUrl}
                            </a>
                            <p className="text-[10px] text-gray-500">
                              {attachment.ingestion?.extractedText
                                ? `Parsed content ready (${attachment.ingestion.extractedText.length} chars)`
                                : 'Parsed content pending'}
                            </p>
                            {typeof attachment.ingestion?.urlPageCount === 'number' && (
                              <p className="text-[10px] text-gray-400">
                                Pages indexed: {attachment.ingestion.urlPageCount}
                              </p>
                            )}
                            {attachment.ingestion?.urlPages && attachment.ingestion.urlPages.length > 0 && (
                              <div className="rounded border border-gray-800 bg-black/30 px-1.5 py-1">
                                <p className="text-[10px] text-gray-500">Visited pages</p>
                                <div className="mt-1 space-y-1">
                                  {attachment.ingestion.urlPages.slice(0, 6).map((page) => (
                                    <div key={`${attachment.id}-${page.url}`} className="rounded border border-gray-800 bg-black/20 px-1.5 py-1">
                                      <a
                                        href={page.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-blue-300 underline break-all"
                                      >
                                        {page.title}
                                      </a>
                                      <p className="text-[10px] text-gray-500 break-all">{page.url}</p>
                                      <p className="text-[10px] text-gray-400 leading-relaxed">{page.summary || page.excerpt}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {(attachment.kind === 'pdf' || attachment.kind === 'zip' || attachment.kind === 'file') &&
                          attachment.downloadUrl && (
                            <a
                              href={attachment.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex text-[10px] text-blue-300 underline"
                            >
                              {t('attachments.open')}
                            </a>
                          )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {integratorFinalArtifact && (
          <div className="mb-3 rounded-lg border border-blue-700/50 bg-blue-950/20 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-blue-300">Final Result / Finalni vysledek</p>
            <p className="mt-1 text-[11px] text-blue-100">
              Source: {integratorFinalArtifact.artifact.path} ({integratorFinalArtifact.task.status})
            </p>

            <div className="mt-2 grid gap-2">
              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">What to do now / Co udelat ted</p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.whatToDoNow || 'Read final summary and start with the first ordered task.'}
                </p>
              </div>

              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">
                  Files likely affected / Pravdepodobne dotcene soubory
                </p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.filesAffected || 'See execution artifacts for file-level proposal details.'}
                </p>
              </div>

              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">
                  Recommended next action / Doporuceny dalsi krok
                </p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.recommendedNextAction || 'Approve the top-priority implementation package and execute in order.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {isComplete && (
          <div className="mb-3 rounded-lg border border-green-700/50 bg-green-950/20 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-green-300">
                {t('preview.completeBanner')}
              </span>
              <span className="ml-auto text-[10px] text-green-200">{t('preview.executionComplete')}</span>
            </div>
            <div className="mt-2 rounded border border-green-700/40 bg-green-950/30 px-2 py-1.5">
              <p className="text-xs text-green-100">{t('preview.finalResult')}</p>
            </div>

            {(
              <div className="mt-3 space-y-2">
                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.projectOutput')}</p>
                  <p className="mt-1 text-xs text-gray-100">{project.name}</p>
                  <p className="mt-1 text-[11px] text-gray-300 leading-relaxed">{project.description}</p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.stableBaseline')}</p>
                  <p className="mt-1 text-[11px] text-gray-200">
                    {project.latestStableFiles.length} files
                    {project.latestStableUpdatedAt
                      ? ` · updated ${new Date(project.latestStableUpdatedAt).toLocaleString()}`
                      : ''}
                  </p>
                  {stableBaselineBundle && (
                    <button
                      type="button"
                      onClick={() => void downloadBundleAsZip(stableBaselineBundle, 'stable-baseline')}
                      className="mt-2 rounded border border-blue-700/60 bg-blue-950/30 px-2 py-1 text-[10px] text-blue-100 transition-colors hover:border-blue-500"
                    >
                      Download stable baseline ZIP
                    </button>
                  )}
                  {executionCompletionStatus === 'failed' && project.latestStableFiles.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-300">
                      Latest revision failed. Stable baseline from the previous successful cycle is preserved.
                    </p>
                  )}
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.implementationOutput')}</p>
                  <p className="mt-1 text-[11px] text-gray-200">
                    {tf('preview.implementationBody', { done: doneTasksCount, total: totalTasksCount })}
                  </p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.debateDecisions')}</p>
                  <p className="mt-1 text-[11px] text-gray-200 whitespace-pre-wrap leading-relaxed">{debateSummary}</p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.keyArtifacts')}</p>
                  <div className="mt-1 space-y-1">
                    {artifactItems.length === 0 && (
                      <p className="text-[11px] text-gray-400">{t('preview.noArtifacts')}</p>
                    )}
                    {artifactItems.map((artifact) => (
                      <button
                        key={`${artifact.taskId}:${artifact.path}`}
                        onClick={() => {
                          setSelectedTaskId(artifact.taskId);
                          setSelectedArtifact(artifact.path);
                        }}
                        className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-left hover:border-blue-700/50"
                      >
                        <p className="text-[10px] text-gray-200">{artifact.label}</p>
                        <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                        <p className="text-[10px] text-gray-400">{artifact.taskTitle}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.architectureSummary')}</p>
                  <p className="mt-1 text-[11px] text-gray-200">
                    {t('preview.architectureBody')}
                  </p>
                </div>

                {isAppProject && (
                  <div className="rounded border border-blue-700/40 bg-blue-950/20 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-blue-300">{t('preview.generatedScreens')}</p>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Sidebar</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Chat Panel</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Agents Panel</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Execution & Preview</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!hasArtifacts && totalTasksCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-2xl mb-2">⏳</div>
            <p className="text-xs text-gray-400">
              {state.currentPhase === 'execution' || state.currentPhase === 'review' || state.currentPhase === 'testing'
                ? t('preview.loading')
                : t('preview.waiting')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {([
              'blocked',
              'blocked_due_to_failed_dependency',
              'queued',
              'running',
              'done',
              'completed_with_fallback',
              'failed',
              'canceled_due_to_failed_dependency',
            ] as TaskStatus[]).map((status) => {
              const items = groupedTasks[status];
              if (items.length === 0) return null;
              return (
                <div key={status} className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-gray-300">
                    {t(`status.task.${status}` as const)} ({items.length})
                  </p>
                  {items.map((task) => (
                    (() => {
                      const dependencyTitles = task.dependsOn.map((id) => taskTitleMap[id] ?? id);
                      const runningForMs =
                        task.status === 'running'
                          ? Math.max(0, nowTick - new Date(task.updatedAt).getTime())
                          : 0;
                      const isStalled = task.status === 'running' && runningForMs > executionTimeoutMs;
                      const unresolvedDependencies = task.dependsOn
                        .map((id) => tasks.find((candidate) => candidate.id === id))
                        .filter((dependency): dependency is Task =>
                          Boolean(
                            dependency &&
                              dependency.status !== 'done' &&
                              dependency.status !== 'failed' &&
                              dependency.status !== 'completed_with_fallback' &&
                              dependency.status !== 'canceled_due_to_failed_dependency' &&
                              dependency.status !== 'blocked_due_to_failed_dependency'
                          )
                        )
                        .map((dependency) => dependency.title);
                      return (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`w-full text-left bg-gray-900 rounded border px-3 py-2 transition-colors ${
                        selectedTaskId === task.id
                          ? 'border-blue-600/70 bg-blue-950/20'
                          : 'border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          task.status === 'done'
                            ? 'bg-green-900/50 text-green-300'
                            : task.status === 'running'
                            ? 'bg-blue-900/50 text-blue-300'
                            : task.status === 'completed_with_fallback'
                            ? 'bg-cyan-900/50 text-cyan-200'
                            : task.status === 'failed'
                            ? 'bg-red-900/50 text-red-300'
                            : task.status === 'canceled_due_to_failed_dependency'
                            ? 'bg-red-900/50 text-red-300'
                            : task.status === 'blocked'
                            ? 'bg-amber-900/50 text-amber-200'
                            : task.status === 'blocked_due_to_failed_dependency'
                            ? 'bg-amber-900/50 text-amber-200'
                            : 'bg-gray-800 text-gray-300'
                        }`}>
                          {t(`status.task.${task.status}` as const)}
                        </span>
                        <span className="text-xs text-gray-100 truncate">{task.title}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{task.agent}</span>
                        <span className="text-[10px] text-cyan-200 rounded border border-cyan-900/60 bg-cyan-950/30 px-1.5 py-0.5 flex-shrink-0">
                          {formatTaskModelLabel(task)}
                        </span>
                      </div>
                      {task.status === 'running' && (
                        <p className={`mt-1 text-[10px] ${isStalled ? 'text-red-300' : 'text-blue-300'}`}>
                          Running: {formatDurationMs(runningForMs)}
                          {isStalled ? ' (timeout / stalled)' : ''}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-gray-300 line-clamp-2">{task.description}</p>
                      <p className="mt-1 text-[10px] text-gray-400">
                        {t('preview.dependsOn')}: {dependencyTitles.length ? dependencyTitles.join(', ') : t('preview.none')}
                      </p>
                      {(task.status === 'blocked' || task.status === 'blocked_due_to_failed_dependency') && unresolvedDependencies.length > 0 && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          {tf('preview.blockedReason', { deps: unresolvedDependencies.join(', ') })}
                        </p>
                      )}
                    </button>
                      );
                    })()
                  ))}
                </div>
              );
            })}

            {selectedTask && (
              <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.artifactDetail')}</p>
                <p className="mt-1 text-[11px] text-gray-100">{selectedTask.title}</p>
                <p className="mt-1 text-[11px] text-gray-300 leading-relaxed">{selectedTask.description}</p>
                <p className="mt-1 text-[11px] text-gray-200">{t('preview.owner')}: {selectedTask.agent}</p>
                <p className="mt-1 text-[11px] text-cyan-200">Model: {formatTaskModelLabel(selectedTask)}</p>
                <p className="mt-1 text-[11px] text-gray-300">
                  {t('preview.dependsOn')}: {selectedTask.dependsOn.length
                    ? selectedTask.dependsOn.map((id) => taskTitleMap[id] ?? id).join(', ')
                    : t('preview.none')}
                </p>
                {selectedTask.errorMessage && (
                  <p className="mt-1 text-[11px] text-red-300">{selectedTask.errorMessage}</p>
                )}

                {selectedTask.producesArtifacts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedTask.producesArtifacts.map((artifact) => (
                      <button
                        key={artifact.path}
                        onClick={() => setSelectedArtifact(artifact.path)}
                        className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                          selectedArtifact === artifact.path
                            ? 'bg-blue-900/40 border-blue-700/60 text-blue-100'
                            : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-blue-700/50'
                        }`}
                      >
                        <p className="text-[10px] font-medium">{artifact.label}</p>
                        <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                      </button>
                    ))}
                  </div>
                )}

                {selectedArtifactMeta && (
                  <div className="mt-2 rounded border border-gray-700 bg-gray-950 px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] text-gray-400">Execution Results</p>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        agent: {selectedArtifactOwner}
                      </span>
                      <span className="rounded bg-cyan-950/30 px-1.5 py-0.5 text-[10px] text-cyan-200">
                        model: {formatTaskModelLabel(selectedTask)}
                      </span>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        file: {selectedArtifactMeta.path}
                      </span>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        type: {selectedArtifactMeta.kind}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsResultExpanded(true)}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 transition-colors hover:border-blue-500"
                      >
                        Expand
                      </button>
                      {selectedExecutionBundle && (
                        <button
                          type="button"
                          onClick={() => void downloadExecutionBundle(selectedArtifactMeta)}
                          className="ml-auto rounded border border-blue-700/60 bg-blue-950/30 px-2 py-1 text-[10px] text-blue-100 transition-colors hover:border-blue-500"
                        >
                          Download ZIP
                        </button>
                      )}
                    </div>

                    <div className="mt-2 rounded border border-gray-800 bg-black/30 px-2 py-2">
                      {selectedExecutionBundle ? (
                        <div className="space-y-3">
                          {selectedInvoiceResult && (
                            <InvoiceSummaryView
                              result={selectedInvoiceResult}
                              isMobile={isMobile}
                              onDownloadCsv={() => downloadInvoiceCsv(selectedInvoiceResult)}
                              onDownloadXlsx={() => downloadInvoiceXlsx(selectedInvoiceResult)}
                            />
                          )}

                          <div className="rounded border border-emerald-800/50 bg-emerald-950/20 px-2 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-emerald-300">Bundle status</p>
                            <p className="mt-1 text-[11px] text-emerald-100">{selectedExecutionBundle.status}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-gray-200">{selectedExecutionBundle.summary}</p>
                            {selectedExecutionBundle.notes.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {selectedExecutionBundle.notes.map((note) => (
                                  <p key={note} className="text-[10px] text-gray-300">
                                    - {note}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-3">
                            {selectedArtifactPreviewHtml && (
                              <div className="rounded border border-gray-800 bg-gray-950/80 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] uppercase tracking-wider text-gray-400">Live preview</p>
                                  <span className="text-[10px] text-gray-500">srcDoc</span>
                                </div>
                                <iframe
                                  title="Generated app preview"
                                  sandbox="allow-scripts"
                                  srcDoc={selectedArtifactPreviewHtml}
                                  className="mt-2 h-72 w-full rounded border border-gray-800 bg-white"
                                />
                              </div>
                            )}

                            <div className="rounded border border-gray-800 bg-gray-950/80 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] uppercase tracking-wider text-gray-400">Generated files</p>
                                <span className="text-[10px] text-gray-500">{selectedExecutionBundle.files.length}</span>
                              </div>
                              <div className="mt-2 space-y-1">
                                {selectedExecutionBundle.files.map((file) => {
                                  const normalizedPath = normalizeBundleFilePath(file.path);
                                  const isIndexFile = normalizedPath === 'index.html';
                                  return (
                                    <button
                                      key={file.path}
                                      type="button"
                                      onClick={() => setSelectedGeneratedFilePath(file.path)}
                                      className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                                        selectedGeneratedFilePath &&
                                        normalizeBundleFilePath(selectedGeneratedFilePath) === normalizedPath
                                          ? 'border-blue-700/60 bg-blue-950/30 text-blue-100'
                                          : 'border-gray-800 bg-gray-900 text-gray-300 hover:border-blue-700/50'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="truncate text-[10px] font-medium">{file.path}</span>
                                        {isIndexFile && (
                                          <span className="rounded bg-emerald-950/40 px-1 py-0.5 text-[9px] text-emerald-200">
                                            entry
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="space-y-3">
                              {selectedGeneratedFile && (
                                <div className="rounded border border-gray-800 bg-gray-950/80 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] uppercase tracking-wider text-gray-400">File viewer</p>
                                    <span className="text-[10px] text-gray-500">{selectedGeneratedFile.path}</span>
                                  </div>
                                  <div className="mt-2 rounded border border-gray-800 bg-black/40 px-2 py-2">
                                    {isBundleMarkdownFile(selectedGeneratedFile.path) ? (
                                      <MarkdownArtifactView content={selectedGeneratedFile.content} isMobile={isMobile} />
                                    ) : (
                                      <PreformattedArtifactView content={selectedGeneratedFile.content} isMobile={isMobile} />
                                    )}
                                  </div>
                                </div>
                              )}

                              {selectedArtifactMeta.rawContent?.trim() && (
                                <div className="rounded border border-gray-800 bg-gray-950/80 p-2">
                                  <p className="text-[10px] uppercase tracking-wider text-gray-400">Raw model output</p>
                                  <div className="mt-2">
                                    <PreformattedArtifactView content={selectedArtifactMeta.rawContent} isMobile={isMobile} />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : isMarkdownArtifact(selectedArtifactMeta.path) ? (
                        <MarkdownArtifactView content={selectedArtifactContent} isMobile={isMobile} />
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[10px] text-gray-400">Structured preview</p>
                          {selectedInvoiceResult ? (
                            <InvoiceSummaryView
                              result={selectedInvoiceResult}
                              isMobile={isMobile}
                              onDownloadCsv={() => downloadInvoiceCsv(selectedInvoiceResult)}
                              onDownloadXlsx={() => downloadInvoiceXlsx(selectedInvoiceResult)}
                            />
                          ) : (
                            <PreformattedArtifactView content={selectedArtifactContent} isMobile={isMobile} />
                          )}
                          {selectedArtifactMeta.rawContent?.trim() && (
                            <PreformattedArtifactView content={selectedArtifactMeta.rawContent} isMobile={isMobile} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-2 rounded border border-gray-800 bg-black/40 px-2 py-1.5">
                  <p className="text-[10px] text-gray-400">{t('preview.snippet')}</p>
                  <p className="mt-1 text-[10px] text-gray-200 font-mono">
                    {selectedArtifactMeta
                      ? `${selectedArtifactMeta.label} [${selectedArtifactMeta.kind}]`
                      : ''}
                    {!selectedArtifactMeta && selectedTask.agent === 'Planner' && t('preview.snippet.planner')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Architect' && t('preview.snippet.architect')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Builder' && t('preview.snippet.builder')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Reviewer' && t('preview.snippet.reviewer')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Tester' && t('preview.snippet.tester')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Integrator' && t('preview.snippet.integrator')}
                  </p>
                </div>
              </div>
            )}

            {executionResultItems.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Execution Results</p>
                <div className="mt-2 space-y-1">
                  {executionResultItems.map((artifact) => (
                    <button
                      key={`${artifact.taskId}:${artifact.path}:result`}
                      onClick={() => {
                        setSelectedTaskId(artifact.taskId);
                        setSelectedArtifact(artifact.path);
                      }}
                      className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                        selectedTaskId === artifact.taskId && selectedArtifact === artifact.path
                          ? 'bg-blue-900/40 border-blue-700/60 text-blue-100'
                          : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-blue-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-medium">{artifact.label}</p>
                        <span className="text-[10px] text-gray-400">{artifact.taskAgent}</span>
                        <span className="text-[10px] rounded border border-cyan-900/60 bg-cyan-950/30 px-1 py-0.5 text-cyan-200">
                          {artifact.provider}/{artifact.model}
                        </span>
                        <span className={`ml-auto text-[10px] rounded px-1 py-0.5 ${
                          artifact.taskStatus === 'done'
                            ? 'bg-green-900/50 text-green-300'
                            : artifact.taskStatus === 'running'
                            ? 'bg-blue-900/50 text-blue-300'
                            : artifact.taskStatus === 'completed_with_fallback'
                            ? 'bg-cyan-900/50 text-cyan-200'
                            : artifact.taskStatus === 'queued' || artifact.taskStatus === 'blocked'
                            ? 'bg-gray-800 text-gray-300'
                            : 'bg-red-900/50 text-red-300'
                        }`}>
                          {artifact.taskStatus}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isResultExpanded && selectedArtifactMeta && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-black/80 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsResultExpanded(false); }}
        >
          <div className="flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wider text-gray-400">Expanded result</p>
                <p className="truncate text-sm text-gray-100">{resultModalTitle}</p>
              </div>
              {selectedExecutionBundle && (
                <button
                  type="button"
                  onClick={() => void downloadExecutionBundle(selectedArtifactMeta)}
                  className="rounded border border-blue-700/60 bg-blue-950/30 px-3 py-1.5 text-xs text-blue-100 hover:border-blue-500"
                >
                  Download ZIP
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsResultExpanded(false)}
                className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 hover:border-blue-500"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {selectedExecutionBundle && selectedArtifactPreviewHtml ? (
                <div className="flex flex-col gap-4 h-full">
                  <iframe
                    title="Expanded generated app preview"
                    sandbox="allow-scripts"
                    srcDoc={selectedArtifactPreviewHtml}
                    className="min-h-[60vh] flex-1 w-full rounded-xl border border-gray-800 bg-white"
                  />
                  {selectedGeneratedFile && (
                    <details className="rounded border border-gray-800 bg-black/40">
                      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-gray-200">
                        Source: {selectedGeneratedFile.path}
                      </summary>
                      <PreformattedArtifactView content={selectedGeneratedFile.content} isMobile={false} />
                    </details>
                  )}
                </div>
              ) : isMarkdownArtifact(selectedArtifactMeta.path) ? (
                <MarkdownArtifactView content={selectedArtifactContent} isMobile={false} />
              ) : selectedInvoiceResult ? (
                <InvoiceSummaryView
                  result={selectedInvoiceResult}
                  isMobile={false}
                  onDownloadCsv={() => downloadInvoiceCsv(selectedInvoiceResult)}
                  onDownloadXlsx={() => downloadInvoiceXlsx(selectedInvoiceResult)}
                />
              ) : (
                <PreformattedArtifactView
                  content={selectedArtifactMeta.rawContent?.trim() || selectedArtifactContent}
                  isMobile={false}
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
