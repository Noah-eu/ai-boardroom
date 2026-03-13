type JsonRecord = Record<string, unknown>;

export type DocumentExtractionMode = 'booking' | 'generic';

export interface DocumentTableColumnSpec {
  key: string;
  header: string;
  numeric: boolean;
  candidates: string[];
}

export interface DocumentTableIntent {
  mode: DocumentExtractionMode;
  columns: DocumentTableColumnSpec[];
  includeTotalsRow: boolean;
  sourcePrompt: string;
}

interface IntentOptions {
  defaultMode?: DocumentExtractionMode;
}

interface ColumnAlias {
  key: string;
  numeric: boolean;
  candidates: string[];
  canonicalHeader: string;
  patterns: RegExp[];
}

const COLUMN_ALIASES: ColumnAlias[] = [
  {
    key: 'variableSymbol',
    numeric: false,
    candidates: ['variableSymbol', 'varSymbol', 'vs', 'variable'],
    canonicalHeader: 'Variabilni symbol',
    patterns: [/\bvariable\s*symbol\b/, /\bvariabilni\s*symbol\b/, /\bvariabiln[ií]\s*symbol\b/, /\bvs\b/],
  },
  {
    key: 'amountDueInclVat',
    numeric: true,
    // For generic table exports, map Czech payment/due phrases to amountDueInclVat.
    // Value resolution prefers invoice-currency amount and falls back to CZK/other totals.
    candidates: [
      'amountDueInclVat',
      'amountInInvoiceCurrency',
      'totalPayableAmount',
      'totalPayable',
      'amount',
      'amountCzk',
      'dueAmount',
      'balance',
      'total',
    ],
    canonicalHeader: 'K uhrade s DPH',
    patterns: [
      /\bamount\s*due\b.*\bvat\b/,
      /\bdue\s*amount\b.*\bvat\b/,
      /\bk\s*uhrade\b/,
      /\bcastka\s*k\s*uhrade\b/,
      /\bcastka\s*k\s*uhrade\s*s\s*dph\b/,
      /\bk\s*zaplaceni\b/,
      /\bcastka\s*k\s*zaplaceni\b/,
      /\bcelkova\s*castka\s*k\s*zaplaceni\b/,
      /\bdluzna\s*castka\b/,
      /\bdluzna\s*castka\b.*\bdph\b/,
      /\bk\s*doplaceni\b/,
      /\bzbyva\s*uhradit\b/,
      /\bk\s*platbe\b/,
      /\bcelkem\s*k\s*uhrade\b/,
      /\bcelkem\s*k\s*zaplaceni\b/,
    ],
  },
  {
    key: 'overpaymentInclVat',
    numeric: true,
    candidates: ['overpaymentInclVat', 'overpayment', 'totalOverpayment', 'amount', 'balance'],
    canonicalHeader: 'Preplatek s DPH',
    patterns: [
      /\boverpayment\b.*\bvat\b/,
      /\boverpayment\b/,
      /\bpreplatek\b.*\bdph\b/,
      /\bp[řr]eplatek\b.*\bdph\b/,
      /\bp[řr]eplatek\b/,
    ],
  },
  {
    key: 'invoiceNumber',
    numeric: false,
    candidates: ['invoiceNumber', 'documentNumber', 'number'],
    canonicalHeader: 'Cislo faktury',
    patterns: [/\binvoice\s*number\b/, /\bcislo\s*faktury\b/, /\bčislo\s*faktury\b/, /\bfaktura\b/],
  },
  {
    key: 'issueDate',
    numeric: false,
    candidates: ['issueDate', 'dateIssued'],
    canonicalHeader: 'Datum vystaveni',
    patterns: [/\bissue\s*date\b/, /\bdatum\s*vystaveni\b/, /\bdatum\b/],
  },
  {
    key: 'dueDate',
    numeric: false,
    candidates: ['dueDate', 'maturityDate'],
    canonicalHeader: 'Datum splatnosti',
    patterns: [/\bdue\s*date\b/, /\bdatum\s*splatnosti\b/, /\bsplatnost\b/],
  },
  {
    key: 'currency',
    numeric: false,
    candidates: ['currency'],
    canonicalHeader: 'Mena',
    patterns: [/\bcurrency\b/, /\bmena\b/, /\bm[eě]na\b/],
  },
];

const BOOKING_SIGNALS = [
  /booking\.com/,
  /accommodation\s*id/,
  /identifikacn[ií]\s*cislo\s*ubytovani/,
  /identifika[cč]n[ií]\s*[cč][ií]slo\s*ubytov[áa]n[ií]/,
  /payment\s*service\s*fee/,
  /poplatek\s*za\s*platebn[ií]\s*sluzby/,
  /room\s*sales/,
  /prodej\s*pokoj[uů]/,
  /commission/,
  /provize/,
];

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

function slugToCamelCase(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return 'column';
  const parts = cleaned.split(/\s+/);
  return parts
    .map((part, index) => (index === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`))
    .join('');
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9+\-.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNumber(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function findKnownAlias(label: string): ColumnAlias | null {
  const normalized = normalizeForMatch(label);
  for (const alias of COLUMN_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(normalized))) {
      return alias;
    }
  }
  return null;
}

function parseBulletColumns(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/);
  const columns: string[] = [];
  let collecting = false;

  lines.forEach((line) => {
    const raw = line.trim();
    if (!raw) {
      if (collecting) collecting = false;
      return;
    }

    if (/\b(columns?|sloupce|sloupcu|sloupcich)\b/i.test(raw)) {
      collecting = true;
      const inline = raw.split(':').slice(1).join(':').trim();
      if (inline) {
        inline
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .forEach((entry) => columns.push(entry));
      }
      return;
    }

    const bulletMatch = raw.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch && (collecting || /\b(table|xlsx|csv|column|sloupec|sloupc|tabulk[a-z]*)\b/i.test(prompt))) {
      columns.push(bulletMatch[1].trim());
      collecting = true;
      return;
    }

    if (collecting) {
      collecting = false;
    }
  });

  return Array.from(new Set(columns.map((entry) => entry.replace(/[.;:]$/, '').trim()).filter(Boolean)));
}

function parseInlineColumns(prompt: string): string[] {
  const match = prompt.match(/columns?[ \t]*:[ \t]*([^\n]+)/i) || prompt.match(/sloupc(?:e|u|ich|i)?[ \t]*:[ \t]*([^\n]+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cleanColumnLabel(label: string): string {
  const cleaned = label
    .replace(/\b(dole\s*sou[cč]et|sou[cč]et\s*dole|add\s+a\s+total.*|total\s+at\s+the\s+bottom)\b.*$/i, '')
    .replace(/^\s*(and|a|plus|soucet|total)\s+/i, '')
    .replace(/["'`]+/g, '')
    .replace(/[.;:]$/, '')
    .trim();
  if (/^(and|a|plus|soucet|total)$/i.test(cleaned)) return '';
  return cleaned;
}

function parseRequestedColumns(prompt: string): DocumentTableColumnSpec[] {
  const labels = [...parseBulletColumns(prompt), ...parseInlineColumns(prompt)].map(cleanColumnLabel).filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels));
  return uniqueLabels.map((label) => {
    const alias = findKnownAlias(label);
    if (!alias) {
      return {
        key: slugToCamelCase(normalizeForMatch(label)),
        header: label,
        numeric: false,
        candidates: [slugToCamelCase(normalizeForMatch(label))],
      };
    }

    return {
      key: alias.key,
      header: alias.canonicalHeader,
      numeric: alias.numeric,
      candidates: alias.candidates,
    };
  });
}

function shouldUseGenericMode(prompt: string): boolean {
  const normalized = normalizeForMatch(prompt);
  const hasBookingSignals = BOOKING_SIGNALS.some((pattern) => pattern.test(normalized));
  const hasTableSignals = /\b(table|xlsx|csv|columns?|sloupce|sloupec)\b/.test(normalized);
  const hasCustomColumnSignals = /\b(variable\s*symbol|variabilni\s*symbol|overpayment|preplatek|amount\s*due|k\s*uhrade|k\s*zaplaceni|dluzna\s*castka|k\s*doplaceni|zbyva\s*uhradit|k\s*platbe)\b/.test(
    normalized
  );

  if (hasBookingSignals) return false;
  if (hasTableSignals || hasCustomColumnSignals) return true;
  return false;
}

function hasMissingValue(value: string | number | null): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  return value.trim().length === 0;
}

function resolveKnownColumnValue(row: JsonRecord, column: DocumentTableColumnSpec): string | number | null {
  const pickCandidate = (): string | number | null => {
    for (const candidate of column.candidates) {
      const raw = row[candidate];
      const normalized = toStringOrNumber(raw);
      if (!hasMissingValue(normalized)) return normalized;
    }
    return null;
  };

  if (column.key === 'overpaymentInclVat') {
    const explicit = pickCandidate();
    if (!hasMissingValue(explicit)) {
      const numeric = parseNumber(explicit);
      if (numeric !== null) return Math.abs(numeric);
      return explicit;
    }

    const amount =
      parseNumber(row.amount) ??
      parseNumber(row.amountInInvoiceCurrency) ??
      parseNumber(row.total) ??
      parseNumber(row.balance);
    if (amount === null) return null;

    const amountTypeRaw = String(row.amountType ?? row.type ?? '').toLowerCase();
    const isOverpayment =
      /overpayment|preplatek|přeplatek/.test(amountTypeRaw) ||
      Number(row.normalizedSign ?? row.sign ?? 0) > 0 ||
      amount > 0;
    if (!isOverpayment) return null;
    return Math.abs(amount);
  }

  if (column.key === 'amountDueInclVat') {
    const explicit = pickCandidate();
    if (!hasMissingValue(explicit)) return explicit;

    return (
      toStringOrNumber(row.amountInInvoiceCurrency) ??
      toStringOrNumber(row.totalPayableAmount) ??
      toStringOrNumber(row.totalPayable) ??
      toStringOrNumber(row.amount) ??
      toStringOrNumber(row.balance)
    );
  }

  const value = pickCandidate();
  if (!hasMissingValue(value)) return value;

  const fallbackByKey = toStringOrNumber(row[column.key]);
  if (!hasMissingValue(fallbackByKey)) return fallbackByKey;

  const fallbackByHeader = toStringOrNumber(row[column.header]);
  if (!hasMissingValue(fallbackByHeader)) return fallbackByHeader;

  return null;
}

export function deriveDocumentTableIntent(prompt: string | null | undefined, options?: IntentOptions): DocumentTableIntent {
  const sourcePrompt = (prompt ?? '').trim();
  const defaultMode = options?.defaultMode ?? 'booking';

  if (!sourcePrompt) {
    return {
      mode: defaultMode,
      columns: [],
      includeTotalsRow: false,
      sourcePrompt: '',
    };
  }

  const mode: DocumentExtractionMode = shouldUseGenericMode(sourcePrompt) ? 'generic' : 'booking';
  const columns = mode === 'generic' ? parseRequestedColumns(sourcePrompt) : [];
  const includeTotalsRow = /\b(total|sum at the bottom|sum at bottom|footer total|sou[cč]et dole|dole sou[cč]et|celkem dole|total at the bottom)\b/i.test(
    normalizeForMatch(sourcePrompt)
  );

  return {
    mode,
    columns,
    includeTotalsRow,
    sourcePrompt,
  };
}

export function resolveDocumentColumnValue(
  row: JsonRecord,
  column: DocumentTableColumnSpec
): string | number | null {
  const raw = resolveKnownColumnValue(row, column);
  if (column.numeric) {
    const parsed = parseNumber(raw);
    if (parsed !== null) return parsed;
    return null;
  }
  return raw;
}

export function isDocumentColumnValueMissing(value: string | number | null): boolean {
  return hasMissingValue(value);
}
