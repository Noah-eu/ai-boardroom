'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { z } from 'zod';
import {
  AIProvider,
  AttachmentIngestion,
  AppLanguage,
  Agent,
  AgentName,
  AgentStatus,
  DebateMode,
  ExecutionSnapshot,
  ExecutionOutputBundle,
  ExecutionOutputFile,
  LogEntry,
  ProjectAttachment,
  ProjectAttachmentKind,
  ProjectRevisionCycle,
  ProjectUsage,
  RevisionExecutionStatus,
  OrchestratorState,
  OutputType,
  Project,
  ProjectStatus,
  Task,
  TaskGraph,
  OpenAIModel,
  resolveOpenAiModel,
  UsageTotals,
  WorkflowPhase,
} from '@/types';
import { getFirebaseClient, getFirebaseInitError, getFirebaseStorageBucketName } from '@/lib/firebase';
import {
  createInitialState,
  createLogEntry,
  createMessage,
  createProject,
  DEFAULT_AGENTS,
  generateId,
  PHASE_AGENTS,
  updateAgentStatus,
} from '@/orchestrator';
import { createTask, patchTask } from '@/tasks';
import { Language, TranslationKey, translate, translateWithVars } from '@/i18n';
import { buildDeterministicDocumentExecutionBundle } from '@/lib/documentExporter';
import {
  deriveDocumentTableIntent,
  isDocumentColumnValueMissing,
  resolveDocumentColumnValue,
  type DocumentTableIntent,
} from '@/lib/documentTableIntent';
import {
  buildDeterministicCodeFinalSummary,
  buildDeterministicCodePackagingNotes,
  classifyCodeGenerationMode,
  getModeLabel,
  stabilizeCodeExecutionBundle,
} from '@/lib/codeBundleStabilizer';
import {
  buildDeterministicWebsiteArtifacts,
  buildDeterministicWebsiteCopySections,
  buildDeterministicWebsiteRenderDiagnostics,
  deriveVerifiedWebsiteContentFromPrompt,
  deriveVerifiedWebsiteContent,
  hasSufficientVerifiedWebsiteContent,
  mergeVerifiedWebsiteContent,
  type VerifiedWebsiteContent,
  type WebsiteCopySections,
} from '@/lib/deterministicWebsiteBuilder';
import {
  getLatestArtifactContentWithinWindow,
  hasArtifactContentOutsideWindow,
} from '@/lib/websiteArtifactWindow';
import { normalizeArchitectureReviewInput } from '@/lib/architectureReviewInput';
import { assembleSegmentedWebsiteSeedBundle } from '@/lib/segmentedWebsiteBundle';
import { decideWebsiteGraphStrategy } from '@/lib/websiteGraphStrategy';

type ExecutionSpeed = 'slow' | 'normal' | 'fast';

interface DeadlockTaskDetail {
  taskId: string;
  taskTitle: string;
  unmetDependencies: string[];
}

interface DeadlockState {
  blockedTasks: DeadlockTaskDetail[];
  message: string;
}

const SPEED_CONFIG: Record<ExecutionSpeed, { tickMs: number; minTaskMs: number; maxTaskMs: number }> = {
  slow: { tickMs: 1600, minTaskMs: 2200, maxTaskMs: 3600 },
  normal: { tickMs: 700, minTaskMs: 1300, maxTaskMs: 2800 },
  fast: { tickMs: 300, minTaskMs: 650, maxTaskMs: 1200 },
};

const MAX_REVISION_ROUNDS = 5;
const MIN_EXECUTION_TASK_TIMEOUT_MS = 60_000;
const MAX_EXECUTION_TASK_TIMEOUT_MS = 120_000;
const DEFAULT_EXECUTION_TASK_TIMEOUT_MS = 90_000;
const MAX_AI_ATTACHMENT_SECTIONS = 6;
const MAX_AI_ATTACHMENT_SECTION_CHARS = 2_000;
const MAX_AI_ATTACHMENT_TOTAL_CHARS = 12_000;
const BUILDER_MAX_PDF_FILES_PER_CHUNK = 3;
const BUILDER_MAX_MERGED_ROWS_FOR_FINAL_PROMPT = 220;
const SEGMENTED_WEBSITE_NO_SCRIPT_MARKER = '__NO_SCRIPT__';
const SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH = 'website-content-model.json';
const SEGMENTED_WEBSITE_COPY_ARTIFACTS = [
  { path: 'copy-hero.json', section: 'hero' },
  { path: 'copy-about.json', section: 'about' },
  { path: 'copy-approach.json', section: 'approach' },
  { path: 'copy-topics.json', section: 'topics' },
  { path: 'copy-services-pricing.json', section: 'servicesPricing' },
  { path: 'copy-contact.json', section: 'contact' },
  { path: 'copy-map.json', section: 'map' },
] as const;
const EXECUTION_OUTPUT_ALLOWED_EXTENSIONS = [
  '.html',
  '.css',
  '.js',
  '.json',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
] as const;
const REAL_PLANNER_BUILD_MARKER =
  (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_MARKER ||
    'local')
    .toString()
    .slice(0, 7);

function resolveExecutionTaskTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_EXECUTION_TASK_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_EXECUTION_TASK_TIMEOUT_MS;
  }
  return Math.max(MIN_EXECUTION_TASK_TIMEOUT_MS, Math.min(MAX_EXECUTION_TASK_TIMEOUT_MS, Math.floor(parsed)));
}

function estimatePromptSize(inputText: string, context: unknown): { chars: number; tokensApprox: number } {
  const contextText = (() => {
    try {
      return JSON.stringify(context ?? null);
    } catch {
      return String(context ?? '');
    }
  })();
  const chars = inputText.length + contextText.length;
  return {
    chars,
    tokensApprox: Math.ceil(chars / 4),
  };
}

type AiRespondPayload = {
  projectId: string;
  language: AppLanguage;
  agentRole: string;
  model?: OpenAIModel;
  responseMode?: 'default' | 'structured_execution_bundle';
  inputText: string;
  context?: unknown;
  attachmentContext?: {
    images?: Array<{ url: string; title: string; source?: 'project' | 'message' }>;
  };
};

type AiUsageMeta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type AiRespondMeta = {
  requestedModel: string | null;
  resolvedModel: string;
  reasoningIncluded: boolean;
  reasoningEffort?: string | null;
  textVerbosity?: string | null;
  model: string;
  usage: AiUsageMeta;
  imageContext?: {
    requested: number;
    included: number;
    dropped: number;
    invalid: number;
  };
};

type AiRespondResult = {
  text: string;
  meta: AiRespondMeta | null;
};

type AiRespondLogContext = {
  agent?: AgentName;
};

type AiRespondOptions = {
  timeoutMs?: number;
};

type AiRequestFailureKind = 'infrastructure' | 'request' | 'content';

class AiRequestError extends Error {
  kind: AiRequestFailureKind;
  statusCode: number | null;
  responseContentType: string | null;
  rawBodySnippet: string | null;
  retryable: boolean;

  constructor(params: {
    message: string;
    kind: AiRequestFailureKind;
    statusCode?: number | null;
    responseContentType?: string | null;
    rawBodySnippet?: string | null;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'AiRequestError';
    this.kind = params.kind;
    this.statusCode = params.statusCode ?? null;
    this.responseContentType = params.responseContentType ?? null;
    this.rawBodySnippet = params.rawBodySnippet ?? null;
    this.retryable = params.retryable ?? false;
  }
}

function shortBodySnippet(value: string, maxChars = 600): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function classifyAiRequestFailure(params: {
  statusCode?: number | null;
  contentType?: string | null;
  rawBody?: string | null;
  parseFailed?: boolean;
  timeout?: boolean;
  missingText?: boolean;
}): AiRequestError {
  const statusCode = params.statusCode ?? null;
  const contentType = params.contentType ?? null;
  const rawBody = params.rawBody ?? '';
  const snippet = rawBody ? shortBodySnippet(rawBody) : null;
  const bodyLooksHtml = /<html|<!doctype html|<body/i.test(rawBody);
  const nonJson = Boolean(contentType && !contentType.includes('application/json'));
  const is5xx = statusCode !== null && statusCode >= 500;
  const retryableStatus = statusCode !== null && [502, 503, 504].includes(statusCode);

  if (params.timeout) {
    return new AiRequestError({
      message: 'AI endpoint timeout',
      kind: 'infrastructure',
      statusCode,
      responseContentType: contentType,
      rawBodySnippet: snippet,
      retryable: true,
    });
  }

  if (is5xx || nonJson || bodyLooksHtml || params.parseFailed) {
    return new AiRequestError({
      message:
        `AI endpoint infrastructure failure` +
        (statusCode ? ` (HTTP ${statusCode})` : '') +
        (nonJson || bodyLooksHtml ? ': non-JSON/HTML response' : ''),
      kind: 'infrastructure',
      statusCode,
      responseContentType: contentType,
      rawBodySnippet: snippet,
      retryable: retryableStatus || bodyLooksHtml || nonJson,
    });
  }

  if (params.missingText) {
    return new AiRequestError({
      message: `AI request content failure${statusCode ? ` (HTTP ${statusCode})` : ''}: empty or invalid body`,
      kind: 'content',
      statusCode,
      responseContentType: contentType,
      rawBodySnippet: snippet,
      retryable: false,
    });
  }

  return new AiRequestError({
    message: `AI request failed${statusCode ? ` (HTTP ${statusCode})` : ''}`,
    kind: 'request',
    statusCode,
    responseContentType: contentType,
    rawBodySnippet: snippet,
    retryable: false,
  });
}

type AttachmentIngestApiResponse = {
  ingest?: AttachmentIngestion & { crawlEvents?: string[] };
  error?: string;
};

type AttachmentContextSnapshot = {
  projectAttachments: Array<{ id: string; title: string; kind: ProjectAttachmentKind; status: string }>;
  messageAttachments: Array<{ id: string; title: string; kind: ProjectAttachmentKind; status: string }>;
  textSections: Array<{
    title: string;
    kind: ProjectAttachmentKind;
    source: 'project' | 'message';
    text: string;
  }>;
  images: Array<{
    url: string;
    title: string;
    source: 'project' | 'message';
    attachmentId: string;
  }>;
  droppedImageAttachments: Array<{ attachmentId: string; title: string; source: 'project' | 'message' }>;
  includedAttachmentIds: string[];
};

type AttachmentTypeCounts = {
  images: number;
  pdfs: number;
  urls: number;
  zips: number;
};

type DebateTaskType = 'observational' | 'planning';

type BuilderExtractionRow = {
  sourceAttachmentId: string;
  sourceTitle: string;
  values: Record<string, unknown>;
};

type PdfSnapshotInput = ExecutionSnapshot['pdfTexts'][number];

function getAttachmentTypeCounts(attachments: ProjectAttachment[]): AttachmentTypeCounts {
  return attachments.reduce<AttachmentTypeCounts>(
    (acc, attachment) => {
      if (attachment.kind === 'image') acc.images += 1;
      if (attachment.kind === 'pdf') acc.pdfs += 1;
      if (attachment.kind === 'url') acc.urls += 1;
      if (attachment.kind === 'zip') acc.zips += 1;
      return acc;
    },
    { images: 0, pdfs: 0, urls: 0, zips: 0 }
  );
}

function detectDebateTaskType(task: string): DebateTaskType {
  const normalized = task.toLowerCase();

  const planningSignals = [
    /\bplan\b/,
    /\bstrategy\b/,
    /\barchitecture\b/,
    /\bimplement\b/,
    /\bexecution\b/,
    /\bimprove\b/,
    /\bpropose\b/,
    /\bdesign\b/,
    /\broadmap\b/,
    /\bmvp\b/,
    /\bkrok(y|u)?\b/,
    /\bnavrh(nout|ni)?\b/,
    /\bstrategie\b/,
    /\barchitektur(a|u)\b/,
    /\bimplementa(cni|ce)\b/,
    /\bzleps(i|it|eni)\b/,
    /\bpostup\b/,
  ];

  const observationalSignals = [
    /what is in (the )?(photo|image|picture|screenshot)/,
    /describe (the )?(photo|image|picture|screenshot|webpage|page)/,
    /summari[sz]e (the )?(document|pdf|page|webpage)/,
    /what is on (this|the) (webpage|page|site)/,
    /co je na (fotce|obrazku|screenshotu|strance|webu)/,
    /popi[sš] (mi )?(co je )?na (fotce|obrazku|screenshotu)/,
    /shrn(i|out) (obsah )?(pdf|dokumentu|stranky|webu)/,
    /co vid[ií][šs]/,
  ];

  const hasPlanningSignal = planningSignals.some((pattern) => pattern.test(normalized));
  const hasObservationalSignal = observationalSignals.some((pattern) => pattern.test(normalized));

  if (hasPlanningSignal) return 'planning';
  if (hasObservationalSignal) return 'observational';
  return 'planning';
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function shouldChunkBuilderPdfExtraction(task: Task, artifactPath: string, snapshot: ExecutionSnapshot, project: Project): boolean {
  if (task.agent !== 'Builder') return false;
  if (artifactPath !== 'extracted-rows.json') return false;
  if (snapshot.pdfTexts.length <= resolveBuilderPdfChunkSize(project, snapshot)) return false;

  const intent = [project.outputType, project.description, project.latestRevisionFeedback ?? '', task.title, task.description]
    .join(' ')
    .toLowerCase();
  const extractionSignals = [
    /\binvoice\b/,
    /\binvoices\b/,
    /\bextract\b/,
    /\bextraction\b/,
    /\btabular\b/,
    /\btable\b/,
    /\bcsv\b/,
    /\bfaktur\b/,
    /\buctenk\b/,
    /\bvytezen/i,
  ];

  return project.outputType === 'document' || extractionSignals.some((pattern) => pattern.test(intent));
}

function resolveBuilderPdfChunkSize(project: Project, snapshot: ExecutionSnapshot): number {
  const intent = [project.outputType, project.description, project.latestRevisionFeedback ?? '']
    .join(' ')
    .toLowerCase();
  const extractionHeavy =
    project.outputType === 'document' ||
    /\binvoice\b|\binvoices\b|\bextract\b|\bcsv\b|\bfaktur\b/.test(intent);
  if (!extractionHeavy) {
    return BUILDER_MAX_PDF_FILES_PER_CHUNK;
  }
  return snapshot.pdfTexts.length >= 12 ? 2 : 3;
}

function shouldRunBuilderChunkEnrichment(project: Project, task: Task): boolean {
  const intent = [project.description, project.latestRevisionFeedback ?? '', task.title, task.description]
    .join(' ')
    .toLowerCase();
  return /\bsupplier\b|\baddress\b|\bwarning\b|\bconfidence\b|\bmetadata\b|\bdodavatel\b|\badresa\b/.test(intent);
}

function buildExtractionRowMergeKey(row: BuilderExtractionRow): string {
  const invoiceNumber =
    toStringValue(row.values.invoiceNumber) ??
    toStringValue(row.values.documentNumber) ??
    '';
  const issueDate = toStringValue(row.values.issueDate) ?? '';
  const variableSymbol = toStringValue(row.values.variableSymbol) ?? '';
  const currency = toStringValue(row.values.currency) ?? '';
  const amount =
    toStringValue(row.values.amountInInvoiceCurrency) ??
    toStringValue(row.values.amount) ??
    '';
  return `${row.sourceAttachmentId}::${invoiceNumber}::${issueDate}::${variableSymbol}::${currency}::${amount}`;
}

function mergeChunkPassRows(
  pass1Rows: BuilderExtractionRow[],
  pass2Rows: BuilderExtractionRow[]
): BuilderExtractionRow[] {
  const byKey = new Map<string, BuilderExtractionRow>();
  const orderedKeys: string[] = [];

  pass1Rows.forEach((row) => {
    const key = buildExtractionRowMergeKey(row);
    if (!byKey.has(key)) {
      orderedKeys.push(key);
      byKey.set(key, {
        sourceAttachmentId: row.sourceAttachmentId,
        sourceTitle: row.sourceTitle,
        values: { ...row.values },
      });
      return;
    }
    const existing = byKey.get(key);
    if (!existing) return;
    existing.values = { ...existing.values, ...row.values };
  });

  pass2Rows.forEach((row) => {
    const key = buildExtractionRowMergeKey(row);
    const existing = byKey.get(key);
    if (!existing) return;
    existing.values = { ...existing.values, ...row.values };
  });

  return orderedKeys.map((key) => byKey.get(key)).filter((row): row is BuilderExtractionRow => Boolean(row));
}

function shouldUseStructuredOnlyStage(artifactPath: string): boolean {
  return [
    'normalized-rows.json',
    'validated-rows.json',
    'summary-metadata.json',
    'generated-files.json',
    'final-summary.md',
  ].includes(artifactPath);
}

function getLatestArtifactContent(tasks: Task[], artifactPath: string): string | null {
  for (const task of [...tasks].reverse()) {
    const artifact = task.producesArtifacts.find((entry) => entry.path === artifactPath);
    if (!artifact) continue;
    if (artifact.rawContent?.trim()) return artifact.rawContent;
    if (artifact.content?.trim()) return artifact.content;
  }
  return null;
}

function tryExtractRowsCount(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = parseJsonObjectFromModelText(raw);
    const root = asRecord(parsed);
    if (!root) return null;
    if (Array.isArray(root.rows)) return root.rows.length;
    if (Array.isArray(root.documents)) {
      return root.documents.reduce((acc, document) => {
        const doc = asRecord(document);
        if (!doc) return acc;
        const rows = Array.isArray(doc.rows) ? doc.rows.length : 0;
        return acc + rows;
      }, 0);
    }
    return null;
  } catch {
    return null;
  }
}

function buildSnapshotAttachmentContext(
  snapshot: ExecutionSnapshot,
  includedPdfAttachmentIds?: Set<string>
): AttachmentContextSnapshot {
  const includePdf = (attachmentId: string) => {
    if (!includedPdfAttachmentIds) return true;
    return includedPdfAttachmentIds.has(attachmentId);
  };

  const pdfSections = snapshot.pdfTexts
    .filter((entry) => includePdf(entry.attachmentId))
    .map((entry) => ({
      title: entry.title,
      kind: 'pdf' as const,
      source: entry.source,
      text: entry.text,
    }));

  const zipSections = snapshot.zipSnapshots.map((entry) => ({
    title: entry.title,
    kind: 'zip' as const,
    source: entry.source,
    text: [
      `File tree:\n${entry.fileTree.join('\n')}`,
      `Key files:\n${entry.keyFiles.map((file) => `${file.path}\n${file.content}`).join('\n\n')}`,
      entry.pdfFiles?.length
        ? `PDF extraction:\n${entry.pdfFiles
            .map((file) => `- ${file.path}: ${file.status}${file.error ? ` (${file.error})` : ''}`)
            .join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));

  const siteSections = snapshot.siteSnapshots.map((entry) => ({
    title: entry.title,
    kind: 'url' as const,
    source: entry.source,
    text: [
      entry.pageTitle ? `Page: ${entry.pageTitle}` : '',
      entry.summary ? `Summary: ${entry.summary}` : '',
      entry.structuredData ? `Structured snapshot:\n${JSON.stringify(entry.structuredData, null, 2)}` : '',
      entry.extractedText ?? '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));

  const includedAttachmentIds = [
    ...snapshot.imageInputs.map((entry) => entry.attachmentId),
    ...snapshot.pdfTexts.filter((entry) => includePdf(entry.attachmentId)).map((entry) => entry.attachmentId),
    ...snapshot.zipSnapshots.map((entry) => entry.attachmentId),
    ...snapshot.siteSnapshots.map((entry) => entry.attachmentId),
  ];

  return {
    projectAttachments: snapshot.projectAttachments,
    messageAttachments: snapshot.messageAttachments,
    textSections: [...pdfSections, ...zipSections, ...siteSections],
    images: snapshot.imageInputs.map((entry) => ({
      url: entry.url,
      title: entry.title,
      source: entry.source,
      attachmentId: entry.attachmentId,
    })),
    droppedImageAttachments: [],
    includedAttachmentIds,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function normalizeRowValues(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value).slice(0, 40).map(([key, item]) => {
    if (typeof item === 'string') {
      return [key, shorten(item, 500)] as const;
    }
    if (Array.isArray(item)) {
      return [key, item.slice(0, 20)] as const;
    }
    return [key, item] as const;
  });
  return Object.fromEntries(entries);
}

function toNumber(value: unknown): number | null {
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

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

const REQUIRED_INVOICE_FIELDS_FOR_QUALITY: Array<{ key: string; label: string }> = [
  { key: 'sourceFileName', label: 'sourceFileName' },
  { key: 'invoiceNumber', label: 'invoiceNumber' },
  { key: 'issueDate', label: 'issueDate' },
  { key: 'billingPeriod', label: 'billingPeriod' },
  { key: 'dueDate', label: 'dueDate' },
  { key: 'accommodationId', label: 'accommodationId' },
  { key: 'currency', label: 'currency' },
  { key: 'amountInInvoiceCurrency', label: 'amountInInvoiceCurrency' },
  { key: 'amountCzk', label: 'amountCzk' },
  { key: 'commission', label: 'commission' },
  { key: 'paymentServiceFee', label: 'paymentServiceFee' },
  { key: 'roomSales', label: 'roomSales' },
];

const DEFAULT_GENERIC_EXTRACTION_COLUMNS: DocumentTableIntent['columns'] = [
  {
    key: 'invoiceNumber',
    header: 'invoiceNumber',
    numeric: false,
    candidates: ['invoiceNumber', 'documentNumber', 'number'],
  },
  {
    key: 'variableSymbol',
    header: 'variableSymbol',
    numeric: false,
    candidates: ['variableSymbol', 'varSymbol', 'vs'],
  },
  {
    key: 'amountDueInclVat',
    header: 'amount due incl. VAT',
    numeric: true,
    candidates: ['amountDueInclVat', 'amountInInvoiceCurrency', 'amount', 'total', 'balance'],
  },
];

function normalizeBookingDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return trimmed;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(yearRaw)) return trimmed;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  if (day <= 0 || day > 31 || month <= 0 || month > 12) return trimmed;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function firstRegexCapture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function inferCurrencyFromText(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b(CZK|EUR|USD|GBP|PLN|HUF)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractBookingInvoiceRowFromPdf(entry: PdfSnapshotInput): BuilderExtractionRow | null {
  const text = entry.text ?? '';
  if (!text.trim()) return null;

  const normalizedText = text.replace(/\r/g, '');
  const likelyBooking = /booking\.com|booking\s*\.\s*com/i.test(normalizedText);
  const likelyInvoice = /[Cc]islo\s+faktury|[Čč]íslo\s+faktury|invoice\s+number|[Oo]bdob[ií]|[Pp]rovize/.test(normalizedText);
  if (!likelyBooking && !likelyInvoice) return null;

  const sourceFileName = entry.title;
  const invoiceNumber = firstRegexCapture(normalizedText, [
    /(?:[Čč]íslo|[Cc]islo)\s*faktury\s*[:\-]?\s*([^\n]+)/i,
    /invoice\s*number\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const issueDateRaw = firstRegexCapture(normalizedText, [
    /\b[Dd]atum\b\s*[:\-]?\s*([^\n]+)/i,
    /issue\s*date\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const billingPeriodRaw = firstRegexCapture(normalizedText, [
    /[Oo]bdob[ií]\s*[:\-]?\s*([^\n]+)/i,
    /billing\s*period\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const dueDateRaw = firstRegexCapture(normalizedText, [
    /[Pp]latba\s+splatn[áa]\s*[:\-]?\s*([^\n]+)/i,
    /datum\s+splatnosti\s*[:\-]?\s*([^\n]+)/i,
    /due\s*date\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const accommodationId = firstRegexCapture(normalizedText, [
    /identifika[cč]n[ií]\s+[cč][ií]slo\s+ubytov[áa]n[ií]\s*[:\-]?\s*([^\n]+)/i,
    /accommodation\s*(?:\/|or\s+)?property\s*id\s*[:\-]?\s*([^\n]+)/i,
    /property\s*id\s*[:\-]?\s*([^\n]+)/i,
  ]);

  const totalPayableRaw = firstRegexCapture(normalizedText, [
    /celkov[áa]\s+[cč][áa]stka\s+k\s+zaplacen[ií]\s*[:\-]?\s*([^\n]+)/i,
    /total\s+payable\s+amount\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const amountCzkRaw = firstRegexCapture(normalizedText, [
    /celkov[áa]\s+[cč][áa]stka\s+k\s+zaplacen[ií]\s+v\s+czk\s*[:\-]?\s*([^\n]+)/i,
    /total\s+payable\s+amount\s+in\s+czk\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const commissionRaw = firstRegexCapture(normalizedText, [
    /\b[Pp]rovize\b\s*[:\-]?\s*([^\n]+)/i,
    /\b[Cc]ommission\b\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const paymentServiceFeeRaw = firstRegexCapture(normalizedText, [
    /poplatek\s+za\s+platebn[ií]\s+slu[zž]by\s*[:\-]?\s*([^\n]+)/i,
    /payment\s+service\s+fee\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const roomSalesRaw = firstRegexCapture(normalizedText, [
    /prodej\s+pokoj[uů]\s*[:\-]?\s*([^\n]+)/i,
    /room\s+sales\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const supplierName = firstRegexCapture(normalizedText, [
    /dodavatel\s*[:\-]?\s*([^\n]+)/i,
    /supplier\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const supplierVatId = firstRegexCapture(normalizedText, [
    /(?:DI[CČ]|VAT\s*ID)\s+dodavatele\s*[:\-]?\s*([^\n]+)/i,
    /supplier\s+vat\s*id\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const customerVatId = firstRegexCapture(normalizedText, [
    /(?:DI[CČ]|VAT\s*ID)\s+odb[eě]ratele\s*[:\-]?\s*([^\n]+)/i,
    /customer\s+vat\s*id\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const variableSymbol = firstRegexCapture(normalizedText, [
    /variabiln[ií]\s+symbol\s*[:\-]?\s*([^\n]+)/i,
    /variable\s+symbol\s*[:\-]?\s*([^\n]+)/i,
  ]);

  const currency =
    inferCurrencyFromText(totalPayableRaw) ??
    firstRegexCapture(normalizedText, [
      /\b[Mm][eě]na\b\s*[:\-]?\s*([^\n]+)/i,
      /\bcurrency\b\s*[:\-]?\s*([^\n]+)/i,
    ]) ??
    null;

  const amountInInvoiceCurrency = toNumber(totalPayableRaw);
  const amountCzk = toNumber(amountCzkRaw);
  const commission = toNumber(commissionRaw);
  const paymentServiceFee = toNumber(paymentServiceFeeRaw);
  const roomSales = toNumber(roomSalesRaw);

  const billingPeriod = billingPeriodRaw
    ? billingPeriodRaw.replace(/\s{2,}/g, ' ').trim()
    : null;
  const issueDate = normalizeBookingDate(issueDateRaw);
  const dueDate = normalizeBookingDate(dueDateRaw);

  const keyFactCount = [
    invoiceNumber,
    issueDate,
    billingPeriod,
    dueDate,
    accommodationId,
    currency,
    amountInInvoiceCurrency,
    amountCzk,
    commission,
    paymentServiceFee,
    roomSales,
  ].filter((value) => value !== null && value !== '').length;

  const rowValues: Record<string, unknown> = {
    sourceFileName,
    invoiceNumber,
    issueDate,
    billingPeriod,
    dueDate,
    accommodationId,
    currency: currency ? currency.toUpperCase() : null,
    amountInInvoiceCurrency,
    amountCzk,
    commission,
    paymentServiceFee,
    roomSales,
    supplierName,
    supplierVatId,
    customerVatId,
    variableSymbol,
  };

  if (keyFactCount === 0) {
    rowValues.extractionWarning =
      'Extraction failed: Booking invoice labels were detected but required fields could not be parsed from PDF text.';
    rowValues.extractionStatus = 'extraction_failed';
  }

  return {
    sourceAttachmentId: entry.attachmentId,
    sourceTitle: entry.title,
    values: rowValues,
  };
}

function annotateInvoiceRowQuality(row: BuilderExtractionRow, intent: DocumentTableIntent): BuilderExtractionRow {
  const missingFields =
    intent.mode === 'booking'
      ? REQUIRED_INVOICE_FIELDS_FOR_QUALITY.filter(({ key }) => {
          const value = row.values[key];
          if (typeof value === 'number') return !Number.isFinite(value);
          if (typeof value === 'string') return value.trim().length === 0;
          return value === null || value === undefined;
        }).map(({ label }) => label)
      : intent.columns
          .filter((column) => {
            const resolved = resolveDocumentColumnValue(row.values, column);
            return isDocumentColumnValueMissing(resolved);
          })
          .map((column) => column.header);

  const existingWarning = toStringValue(row.values.extractionWarning) ?? null;
  let qualityWarning: string | null = null;
  let extractionStatus = 'ok';

  if (missingFields.length > 0 && missingFields.length === (intent.mode === 'booking' ? REQUIRED_INVOICE_FIELDS_FOR_QUALITY.length : intent.columns.length)) {
    extractionStatus = 'extraction_failed';
    qualityWarning =
      intent.mode === 'booking'
        ? 'Extraction failed: no required invoice/accounting fields were extracted for this source file.'
        : `Extraction failed: required output columns missing (${missingFields.join(', ')}).`;
  } else if (missingFields.length > 0) {
    extractionStatus = 'fields_missing';
    qualityWarning =
      intent.mode === 'booking'
        ? `Missing required fields: ${missingFields.join(', ')}`
        : `Missing required output columns: ${missingFields.join(', ')}`;
  }

  const combinedWarning = [existingWarning, qualityWarning].filter(Boolean).join(' | ');
  return {
    ...row,
    values: {
      ...row.values,
      extractionStatus,
      extractionWarning: combinedWarning || null,
    },
  };
}

function mergeBookingFallbackRows(
  existingRows: BuilderExtractionRow[],
  pdfChunk: PdfSnapshotInput[],
  intent: DocumentTableIntent
): BuilderExtractionRow[] {
  const mergedRows: BuilderExtractionRow[] = existingRows.map((row): BuilderExtractionRow => ({
    ...row,
    values: {
      ...row.values,
      sourceFileName: row.values.sourceFileName ?? row.sourceTitle,
    },
  }));

  if (intent.mode === 'booking') {
    pdfChunk.forEach((entry) => {
      const fallbackRow = extractBookingInvoiceRowFromPdf(entry);
      if (!fallbackRow) return;

      const existingIndex = mergedRows.findIndex((row) => row.sourceAttachmentId === entry.attachmentId);
      if (existingIndex === -1) {
        mergedRows.push(fallbackRow);
        return;
      }

      const current = mergedRows[existingIndex];
      const mergedValues: Record<string, unknown> = { ...current.values };
      Object.entries(fallbackRow.values).forEach(([key, value]) => {
        const currentValue = mergedValues[key];
        const isCurrentMissing =
          currentValue === null ||
          currentValue === undefined ||
          (typeof currentValue === 'string' && currentValue.trim() === '');
        const isIncomingPresent =
          value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
        if (isCurrentMissing && isIncomingPresent) {
          mergedValues[key] = value;
        }
      });

      mergedRows[existingIndex] = {
        ...current,
        values: mergedValues,
      };
    });
  }

  return mergedRows.map((row) => annotateInvoiceRowQuality(row, intent));
}

function buildMergedRowsSummary(rows: BuilderExtractionRow[], intent: DocumentTableIntent): {
  invoiceCount: number;
  uniqueVariableSymbolCount: number;
  duplicateVariableSymbolCount: number;
  totalOverpayment: number;
  totalUnderpayment: number;
  netTotal: number;
  vatNote: string | null;
  warnings: string[];
  duplicateVariableSymbols: string[];
  filesProcessed: string[];
  filesFailed: string[];
} {
  const symbols = rows
    .map((row) =>
      toStringValue(row.values.variableSymbol) ??
      toStringValue(row.values.varSymbol) ??
      toStringValue(row.values.vs)
    )
    .filter((value): value is string => Boolean(value));

  const frequencies = symbols.reduce<Record<string, number>>((acc, symbol) => {
    acc[symbol] = (acc[symbol] ?? 0) + 1;
    return acc;
  }, {});
  const duplicateVariableSymbols = Object.keys(frequencies).filter((symbol) => frequencies[symbol] > 1);

  const normalized = rows.map((row) => {
    const amount =
      toNumber(row.values.amountInInvoiceCurrency) ??
      toNumber(row.values.amount) ??
      toNumber(row.values.total) ??
      toNumber(row.values.balance) ??
      null;
    const amountTypeRaw =
      (toStringValue(row.values.amountType) ?? toStringValue(row.values.type) ?? '').toLowerCase();
    const isOverType = amountTypeRaw.includes('overpayment') || amountTypeRaw.includes('preplatek') || amountTypeRaw.includes('přeplatek');
    const isUnderType = amountTypeRaw.includes('underpayment') || amountTypeRaw.includes('nedoplatek');

    const explicitSign =
      typeof row.values.normalizedSign === 'number'
        ? row.values.normalizedSign
        : typeof row.values.sign === 'number'
        ? row.values.sign
        : null;
    const sign =
      explicitSign !== null && Number.isFinite(explicitSign)
        ? Math.sign(explicitSign)
        : amount !== null
        ? Math.sign(amount)
        : isOverType
        ? 1
        : isUnderType
        ? -1
        : 0;

    return { amount, sign };
  });

  const totalOverpayment = normalized.reduce((acc, row) => {
    if (row.amount === null || row.sign <= 0) return acc;
    return acc + Math.abs(row.amount);
  }, 0);
  const totalUnderpayment = normalized.reduce((acc, row) => {
    if (row.amount === null || row.sign >= 0) return acc;
    return acc + Math.abs(row.amount);
  }, 0);
  const netTotal = normalized.reduce((acc, row) => {
    if (row.amount === null) return acc;
    return acc + Math.abs(row.amount) * row.sign;
  }, 0);

  const warnings = rows
    .map((row) =>
      toStringValue(row.values.extractionWarning) ??
      toStringValue(row.values.warning)
    )
    .filter((value): value is string => Boolean(value));

  const failedRows = rows.filter((row) => toStringValue(row.values.extractionStatus) === 'extraction_failed').length;
  if (rows.length === 0) {
    warnings.push('Extraction failed: no structured rows were extracted from the provided PDF files.');
  } else if (failedRows === rows.length) {
    warnings.push(
      intent.mode === 'booking'
        ? 'Extraction failed: all extracted rows are missing required invoice/accounting fields.'
        : 'Extraction failed: all extracted rows are missing required fields for requested output.'
    );
  }

  const vatNote =
    rows
      .map((row) =>
        toStringValue(row.values.vatNote) ??
        toStringValue(row.values.note)
      )
      .find((value) => Boolean(value && /\b(vat|dph)\b/i.test(value))) ?? null;

  const filesProcessed = Array.from(new Set(rows.map((row) => row.sourceTitle).filter(Boolean)));
  const filesFailed = rows
    .filter((row) => toStringValue(row.values.extractionStatus) === 'extraction_failed')
    .map((row) => row.sourceTitle)
    .filter((value): value is string => Boolean(value));

  return {
    invoiceCount: rows.length,
    uniqueVariableSymbolCount: new Set(symbols).size,
    duplicateVariableSymbolCount: duplicateVariableSymbols.length,
    totalOverpayment,
    totalUnderpayment,
    netTotal,
    vatNote,
    warnings: Array.from(new Set(warnings)),
    duplicateVariableSymbols,
    filesProcessed,
    filesFailed: Array.from(new Set(filesFailed)),
  };
}

function parseBuilderChunkRows(raw: string, chunkPdfEntries: PdfSnapshotInput[]): BuilderExtractionRow[] {
  const parsed = parseJsonObjectFromModelText(raw);
  const root = asRecord(parsed);
  if (!root) {
    throw new Error('Chunk extraction output is not an object.');
  }

  const documentCandidates = [root.documents, root.results, root.items, root.records].find((candidate) =>
    Array.isArray(candidate)
  );

  if (!Array.isArray(documentCandidates)) {
    throw new Error('Chunk extraction output is missing documents/results/items array.');
  }

  const sourceById = new Map(chunkPdfEntries.map((entry) => [entry.attachmentId, entry] as const));
  const sourceByTitle = new Map(chunkPdfEntries.map((entry) => [entry.title, entry] as const));

  const rows: BuilderExtractionRow[] = [];
  documentCandidates.forEach((docCandidate) => {
    const doc = asRecord(docCandidate);
    if (!doc) return;

    const sourceAttachmentId =
      typeof doc.sourceAttachmentId === 'string' && sourceById.has(doc.sourceAttachmentId)
        ? doc.sourceAttachmentId
        : null;
    const sourceTitle = typeof doc.sourceTitle === 'string' ? doc.sourceTitle : null;

    const resolvedSource =
      (sourceAttachmentId ? sourceById.get(sourceAttachmentId) : null) ??
      (sourceTitle ? sourceByTitle.get(sourceTitle) : null) ??
      null;
    if (!resolvedSource) return;

    const rowCandidates =
      (Array.isArray(doc.rows) ? doc.rows : null) ??
      (Array.isArray(doc.records) ? doc.records : null) ??
      (Array.isArray(doc.items) ? doc.items : null) ??
      [];

    rowCandidates.forEach((rowCandidate) => {
      const record = asRecord(rowCandidate);
      if (!record) return;
      rows.push({
        sourceAttachmentId: resolvedSource.attachmentId,
        sourceTitle: resolvedSource.title,
        values: record,
      });
    });
  });

  return rows;
}

function mergeExtractionRows(rows: BuilderExtractionRow[]): BuilderExtractionRow[] {
  const deduped: BuilderExtractionRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    const key = `${row.sourceAttachmentId}::${stableSerialize(row.values)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });
  return deduped;
}

function buildBuilderChunkPass1Prompt(
  project: Project,
  snapshot: ExecutionSnapshot,
  chunkIndex: number,
  chunkCount: number,
  pdfChunk: PdfSnapshotInput[],
  intent: DocumentTableIntent
): string {
  const genericColumns = intent.columns.length > 0 ? intent.columns : DEFAULT_GENERIC_EXTRACTION_COLUMNS;

  if (intent.mode === 'generic') {
    const genericRowContract = genericColumns.reduce<Record<string, string | number | null>>((acc, column) => {
      acc[column.key] = column.numeric ? 0 : '...';
      return acc;
    }, { sourceFileName: '...', extractionWarning: '...' });

    return [
      project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
      'You are Builder.',
      `Pass 1/2: Extract only fields required for custom table output from PDF chunk ${chunkIndex + 1}/${chunkCount}.`,
      'Return JSON only. No markdown fences or prose.',
      'Contract:',
      JSON.stringify(
        {
          documents: [
            {
              sourceAttachmentId: '...',
              sourceTitle: '...',
              rows: [genericRowContract],
            },
          ],
        },
        null,
        0
      ),
      'Requested output columns (keep exactly this meaning):',
      genericColumns.map((column) => `- ${column.header} -> ${column.key}`).join('\n'),
      'Rules:',
      '- Use only sourceAttachmentId/sourceTitle listed below.',
      '- Keep source mapping exact per row.',
      '- If a document has no rows, return an empty rows array for it.',
      '- Do not include data from files outside this chunk.',
      '- Keep missing fields null/empty; never fabricate values.',
      '- Preserve one row per extracted invoice/record where possible.',
      `Project prompt:\n${shorten(snapshot.projectPrompt, 600)}`,
      `Chunk files:\n${pdfChunk.map((entry) => `- ${entry.attachmentId} | ${entry.title}`).join('\n')}`,
    ].join('\n\n');
  }

  return [
    project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
    'You are Builder.',
    `Pass 1/2: Extract required invoice fields only from PDF chunk ${chunkIndex + 1}/${chunkCount}.`,
    'Return JSON only. No markdown fences or prose.',
    'Contract:',
    '{"documents":[{"sourceAttachmentId":"...","sourceTitle":"...","rows":[{"sourceFileName":"...","invoiceNumber":"...","issueDate":"...","billingPeriod":"...","dueDate":"...","accommodationId":"...","currency":"...","amountInInvoiceCurrency":0,"amountCzk":0,"commission":0,"paymentServiceFee":0,"roomSales":0,"supplierName":"...","supplierVatId":"...","customerVatId":"...","variableSymbol":"..."}]}]}',
    'Rules:',
    '- Use only sourceAttachmentId/sourceTitle listed below.',
    '- Keep source mapping exact per row.',
    '- If a document has no rows, return an empty rows array for it.',
    '- Do not include data from files outside this chunk.',
    '- Pass 1 required fields only; no summaries, no analysis, no prose.',
    '- Keep missing fields null/empty; never fabricate values.',
    '- Booking.com invoices: prefer direct label mapping instead of generic guessing.',
    '- Booking.com label map to target fields:',
    '  Číslo faktury -> invoiceNumber',
    '  Datum -> issueDate',
    '  Období -> billingPeriod',
    '  Platba splatná -> dueDate',
    '  Identifikační číslo ubytování -> accommodationId',
    '  Celková částka k zaplacení -> amountInInvoiceCurrency / currency',
    '  Celková částka k zaplacení v CZK -> amountCzk',
    '  Prodej pokojů -> roomSales',
    '  Provize -> commission',
    '  Poplatek za platební služby -> paymentServiceFee',
    '- If extraction failed for a document, keep null values and set extractionWarning briefly.',
    `Project prompt:\n${shorten(snapshot.projectPrompt, 600)}`,
    `Chunk files:\n${pdfChunk.map((entry) => `- ${entry.attachmentId} | ${entry.title}`).join('\n')}`,
  ].join('\n\n');
}

function buildBuilderChunkPass2Prompt(
  project: Project,
  snapshot: ExecutionSnapshot,
  chunkIndex: number,
  chunkCount: number,
  pdfChunk: PdfSnapshotInput[],
  pass1Rows: BuilderExtractionRow[]
): string {
  return [
    project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
    'You are Builder.',
    `Pass 2/2: Optional enrichment only for PDF chunk ${chunkIndex + 1}/${chunkCount}.`,
    'Return JSON only. No markdown fences or prose.',
    'Contract:',
    '{"documents":[{"sourceAttachmentId":"...","sourceTitle":"...","rows":[{"invoiceNumber":"...","issueDate":"...","variableSymbol":"...","currency":"...","amountInInvoiceCurrency":0,"supplierName":"...","supplierVatId":"...","customerVatId":"...","supplyPoint":"...","note":"...","extractionWarning":"...","confidence":0.0}]}]}',
    'Rules:',
    '- Use only sourceAttachmentId/sourceTitle listed below.',
    '- Keep source mapping exact per row.',
    '- Enrich only optional fields (supplierName, supplierVatId, customerVatId, supplyPoint/address, note, extractionWarning, confidence).',
    '- Keep pass-1 identifier fields in each row so rows can be merged.',
    '- If optional fields are not found, keep them null/empty.',
    '- Do not add summaries or analytics.',
    `Project prompt:\n${shorten(snapshot.projectPrompt, 450)}`,
    `Chunk files:\n${pdfChunk.map((entry) => `- ${entry.attachmentId} | ${entry.title}`).join('\n')}`,
    'Pass-1 extracted rows for this chunk (canonical base):',
    JSON.stringify(
      pass1Rows.map((row) => ({
        sourceAttachmentId: row.sourceAttachmentId,
        sourceTitle: row.sourceTitle,
        values: {
          invoiceNumber: row.values.invoiceNumber ?? null,
          issueDate: row.values.issueDate ?? null,
          variableSymbol: row.values.variableSymbol ?? null,
          currency: row.values.currency ?? null,
          amountInInvoiceCurrency: row.values.amountInInvoiceCurrency ?? row.values.amount ?? null,
        },
      })),
      null,
      2
    ),
  ].join('\n\n');
}

type DraftAttachmentInput =
  | { kind: 'image' | 'pdf' | 'zip' | 'file'; file: File; source?: 'project' | 'message' }
  | { kind: 'url'; url: string; source?: 'project' | 'message' };

const MODEL_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function resolveModelRates(modelName: string | null): { input: number; output: number } {
  if (!modelName) {
    return MODEL_PRICING_PER_MILLION['gpt-4.1-mini'];
  }
  return MODEL_PRICING_PER_MILLION[modelName] ?? MODEL_PRICING_PER_MILLION['gpt-4.1-mini'];
}

function estimateCostUsd(totals: UsageTotals, modelName: string | null): number {
  const rates = resolveModelRates(modelName);
  const inputCost = (totals.inputTokens / 1_000_000) * rates.input;
  const outputCost = (totals.outputTokens / 1_000_000) * rates.output;
  return Number((inputCost + outputCost).toFixed(6));
}

function estimateUsageCostUsd(usage: AiUsageMeta, modelName: string | null): number {
  return estimateCostUsd(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
    modelName
  );
}

const executionOutputFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const executionOutputSchema = z.object({
  status: z.enum(['success', 'failed']),
  summary: z.string().min(1),
  files: z.array(executionOutputFileSchema),
  notes: z.array(z.string()).optional().default([]),
  removePaths: z.array(z.string().min(1)).optional().default([]),
});

function normalizeExecutionFilePath(filePath: string): string {
  return filePath.replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function createRevisionCycle(cycleNumber: number, userPrompt: string): ProjectRevisionCycle {
  return {
    cycleNumber,
    userPrompt,
    requestedAt: new Date(),
    approved: false,
    executionStatus: 'pending',
    baselineUpdated: false,
  };
}

function mergeExecutionBaselineFiles(
  previousFiles: ExecutionOutputFile[],
  bundle: ExecutionOutputBundle
): ExecutionOutputFile[] {
  const merged = new Map<string, string>();
  previousFiles.forEach((file) => {
    merged.set(normalizeExecutionFilePath(file.path), file.content);
  });

  bundle.files.forEach((file) => {
    merged.set(normalizeExecutionFilePath(file.path), file.content);
  });

  (bundle.removePaths ?? []).forEach((filePath) => {
    merged.delete(normalizeExecutionFilePath(filePath));
  });

  return Array.from(merged.entries()).map(([path, content]) => ({ path, content }));
}

function findBuilderExecutionBundle(tasks: Task[]): ExecutionOutputBundle | null {
  const builderTask = [...tasks].reverse().find((task) => task.agent === 'Builder');
  if (!builderTask) return null;
  const generated = builderTask.producesArtifacts.find((artifact) => artifact.path === 'generated-files.json');
  return generated?.executionOutput ?? null;
}

function findIntegratorFinalSummary(tasks: Task[]): string | null {
  const integratorTask = [...tasks].reverse().find((task) => task.agent === 'Integrator');
  if (!integratorTask) return null;
  const finalArtifact = integratorTask.producesArtifacts.find((artifact) => artifact.path === 'final-summary.md');
  return finalArtifact?.content ?? null;
}

function deriveRevisionExecutionStatus(tasks: Task[]): RevisionExecutionStatus {
  if (tasks.some((task) => task.status === 'failed' || task.status === 'canceled_due_to_failed_dependency')) {
    return 'failed';
  }
  if (tasks.some((task) => task.status === 'queued' || task.status === 'blocked' || task.status === 'running')) {
    return 'running';
  }
  if (tasks.some((task) => task.status === 'completed_with_fallback')) return 'completed_with_fallback';
  return 'completed';
}

function isSupportedExecutionFilePath(filePath: string): boolean {
  const normalized = normalizeExecutionFilePath(filePath).toLowerCase();
  if (!normalized || normalized.includes('..')) {
    return false;
  }
  return EXECUTION_OUTPUT_ALLOWED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function taskRequiresHtmlEntry(task: Task, project: Project): boolean {
  if (task.agent !== 'Builder') {
    return false;
  }

  if (project.outputType === 'app' || project.outputType === 'website') {
    return true;
  }

  const combined = [project.description, task.title, task.description].join(' ').toLowerCase();
  return /\b(html|website|web app|webapp|landing page|homepage|page|site)\b/.test(combined);
}

function isSegmentedWebsiteSourceArtifactPath(artifactPath: string): boolean {
  return artifactPath === 'index.html' || artifactPath === 'styles.css' || artifactPath === 'script.js';
}

function isSegmentedWebsiteCopyArtifactPath(artifactPath: string): boolean {
  return SEGMENTED_WEBSITE_COPY_ARTIFACTS.some((entry) => entry.path === artifactPath);
}

function resolveSegmentedWebsiteCopySectionByPath(
  artifactPath: string
): (typeof SEGMENTED_WEBSITE_COPY_ARTIFACTS)[number]['section'] | null {
  const matched = SEGMENTED_WEBSITE_COPY_ARTIFACTS.find((entry) => entry.path === artifactPath);
  return matched?.section ?? null;
}

type SegmentedWebsiteContentModel = {
  schemaVersion: 1;
  type: 'ai-boardroom-segmented-website-content-model';
  generatedAt: string;
  language: AppLanguage;
  sourceMode: 'ingestion' | 'prompt-only' | 'hybrid';
  verified: VerifiedWebsiteContent;
  copySections: WebsiteCopySections;
};

function buildSegmentedWebsiteContentModelPayload(project: Project, snapshot: ExecutionSnapshot): SegmentedWebsiteContentModel | null {
  const ingestionVerified = deriveVerifiedWebsiteContent(snapshot.siteSnapshots);
  const promptVerified = deriveVerifiedWebsiteContentFromPrompt({
    projectName: project.name,
    projectDescription: project.description,
    projectPrompt: snapshot.projectPrompt,
    revisionPrompt: snapshot.revisionPrompt,
    debateSummary: snapshot.approvedDebateSummary,
  });

  const hasIngestion = hasSufficientVerifiedWebsiteContent(ingestionVerified);
  const hasPrompt = hasSufficientVerifiedWebsiteContent(promptVerified);
  const verified = hasIngestion
    ? hasPrompt
      ? mergeVerifiedWebsiteContent(ingestionVerified, promptVerified)
      : ingestionVerified
    : promptVerified;

  if (!hasSufficientVerifiedWebsiteContent(verified)) {
    return null;
  }

  const sourceMode: SegmentedWebsiteContentModel['sourceMode'] = hasIngestion
    ? hasPrompt
      ? 'hybrid'
      : 'ingestion'
    : 'prompt-only';

  return {
    schemaVersion: 1,
    type: 'ai-boardroom-segmented-website-content-model',
    generatedAt: new Date().toISOString(),
    language: project.language,
    sourceMode,
    verified,
    copySections: buildDeterministicWebsiteCopySections({
      projectName: project.name,
      verified,
      language: project.language,
    }),
  };
}

function resolveSegmentedWebsiteContentModelFromTaskArtifacts(
  tasks: Task[],
  snapshot?: ExecutionSnapshot
): SegmentedWebsiteContentModel | null {
  const raw = getLatestArtifactContentWithinWindow(tasks, SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH, {
    minGeneratedAt: snapshot?.createdAt,
  });
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SegmentedWebsiteContentModel>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type !== 'ai-boardroom-segmented-website-content-model') return null;
    if (!parsed.verified || !parsed.copySections) return null;
    return parsed as SegmentedWebsiteContentModel;
  } catch {
    return null;
  }
}

function resolveWebsiteCopySectionsFromTaskArtifacts(
  tasks: Task[],
  snapshot?: ExecutionSnapshot
): Partial<WebsiteCopySections> {
  const model = resolveSegmentedWebsiteContentModelFromTaskArtifacts(tasks, snapshot);
  if (model?.copySections) {
    return model.copySections;
  }

  const output: Partial<WebsiteCopySections> = {};

  SEGMENTED_WEBSITE_COPY_ARTIFACTS.forEach((entry) => {
    const raw = getLatestArtifactContentWithinWindow(tasks, entry.path, {
      minGeneratedAt: snapshot?.createdAt,
    });
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      switch (entry.section) {
        case 'hero':
          output.hero = parsed as WebsiteCopySections['hero'];
          break;
        case 'about':
          output.about = parsed as WebsiteCopySections['about'];
          break;
        case 'approach':
          output.approach = parsed as WebsiteCopySections['approach'];
          break;
        case 'topics':
          output.topics = parsed as WebsiteCopySections['topics'];
          break;
        case 'servicesPricing':
          output.servicesPricing = parsed as WebsiteCopySections['servicesPricing'];
          break;
        case 'contact':
          output.contact = parsed as WebsiteCopySections['contact'];
          break;
        case 'map':
          output.map = parsed as WebsiteCopySections['map'];
          break;
        default:
          break;
      }
    } catch {
      // Invalid section payload is ignored; deterministic defaults remain in use.
    }
  });

  return output;
}

function hasSegmentedWebsiteCrossRunRisk(tasks: Task[], snapshot: ExecutionSnapshot): boolean {
  if (
    hasArtifactContentOutsideWindow(tasks, SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH, {
      minGeneratedAt: snapshot.createdAt,
    })
  ) {
    return true;
  }

  return SEGMENTED_WEBSITE_COPY_ARTIFACTS.some((entry) =>
    hasArtifactContentOutsideWindow(tasks, entry.path, {
      minGeneratedAt: snapshot.createdAt,
    })
  );
}

function hasWebsiteAttachmentSignals(project: Project): boolean {
  return project.attachments.some((attachment) => {
    if (attachment.kind === 'url') return true;
    if (attachment.kind !== 'zip') return false;
    const tree = attachment.ingestion?.zipFileTree ?? [];
    return tree.some((entry) => /\.(html?|css|js|md)$/i.test(entry));
  });
}

function shouldUseSegmentedWebsiteBuild(project: Project, snapshot?: ExecutionSnapshot): boolean {
  if (decideExecutionPipeline(project) !== 'code') {
    return false;
  }

  const intentText = buildWebsiteTaskIntentText(project, snapshot);

  const strategy = decideWebsiteGraphStrategy({
    outputType: project.outputType,
    projectName: project.name,
    projectDescription: project.description,
    projectPrompt: snapshot?.projectPrompt ?? project.description,
    taskIntentText: intentText,
    revisionPrompt: snapshot?.revisionPrompt ?? project.latestRevisionFeedback,
    debateSummary: snapshot?.approvedDebateSummary ?? getLatestOrchestratorSummary(project),
    hasWebsiteAttachmentSignals: hasWebsiteAttachmentSignals(project),
    hasStructuredWebsiteSources: Boolean(snapshot?.siteSnapshots?.length),
  });

  return strategy.kind === 'segmented-website';
}

function resolvePrimaryWebsiteSourceUrl(project: Project, snapshot: ExecutionSnapshot): string | null {
  const fromProjectAttachment = project.attachments
    .find((attachment) => attachment.kind === 'url' && typeof attachment.sourceUrl === 'string' && attachment.sourceUrl.trim())
    ?.sourceUrl;
  if (fromProjectAttachment?.trim()) {
    return fromProjectAttachment.trim();
  }

  const fromSnapshotPages = snapshot.siteSnapshots
    .flatMap((entry) => entry.pages ?? [])
    .map((page) => page.url?.trim())
    .find((url) => Boolean(url));
  if (fromSnapshotPages) {
    return fromSnapshotPages;
  }

  const fromStructured = snapshot.siteSnapshots
    .map((entry) => entry.structuredData?.sourceUrl?.trim())
    .find((url): url is string => Boolean(url));
  if (fromStructured) {
    return fromStructured;
  }

  return null;
}

function buildWebsiteAttachmentHints(snapshot: ExecutionSnapshot): string {
  const structuredSnapshots = snapshot.siteSnapshots
    .map((entry) => entry.structuredData)
    .filter((entry): entry is NonNullable<ExecutionSnapshot['siteSnapshots'][number]['structuredData']> => Boolean(entry));

  const urls = snapshot.siteSnapshots
    .flatMap((entry) => entry.pages ?? [])
    .map((page) => page.url?.trim())
    .filter((url): url is string => Boolean(url));

  const structuredUrls = structuredSnapshots
    .map((entry) => entry.sourceUrl?.trim())
    .filter((url): url is string => Boolean(url));

  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const priceRegex = /(?:\b\d+[\s.,]?\d*\s?(?:CZK|EUR|USD|Kc|Kč|€|\$)\b|\b(?:price|cen[a-y]|tariff|fee)\b[^\n]{0,60})/i;

  const sources = [
    ...snapshot.siteSnapshots.map((entry) => entry.extractedText ?? ''),
    ...snapshot.pdfTexts.map((entry) => entry.text ?? ''),
  ]
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400);

  const emailLines = sources.filter((line) => emailRegex.test(line)).slice(0, 5);
  const priceLines = sources.filter((line) => priceRegex.test(line)).slice(0, 8);

  const structuredEmails = structuredSnapshots.flatMap((entry) => entry.contactFields.emails).slice(0, 10);
  const structuredPhones = structuredSnapshots.flatMap((entry) => entry.contactFields.phones).slice(0, 10);
  const structuredAddresses = structuredSnapshots.flatMap((entry) => entry.contactFields.addresses).slice(0, 6);
  const structuredPrices = structuredSnapshots.flatMap((entry) => entry.pricingFields).slice(0, 10);
  const structuredCtas = structuredSnapshots.flatMap((entry) => entry.ctaTexts).slice(0, 10);
  const structuredMissing = Array.from(new Set(structuredSnapshots.flatMap((entry) => entry.missingFields))).slice(0, 10);

  const uniqueUrls = Array.from(new Set([...structuredUrls, ...urls])).slice(0, 8);

  return [
    'Approved late-added inputs from attachments (use when relevant):',
    uniqueUrls.length ? `- Source URLs:\n${uniqueUrls.map((url) => `  - ${url}`).join('\n')}` : '- Source URLs: none detected',
    structuredEmails.length
      ? `- Emails:\n${structuredEmails.map((line) => `  - ${shorten(line, 160)}`).join('\n')}`
      : emailLines.length
      ? `- Emails:\n${emailLines.map((line) => `  - ${shorten(line, 160)}`).join('\n')}`
      : '- Emails: none detected',
    structuredPhones.length
      ? `- Phones:\n${structuredPhones.map((line) => `  - ${shorten(line, 120)}`).join('\n')}`
      : '- Phones: none detected',
    structuredAddresses.length
      ? `- Addresses:\n${structuredAddresses.map((line) => `  - ${shorten(line, 180)}`).join('\n')}`
      : '- Addresses: none detected',
    structuredPrices.length
      ? `- Prices/tariffs:\n${structuredPrices.map((line) => `  - ${shorten(line, 180)}`).join('\n')}`
      : priceLines.length
      ? `- Prices/tariffs:\n${priceLines.map((line) => `  - ${shorten(line, 180)}`).join('\n')}`
      : '- Prices/tariffs: none detected',
    structuredCtas.length
      ? `- CTA texts:\n${structuredCtas.map((line) => `  - ${shorten(line, 120)}`).join('\n')}`
      : '- CTA texts: none detected',
    structuredMissing.length
      ? `- Missing fields reported by ingestion:\n${structuredMissing.map((line) => `  - ${line}`).join('\n')}`
      : '- Missing fields reported by ingestion: none',
  ].join('\n');
}

function isCodeGeneratedFilesStage(project: Project, task: Task, artifactPath: string): boolean {
  if (task.agent !== 'Builder' || artifactPath !== 'generated-files.json') return false;
  if (isDocumentGeneratedFilesStage(project, task, artifactPath)) return false;
  return decideExecutionPipeline(project) === 'code';
}

function parseExecutionOutputBundle(
  raw: string,
  task: Task,
  project: Project
): { bundle: ExecutionOutputBundle; error: null } | { bundle: null; error: string } {
  let parsed: unknown;
  try {
    parsed = parseJsonObjectFromModelText(raw);
  } catch {
    const trimmed = raw.trim();
    const looksLikeTruncated =
      trimmed.length > 200 &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(']') &&
      !trimmed.endsWith('"');
    if (looksLikeTruncated) {
      return {
        bundle: null,
        error: `Execution output was truncated (${trimmed.length} chars). The model likely hit the output token limit. Try a shorter prompt or simpler project.`,
      };
    }
    return { bundle: null, error: `Execution output is not valid JSON (${trimmed.length} chars).` };
  }

  const result = executionOutputSchema.safeParse(parsed);
  if (!result.success) {
    return { bundle: null, error: 'Execution output does not match the required schema.' };
  }

  const normalizedFiles: ExecutionOutputFile[] = [];
  const seenPaths = new Set<string>();
  for (const file of result.data.files) {
    const normalizedPath = normalizeExecutionFilePath(file.path);
    if (!isSupportedExecutionFilePath(normalizedPath)) {
      return { bundle: null, error: `Unsupported generated file path: ${file.path}` };
    }
    if (seenPaths.has(normalizedPath)) {
      return { bundle: null, error: `Duplicate generated file path: ${normalizedPath}` };
    }
    seenPaths.add(normalizedPath);
    normalizedFiles.push({
      path: normalizedPath,
      content: file.content,
    });
  }

  if (normalizedFiles.length === 0) {
    return { bundle: null, error: 'Execution output must contain at least one file.' };
  }

  if (taskRequiresHtmlEntry(task, project) && !normalizedFiles.some((file) => file.path.toLowerCase() === 'index.html')) {
    return { bundle: null, error: 'Website execution output must include index.html.' };
  }

  const bundle: ExecutionOutputBundle = {
    status: result.data.status,
    summary: result.data.summary,
    files: normalizedFiles,
    notes: result.data.notes ?? [],
    removePaths: (result.data.removePaths ?? [])
      .map((filePath) => normalizeExecutionFilePath(filePath))
      .filter((filePath) => isSupportedExecutionFilePath(filePath)),
  };

  if (bundle.status !== 'success') {
    return { bundle: null, error: 'Execution output returned failed status.' };
  }

  if (isCodeGeneratedFilesStage(project, task, 'generated-files.json')) {
    const stabilized = stabilizeCodeExecutionBundle({
      bundle,
      projectName: project.name,
      projectDescription: project.description,
      latestRevisionFeedback: project.latestRevisionFeedback,
      outputType: project.outputType,
      language: project.language,
    });
    return { bundle: stabilized.bundle, error: null };
  }

  return { bundle, error: null };
}

function artifactRequiresStructuredExecutionOutput(task: Task, artifact: Task['producesArtifacts'][number]): boolean {
  return task.agent === 'Builder' && artifact.path === 'generated-files.json';
}

function artifactCanBeGeneratedLocally(
  project: Project,
  task: Task,
  artifact: Task['producesArtifacts'][number],
  snapshot?: ExecutionSnapshot
): boolean {
  if (task.agent === 'Builder' && artifact.path === 'patch-plan.md') return true;
  if (
    task.agent === 'Builder' &&
    artifact.path === SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH &&
    shouldUseSegmentedWebsiteBuild(project, snapshot)
  ) {
    return true;
  }
  if (
    task.agent === 'Builder' &&
    isSegmentedWebsiteCopyArtifactPath(artifact.path) &&
    shouldUseSegmentedWebsiteBuild(project, snapshot)
  ) {
    return true;
  }
  if (
    task.agent === 'Builder' &&
    isSegmentedWebsiteSourceArtifactPath(artifact.path) &&
    shouldUseSegmentedWebsiteBuild(project, snapshot)
  ) {
    return true;
  }
  if (
    task.agent === 'Builder' &&
    artifact.path === 'generated-files.json' &&
    shouldUseSegmentedWebsiteBuild(project, snapshot)
  ) {
    return true;
  }
  if (decideExecutionPipeline(project) !== 'code') return false;
  if (task.agent === 'Tester' && artifact.path === 'bundle-export.md') return true;
  if (task.agent === 'Integrator' && artifact.path === 'final-summary.md') return true;
  return false;
}

function buildPatchPlanFromExecutionBundle(
  bundle: ExecutionOutputBundle,
  project: Project
): string {
  const heading = project.language === 'cz' ? '# Patch Plan' : '# Patch Plan';
  const summaryHeading = project.language === 'cz' ? '## Summary' : '## Summary';
  const stepsHeading = project.language === 'cz' ? '## Ordered patch steps' : '## Ordered patch steps';
  const filesHeading = project.language === 'cz' ? '## Target files and reasons' : '## Target files and reasons';
  const notesHeading = project.language === 'cz' ? '## Dependencies and rollout notes' : '## Dependencies and rollout notes';
  const emptyNotes = project.language === 'cz' ? '- No additional rollout notes.' : '- No additional rollout notes.';

  const orderedSteps = bundle.files.map((file, index) => {
    const normalizedPath = normalizeExecutionFilePath(file.path);
    const reason = normalizedPath.endsWith('.html')
      ? 'Entry structure and UI markup'
      : normalizedPath.endsWith('.css')
      ? 'Styling and layout rules'
      : normalizedPath.endsWith('.js')
      ? 'Interactive behavior and state handling'
      : normalizedPath.endsWith('.json')
      ? 'Supporting data/config payload'
      : 'Supporting documentation or notes';
    return `${index + 1}. Update ${normalizedPath} to deliver ${reason.toLowerCase()}.`;
  });

  const fileReasons = bundle.files.map((file) => {
    const normalizedPath = normalizeExecutionFilePath(file.path);
    const reason = normalizedPath.endsWith('.html')
      ? 'Primary application shell and visible interface.'
      : normalizedPath.endsWith('.css')
      ? 'Visual styling, spacing, color, and responsive behavior.'
      : normalizedPath.endsWith('.js')
      ? 'Client-side interactions, events, and persistence logic.'
      : normalizedPath.endsWith('.json')
      ? 'Machine-readable support data for the generated output.'
      : 'Supporting documentation for the generated output.';
    return `- ${normalizedPath}: ${reason}`;
  });

  const rolloutNotes = bundle.notes.length > 0 ? bundle.notes.map((note) => `- ${note}`) : [emptyNotes];

  return [
    heading,
    '',
    summaryHeading,
    bundle.summary,
    '',
    stepsHeading,
    ...orderedSteps,
    '',
    filesHeading,
    ...fileReasons,
    '',
    notesHeading,
    ...rolloutNotes,
  ].join('\n');
}

function stripJsonCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function repairJsonStringEscapes(value: string): string {
  let repaired = '';
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (char === '\\') {
      const next = value[index + 1];
      if (next === undefined) {
        repaired += '\\\\';
        continue;
      }

      if (/^["\\/bfnrt]$/.test(next)) {
        repaired += `\\${next}`;
        index += 1;
        continue;
      }

      if (next === 'u') {
        const unicodeDigits = value.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`;
          index += 5;
          continue;
        }
      }

      if (/\s/.test(next)) {
        continue;
      }

      repaired += '\\\\';
      continue;
    }

    if (char === '"') {
      inString = false;
      repaired += char;
      continue;
    }

    if (char === '\n') {
      repaired += '\\n';
      continue;
    }

    if (char === '\r') {
      repaired += '\\r';
      continue;
    }

    if (char === '\t') {
      repaired += '\\t';
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function parseJsonObjectFromModelText(raw: string): unknown {
  const normalizedRaw = raw.trim();
  const candidates = [
    normalizedRaw,
    stripJsonCodeFence(normalizedRaw),
    extractFirstJsonObject(stripJsonCodeFence(normalizedRaw)),
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }

    try {
      return JSON.parse(repairJsonStringEscapes(candidate));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Invalid JSON payload.');
}

function createEmptyUsage(): ProjectUsage {
  return {
    totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    session: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    estimatedProjectCostUsd: 0,
    sessionCostUsd: 0,
    activeModel: null,
    models: [],
    lastUpdatedAt: null,
    persistence: {
      lastSyncedAt: null,
      pendingSync: false,
    },
  };
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function detectFileKind(file: File): ProjectAttachmentKind {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/.test(name)) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || name.endsWith('.zip')) {
    return 'zip';
  }
  return 'file';
}

function normalizeUserUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeAiImageUrl(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('blob:')) {
    return null;
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveAttachmentImageUrl(attachment: ProjectAttachment): string | null {
  return (
    normalizeAiImageUrl(attachment.aiImageDataUrl) ??
    normalizeAiImageUrl(attachment.downloadUrl) ??
    normalizeAiImageUrl(attachment.sourceUrl)
  );
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : null;
      resolve(value && value.startsWith('data:image/') ? value : null);
    };
    try {
      reader.readAsDataURL(file);
    } catch {
      resolve(null);
    }
  });
}

type PortraitAssetPlan = {
  sourceUrl: string;
  assetPath: string;
  alt: string;
};

function inferImageExtensionFromUrl(value: string): string {
  const match = value.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  const ext = match?.[1] ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return ext;
  }
  return 'jpg';
}

function inferImageExtensionFromMime(value: string | null): string {
  const lower = (value ?? '').toLowerCase();
  if (lower.includes('image/png')) return 'png';
  if (lower.includes('image/webp')) return 'webp';
  if (lower.includes('image/gif')) return 'gif';
  if (lower.includes('image/jpeg') || lower.includes('image/jpg')) return 'jpg';
  return 'jpg';
}

function toBase64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildPortraitAssetPlan(snapshot: ExecutionSnapshot): PortraitAssetPlan | null {
  const portrait = snapshot.imageInputs.find((entry) => typeof entry.url === 'string' && entry.url.trim());
  if (!portrait) return null;
  const sourceUrl = portrait.url.trim();
  if (!sourceUrl) return null;

  const ext = sourceUrl.startsWith('data:image/')
    ? inferImageExtensionFromMime(sourceUrl.slice(5, sourceUrl.indexOf(';') > 5 ? sourceUrl.indexOf(';') : undefined))
    : inferImageExtensionFromUrl(sourceUrl);

  const alt = (portrait.description ?? portrait.title ?? 'Portrait').trim() || 'Portrait';
  return {
    sourceUrl,
    assetPath: `assets/portrait.${ext}`,
    alt,
  };
}

async function materializePortraitBundleFile(plan: PortraitAssetPlan): Promise<ExecutionOutputFile | null> {
  if (plan.sourceUrl.startsWith('data:image/')) {
    const dataMatch = plan.sourceUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
    if (!dataMatch?.[1]) {
      return null;
    }
    return {
      path: plan.assetPath,
      content: `base64:${dataMatch[1]}`,
    };
  }

  const fromArrayBufferToBundleFile = (buffer: ArrayBuffer): ExecutionOutputFile | null => {
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) return null;
    return {
      path: plan.assetPath,
      content: `base64:${toBase64FromBytes(bytes)}`,
    };
  };

  try {
    const response = await fetch(plan.sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const mime = response.headers.get('content-type');
    if (mime && !mime.toLowerCase().startsWith('image/')) {
      throw new Error('Non-image response');
    }
    const buffer = await response.arrayBuffer();
    const direct = fromArrayBufferToBundleFile(buffer);
    if (direct) return direct;
  } catch {
    // Fallback to server-side proxy materialization to avoid browser CORS failures.
  }

  try {
    const proxyResponse = await fetch('/api/attachments/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: plan.sourceUrl }),
    });
    if (!proxyResponse.ok) {
      return null;
    }
    const payload = (await proxyResponse.json()) as { base64?: string };
    if (!payload.base64?.trim()) {
      return null;
    }
    return {
      path: plan.assetPath,
      content: `base64:${payload.base64}`,
    };
  } catch {
    return null;
  }
}

function normalizeBucketName(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('gs://')) {
    return trimmed.slice(5).split('/')[0] ?? null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const pathMatch = parsed.pathname.match(/\/b\/([^/]+)/);
      if (pathMatch?.[1]) {
        return decodeURIComponent(pathMatch[1]);
      }
      return parsed.hostname || null;
    } catch {
      return null;
    }
  }

  return trimmed.replace(/^\/+|\/+$/g, '') || null;
}

type FirebaseErrorLike = {
  code?: string;
  message?: string;
};

function getFirebaseErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const maybeCode = (error as FirebaseErrorLike).code;
    return typeof maybeCode === 'string' ? maybeCode : null;
  }
  return null;
}

function getFirebaseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const maybeMessage = (error as FirebaseErrorLike).message;
    if (typeof maybeMessage === 'string') {
      return maybeMessage;
    }
  }
  return 'Unknown Firebase Storage error';
}

type Action =
  | {
      type: 'CREATE_PROJECT';
      projectId?: string;
      name: string;
      description: string;
      language: AppLanguage;
      provider: AIProvider;
      model: OpenAIModel;
      outputType: OutputType;
      simulationMode: boolean;
      debateRounds: number;
      debateMode: DebateMode;
      maxWordsPerAgent: number;
    }
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'START_DEBATE'; task: string; projectId?: string }
  | { type: 'AGENT_SPEAK'; agent: AgentName; content: string }
  | { type: 'ORCHESTRATOR_SUMMARY'; content: string }
  | { type: 'REQUEST_APPROVAL' }
  | { type: 'APPROVE_PLAN' }
  | { type: 'REJECT_PLAN'; feedback: string; attachmentIds?: string[] }
  | { type: 'REVISION_FROM_COMPLETE'; feedback: string; attachmentIds?: string[] }
  | { type: 'SET_PHASE'; phase: WorkflowPhase }
  | { type: 'UPDATE_AGENT_STATUS'; agent: AgentName; status: AgentStatus; lastOutput?: string }
  | { type: 'ADD_USER_MESSAGE'; content: string; attachmentIds?: string[] }
  | { type: 'ADD_LOG'; message: string; level: LogEntry['level']; agent?: AgentName }
  | { type: 'SET_TASK_GRAPH'; projectId: string; taskGraph: TaskGraph }
  | { type: 'ADD_TASK'; projectId: string; task: Task }
  | {
      type: 'UPDATE_TASK';
      projectId: string;
      taskId: string;
      patch: Partial<Omit<Task, 'id' | 'createdAt'>>;
    }
  | {
      type: 'SET_PROJECT_SIMULATION_MODE';
      projectId: string;
      simulationMode: boolean;
    }
  | {
      type: 'SET_PROJECT_DEBATE_ROUNDS';
      projectId: string;
      debateRounds: number;
    }
  | {
      type: 'ADD_PROJECT_USAGE';
      projectId: string;
      model: string;
      usage: AiUsageMeta;
    }
  | {
      type: 'ADD_PROJECT_ATTACHMENT';
      projectId: string;
      attachment: ProjectAttachment;
    }
  | {
      type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION';
      projectId: string;
      attachmentId: string;
      ingestion: Partial<AttachmentIngestion>;
    }
  | {
      type: 'SET_EXECUTION_SNAPSHOT';
      projectId: string;
      snapshot: ExecutionSnapshot;
    }
  | {
      type: 'MARK_REVISION_APPROVED';
      projectId: string;
      cycleNumber: number;
      debateSummary: string;
      snapshotId: string;
    }
  | {
      type: 'COMPLETE_REVISION_CYCLE';
      projectId: string;
      cycleNumber: number;
      status: RevisionExecutionStatus;
      baselineUpdated: boolean;
      finalSummary?: string;
      generatedFilesCount?: number;
    }
  | {
      type: 'SET_STABLE_BASELINE';
      projectId: string;
      bundle: ExecutionOutputBundle;
      files: ExecutionOutputFile[];
    }
  | { type: 'RESET' };

interface AppState extends OrchestratorState {
  projects: Project[];
  selectedProjectId: string | null;
}

function mapPhaseToProjectStatus(phase: WorkflowPhase): ProjectStatus {
  switch (phase) {
    case 'debate':
      return 'debating';
    case 'awaiting-approval':
      return 'awaiting-approval';
    case 'execution':
      return 'executing';
    case 'review':
      return 'reviewing';
    case 'testing':
      return 'testing';
    case 'integration':
      return 'integrating';
    case 'complete':
      return 'complete';
    default:
      return 'idle';
  }
}

function syncProjectById(
  state: AppState,
  projectId: string,
  updater: (project: Project) => Project
): AppState {
  const updatedProjects = state.projects.map((project) =>
    project.id === projectId ? updater(project) : project
  );
  const updatedActiveProject =
    state.activeProject?.id === projectId ? updater(state.activeProject) : state.activeProject;

  return {
    ...state,
    projects: updatedProjects,
    activeProject: updatedActiveProject,
  };
}

function dependencySatisfied(tasks: Task[], dependencyId: string): boolean {
  const dependencyTask = tasks.find((task) => task.id === dependencyId);
  return dependencyTask
  ? dependencyTask.status === 'done' || dependencyTask.status === 'completed_with_fallback'
    : false;
}

function dependenciesSatisfied(tasks: Task[], task: Task): boolean {
  return task.dependsOn.every((dependencyId) => dependencySatisfied(tasks, dependencyId));
}

type TaskPrerequisiteValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'dependency-failed' | 'dependency-pending' | 'artifact-missing' | 'artifact-invalid' | 'artifact-stale';
      dependencyTask?: Task;
      artifactPath?: string;
      details: string;
    };

type DependencyFailureTrace = {
  rootFailedTask: Task;
  chain: Task[];
};

function getPrimaryArtifactPath(task: Task): string | null {
  return task.producesArtifacts[0]?.path ?? null;
}

function getRequiredUpstreamArtifacts(task: Task): Array<{ path: string; requiresExecutionOutput?: boolean }> {
  const primaryArtifact = getPrimaryArtifactPath(task);
  if (!primaryArtifact) return [];

  const isDocumentPipelineTask = /DocumentExtractor|Normalizer|Validator|Summarizer|Exporter/i.test(task.title);
  const isCodePipelineTask =
    /CodePlanner|AppArchitect|WebContentNormalizer|WebCopyBuilder|FileBuilder|WebHtmlBuilder|WebStyleBuilder|WebScriptBuilder|WebBundleAssembler|QA|BundleExporter/i.test(
      task.title
    );

  if (isSegmentedWebsiteCopyArtifactPath(primaryArtifact)) {
    return [
      { path: 'execution-plan.md' },
      { path: 'architecture-review.md' },
      { path: SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH },
    ];
  }

  if (primaryArtifact === SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH) {
    return [{ path: 'execution-plan.md' }, { path: 'architecture-review.md' }];
  }

  if (primaryArtifact === 'index.html') {
    return [
      { path: SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH },
      ...SEGMENTED_WEBSITE_COPY_ARTIFACTS.map((entry) => ({ path: entry.path })),
    ];
  }

  if (primaryArtifact === 'styles.css') {
    return [{ path: 'index.html' }];
  }

  if (primaryArtifact === 'script.js') {
    return [{ path: 'index.html' }, { path: 'styles.css' }];
  }

  if (primaryArtifact === 'normalized-rows.json') {
    return [{ path: 'extracted-rows.json' }];
  }
  if (primaryArtifact === 'validated-rows.json') {
    return [{ path: 'normalized-rows.json' }];
  }
  if (primaryArtifact === 'summary-metadata.json') {
    return [{ path: 'validated-rows.json' }];
  }
  if (primaryArtifact === 'generated-files.json') {
    if (isDocumentPipelineTask) {
      return [
        { path: 'validated-rows.json' },
        { path: 'summary-metadata.json' },
      ];
    }
    if (isCodePipelineTask) {
      if (/WebBundleAssembler/i.test(task.title)) {
        return [
          { path: 'execution-plan.md' },
          { path: 'architecture-review.md' },
          { path: SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH },
          { path: 'index.html' },
          { path: 'styles.css' },
          { path: 'script.js' },
        ];
      }
      return [
        { path: 'execution-plan.md' },
        { path: 'architecture-review.md' },
      ];
    }
  }
  if (primaryArtifact === 'review-notes.md') {
    return [
      { path: 'generated-files.json', requiresExecutionOutput: true },
      { path: 'patch-plan.md' },
    ];
  }
  if (primaryArtifact === 'bundle-export.md') {
    return [
      { path: 'generated-files.json', requiresExecutionOutput: true },
      { path: 'review-notes.md' },
    ];
  }
  if (primaryArtifact === 'final-summary.md') {
    if (isDocumentPipelineTask) {
      return [
        { path: 'generated-files.json', requiresExecutionOutput: true },
        { path: 'summary-metadata.json' },
        { path: 'validated-rows.json' },
      ];
    }
    return [
      { path: 'generated-files.json', requiresExecutionOutput: true },
      { path: 'review-notes.md' },
      { path: 'bundle-export.md' },
    ];
  }

  return [];
}

function isDocumentGeneratedFilesStage(
  project: Project,
  task: Task,
  artifactPath: string
): boolean {
  if (task.agent !== 'Builder' || artifactPath !== 'generated-files.json') return false;

  const requiredPaths = getRequiredUpstreamArtifacts(task).map((entry) => entry.path);
  if (requiredPaths.includes('validated-rows.json') && requiredPaths.includes('summary-metadata.json')) {
    return true;
  }

  // Fallback safety for migrated/legacy task graphs where dependencies might be incomplete.
  return decideExecutionPipeline(project) === 'document';
}

function findTaskProducingArtifact(project: Project, artifactPath: string): Task | null {
  const byDependencyOrder = [...project.tasks].reverse().find((candidate) =>
    candidate.producesArtifacts.some((artifact) => artifact.path === artifactPath)
  );
  return byDependencyOrder ?? null;
}

function validateTaskPrerequisites(project: Project, task: Task): TaskPrerequisiteValidationResult {
  const executionSnapshot = project.executionSnapshot;
  const snapshotCreatedAt = executionSnapshot ? new Date(executionSnapshot.createdAt).getTime() : 0;

  for (const dependencyId of task.dependsOn) {
    const dependencyTask = project.tasks.find((candidate) => candidate.id === dependencyId);
    if (!dependencyTask) {
      return {
        ok: false,
        reason: 'artifact-missing',
        details: `Dependency task not found (${dependencyId}).`,
      };
    }

    if (
      dependencyTask.status === 'failed' ||
      dependencyTask.status === 'canceled_due_to_failed_dependency' ||
      dependencyTask.status === 'blocked_due_to_failed_dependency'
    ) {
      return {
        ok: false,
        reason: 'dependency-failed',
        dependencyTask,
        details: `Dependency ${dependencyTask.title} is ${dependencyTask.status}.`,
      };
    }

    if (dependencyTask.status !== 'done' && dependencyTask.status !== 'completed_with_fallback') {
      return {
        ok: false,
        reason: 'dependency-pending',
        dependencyTask,
        details: `Dependency ${dependencyTask.title} is ${dependencyTask.status}.`,
      };
    }
  }

  const requiredArtifacts = getRequiredUpstreamArtifacts(task);
  for (const requirement of requiredArtifacts) {
    const sourceTask = findTaskProducingArtifact(project, requirement.path);
    if (!sourceTask) {
      return {
        ok: false,
        reason: 'artifact-missing',
        artifactPath: requirement.path,
        details: `Required upstream artifact source task is missing (${requirement.path}).`,
      };
    }

    if (
      sourceTask.status === 'failed' ||
      sourceTask.status === 'canceled_due_to_failed_dependency' ||
      sourceTask.status === 'blocked_due_to_failed_dependency'
    ) {
      return {
        ok: false,
        reason: 'dependency-failed',
        dependencyTask: sourceTask,
        artifactPath: requirement.path,
        details: `Required upstream task ${sourceTask.title} failed before ${requirement.path}.`,
      };
    }

    const artifact = sourceTask.producesArtifacts.find((entry) => entry.path === requirement.path);
    if (!artifact) {
      return {
        ok: false,
        reason: 'artifact-missing',
        dependencyTask: sourceTask,
        artifactPath: requirement.path,
        details: `Required artifact ${requirement.path} not found on ${sourceTask.title}.`,
      };
    }

    if (requirement.requiresExecutionOutput && !artifact.executionOutput) {
      return {
        ok: false,
        reason: 'artifact-invalid',
        dependencyTask: sourceTask,
        artifactPath: requirement.path,
        details: `Required artifact ${requirement.path} has no valid executionOutput.`,
      };
    }

    if (!requirement.requiresExecutionOutput && !artifact.content?.trim()) {
      return {
        ok: false,
        reason: 'artifact-invalid',
        dependencyTask: sourceTask,
        artifactPath: requirement.path,
        details: `Required artifact ${requirement.path} is empty.`,
      };
    }

    if (executionSnapshot) {
      if (!artifact.generatedAt) {
        return {
          ok: false,
          reason: 'artifact-invalid',
          dependencyTask: sourceTask,
          artifactPath: requirement.path,
          details: `Required artifact ${requirement.path} has no generatedAt timestamp for current cycle.`,
        };
      }

      const generatedAt = new Date(artifact.generatedAt).getTime();
      if (generatedAt < snapshotCreatedAt) {
        return {
          ok: false,
          reason: 'artifact-stale',
          dependencyTask: sourceTask,
          artifactPath: requirement.path,
          details: `Required artifact ${requirement.path} is stale for cycle ${executionSnapshot.cycleNumber}.`,
        };
      }
    }
  }

  return { ok: true };
}

function isFailureTerminalStatus(status: Task['status']): boolean {
  return (
    status === 'failed' ||
    status === 'canceled_due_to_failed_dependency' ||
    status === 'blocked_due_to_failed_dependency'
  );
}

type ExecutionPipelineKind = 'document' | 'code';

function decideExecutionPipeline(project: Project): ExecutionPipelineKind {
  const combinedText = [project.name, project.description, project.latestRevisionFeedback ?? '']
    .join(' ')
    .toLowerCase();

  const documentSignals =
    /\binvoice\b|\binvoices\b|\bpdf\b|\bcsv\b|\bxlsx\b|\bextract\b|\breport\b|\bsummary\b|\bfaktur\b|\buctenk\b|\bvyuctovan/i.test(
      combinedText
    );
  const codeSignals =
    /\bapp\b|\bweb\b|\bwebsite\b|\bgame\b|\bpong\b|\btodo\b|\bhtml\b|\bcss\b|\bjavascript\b|\bjs\b|\btypescript\b|\bcode\b|\bfrontend\b|\bui\b/.test(
      combinedText
    );

  const attachments = project.attachments ?? [];
  const pdfLikeAttachments = attachments.filter((attachment) => attachment.kind === 'pdf').length;
  const zipCodeSignals = attachments.some((attachment) => {
    if (attachment.kind !== 'zip') return false;
    const tree = attachment.ingestion?.zipFileTree ?? [];
    return tree.some((entry) => /\.(html|css|js|ts|tsx|jsx|json|md)$/i.test(entry));
  });

  if (project.outputType === 'document') return 'document';
  if (project.outputType === 'app' || project.outputType === 'website') return 'code';

  if (documentSignals && !codeSignals) return 'document';
  if (codeSignals && !documentSignals) return 'code';
  if (pdfLikeAttachments > 0 && !zipCodeSignals) return 'document';

  return 'code';
}

function findDependencyFailureTrace(
  project: Project,
  task: Task,
  visited = new Set<string>()
): DependencyFailureTrace | null {
  if (visited.has(task.id)) {
    return null;
  }
  visited.add(task.id);

  if (task.status === 'failed') {
    return { rootFailedTask: task, chain: [task] };
  }

  for (const dependencyId of task.dependsOn) {
    const dependencyTask = project.tasks.find((candidate) => candidate.id === dependencyId);
    if (!dependencyTask) {
      continue;
    }

    if (dependencyTask.status === 'failed') {
      return {
        rootFailedTask: dependencyTask,
        chain: [task, dependencyTask],
      };
    }

    if (
      dependencyTask.status === 'blocked' ||
      dependencyTask.status === 'canceled_due_to_failed_dependency' ||
      dependencyTask.status === 'blocked_due_to_failed_dependency'
    ) {
      const nested = findDependencyFailureTrace(project, dependencyTask, visited);
      if (nested) {
        return {
          rootFailedTask: nested.rootFailedTask,
          chain: [task, ...nested.chain],
        };
      }
    }
  }

  return null;
}

function summarizeFailureType(errorMessage?: string): string | null {
  if (!errorMessage) return null;
  const normalized = errorMessage.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function formatDependencyFailureMessage(
  task: Task,
  dependencyTask: Task | undefined,
  trace: DependencyFailureTrace | null,
  artifactPath?: string,
  action: 'blocked' | 'canceled' = 'canceled'
): string {
  const immediateTask = dependencyTask ?? trace?.chain[1] ?? trace?.rootFailedTask;
  const rootTask = trace?.rootFailedTask ?? dependencyTask;
  const failureType = summarizeFailureType(rootTask?.errorMessage);
  const artifactInfo = artifactPath ? ` on ${artifactPath}` : '';
  const failureInfo = failureType ? ` (${failureType})` : '';

  if (immediateTask && rootTask && immediateTask.id !== rootTask.id) {
    return `${task.title} ${action} because ${immediateTask.title} was blocked after ${rootTask.title} failed${artifactInfo}${failureInfo}.`;
  }

  if (rootTask) {
    return `${task.title} ${action} because ${rootTask.title} failed${artifactInfo}${failureInfo}.`;
  }

  if (immediateTask) {
    return `${task.title} ${action} because dependency ${immediateTask.title} failed${artifactInfo}.`;
  }

  return `${task.title} ${action} due to failed upstream dependency${artifactInfo}.`;
}

function buildWorkflowFailurePropagationSummary(tasks: Task[]): string | null {
  const rootFailedTask = tasks.find((task) => task.status === 'failed');
  const blockedDueToFailure = tasks.filter(
    (task) => task.status === 'blocked_due_to_failed_dependency'
  ).length;
  const canceledDueToFailure = tasks.filter(
    (task) => task.status === 'canceled_due_to_failed_dependency'
  ).length;
  const downstreamImpacted = blockedDueToFailure + canceledDueToFailure;

  if (!rootFailedTask || downstreamImpacted === 0) {
    return null;
  }

  const failureType = summarizeFailureType(rootFailedTask.errorMessage);
  const failureDetails = failureType ? ` (${failureType})` : '';
  return (
    `Workflow ended due to upstream failure propagation: root cause ${rootFailedTask.title} failed` +
    `${failureDetails}. Downstream impacted: ${downstreamImpacted} task(s)` +
    ` (${blockedDueToFailure} blocked, ${canceledDueToFailure} canceled).`
  );
}

function getLatestOrchestratorSummary(project: Project): string | null {
  const message = [...project.messages]
    .reverse()
    .find((entry) => entry.sender === 'orchestrator' && entry.type === 'system');
  return message?.content ?? null;
}

function buildWebsiteTaskIntentText(project: Project, snapshot?: ExecutionSnapshot): string {
  const recentUserMessages = [...project.messages]
    .reverse()
    .filter((entry) => entry.sender === 'user' && entry.type === 'chat' && entry.content.trim())
    .slice(0, 3)
    .map((entry) => entry.content.trim())
    .reverse();

  const latestRevisionUserPrompt = [...project.revisionHistory]
    .reverse()
    .map((entry) => entry.userPrompt?.trim())
    .find((entry): entry is string => Boolean(entry));

  return [
    project.description,
    snapshot?.projectPrompt ?? '',
    project.latestRevisionFeedback ?? '',
    snapshot?.revisionPrompt ?? '',
    latestRevisionUserPrompt ?? '',
    ...recentUserMessages,
  ]
    .filter((entry) => Boolean(entry && entry.trim()))
    .join('\n');
}

function shorten(value: string | undefined, maxChars: number): string {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function compactAttachmentContextSnapshot(snapshot: AttachmentContextSnapshot): {
  snapshot: AttachmentContextSnapshot;
  originalSectionCount: number;
  keptSectionCount: number;
  originalChars: number;
  keptChars: number;
  truncatedSections: number;
} {
  const originalSectionCount = snapshot.textSections.length;
  const originalChars = snapshot.textSections.reduce((sum, section) => sum + section.text.length, 0);
  let remainingChars = MAX_AI_ATTACHMENT_TOTAL_CHARS;
  let truncatedSections = 0;

  const textSections = snapshot.textSections
    .slice(0, MAX_AI_ATTACHMENT_SECTIONS)
    .map((section) => {
      if (remainingChars <= 0) {
        truncatedSections += 1;
        return null;
      }

      const budget = Math.min(MAX_AI_ATTACHMENT_SECTION_CHARS, remainingChars);
      const text = shorten(section.text, budget);
      if (text.length < section.text.length) {
        truncatedSections += 1;
      }
      remainingChars -= text.length;
      return {
        ...section,
        text,
      };
    })
    .filter((section): section is AttachmentContextSnapshot['textSections'][number] => Boolean(section));

  truncatedSections += Math.max(0, snapshot.textSections.length - MAX_AI_ATTACHMENT_SECTIONS);

  return {
    snapshot: {
      ...snapshot,
      textSections,
    },
    originalSectionCount,
    keptSectionCount: textSections.length,
    originalChars,
    keptChars: textSections.reduce((sum, section) => sum + section.text.length, 0),
    truncatedSections,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.getOwnPropertyNames(value).forEach((prop) => {
    const nested = (value as Record<string, unknown>)[prop];
    if (nested && typeof nested === 'object') {
      deepFreeze(nested);
    }
  });
  return value;
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CREATE_PROJECT': {
      const project = createProject(
        action.name,
        action.description,
        action.language,
        action.outputType,
        action.simulationMode,
        action.debateRounds,
        action.debateMode,
        action.maxWordsPerAgent,
        action.projectId,
        action.provider,
        action.model
      );
      return {
        ...state,
        projects: [...state.projects, project],
        selectedProjectId: project.id,
        activeProject: project,
        currentPhase: 'idle',
        agents: DEFAULT_AGENTS.map((a) => ({ ...a })),
        executionLog: [
          createLogEntry(
            translateWithVars(project.language, 'workflow.projectCreated', { name: project.name }),
            'success'
          ),
        ],
      };
    }

    case 'SELECT_PROJECT': {
      const project = state.projects.find((p) => p.id === action.projectId) ?? null;
      return {
        ...state,
        selectedProjectId: action.projectId,
        activeProject: project,
        currentPhase:
          project?.status === 'debating'
            ? 'debate'
            : project?.status === 'awaiting-approval'
            ? 'awaiting-approval'
            : project?.status === 'executing'
            ? 'execution'
            : project?.status === 'reviewing'
            ? 'review'
            : project?.status === 'testing'
            ? 'testing'
            : project?.status === 'integrating'
            ? 'integration'
            : project?.status === 'complete'
            ? 'complete'
            : 'idle',
      };
    }

    case 'START_DEBATE': {
      const targetProjectId = action.projectId ?? state.activeProject?.id;
      if (!targetProjectId) return state;
      const targetProject = state.projects.find((project) => project.id === targetProjectId);
      if (!targetProject) return state;
      const lang = targetProject.language;
      const welcomeMsg = createMessage(
        'orchestrator',
        translateWithVars(lang, 'workflow.startDebateWelcome', { task: action.task }),
        'system'
      );
      const log = createLogEntry(translate(lang, 'workflow.debateInitiated'), 'info');
      const phaseAgents = PHASE_AGENTS.debate;
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (phaseAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const cycleNumber = targetProject.revisionRound + 1;
      const hasCycle = targetProject.revisionHistory.some((cycle) => cycle.cycleNumber === cycleNumber);
      const updatedProject: Project = {
        ...targetProject,
        currentCycleNumber: cycleNumber,
        revisionHistory: hasCycle
          ? targetProject.revisionHistory
          : [...targetProject.revisionHistory, createRevisionCycle(cycleNumber, action.task)],
        status: 'debating',
        messages: [...targetProject.messages, createMessage('user', action.task), welcomeMsg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: updatedAgents,
        selectedProjectId: updatedProject.id,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'AGENT_SPEAK': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const agentInfo = state.agents.find((a) => a.name === action.agent);
      const msg = createMessage(action.agent, action.content, 'chat', agentInfo?.role);
      const log = createLogEntry(
        translateWithVars(lang, 'workflow.agentContributed', { agent: action.agent }),
        'info',
        action.agent
      );
      const updatedAgents = updateAgentStatus(state.agents, action.agent, 'idle', action.content);
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'ORCHESTRATOR_SUMMARY': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('orchestrator', action.content, 'system');
      const log = createLogEntry(translate(lang, 'workflow.summaryGenerated'), 'info');
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'awaiting-approval',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'awaiting-approval',
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REQUEST_APPROVAL': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('orchestrator', translate(lang, 'workflow.requestApproval'), 'approval-request');
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          messages: [...state.activeProject.messages, msg],
          updatedAt: new Date(),
        },
      };
    }

    case 'APPROVE_PLAN': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('user', translate(lang, 'workflow.approvedResponse'), 'approval-response');
      const log = createLogEntry(translate(lang, 'workflow.approvedLog'), 'success');
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'executing',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'execution',
        agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REJECT_PLAN': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const nextRound = state.activeProject.revisionRound + 1;
      const msg = createMessage('user', action.feedback, 'chat', undefined, action.attachmentIds);
      const log = createLogEntry(
        translateWithVars(lang, 'workflow.revision.requested', { round: nextRound }),
        'warning'
      );
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        currentCycleNumber: nextRound,
        latestRevisionFeedback: action.feedback,
        revisionRound: nextRound,
        revisionHistory: [...state.activeProject.revisionHistory, createRevisionCycle(nextRound, action.feedback)],
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REVISION_FROM_COMPLETE': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const nextRound = state.activeProject.revisionRound + 1;
      const msg = createMessage('user', action.feedback, 'chat', undefined, action.attachmentIds);
      const log = createLogEntry(
        translateWithVars(lang, 'workflow.revision.fromComplete', { round: nextRound }),
        'warning'
      );
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        currentCycleNumber: nextRound,
        latestRevisionFeedback: action.feedback,
        revisionRound: nextRound,
        revisionHistory: [...state.activeProject.revisionHistory, createRevisionCycle(nextRound, action.feedback)],
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'SET_PHASE': {
      if (!state.activeProject) return state;
      const updatedProject: Project = {
        ...state.activeProject,
        status: mapPhaseToProjectStatus(action.phase),
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: action.phase,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
      };
    }

    case 'UPDATE_AGENT_STATUS': {
      const updatedAgents = updateAgentStatus(
        state.agents,
        action.agent,
        action.status,
        action.lastOutput
      );
      return { ...state, agents: updatedAgents };
    }

    case 'ADD_USER_MESSAGE': {
      if (!state.activeProject) return state;
      const msg = createMessage('user', action.content, 'chat', undefined, action.attachmentIds);
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
      };
    }

    case 'ADD_LOG': {
      const log = createLogEntry(action.message, action.level, action.agent);
      return {
        ...state,
        executionLog: [...state.executionLog, log],
      };
    }

    case 'SET_TASK_GRAPH': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        taskGraph: action.taskGraph,
        tasks: action.taskGraph.tasks,
        updatedAt: new Date(),
      }));
    }

    case 'ADD_TASK': {
      return syncProjectById(state, action.projectId, (project) => {
        const nextTasks = [...project.tasks, action.task];
        return {
          ...project,
          tasks: nextTasks,
          taskGraph: project.taskGraph
            ? { ...project.taskGraph, tasks: nextTasks }
            : { tasks: nextTasks, concurrencyLimit: 2, maxRetries: 2 },
          updatedAt: new Date(),
        };
      });
    }

    case 'UPDATE_TASK': {
      return syncProjectById(state, action.projectId, (project) => {
        const updatedTasks = patchTask(project.tasks, action.taskId, action.patch);
        return {
          ...project,
          tasks: updatedTasks,
          taskGraph: project.taskGraph ? { ...project.taskGraph, tasks: updatedTasks } : null,
          updatedAt: new Date(),
        };
      });
    }

    case 'SET_PROJECT_SIMULATION_MODE': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        simulationMode: action.simulationMode,
        updatedAt: new Date(),
      }));
    }
    case 'SET_PROJECT_DEBATE_ROUNDS': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        debateRounds: Math.min(3, Math.max(1, action.debateRounds)),
        updatedAt: new Date(),
      }));
    }

    case 'ADD_PROJECT_USAGE': {
      return syncProjectById(state, action.projectId, (project) => {
        const currentUsage = project.usage ?? createEmptyUsage();
        const nextTotals: UsageTotals = {
          inputTokens: currentUsage.totals.inputTokens + action.usage.inputTokens,
          outputTokens: currentUsage.totals.outputTokens + action.usage.outputTokens,
          totalTokens:
            currentUsage.totals.totalTokens +
            (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
        };
        const nextSession: UsageTotals = {
          inputTokens: currentUsage.session.inputTokens + action.usage.inputTokens,
          outputTokens: currentUsage.session.outputTokens + action.usage.outputTokens,
          totalTokens:
            currentUsage.session.totalTokens +
            (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
        };
        const modelName = action.model || project.model || currentUsage.activeModel || null;
        const modelIndex = currentUsage.models.findIndex((entry) => entry.model === action.model);
        const nextModels = [...currentUsage.models];
        const incrementalCostUsd = estimateUsageCostUsd(action.usage, action.model || project.model || null);

        if (modelIndex >= 0) {
          const current = nextModels[modelIndex];
          nextModels[modelIndex] = {
            ...current,
            calls: current.calls + 1,
            totals: {
              inputTokens: current.totals.inputTokens + action.usage.inputTokens,
              outputTokens: current.totals.outputTokens + action.usage.outputTokens,
              totalTokens:
                current.totals.totalTokens +
                (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
            },
          };
        } else {
          nextModels.push({
            model: action.model,
            calls: 1,
            totals: {
              inputTokens: action.usage.inputTokens,
              outputTokens: action.usage.outputTokens,
              totalTokens: action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens,
            },
          });
        }

        return {
          ...project,
          usage: {
            ...currentUsage,
            totals: nextTotals,
            session: nextSession,
            activeModel: modelName,
            models: nextModels,
            estimatedProjectCostUsd: Number((currentUsage.estimatedProjectCostUsd + incrementalCostUsd).toFixed(6)),
            sessionCostUsd: Number((currentUsage.sessionCostUsd + incrementalCostUsd).toFixed(6)),
            lastUpdatedAt: new Date(),
            persistence: {
              ...currentUsage.persistence,
              pendingSync: true,
            },
          },
          updatedAt: new Date(),
        };
      });
    }

    case 'ADD_PROJECT_ATTACHMENT': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        attachments: [action.attachment, ...project.attachments],
        updatedAt: new Date(),
      }));
    }

    case 'UPDATE_PROJECT_ATTACHMENT_INGESTION': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        attachments: project.attachments.map((attachment) =>
          attachment.id === action.attachmentId
            ? (() => {
                const merged = {
                  ...attachment.ingestion,
                  ...action.ingestion,
                };
                const mergedStatus = merged.status;
                if (!mergedStatus) {
                  return attachment;
                }
                return {
                  ...attachment,
                  ingestion: {
                    ...merged,
                    status: mergedStatus,
                  },
                };
              })()
            : attachment
        ),
        updatedAt: new Date(),
      }));
    }

    case 'SET_EXECUTION_SNAPSHOT': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        executionSnapshot: action.snapshot,
        updatedAt: new Date(),
      }));
    }

    case 'MARK_REVISION_APPROVED': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        revisionHistory: project.revisionHistory.map((cycle) =>
          cycle.cycleNumber === action.cycleNumber
            ? {
                ...cycle,
                approved: true,
                approvedAt: new Date(),
                debateSummary: action.debateSummary,
                executionSnapshotId: action.snapshotId,
                executionStatus: 'running',
              }
            : cycle
        ),
        updatedAt: new Date(),
      }));
    }

    case 'COMPLETE_REVISION_CYCLE': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        revisionHistory: project.revisionHistory.map((cycle) =>
          cycle.cycleNumber === action.cycleNumber
            ? {
                ...cycle,
                executionStatus: action.status,
                baselineUpdated: action.baselineUpdated,
                finalSummary: action.finalSummary ?? cycle.finalSummary,
                generatedFilesCount: action.generatedFilesCount ?? cycle.generatedFilesCount,
                completedAt: new Date(),
              }
            : cycle
        ),
        updatedAt: new Date(),
      }));
    }

    case 'SET_STABLE_BASELINE': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        latestStableBundle: action.bundle,
        latestStableFiles: action.files,
        latestStableUpdatedAt: new Date(),
        updatedAt: new Date(),
      }));
    }

    case 'RESET': {
      return createInitialAppState();
    }

    default:
      return state;
  }
}

function createInitialAppState(): AppState {
  return {
    ...createInitialState(),
    projects: [],
    selectedProjectId: null,
  };
}

interface AppContextValue {
  state: AppState;
  firebaseUid: string | null;
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
  tf: (key: TranslationKey, vars: Record<string, string | number>) => string;
  createProject: (
    name: string,
    description: string,
    projectLanguage: AppLanguage,
    model: OpenAIModel,
    outputType: OutputType,
    simulationMode: boolean,
    debateRounds: number,
    debateMode: DebateMode,
    maxWordsPerAgent: number,
    autoStartDebate?: boolean
  ) => Promise<{ projectId: string }>;
  selectProject: (id: string) => void;
  startDebate: (task: string, projectId?: string) => void;
  agentSpeak: (agent: AgentName, content: string) => void;
  orchestratorSummary: (content: string) => void;
  requestApproval: () => void;
  approvePlan: () => void;
  rejectPlan: (feedback: string, attachmentIds?: string[]) => void;
  requestRevisionFromComplete: (feedback: string, attachmentIds?: string[]) => void;
  updateAgentStatus: (agent: AgentName, status: AgentStatus, lastOutput?: string) => void;
  addUserMessage: (content: string, attachmentIds?: string[]) => void;
  attachToProject: (projectId: string, attachment: DraftAttachmentInput) => Promise<ProjectAttachment>;
  addLog: (message: string, level: LogEntry['level'], agent?: AgentName) => void;
  setProjectSimulationMode: (projectId: string, simulationMode: boolean) => void;
  setProjectDebateRounds: (projectId: string, debateRounds: number) => void;
  schedulerState: {
    isPaused: boolean;
    isComplete: boolean;
    concurrencyLimit: number;
    total: number;
    done: number;
    runningTasks: number;
    queued: number;
    blocked: number;
    failed: number;
    retryLimit: number;
    executionSpeed: ExecutionSpeed;
    autoPauseCheckpoints: boolean;
    deadlock: DeadlockState | null;
  };
  setExecutionSpeed: (speed: ExecutionSpeed) => void;
  setAutoPauseCheckpoints: (enabled: boolean) => void;
  repairDeadlock: () => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  stopExecution: () => void;
  stepExecution: () => void;
  reset: () => void;
  runDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialAppState);
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('cz');
  const [executionSpeed, setExecutionSpeed] = useState<ExecutionSpeed>('normal');
  const [autoPauseCheckpoints, setAutoPauseCheckpoints] = useState(true);
  const executionTaskTimeoutMs = useMemo(() => resolveExecutionTaskTimeoutMs(), []);
  const [pausedSchedulers, setPausedSchedulers] = useState<Record<string, boolean>>({});
  const [deadlocks, setDeadlocks] = useState<Record<string, DeadlockState | null>>({});
  const stateRef = useRef<AppState>(state);
  const executionSpeedRef = useRef<ExecutionSpeed>('normal');
  const schedulerIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const schedulerPausedRef = useRef<Record<string, boolean>>({});
  const taskTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const checkpointHitRef = useRef<Record<string, { approval: boolean }>>({});
  const deadlockSignatureRef = useRef<Record<string, string>>({});
  const completedSnapshotRef = useRef<Record<string, string>>({});
  const debateRunsRef = useRef<Record<string, boolean>>({});
  const debateRoundStateRef = useRef<Record<string, { isRunning: boolean; currentRound: number }>>({});
  const projectPhaseRef = useRef<Record<string, WorkflowPhase>>({});
  const firebaseConnectedLoggedRef = useRef(false);
  const firebaseErrorLoggedRef = useRef(false);
  const firebaseBucketLoggedRef = useRef(false);
  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);
  const tf = useCallback(
    (key: TranslationKey, vars: Record<string, string | number>) =>
      translateWithVars(language, key, vars),
    [language]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    executionSpeedRef.current = executionSpeed;
  }, [executionSpeed]);

  useEffect(() => {
    let unsubAuth: (() => void) | undefined;

    const logFirebaseError = (message: string) => {
      if (firebaseErrorLoggedRef.current) {
        return;
      }
      firebaseErrorLoggedRef.current = true;
      dispatch({
        type: 'ADD_LOG',
        level: 'error',
        message: `Firebase: ${message}. Continuing in simulation mode.`,
      });
    };

    const logBucketInfo = (clientBucket: string | null) => {
      if (firebaseBucketLoggedRef.current) {
        return;
      }
      firebaseBucketLoggedRef.current = true;
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message:
          `Firebase Storage bucket: runtime=${clientBucket ?? '<missing>'}` +
          `, config=${getFirebaseStorageBucketName() ?? '<missing>'}`,
      });
    };

    const ensureAnonymousSignIn = async (currentUser: User | null) => {
      if (currentUser) {
        setFirebaseUid(currentUser.uid);
        if (!firebaseConnectedLoggedRef.current) {
          firebaseConnectedLoggedRef.current = true;
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firebase: connected (uid: ${currentUser.uid})`,
          });
        }
        const client = getFirebaseClient();
        const runtimeBucket = client?.storage?.app?.options?.storageBucket?.toString?.() ?? null;
        logBucketInfo(runtimeBucket);
        return;
      }

      setFirebaseUid(null);
      try {
        const client = getFirebaseClient();
        if (!client) {
          logFirebaseError(getFirebaseInitError() ?? 'initialization failed');
          return;
        }
        const credential = await signInAnonymously(client.auth);
        setFirebaseUid(credential.user.uid);
        if (!firebaseConnectedLoggedRef.current) {
          firebaseConnectedLoggedRef.current = true;
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firebase: connected (uid: ${credential.user.uid})`,
          });
        }
        const runtimeBucket = client.storage?.app?.options?.storageBucket?.toString?.() ?? null;
        logBucketInfo(runtimeBucket);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'anonymous authentication failed';
        logFirebaseError(detail);
      }
    };

    try {
      const client = getFirebaseClient();
      if (!client) {
        logFirebaseError(getFirebaseInitError() ?? 'initialization failed');
        return;
      }

      unsubAuth = onAuthStateChanged(
        client.auth,
        (user) => {
          void ensureAnonymousSignIn(user);
        },
        (error) => {
          const detail = error instanceof Error ? error.message : 'auth state tracking failed';
          logFirebaseError(detail);
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'initialization failed';
      logFirebaseError(detail);
    }

    return () => {
      if (unsubAuth) {
        unsubAuth();
      }
    };
  }, []);

  const translateProject = useCallback((projectLanguage: AppLanguage, key: TranslationKey) => {
    return translate(projectLanguage, key);
  }, []);

  const translateProjectWithVars = useCallback(
    (projectLanguage: AppLanguage, key: TranslationKey, vars: Record<string, string | number>) => {
      return translateWithVars(projectLanguage, key, vars);
    },
    []
  );

  const resolveAiRespondEndpoint = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.host.includes('netlify.app')) {
      return '/.netlify/functions/ai-respond';
    }
    return '/api/ai/respond';
  }, []);

  const buildAttachmentContext = useCallback((project: Project): AttachmentContextSnapshot => {
    const projectAttachments = project.attachments.filter((attachment) => (attachment.source ?? 'message') === 'project');
    const messageAttachments = project.attachments.filter((attachment) => (attachment.source ?? 'message') === 'message');
    const includedAttachmentIds: string[] = [];
    const textSections: Array<{ title: string; kind: ProjectAttachmentKind; source: 'project' | 'message'; text: string }> = [];
    const images: Array<{ url: string; title: string; source: 'project' | 'message'; attachmentId: string }> = [];
    const droppedImageAttachments: Array<{ attachmentId: string; title: string; source: 'project' | 'message' }> = [];

    for (const attachment of project.attachments) {
      const source = (attachment.source ?? 'message') as 'project' | 'message';
      const ingestion = attachment.ingestion;
      const fallbackSourceUrl =
        attachment.kind === 'url'
          ? (attachment.sourceUrl ?? attachment.downloadUrl ?? ingestion?.sourceUrl)?.trim()
          : '';
      let included = false;

      const hasValidImageUrl = attachment.kind === 'image' ? resolveAttachmentImageUrl(attachment) : null;
      if (attachment.kind === 'image') {
        if (hasValidImageUrl) {
          images.push({
            url: hasValidImageUrl,
            title: attachment.title,
            source,
            attachmentId: attachment.id,
          });
          included = true;
        } else {
          droppedImageAttachments.push({
            attachmentId: attachment.id,
            title: attachment.title,
            source,
          });
        }
      }

      if (attachment.kind === 'image' && hasValidImageUrl) {
        included = true;
      }

      if (attachment.kind === 'url' && fallbackSourceUrl) {
        textSections.push({
          title: `${attachment.title} (source URL)`,
          kind: attachment.kind,
          source,
          text: [`Primary source URL: ${fallbackSourceUrl}`, ingestion?.summary ? `Ingestion status: ${ingestion.summary}` : '']
            .filter(Boolean)
            .join('\n'),
        });
        included = true;
      }

      if (ingestion?.extractedText) {
        textSections.push({
          title: attachment.title,
          kind: attachment.kind,
          source,
          text: ingestion.extractedText,
        });
        included = true;
        if (attachment.kind === 'url' && ingestion.urlStructuredData) {
          textSections.push({
            title: `${attachment.title} (structured snapshot)`,
            kind: attachment.kind,
            source,
            text: JSON.stringify(ingestion.urlStructuredData, null, 2),
          });
        }
      } else if (attachment.kind === 'url' && ingestion?.urlStructuredData) {
        textSections.push({
          title: `${attachment.title} (structured snapshot)`,
          kind: attachment.kind,
          source,
          text: JSON.stringify(ingestion.urlStructuredData, null, 2),
        });
        included = true;
      } else if (attachment.kind === 'zip' && ingestion?.zipFileTree) {
        const zipSummary = [
          `File tree:\n${ingestion.zipFileTree.slice(0, 80).join('\n')}`,
          ingestion.zipKeyFiles?.length
            ? `Key files:\n${ingestion.zipKeyFiles
                .map((file) => `${file.path}\n${file.content}`)
                .join('\n\n')}`
            : '',
          ingestion.zipPdfFiles?.length
            ? `PDF extraction:\n${ingestion.zipPdfFiles
                .map((file) => `- ${file.path}: ${file.status}${file.error ? ` (${file.error})` : ''}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        textSections.push({
          title: attachment.title,
          kind: attachment.kind,
          source,
          text: zipSummary,
        });
        included = true;
      }

      if (included) {
        includedAttachmentIds.push(attachment.id);
      }
    }

    return {
      projectAttachments: projectAttachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        kind: attachment.kind,
        status: attachment.ingestion?.status ?? 'uploaded',
      })),
      messageAttachments: messageAttachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        kind: attachment.kind,
        status: attachment.ingestion?.status ?? 'uploaded',
      })),
      textSections,
      images,
      droppedImageAttachments,
      includedAttachmentIds,
    };
  }, []);

  const createExecutionSnapshot = useCallback((project: Project): ExecutionSnapshot => {
    const approvedDebateSummary = getLatestOrchestratorSummary(project) ?? '';
    const cycleNumber = project.revisionRound + 1;
    const attachmentContext = buildAttachmentContext(project);
    const imageInputs: ExecutionSnapshot['imageInputs'] = [];
    const pdfTexts: ExecutionSnapshot['pdfTexts'] = [];
    const zipSnapshots: ExecutionSnapshot['zipSnapshots'] = [];
    const siteSnapshots: ExecutionSnapshot['siteSnapshots'] = [];
    const missingInputNotes: string[] = [];

    const buildZipInnerPdfAttachmentId = (zipAttachmentId: string, innerPath: string): string => {
      return `${zipAttachmentId}::${innerPath.toLowerCase()}`;
    };

    for (const attachment of project.attachments) {
      const source = (attachment.source ?? 'message') as 'project' | 'message';
      const ingestion = attachment.ingestion;

      if (attachment.kind === 'image') {
        const resolvedUrl = resolveAttachmentImageUrl(attachment);
        if (resolvedUrl) {
          imageInputs.push({
            attachmentId: attachment.id,
            title: attachment.title,
            source,
            url: resolvedUrl,
            description: ingestion?.summary ?? ingestion?.excerpt,
          });
        } else {
          missingInputNotes.push(`Image input missing URL: ${attachment.title}`);
        }
      }

      if (attachment.kind === 'pdf') {
        if (ingestion?.extractedText?.trim()) {
          pdfTexts.push({
            attachmentId: attachment.id,
            title: attachment.title,
            source,
            text: shorten(ingestion.extractedText, 24_000),
          });
        } else {
          missingInputNotes.push(`PDF text missing or unreadable: ${attachment.title}`);
        }
      }

      if (attachment.kind === 'zip') {
        if (ingestion?.zipFileTree?.length) {
          const zipPdfFiles = (ingestion.zipPdfFiles ?? []).map((file) => ({
            path: file.path,
            status: file.status,
            pageCount: file.pageCount,
            extractedText: file.extractedText ? shorten(file.extractedText, 24_000) : undefined,
            error: file.error,
          }));

          zipPdfFiles.forEach((innerPdf) => {
            if (innerPdf.status === 'ingested' && innerPdf.extractedText?.trim()) {
              pdfTexts.push({
                attachmentId: buildZipInnerPdfAttachmentId(attachment.id, innerPdf.path),
                title: `${attachment.title} :: ${innerPdf.path}`,
                source,
                text: innerPdf.extractedText,
              });
            } else {
              missingInputNotes.push(
                `ZIP PDF text unavailable: ${attachment.title} -> ${innerPdf.path}` +
                  (innerPdf.error ? ` (${innerPdf.error})` : '')
              );
            }
          });

          zipSnapshots.push({
            attachmentId: attachment.id,
            title: attachment.title,
            source,
            fileTree: ingestion.zipFileTree.slice(0, 300),
            keyFiles: (ingestion.zipKeyFiles ?? []).slice(0, 12).map((file) => ({
              path: file.path,
              content: shorten(file.content, 3_500),
            })),
            pdfFiles: zipPdfFiles,
          });
        } else {
          missingInputNotes.push(`ZIP tree missing or unreadable: ${attachment.title}`);
        }
      }

      if (attachment.kind === 'url') {
        const fallbackSourceUrl = (attachment.sourceUrl ?? attachment.downloadUrl ?? ingestion?.sourceUrl)?.trim();
        if (ingestion?.extractedText || ingestion?.urlPages?.length || ingestion?.urlStructuredData || fallbackSourceUrl) {
          const fallbackPages = fallbackSourceUrl
            ? [
                {
                  url: fallbackSourceUrl,
                  title: 'Attached source URL',
                  summary: 'Source URL attached; crawl content may still be processing.',
                  excerpt: 'Source URL attached; crawl content may still be processing.',
                },
              ]
            : undefined;
          const fallbackText = fallbackSourceUrl
            ? `Primary source URL: ${fallbackSourceUrl}`
            : undefined;
          siteSnapshots.push({
            attachmentId: attachment.id,
            title: attachment.title,
            source,
            pageTitle: ingestion?.pageTitle,
            summary: ingestion?.summary ?? (fallbackSourceUrl ? `Attached source URL: ${fallbackSourceUrl}` : undefined),
            extractedText: ingestion?.extractedText?.trim()
              ? shorten(ingestion.extractedText, 24_000)
              : fallbackText,
            pages: ingestion?.urlPages?.slice(0, 10).map((page) => ({
              url: page.url,
              title: page.title,
              summary: page.summary,
              excerpt: shorten(page.excerpt, 700),
            })) ?? fallbackPages,
            structuredData: ingestion?.urlStructuredData,
          });
        } else {
          missingInputNotes.push(`Site snapshot missing or unreadable: ${attachment.title}`);
        }
      }
    }

    if (!approvedDebateSummary.trim()) {
      missingInputNotes.push('Approved debate summary missing.');
    }

    const snapshot: ExecutionSnapshot = {
      id: `snapshot-${generateId()}`,
      createdAt: new Date(),
      cycleNumber,
      revisionPrompt: project.latestRevisionFeedback,
      projectPrompt: project.description,
      approvedDebateSummary,
      latestStableSummary: project.latestStableBundle?.summary ?? null,
      latestStableFiles: project.latestStableFiles,
      projectAttachments: attachmentContext.projectAttachments,
      messageAttachments: attachmentContext.messageAttachments,
      imageInputs,
      pdfTexts,
      zipSnapshots,
      siteSnapshots,
      missingInputNotes,
    };

    return deepFreeze(snapshot);
  }, [buildAttachmentContext]);

  const callAiRespond = useCallback(
    async (
      payload: AiRespondPayload,
      logContext?: AiRespondLogContext,
      attachmentSnapshot?: AttachmentContextSnapshot,
      options?: AiRespondOptions
    ): Promise<AiRespondResult> => {
      const role = payload.agentRole;
      const project = stateRef.current.projects.find((candidate) => candidate.id === payload.projectId);
      const attachmentContext = attachmentSnapshot ?? (project ? buildAttachmentContext(project) : null);
      const compactedAttachmentContext = attachmentContext
        ? compactAttachmentContextSnapshot(attachmentContext)
        : null;
      const requestAttachmentContext = compactedAttachmentContext?.snapshot ?? attachmentContext;
      const imageContextByUrl = new Map<
        string,
        {
          url: string;
          title: string;
          source: 'project' | 'message';
          attachmentIds: string[];
        }
      >();

      if (requestAttachmentContext) {
        requestAttachmentContext.images.forEach((image) => {
          const existing = imageContextByUrl.get(image.url);
          if (existing) {
            if (!existing.attachmentIds.includes(image.attachmentId)) {
              existing.attachmentIds.push(image.attachmentId);
            }
            return;
          }
          imageContextByUrl.set(image.url, {
            url: image.url,
            title: image.title,
            source: image.source,
            attachmentIds: [image.attachmentId],
          });
        });
      }

      const aiImages = Array.from(imageContextByUrl.values()).slice(0, 8);
      const requestedModel = payload.model ?? project?.model ?? undefined;
      const requestPayload: AiRespondPayload = {
        ...payload,
        model: requestedModel,
        context: {
          ...(typeof payload.context === 'object' && payload.context !== null ? payload.context : { raw: payload.context ?? null }),
          attachments: requestAttachmentContext
            ? {
                projectAttachments: requestAttachmentContext.projectAttachments,
                messageAttachments: requestAttachmentContext.messageAttachments,
                extractedSections: requestAttachmentContext.textSections.map((section) => ({
                  title: section.title,
                  source: section.source,
                  kind: section.kind,
                  content: section.text,
                })),
              }
            : null,
        },
        attachmentContext: {
          images: aiImages.map((image) => ({
            url: image.url,
            title: image.title,
            source: image.source,
          })),
        },
      };

      console.info(
        '[ai/respond][client] request boundary',
        JSON.stringify({
          projectId: payload.projectId,
          agentRole: payload.agentRole,
          selectedModel: requestedModel ?? null,
          projectModel: project?.model ?? null,
          imageCount: aiImages.length,
        })
      );

      if (logContext) {
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          agent: logContext.agent,
          message: translateProjectWithVars(payload.language, 'workflow.openai.callStart', { role }),
        });

        if (aiImages.length > 0) {
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: logContext.agent,
            message: `Image attachment included in AI context (${aiImages.length})`,
          });
        }

        if (compactedAttachmentContext && compactedAttachmentContext.truncatedSections > 0) {
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: logContext.agent,
            message:
              `AI context trimmed: kept ${compactedAttachmentContext.keptSectionCount}/` +
              `${compactedAttachmentContext.originalSectionCount} text sections, ` +
              `chars ${compactedAttachmentContext.keptChars}/${compactedAttachmentContext.originalChars}.`,
          });
        }

        if (requestAttachmentContext && requestAttachmentContext.images.length > aiImages.length) {
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: logContext.agent,
            message: `Image context truncated to ${aiImages.length} item(s) for OpenAI request limit.`,
          });
        }

        if (
          requestAttachmentContext &&
          requestAttachmentContext.droppedImageAttachments.length > 0
        ) {
          const droppedTitles = requestAttachmentContext.droppedImageAttachments
            .map((image) => image.title)
            .slice(0, 3)
            .join(', ');
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: logContext.agent,
            message:
              `Image attachment warning: ${requestAttachmentContext.droppedImageAttachments.length} image(s) ` +
              `could not be linked to AI (missing server-reachable URL).` +
              (droppedTitles ? ` Example: ${droppedTitles}` : ''),
          });
        }

        const urlSnapshotSections =
          attachmentContext?.textSections.filter((section) => section.kind === 'url').length ?? 0;
        if (urlSnapshotSections > 0) {
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: logContext.agent,
            message: `Site snapshot included in AI context: ${urlSnapshotSections}`,
          });
        }

        const totalImageAttachments = project
          ? project.attachments.filter((attachment) => attachment.kind === 'image').length
          : 0;
        if (totalImageAttachments > 0 && aiImages.length === 0) {
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: logContext.agent,
            message:
              'Image attachment warning: no image was available to the OpenAI request. Agents may not analyze the photo.',
          });
        }
      }

      try {
        const endpoint = resolveAiRespondEndpoint();
        const maxAttempts = 2;
        const timeoutMs = options?.timeoutMs;
        let responsePayload: { text?: string; error?: string; meta?: AiRespondMeta } | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const controller = new AbortController();
          const timeoutHandle =
            typeof timeoutMs === 'number' && timeoutMs > 0
              ? setTimeout(() => controller.abort(), timeoutMs)
              : null;

          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify(requestPayload),
            });

            const contentType = response.headers.get('content-type') ?? '';
            const rawBody = await response.text();
            let data: { text?: string; error?: string; meta?: AiRespondMeta } | null = null;

            if (contentType.includes('application/json')) {
              try {
                data = JSON.parse(rawBody) as { text?: string; error?: string; meta?: AiRespondMeta };
              } catch {
                data = null;
              }
            }

            if (!data) {
              throw classifyAiRequestFailure({
                statusCode: response.status,
                contentType,
                rawBody,
                parseFailed: true,
              });
            }

            if (!response.ok) {
              throw classifyAiRequestFailure({
                statusCode: response.status,
                contentType,
                rawBody: data.error ?? rawBody,
              });
            }

            if (!data.text) {
              throw classifyAiRequestFailure({
                statusCode: response.status,
                contentType,
                rawBody,
                missingText: true,
              });
            }

            responsePayload = data;
            break;
          } catch (error) {
            const classifiedError =
              error instanceof AiRequestError
                ? error
                : error instanceof DOMException && error.name === 'AbortError'
                ? classifyAiRequestFailure({ timeout: true })
                : new AiRequestError({
                    message: error instanceof Error ? error.message : 'Unknown AI request failure',
                    kind: 'request',
                  });

            const canRetry = classifiedError.retryable && attempt < maxAttempts;
            if (canRetry) {
              const backoffMs = 350 * attempt;
              dispatch({
                type: 'ADD_LOG',
                level: 'warning',
                agent: logContext?.agent,
                message:
                  `AI retry ${attempt}/${maxAttempts - 1} after ${classifiedError.message}` +
                  `${classifiedError.statusCode ? ` [HTTP ${classifiedError.statusCode}]` : ''}`,
              });
              await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
              continue;
            }

            throw classifiedError;
          } finally {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
          }
        }

        const data = responsePayload;
        if (!data?.text) {
          throw new AiRequestError({
            message: 'AI request failed: empty response payload after retry',
            kind: 'request',
          });
        }

        console.info(
          '[ai/respond][client] response meta',
          JSON.stringify({
            projectId: payload.projectId,
            agentRole: payload.agentRole,
            selectedModel: requestedModel ?? null,
            resolvedModel: data.meta?.resolvedModel ?? null,
            actualModel: data.meta?.model ?? null,
            reasoningIncluded: data.meta?.reasoningIncluded ?? null,
            reasoningEffort: data.meta?.reasoningEffort ?? null,
            textVerbosity: data.meta?.textVerbosity ?? null,
          })
        );

        if (logContext && data.meta?.imageContext) {
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: logContext.agent,
            message: `Image attachment included in AI context: ${data.meta.imageContext.included}`,
          });
          if (data.meta.imageContext.requested > 0 && data.meta.imageContext.included === 0) {
            dispatch({
              type: 'ADD_LOG',
              level: 'warning',
              agent: logContext.agent,
              message:
                'Image attachment warning: no image reached OpenAI input. Verify uploaded attachment download URLs.',
            });
          }
        }

        if (logContext) {
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            agent: logContext.agent,
            message: translateProject(payload.language, 'workflow.openai.callSuccess'),
          });

          if (data.meta) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: logContext.agent,
              message:
                `OpenAI meta: selected=${data.meta.requestedModel ?? 'none'}, ` +
                `resolved=${data.meta.resolvedModel}, actual=${data.meta.model}, ` +
                `reasoning=${data.meta.reasoningIncluded ? (data.meta.reasoningEffort ?? 'included') : 'omitted'}, ` +
                `verbosity=${data.meta.textVerbosity ?? 'omitted'}`,
            });
          }
        }

        if (project && attachmentContext && attachmentContext.includedAttachmentIds.length > 0) {
          const linkedImageAttachmentIds = new Set(aiImages.flatMap((image) => image.attachmentIds));
          attachmentContext.includedAttachmentIds.forEach((attachmentId) => {
            dispatch({
              type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
              projectId: project.id,
              attachmentId,
              ingestion: {
                status: 'included',
                includedInContext: true,
                linkedToAi: linkedImageAttachmentIds.has(attachmentId),
                linkedToAiAt: linkedImageAttachmentIds.has(attachmentId) ? new Date() : undefined,
                analyzedAt: linkedImageAttachmentIds.has(attachmentId) ? new Date() : undefined,
                lastIncludedAt: new Date(),
              },
            });
          });

          if (logContext) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: logContext.agent,
              message: `Attachments included in AI context: ${attachmentContext.includedAttachmentIds.length}`,
            });
          }
        }

        if (data.meta?.model && data.meta.usage) {
          dispatch({
            type: 'ADD_PROJECT_USAGE',
            projectId: payload.projectId,
            model: data.meta.model || data.meta.resolvedModel,
            usage: data.meta.usage,
          });
        }

        return {
          text: data.text,
          meta: data.meta ?? null,
        };
      } catch (error) {
        const timeoutError =
          error instanceof DOMException && error.name === 'AbortError'
            ? classifyAiRequestFailure({ timeout: true })
            : error;
        console.warn(
          '[ai/respond][client] request failed',
          JSON.stringify({
            projectId: payload.projectId,
            agentRole: payload.agentRole,
            selectedModel: requestedModel ?? null,
            projectModel: project?.model ?? null,
            error: timeoutError instanceof Error ? timeoutError.message : 'Unknown OpenAI error',
            statusCode: timeoutError instanceof AiRequestError ? timeoutError.statusCode : null,
            failureKind: timeoutError instanceof AiRequestError ? timeoutError.kind : 'unknown',
          })
        );
        if (logContext) {
          const message = timeoutError instanceof Error ? timeoutError.message : 'Unknown OpenAI error';
          const shortError = message.length > 140 ? `${message.slice(0, 137)}...` : message;
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            agent: logContext.agent,
            message: translateProjectWithVars(payload.language, 'workflow.openai.callError', {
              error: shortError,
            }),
          });
          if (timeoutError instanceof AiRequestError) {
            dispatch({
              type: 'ADD_LOG',
              level: 'error',
              agent: logContext.agent,
              message:
                `AI infrastructure failure: kind=${timeoutError.kind}` +
                `${timeoutError.statusCode ? ` status=${timeoutError.statusCode}` : ''}` +
                `${timeoutError.rawBodySnippet ? ` body="${timeoutError.rawBodySnippet}"` : ''}`,
            });
          }
        }
        throw timeoutError;
      }
    },
    [buildAttachmentContext, resolveAiRespondEndpoint, translateProject, translateProjectWithVars]
  );

  const setSchedulerPaused = useCallback(
    (projectId: string, paused: boolean, withLog: boolean) => {
      schedulerPausedRef.current = {
        ...schedulerPausedRef.current,
        [projectId]: paused,
      };
      setPausedSchedulers((previous) => ({ ...previous, [projectId]: paused }));

      if (!withLog) return;
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: translateProject(
          project.language,
          paused ? 'workflow.scheduler.paused' : 'workflow.scheduler.resumed'
        ),
      });
    },
    [translateProject]
  );

  const createProjectFn = useCallback(
    async (
      name: string,
      description: string,
      projectLanguage: AppLanguage,
      model: OpenAIModel,
      outputType: OutputType,
      simulationMode: boolean,
      debateRounds: number,
      debateMode: DebateMode,
      maxWordsPerAgent: number,
      autoStartDebate = true
    ) => {
      const projectId = generateId();
      const createdProject = createProject(
        name,
        description,
        projectLanguage,
        outputType,
        simulationMode,
        debateRounds,
        debateMode,
        maxWordsPerAgent,
        projectId,
        'openai',
        model
      );

      dispatch({
        type: 'CREATE_PROJECT',
        projectId,
        name,
        description,
        language: projectLanguage,
        provider: 'openai',
        model,
        outputType,
        simulationMode,
        debateRounds,
        debateMode,
        maxWordsPerAgent,
      });
      dispatch({ type: 'ADD_LOG', level: 'info', message: `project created with id: ${projectId}` });

      const client = getFirebaseClient();
      if (client) {
        await setDoc(
          doc(client.firestore, 'projects', projectId),
          {
            ...createdProject,
            createdAt: createdProject.createdAt.toISOString(),
            updatedAt: createdProject.updatedAt.toISOString(),
            usage: {
              ...createdProject.usage,
              lastUpdatedAt: createdProject.usage.lastUpdatedAt
                ? createdProject.usage.lastUpdatedAt.toISOString()
                : null,
              persistence: {
                ...createdProject.usage.persistence,
                lastSyncedAt: createdProject.usage.persistence.lastSyncedAt
                  ? createdProject.usage.persistence.lastSyncedAt.toISOString()
                  : null,
              },
            },
            createdBy: firebaseUid,
          },
          { merge: true }
        );
        dispatch({ type: 'ADD_LOG', level: 'success', message: 'project persisted' });
      }

      if (autoStartDebate) {
        dispatch({ type: 'START_DEBATE', task: description, projectId });
      }
      return { projectId };
    },
    [firebaseUid]
  );

  const selectProject = useCallback((id: string) => {
    dispatch({ type: 'SELECT_PROJECT', projectId: id });
  }, []);

  const startDebate = useCallback((task: string, projectId?: string) => {
    const targetProjectId = projectId ?? stateRef.current.activeProject?.id;
    if (!targetProjectId) {
      dispatch({
        type: 'ADD_LOG',
        level: 'error',
        message: 'startDebate failed in AppContext.startDebate: missing target project id.',
      });
      return;
    }

    const targetProject = stateRef.current.projects.find((candidate) => candidate.id === targetProjectId);
    if (!targetProject) {
      dispatch({
        type: 'ADD_LOG',
        level: 'error',
        message: `startDebate failed in AppContext.startDebate: project lookup failed for id ${targetProjectId}.`,
      });
      return;
    }

    dispatch({ type: 'SELECT_PROJECT', projectId: targetProjectId });
    dispatch({ type: 'START_DEBATE', task, projectId: targetProjectId });
  }, []);

  const agentSpeak = useCallback((agent: AgentName, content: string) => {
    dispatch({ type: 'AGENT_SPEAK', agent, content });
  }, []);

  const orchestratorSummary = useCallback((content: string) => {
    dispatch({ type: 'ORCHESTRATOR_SUMMARY', content });
  }, []);

  const requestApproval = useCallback(() => {
    dispatch({ type: 'REQUEST_APPROVAL' });
  }, []);

  const derivePhaseFromTasks = useCallback((tasks: Task[]): WorkflowPhase => {
    if (
      tasks.length > 0 &&
      tasks.every(
        (task) =>
          task.status === 'done' ||
          task.status === 'failed' ||
          task.status === 'completed_with_fallback' ||
          task.status === 'canceled_due_to_failed_dependency' ||
          task.status === 'blocked_due_to_failed_dependency'
      )
    ) {
      return 'complete';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Integrator')) {
      return 'integration';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Tester')) {
      return 'testing';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Reviewer')) {
      return 'review';
    }
    if (tasks.some((task) => task.status === 'running')) {
      return 'execution';
    }
    return 'execution';
  }, []);

  const syncTaskAvailability = useCallback(
    (project: Project, logFixes = false) => {
      const taskIdSet = new Set(project.tasks.map((task) => task.id));
      let changed = false;

      project.tasks.forEach((task) => {
        if (
          task.status === 'done' ||
          task.status === 'failed' ||
          task.status === 'completed_with_fallback' ||
          task.status === 'canceled_due_to_failed_dependency' ||
          task.status === 'blocked_due_to_failed_dependency' ||
          task.status === 'running'
        ) {
          return;
        }

        const validDependencies = task.dependsOn.filter((dependencyId) => taskIdSet.has(dependencyId));
        const missingDependencies = task.dependsOn.filter((dependencyId) => !taskIdSet.has(dependencyId));
        const shouldQueue = validDependencies.every((dependencyId) =>
          dependencySatisfied(project.tasks, dependencyId)
        );
        const expectedStatus: Task['status'] = shouldQueue ? 'queued' : 'blocked';

        if (
          missingDependencies.length > 0 ||
          task.status !== expectedStatus ||
          validDependencies.length !== task.dependsOn.length
        ) {
          changed = true;
          dispatch({
            type: 'UPDATE_TASK',
            projectId: project.id,
            taskId: task.id,
            patch: {
              dependsOn: validDependencies,
              status: expectedStatus,
            },
          });

          if (missingDependencies.length > 0 && logFixes) {
            dispatch({
              type: 'ADD_LOG',
              level: 'warning',
              message: translateProjectWithVars(project.language, 'workflow.task.dependenciesFixed', {
                title: task.title,
              }),
            });
          }
        }
      });

      return changed;
    },
    [translateProjectWithVars]
  );

  const syncAgentStatusesFromTasks = useCallback((project: Project) => {
    const latestState = stateRef.current;
    latestState.agents.forEach((agent) => {
      const hasRunningTask = project.tasks.some(
        (task) => task.agent === agent.name && task.status === 'running'
      );
      const hasQueuedTask = project.tasks.some(
        (task) =>
          task.agent === agent.name &&
          task.status === 'queued' &&
          dependenciesSatisfied(project.tasks, task)
      );

      const targetStatus: AgentStatus = hasRunningTask
        ? 'active'
        : hasQueuedTask
        ? 'thinking'
        : 'idle';

      if (agent.status !== targetStatus) {
        dispatch({ type: 'UPDATE_AGENT_STATUS', agent: agent.name, status: targetStatus });
      }
    });
  }, []);

  const agentStartLogKey: Record<AgentName, TranslationKey | null> = useMemo(
    () => ({
      Strategist: null,
      Skeptic: null,
      Pragmatist: null,
      Planner: 'workflow.exec.log.planner.start',
      Architect: 'workflow.exec.log.architect.start',
      Builder: 'workflow.exec.log.builder.start',
      Reviewer: 'workflow.exec.log.reviewer.start',
      Tester: 'workflow.exec.log.tester.start',
      Integrator: 'workflow.exec.log.integrator.start',
    }),
    []
  );

  const agentDoneLogKey: Record<AgentName, TranslationKey | null> = useMemo(
    () => ({
      Strategist: null,
      Skeptic: null,
      Pragmatist: null,
      Planner: 'workflow.exec.log.planner.done',
      Architect: 'workflow.exec.log.architect.done',
      Builder: 'workflow.exec.log.builder.done',
      Reviewer: 'workflow.exec.log.reviewer.done',
      Tester: 'workflow.exec.log.tester.done',
      Integrator: 'workflow.exec.log.integrator.done',
    }),
    []
  );

  const buildExecutionArtifactPrompt = useCallback(
    (task: Task, artifact: Task['producesArtifacts'][number], snapshot: ExecutionSnapshot, project: Project) => {
      const findArtifactText = (artifactPath: string): string | null => {
        for (const upstreamTask of [...project.tasks].reverse()) {
          const found = upstreamTask.producesArtifacts.find((entry) => entry.path === artifactPath);
          if (!found) continue;
          if (found.rawContent?.trim()) return found.rawContent;
          if (found.content?.trim()) return found.content;
        }
        return null;
      };

      const shortenArtifact = (artifactPath: string, maxChars: number): string =>
        shorten(findArtifactText(artifactPath) ?? '{}', maxChars);
      const extractionIntent = deriveDocumentTableIntent(snapshot.projectPrompt, { defaultMode: 'booking' });

      if (shouldUseSegmentedWebsiteBuild(project, snapshot) && isSegmentedWebsiteSourceArtifactPath(artifact.path)) {
        const baselineByPath = snapshot.latestStableFiles.find(
          (file) => normalizeExecutionFilePath(file.path) === artifact.path
        );
        const executionPlanExcerpt = shortenArtifact('execution-plan.md', 2200);
        const architectureExcerpt = shortenArtifact('architecture-review.md', 2200);
        const sourceUrl = resolvePrimaryWebsiteSourceUrl(project, snapshot);
        const attachmentHints = buildWebsiteAttachmentHints(snapshot);
        const indexHtml = shorten(findArtifactText('index.html') ?? baselineByPath?.content ?? '', 5000);
        const stylesCss = shorten(findArtifactText('styles.css') ?? '', 5000);

        if (artifact.path === 'index.html') {
          return [
            'You are WebHtmlBuilder (step 1/3).',
            'Return only raw HTML for index.html. No markdown fences, no explanations.',
            'Generate a complete semantic page with accessible structure, responsive layout, and links to styles.css and optional script.js.',
            'Keep output focused and runnable as static website source.',
            `Project prompt:\n${snapshot.projectPrompt}`,
            snapshot.revisionPrompt ? `Revision request:\n${snapshot.revisionPrompt}` : 'Revision request: initial implementation.',
            sourceUrl ? `Primary source URL (replace placeholders with this real URL): ${sourceUrl}` : 'Primary source URL: not provided.',
            attachmentHints,
            'Execution plan excerpt:',
            executionPlanExcerpt,
            'Architecture review excerpt:',
            architectureExcerpt,
            baselineByPath ? `Previous index.html baseline:\n${shorten(baselineByPath.content, 2200)}` : 'Previous index.html baseline: none.',
          ].join('\n\n');
        }

        if (artifact.path === 'styles.css') {
          return [
            'You are WebStyleBuilder (step 2/3).',
            'Return only raw CSS for styles.css. No markdown fences, no explanations.',
            'Style the provided index.html structure and keep responsive behavior for desktop and mobile.',
            'Prefer maintainable selectors and avoid unused boilerplate.',
            `Project prompt:\n${snapshot.projectPrompt}`,
            snapshot.revisionPrompt ? `Revision request:\n${snapshot.revisionPrompt}` : 'Revision request: initial implementation.',
            sourceUrl ? `Primary source URL (replace placeholders with this real URL): ${sourceUrl}` : 'Primary source URL: not provided.',
            attachmentHints,
            'Execution plan excerpt:',
            executionPlanExcerpt,
            'Architecture review excerpt:',
            architectureExcerpt,
            `Current index.html:\n${indexHtml || '<!doctype html><html><body></body></html>'}`,
          ].join('\n\n');
        }

        return [
          'You are WebScriptBuilder (step 3/3).',
          'Return only raw JavaScript for script.js. No markdown fences, no explanations.',
          `If no JavaScript is needed, return exactly ${SEGMENTED_WEBSITE_NO_SCRIPT_MARKER} and nothing else.`,
          'If JavaScript is needed, keep it framework-free and compatible with the current HTML/CSS.',
          `Project prompt:\n${snapshot.projectPrompt}`,
          snapshot.revisionPrompt ? `Revision request:\n${snapshot.revisionPrompt}` : 'Revision request: initial implementation.',
          sourceUrl ? `Primary source URL (replace placeholders with this real URL): ${sourceUrl}` : 'Primary source URL: not provided.',
          attachmentHints,
          'Execution plan excerpt:',
          executionPlanExcerpt,
          'Architecture review excerpt:',
          architectureExcerpt,
          `Current index.html:\n${indexHtml || '<!doctype html><html><body></body></html>'}`,
          `Current styles.css:\n${stylesCss || '/* no styles yet */'}`,
        ].join('\n\n');
      }

      if (artifactRequiresStructuredExecutionOutput(task, artifact)) {
        const isExporterStage = isDocumentGeneratedFilesStage(project, task, artifact.path);
        if (isExporterStage) {
          return [
            project.language === 'cz' ? 'Write summary and notes in Czech.' : 'Write summary and notes in English.',
            'You are Exporter stage in a 6-stage execution pipeline.',
            'Input data is already structured. Do not re-extract from PDFs. Do not infer missing source facts.',
            'Return JSON only. Do not wrap in markdown fences.',
            'JSON contract:',
            '{"status":"success","summary":"short summary","files":[{"path":"invoice-rows.json","content":"{...}"},{"path":"invoice-summary.json","content":"{...}"},{"path":"index.html","content":"<!doctype html>..."}],"notes":["optional"],"removePaths":[]}',
            'Allowed file extensions only: .html, .css, .js, .json, .md',
            'Provide machine-usable outputs from structured rows and summary metadata (CSV/XLSX data should be represented in JSON/HTML support files if needed).',
            'Do not add analysis prose outside summary/notes fields.',
            `Project prompt:\n${snapshot.projectPrompt}`,
            'Validated rows artifact (canonical):',
            shortenArtifact('validated-rows.json', 12000),
            'Summary metadata artifact (canonical):',
            shortenArtifact('summary-metadata.json', 8000),
          ].join('\n\n');
        }

        const websiteRequirement = taskRequiresHtmlEntry(task, project)
          ? 'Because this run is building a website/app/page, index.html is required.'
          : 'If you are building a website/page, include index.html.';
        const codeMode = classifyCodeGenerationMode({
          name: project.name,
          description: project.description,
          latestRevisionFeedback: project.latestRevisionFeedback,
          outputType: project.outputType,
        });

        return [
          project.language === 'cz' ? 'Write summary and notes in Czech.' : 'Write summary and notes in English.',
          'You are Builder. Revise the current project baseline; do not restart from scratch unless requested.',
          'Return JSON only. Do not wrap the response in markdown fences.',
          'Prefer a minimal working static website bundle using index.html and optional style.css and script.js.',
          'Never finish with only patch notes or prose when the user asked to build something.',
          'JSON contract:',
          '{"status":"success","summary":"short summary","files":[{"path":"index.html","content":"<!doctype html>..."}],"notes":["optional note"],"removePaths":["obsolete.js"]}',
          'Allowed file extensions only: .html, .css, .js, .json, .md',
          'files must be an array of objects with path and content. Return changed/new files only.',
          'removePaths is optional. Use it only for files that should be removed from baseline.',
          'Execution is successful only if at least one file is present.',
          `Target generation mode: ${getModeLabel(codeMode)}.`,
          'Bundle contract targets (include unless already present in unchanged baseline): README.md, run-instructions.md, deploy-instructions.md, app-manifest.json.',
          'README.md should summarize setup and project purpose.',
          'run-instructions.md should include concrete local run steps.',
          'deploy-instructions.md should include practical deploy steps.',
          'app-manifest.json should contain entryPoint and basic bundle metadata.',
          websiteRequirement,
          'Use only local generated files. Do not reference remote scripts, packages, build tools, or deployment steps.',
          `Project prompt:\n${snapshot.projectPrompt}`,
          snapshot.revisionPrompt ? `Revision request:\n${snapshot.revisionPrompt}` : 'Revision request: initial implementation.',
          `Approved debate summary:\n${snapshot.approvedDebateSummary}`,
          snapshot.latestStableFiles.length > 0
            ? `Current baseline files (${snapshot.latestStableFiles.length}):\n${snapshot.latestStableFiles
                .slice(0, 20)
                .map((file) => `${file.path}\n${shorten(file.content, 800)}`)
                .join('\n\n')}`
            : 'Current baseline files: none (first execution cycle).',
          `ZIP snapshots count: ${snapshot.zipSnapshots.length}`,
          `Site snapshots count: ${snapshot.siteSnapshots.length}`,
          `PDF snapshots count: ${snapshot.pdfTexts.length}`,
          `Image inputs count: ${snapshot.imageInputs.length}`,
        ].join('\n\n');
      }

      if (artifact.path === 'extracted-rows.json') {
        if (extractionIntent.mode === 'generic') {
          const genericColumns =
            extractionIntent.columns.length > 0 ? extractionIntent.columns : DEFAULT_GENERIC_EXTRACTION_COLUMNS;
          const contractRow = genericColumns.reduce<Record<string, string | number | null>>(
            (acc, column) => {
              acc[column.key] = column.numeric ? 0 : '...';
              return acc;
            },
            { sourceFileName: '...', extractionWarning: '...' }
          );

          return [
            project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
            'You are DocumentExtractor stage.',
            'Extract only fields needed for requested custom table output. No summaries, no analysis.',
            'Return JSON only. No markdown fences or prose.',
            'Contract:',
            JSON.stringify(
              {
                documents: [
                  {
                    sourceAttachmentId: '...',
                    sourceTitle: '...',
                    rows: [contractRow],
                  },
                ],
              },
              null,
              0
            ),
            'Requested output columns (keep meaning and order):',
            genericColumns.map((column) => `- ${column.header} -> ${column.key}`).join('\n'),
            'Rules: keep source mapping exact; keep missing values null/empty; no fabricated values.',
            `Project prompt:\n${shorten(snapshot.projectPrompt, 900)}`,
          ].join('\n\n');
        }

        return [
          project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
          'You are DocumentExtractor stage.',
          'Extract required invoice fields only. No summaries, no analysis.',
          'Return JSON only. No markdown fences or prose.',
          'Contract:',
          '{"documents":[{"sourceAttachmentId":"...","sourceTitle":"...","rows":[{"sourceFileName":"...","invoiceNumber":"...","issueDate":"...","billingPeriod":"...","dueDate":"...","accommodationId":"...","currency":"...","amountInInvoiceCurrency":0,"amountCzk":0,"commission":0,"paymentServiceFee":0,"roomSales":0,"supplierName":"...","supplierVatId":"...","customerVatId":"...","variableSymbol":"...","extractionWarning":"..."}]}]}',
          'Rules: keep source mapping exact; keep missing values null/empty; no fabricated values.',
          'Booking.com invoices: map values from explicit labels whenever present (Číslo faktury, Datum, Období, Platba splatná, Identifikační číslo ubytování, Celková částka k zaplacení, Prodej pokojů, Provize, Poplatek za platební služby).',
          'If required fields cannot be extracted, keep nulls and include extractionWarning with missing fields.',
          `Project prompt:\n${shorten(snapshot.projectPrompt, 900)}`,
        ].join('\n\n');
      }

      if (artifact.path === 'normalized-rows.json') {
        return [
          project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
          'You are Normalizer stage.',
          'Normalize field names, signs, dates, amounts, currencies, and source mapping. Keep evidence traceability.',
          'Return JSON only.',
          'Contract:',
          '{"rows":[{"sourceFileName":"...","invoiceNumber":"...","issueDate":"YYYY-MM-DD|null","billingPeriod":"...","dueDate":"YYYY-MM-DD|null","accommodationId":"...","currency":"...","amountInInvoiceCurrency":0,"amountCzk":0,"commission":0,"paymentServiceFee":0,"roomSales":0,"variableSymbol":"...","amountType":"overpayment|underpayment|unknown","normalizedSign":-1|0|1}],"filesProcessed":["..."]}',
          'Input extracted rows (canonical):',
          shortenArtifact('extracted-rows.json', 14000),
        ].join('\n\n');
      }

      if (artifact.path === 'validated-rows.json') {
        return [
          project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
          'You are Validator stage.',
          'Validate normalized rows: duplicates, missing fields, suspicious values, inconsistent formats.',
          'Do not remove core evidence; annotate with warnings/quality flags.',
          'Return JSON only.',
          'Contract:',
          '{"rows":[{"...":"...","validationWarnings":["..."],"qualityFlags":["..."]}],"warnings":["..."],"duplicateVariableSymbols":["..."]}',
          'Input normalized rows (canonical):',
          shortenArtifact('normalized-rows.json', 14000),
        ].join('\n\n');
      }

      if (artifact.path === 'summary-metadata.json') {
        return [
          project.language === 'cz' ? 'Write JSON keys and values in English.' : 'Write JSON in English.',
          'You are Summarizer stage.',
          'Build monthly/annual summaries and totals strictly from validated structured rows.',
          'Do not re-read PDFs. Return JSON only.',
          'Contract:',
          '{"invoiceCount":0,"uniqueVariableSymbolCount":0,"duplicateVariableSymbolCount":0,"totalOverpayment":0,"totalUnderpayment":0,"netTotal":0,"monthlySummary":[{"month":"YYYY-MM","invoiceCount":0,"netTotal":0}],"annualSummary":[{"year":2026,"invoiceCount":0,"netTotal":0}],"warnings":["..."],"duplicateVariableSymbols":["..."],"filesProcessed":["..."],"filesFailed":["..."]}',
          'Input validated rows (canonical):',
          shortenArtifact('validated-rows.json', 14000),
        ].join('\n\n');
      }

      const requiredSectionsByArtifact: Record<string, string[]> = {
        'execution-plan.md': [
          'Prioritized task list',
          'Milestones',
          'Dependencies',
          'Estimated implementation order',
        ],
        'architecture-review.md': [
          'Affected modules/components/files',
          'Proposed structural changes',
          'Technical constraints and assumptions',
        ],
        'patch-plan.md': [
          'Ordered patch steps',
          'Target files and reasons',
          'Dependencies and rollout notes',
        ],
        'review-notes.md': [
          'Quality concerns',
          'Missing requirements',
          'Risks and ambiguity list',
          'Suggested corrections to Builder output',
        ],
        'test-checklist.md': [
          'Functional test cases',
          'Regression checklist',
          'Edge cases',
          'Acceptance criteria',
        ],
        'final-summary.md': [
          'Final merged implementation recommendation',
          'Ordered execution package',
          'What should be changed first',
          'What can wait for v2',
        ],
      };

      const sectionList = requiredSectionsByArtifact[artifact.path] ?? ['Key recommendations'];
      const missingInputs = snapshot.missingInputNotes.length
        ? `Missing inputs to mention explicitly if relevant:\n- ${snapshot.missingInputNotes.join('\n- ')}`
        : 'Missing inputs: none detected.';

      if (artifact.path === 'architecture-review.md' && decideExecutionPipeline(project) === 'code') {
        const promptVerified = deriveVerifiedWebsiteContentFromPrompt({
          projectName: project.name,
          projectDescription: project.description,
          projectPrompt: snapshot.projectPrompt,
          revisionPrompt: snapshot.revisionPrompt,
          debateSummary: snapshot.approvedDebateSummary,
        });
        const ingestionVerified = deriveVerifiedWebsiteContent(snapshot.siteSnapshots);
        const hasPromptVerified = hasSufficientVerifiedWebsiteContent(promptVerified);
        const hasIngestionVerified = hasSufficientVerifiedWebsiteContent(ingestionVerified);
        const mergedVerified = hasIngestionVerified
          ? hasPromptVerified
            ? mergeVerifiedWebsiteContent(ingestionVerified, promptVerified)
            : ingestionVerified
          : promptVerified;

        const normalizedArchitecture = normalizeArchitectureReviewInput({
          projectName: project.name,
          outputType: project.outputType,
          projectDescription: project.description,
          projectPrompt: snapshot.projectPrompt,
          revisionPrompt: snapshot.revisionPrompt,
          debateSummary: snapshot.approvedDebateSummary,
          maxChars: 4200,
          websiteFacts: {
            sourceUrl: mergedVerified.sourceUrl,
            headings: mergedVerified.headings,
            bodyTextBlocks: mergedVerified.bodyTextBlocks,
            serviceNames: mergedVerified.serviceNames,
            pricingFields: mergedVerified.pricingFields,
            ctaTexts: mergedVerified.ctaTexts,
            emails: mergedVerified.emails,
            phones: mergedVerified.phones,
            addresses: mergedVerified.addresses,
          },
        });

        return [
          project.language === 'cz' ? 'Write in Czech.' : 'Write in English.',
          `You are ${task.agent}. Produce artifact "${artifact.path}" only in Markdown.`,
          'Use normalized architecture input below. Do not pass through raw prompt blobs or repeated facts.',
          'Prioritize deterministic file/module-level design, dependencies, and implementation constraints.',
          `Required sections:\n- ${sectionList.join('\n- ')}`,
          missingInputs,
          'Normalized architecture input:',
          normalizedArchitecture.normalizedInput,
          `Normalization stats: raw=${normalizedArchitecture.stats.rawChars} chars, normalized=${normalizedArchitecture.stats.normalizedChars} chars, dedupDropped=${normalizedArchitecture.stats.droppedDuplicates}`,
          `Snapshot counts: site=${snapshot.siteSnapshots.length}, zip=${snapshot.zipSnapshots.length}, pdf=${snapshot.pdfTexts.length}, images=${snapshot.imageInputs.length}`,
        ].join('\n\n');
      }

      return [
        project.language === 'cz' ? 'Write in Czech.' : 'Write in English.',
        `You are ${task.agent}. Produce artifact \"${artifact.path}\" only in Markdown.`,
        'Do not produce placeholder text. Ground claims in provided inputs (ZIP tree, site snapshot, PDF text, images).',
        'If an expected input is missing, explicitly state that in a short "Missing Inputs" section.',
        `Required sections:\n- ${sectionList.join('\n- ')}`,
        missingInputs,
        `Project prompt:\n${snapshot.projectPrompt}`,
        `Approved debate summary:\n${snapshot.approvedDebateSummary}`,
        `ZIP snapshots count: ${snapshot.zipSnapshots.length}`,
        `Site snapshots count: ${snapshot.siteSnapshots.length}`,
        `PDF snapshots count: ${snapshot.pdfTexts.length}`,
        `Image inputs count: ${snapshot.imageInputs.length}`,
      ].join('\n\n');
    },
    []
  );

  const buildExecutionAgentContext = useCallback(
    (task: Task, snapshot: ExecutionSnapshot) => {
      const primaryArtifact = getPrimaryArtifactPath(task);
      const isArchitectureReviewTask = task.agent === 'Architect' && primaryArtifact === 'architecture-review.md';

      if (isArchitectureReviewTask) {
        return {
          snapshotId: snapshot.id,
          cycleNumber: snapshot.cycleNumber,
          revisionPrompt: shorten(snapshot.revisionPrompt ?? '', 700),
          projectPrompt: shorten(snapshot.projectPrompt, 1400),
          approvedDebateSummary: shorten(snapshot.approvedDebateSummary, 1400),
          latestStableSummary: shorten(snapshot.latestStableSummary ?? '', 900),
          attachmentCounts: {
            project: snapshot.projectAttachments.length,
            message: snapshot.messageAttachments.length,
            zip: snapshot.zipSnapshots.length,
            site: snapshot.siteSnapshots.length,
            pdf: snapshot.pdfTexts.length,
            images: snapshot.imageInputs.length,
          },
          missingInputNotes: snapshot.missingInputNotes.slice(0, 10),
        };
      }

      return {
        snapshotId: snapshot.id,
        cycleNumber: snapshot.cycleNumber,
        revisionPrompt: snapshot.revisionPrompt,
        projectPrompt: shorten(snapshot.projectPrompt, 1_800),
        approvedDebateSummary: shorten(snapshot.approvedDebateSummary, 3_000),
        latestStableSummary: shorten(snapshot.latestStableSummary ?? '', 1_800),
        latestStableFiles: snapshot.latestStableFiles.slice(0, 25).map((file) => ({
          path: file.path,
          excerpt: shorten(file.content, 800),
        })),
        attachmentOverview: {
          project: snapshot.projectAttachments.map((item) => ({
            title: item.title,
            kind: item.kind,
            status: item.status,
          })),
          message: snapshot.messageAttachments.map((item) => ({
            title: item.title,
            kind: item.kind,
            status: item.status,
          })),
        },
        zipSummary: snapshot.zipSnapshots.map((entry) => ({
          title: entry.title,
          fileTreeTop: entry.fileTree.slice(0, 80),
          keyFiles: entry.keyFiles.slice(0, 8).map((file) => ({
            path: file.path,
            excerpt: shorten(file.content, 800),
          })),
          pdfFiles: (entry.pdfFiles ?? []).slice(0, 20).map((file) => ({
            path: file.path,
            status: file.status,
            error: file.error,
            excerpt: shorten(file.extractedText, 800),
          })),
        })),
        siteSummary: snapshot.siteSnapshots.map((entry) => ({
          title: entry.title,
          pageTitle: entry.pageTitle,
          summary: shorten(entry.summary, 600),
          extractedExcerpt: shorten(entry.extractedText, 1_000),
          structured: entry.structuredData
            ? {
                sourceUrl: entry.structuredData.sourceUrl,
                missingFields: entry.structuredData.missingFields,
                warnings: entry.structuredData.extractionWarnings,
                contacts: {
                  emails: entry.structuredData.contactFields.emails.slice(0, 8),
                  phones: entry.structuredData.contactFields.phones.slice(0, 8),
                  addresses: entry.structuredData.contactFields.addresses.slice(0, 5),
                },
                pricing: entry.structuredData.pricingFields.slice(0, 10),
                ctas: entry.structuredData.ctaTexts.slice(0, 10),
              }
            : null,
          pages: (entry.pages ?? []).slice(0, 5).map((page) => ({
            title: page.title,
            url: page.url,
            excerpt: shorten(page.excerpt ?? page.summary, 220),
          })),
        })),
        pdfSummary: snapshot.pdfTexts.map((entry) => ({
          title: entry.title,
          excerpt: shorten(entry.text, 1_200),
        })),
        imageSummary: snapshot.imageInputs.map((entry) => ({
          title: entry.title,
          description: shorten(entry.description, 300),
          source: entry.source,
        })),
        missingInputNotes: snapshot.missingInputNotes,
      };
    },
    []
  );

  type PlannerPriority = 'high' | 'medium' | 'low';
  type PlannerStructuredTask = {
    id: string;
    title: string;
    description: string;
    priority: PlannerPriority;
    dependsOn?: string[];
  };

  type PlannerStructuredPlan = {
    title: string;
    summary: string;
    tasks: PlannerStructuredTask[];
  };

  const normalizePlannerTaskId = useCallback((value: string, index: number): string => {
    const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return trimmed || `task-${index + 1}`;
  }, []);

  const validatePlannerStructuredPlan = useCallback(
    (raw: string): PlannerStructuredPlan => {
      let parsed: unknown;
      try {
        parsed = parseJsonObjectFromModelText(raw);
      } catch (error) {
        throw new Error(`Planner conversion JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Planner conversion payload is not an object.');
      }

      const candidate = parsed as Record<string, unknown>;
      const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
      const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
      const tasks = Array.isArray(candidate.tasks) ? candidate.tasks : [];

      if (!title) throw new Error('Planner conversion missing title.');
      if (!summary) throw new Error('Planner conversion missing summary.');
      if (tasks.length < 3 || tasks.length > 7) {
        throw new Error(`Planner conversion task count out of range: ${tasks.length} (expected 3-7).`);
      }

      const normalizedTasks: PlannerStructuredTask[] = tasks.map((task, index) => {
        if (!task || typeof task !== 'object') {
          throw new Error(`Planner task at index ${index} is not an object.`);
        }
        const item = task as Record<string, unknown>;
        const taskId = normalizePlannerTaskId(String(item.id ?? ''), index);
        const taskTitle = typeof item.title === 'string' ? item.title.trim() : '';
        const taskDescription = typeof item.description === 'string' ? item.description.trim() : '';
        const rawPriority = typeof item.priority === 'string' ? item.priority.toLowerCase() : 'medium';
        const priority: PlannerPriority =
          rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low'
            ? rawPriority
            : 'medium';
        const dependsOn = Array.isArray(item.dependsOn)
          ? item.dependsOn.map((dep) => String(dep)).filter(Boolean)
          : undefined;

        if (!taskTitle) throw new Error(`Planner task at index ${index} missing title.`);
        if (!taskDescription) throw new Error(`Planner task at index ${index} missing description.`);

        return {
          id: taskId,
          title: taskTitle,
          description: taskDescription,
          priority,
          dependsOn,
        };
      });

      return {
        title,
        summary,
        tasks: normalizedTasks,
      };
    },
    [normalizePlannerTaskId]
  );

  const buildPlannerFallbackPlan = useCallback(
    (project: Project, stageAText: string): PlannerStructuredPlan => {
      const extractedLines = stageAText
        .split('\n')
        .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((line) => line.length > 10)
        .slice(0, 5);

      const fallbackLines =
        extractedLines.length >= 3
          ? extractedLines
          : [
              'Audit current static website baseline and identify top user-facing issues.',
              'Propose high-impact UX/content/performance improvements for v1.',
              'Implement and review prioritized improvements with quick validation.',
            ];

      const tasks: PlannerStructuredTask[] = fallbackLines.map((line, index) => ({
        id: `fallback-${index + 1}`,
        title: `Task ${index + 1}`,
        description: shorten(line, 180),
        priority: index === 0 ? 'high' : index < 3 ? 'medium' : 'low',
        dependsOn: index > 0 ? [`fallback-${index}`] : [],
      }));

      return {
        title: `Planner fallback plan: ${project.name}`,
        summary: 'Structured conversion failed; generated fallback task list from planner plain-text output.',
        tasks,
      };
    },
    []
  );

  const buildPlannerArtifactMarkdown = useCallback(
    (
      plan: PlannerStructuredPlan,
      stageAText: string,
      options?: { fallbackReason?: string; usedFallback?: boolean }
    ): string => {
      return [
        `# ${plan.title}`,
        '',
        '## Summary',
        plan.summary,
        '',
        '## Tasks',
        ...plan.tasks.map((task) => {
          const deps = task.dependsOn?.length ? task.dependsOn.join(', ') : 'none';
          return `- id: ${task.id}\n  - title: ${task.title}\n  - description: ${task.description}\n  - priority: ${task.priority}\n  - dependsOn: ${deps}`;
        }),
        '',
        '## Planner Stage A (plain text)',
        stageAText,
        '',
        '## Planner Final Status',
        options?.usedFallback ? 'completed_with_fallback' : 'completed',
        options?.fallbackReason ? `Fallback reason: ${options.fallbackReason}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
    []
  );

  const rerouteDependencies = useCallback((project: Project, fromTaskId: string, toTaskId: string) => {
    project.tasks
      .filter(
        (task) =>
          task.id !== toTaskId &&
          task.status !== 'done' &&
          task.status !== 'completed_with_fallback' &&
          task.status !== 'running' &&
          task.dependsOn.includes(fromTaskId)
      )
      .forEach((task) => {
        dispatch({
          type: 'UPDATE_TASK',
          projectId: project.id,
          taskId: task.id,
          patch: {
            dependsOn: task.dependsOn.map((dependencyId) =>
              dependencyId === fromTaskId ? toTaskId : dependencyId
            ),
            status: 'blocked',
          },
        });
      });
  }, []);

  const completeTask = useCallback(
    (
      projectId: string,
      taskId: string,
      options?: { skipFailure?: boolean; lastOutput?: string }
    ) => {
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      const task = project?.tasks.find((candidate) => candidate.id === taskId);
      if (!project || !task || task.status !== 'running') {
        return;
      }

      const lang = project.language;
      const retryCount = task.retryCount ?? 0;
      const maxRetries = task.maxRetries ?? project.taskGraph?.maxRetries ?? 2;
      const failProbability = options?.skipFailure
        ? 0
        : project.simulationMode
        ? task.agent === 'Tester'
          ? 0.25
          : task.agent === 'Reviewer'
          ? 0.15
          : 0
        : 0;
      const shouldFail = failProbability > 0 && retryCount < maxRetries && Math.random() < failProbability;

      if (shouldFail) {
        const errorMessage = translateProjectWithVars(lang, 'workflow.task.failedReason', {
          title: task.title,
        });
        dispatch({
          type: 'UPDATE_TASK',
          projectId,
          taskId,
          patch: { status: 'failed', errorMessage },
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.transition.failed', {
            title: task.title,
          }),
        });

        const reworkTask = createTask({
          title: translateProject(lang, 'workflow.task.rework.fixTitle'),
          description: translateProjectWithVars(lang, 'workflow.task.rework.fixDescription', {
            title: task.title,
          }),
          agent: 'Builder',
          provider: task.provider,
          model: task.model,
          dependsOn: [task.id],
          status: 'blocked',
          producesArtifacts: [
            {
              path: 'artifacts/rework-fix.json',
              label: translateProject(lang, 'workflow.artifact.reworkFix'),
              kind: 'json',
            },
          ],
          retryCount,
          maxRetries,
        });
        dispatch({ type: 'ADD_TASK', projectId, task: reworkTask });

        const followUpTask = createTask({
          title:
            task.agent === 'Tester'
              ? translateProject(lang, 'workflow.task.rework.retestTitle')
              : translateProject(lang, 'workflow.task.rework.rereviewTitle'),
          description: translateProjectWithVars(lang, 'workflow.task.rework.retestDescription', {
            title: task.title,
          }),
          agent: task.agent,
          provider: task.provider,
          model: task.model,
          dependsOn: [reworkTask.id],
          status: 'blocked',
          producesArtifacts: task.producesArtifacts,
          retryCount: retryCount + 1,
          maxRetries,
        });
        dispatch({ type: 'ADD_TASK', projectId, task: followUpTask });

        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.retryTriggered', {
            title: task.title,
            retry: retryCount + 1,
            max: maxRetries,
          }),
        });

        if (autoPauseCheckpoints) {
          setSchedulerPaused(projectId, true, false);
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message: translateProjectWithVars(lang, 'workflow.scheduler.checkpoint.failure', {
              title: task.title,
            }),
          });
        }

        rerouteDependencies(project, task.id, followUpTask.id);

        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: 'Builder',
          message: translateProjectWithVars(lang, 'workflow.task.rework.created', {
            from: task.title,
            fix: reworkTask.title,
            retest: followUpTask.title,
          }),
        });

        dispatch({
          type: 'UPDATE_AGENT_STATUS',
          agent: task.agent,
          status: 'idle',
          lastOutput: errorMessage,
        });
      } else {
        dispatch({
          type: 'UPDATE_TASK',
          projectId,
          taskId,
          patch: { status: 'done', errorMessage: undefined },
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'success',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.transition.done', {
            title: task.title,
          }),
        });
        dispatch({
          type: 'UPDATE_AGENT_STATUS',
          agent: task.agent,
          status: 'idle',
          lastOutput:
            options?.lastOutput ??
            translateProjectWithVars(lang, 'workflow.task.doneSummary', {
              title: task.title,
            }),
        });

        const doneLogKey = agentDoneLogKey[task.agent];
        if (doneLogKey) {
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            agent: task.agent,
            message: translateProject(lang, doneLogKey),
          });
        }
      }

      delete taskTimersRef.current[taskId];
    },
    [
      agentDoneLogKey,
      autoPauseCheckpoints,
      rerouteDependencies,
      setSchedulerPaused,
      translateProject,
      translateProjectWithVars,
    ]
  );

  const runLiveTaskExecution = useCallback(
    async (projectId: string, taskId: string) => {
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const getLiveTask = () => {
        const liveProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        const liveTask = liveProject?.tasks.find((candidate) => candidate.id === taskId);
        return { liveProject, liveTask };
      };

      const failLiveTask = (
        agent: AgentName,
        message: string,
        options?: { artifactPath?: string; rawBodySnippet?: string | null }
      ) => {
        if (options?.artifactPath) {
          const liveProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          const liveTask = liveProject?.tasks.find((candidate) => candidate.id === taskId);
          const artifacts = liveTask?.producesArtifacts ?? [];
          const updatedArtifacts = artifacts.map((artifact) =>
            artifact.path === options.artifactPath
              ? {
                  ...artifact,
                  rawContent: options.rawBodySnippet ?? artifact.rawContent,
                  generatedAt: new Date(),
                }
              : artifact
          );
          if (updatedArtifacts.length > 0) {
            dispatch({
              type: 'UPDATE_TASK',
              projectId,
              taskId,
              patch: { producesArtifacts: updatedArtifacts },
            });
          }
        }

        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          agent,
          message,
        });
        dispatch({
          type: 'UPDATE_TASK',
          projectId,
          taskId,
          patch: { status: 'failed', errorMessage: message },
        });
        dispatch({
          type: 'UPDATE_AGENT_STATUS',
          agent,
          status: 'error',
          lastOutput: message,
        });

        if (agent === 'Planner') {
          const liveProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          if (!liveProject) return;
          liveProject.tasks
            .filter((candidate) => candidate.id !== taskId && (candidate.status === 'queued' || candidate.status === 'blocked'))
            .forEach((candidate) => {
              dispatch({
                type: 'UPDATE_TASK',
                projectId,
                taskId: candidate.id,
                patch: {
                  status: 'canceled_due_to_failed_dependency',
                  errorMessage: 'Planner failed; downstream execution canceled due to failed dependency.',
                },
              });
            });
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message: 'Planner failed; downstream queued/blocked tasks were canceled due to failed dependency.',
          });
        }
      };

      const formatAiExecutionError = (error: unknown): { message: string; rawBodySnippet: string | null } => {
        if (error instanceof AiRequestError) {
          const classified =
            `${error.kind === 'infrastructure' ? 'Infrastructure' : 'Request'} failure` +
            `${error.statusCode ? ` HTTP ${error.statusCode}` : ''}: ${error.message}`;
          return {
            message: classified,
            rawBodySnippet: error.rawBodySnippet ?? null,
          };
        }
        return {
          message: error instanceof Error ? error.message : 'Unknown OpenAI execution error',
          rawBodySnippet: null,
        };
      };

      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!project) return;

      let task = project.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      if (task.status !== 'running') {
        for (let attempt = 1; attempt <= 20; attempt += 1) {
          await sleep(100);
          const refreshed = stateRef.current.projects
            .find((candidate) => candidate.id === projectId)
            ?.tasks.find((candidate) => candidate.id === taskId);
          if (!refreshed) return;
          task = refreshed;
          if (task.status === 'running') {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: task.agent,
              message: `planner/live runner synchronized after status commit (attempt ${attempt}).`,
            });
            break;
          }
        }
      }

      if (task.status !== 'running') {
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          agent: task.agent,
          message: `Live runner aborted: task status stayed ${task.status} and never reached running.`,
        });
        return;
      }

      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        agent: task.agent,
        message: `${task.agent} agent started`,
      });

      const snapshot = project.executionSnapshot;
      if (!snapshot) {
        failLiveTask(task.agent, 'Execution snapshot missing; task cannot use approved immutable context.');
        return;
      }

      const stallTimer = setTimeout(() => {
        const { liveTask } = getLiveTask();
        if (!liveTask || liveTask.status !== 'running') {
          return;
        }
        failLiveTask(task.agent, `Task timed out after ${executionTaskTimeoutMs} ms (timeout / stalled).`);
      }, executionTaskTimeoutMs);

      try {
        const snapshotAttachmentContext = buildSnapshotAttachmentContext(snapshot);

        const updatedArtifacts = [...task.producesArtifacts];

        if (task.agent === 'Planner') {
          const plannerArtifactIndex = updatedArtifacts.findIndex((artifact) => artifact.path === 'execution-plan.md');
          if (plannerArtifactIndex < 0) {
            failLiveTask('Planner', 'Planner artifact execution-plan.md missing in task output contract.');
            return;
          }

          const plannerArtifact = updatedArtifacts[plannerArtifactIndex];
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: 'planner prompt built',
          });

          const plannerStageAPrompt = [
            project.language === 'cz' ? 'Write in Czech.' : 'Write in English.',
            'You are Planner. Return concise plain-text plan only.',
            'Include: a short title, one-paragraph summary, and 3-7 actionable tasks in bullet form.',
            `Project prompt: ${snapshot.projectPrompt}`,
            `Approved debate summary: ${shorten(snapshot.approvedDebateSummary, 2600)}`,
          ].join('\n\n');

          const plannerStageAContext = buildExecutionAgentContext(task, snapshot);
          const plannerStageASize = estimatePromptSize(plannerStageAPrompt, plannerStageAContext);
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: `Planner prompt size estimate chars=${plannerStageASize.chars}, tokens~=${plannerStageASize.tokensApprox}`,
          });

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: 'planner OpenAI call started',
          });

          let stageAText = '';
          try {
            const stageAResponse = await callAiRespond(
              {
                projectId,
                language: project.language,
                agentRole: 'Planner',
                model: task.model,
                inputText: plannerStageAPrompt,
                context: plannerStageAContext,
              },
              { agent: 'Planner' },
              snapshotAttachmentContext,
              { timeoutMs: executionTaskTimeoutMs }
            );
            stageAText = stageAResponse.text;
          } catch (error) {
            const detail = formatAiExecutionError(error);
            failLiveTask('Planner', `planner OpenAI call failed: ${detail.message}`, {
              artifactPath: 'execution-plan.md',
              rawBodySnippet: detail.rawBodySnippet,
            });
            return;
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            agent: 'Planner',
            message: 'planner OpenAI call returned',
          });

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: 'planner parse started',
          });

          let plan: PlannerStructuredPlan;
          let usedFallback = false;
          let fallbackReason = '';

          const plannerStageBPrompt = [
            project.language === 'cz' ? 'Write in English for JSON keys and values.' : 'Write in English.',
            'Convert the planner text into minimal JSON only.',
            'Do not include markdown fences, commentary, prefaces, or trailing text.',
            'JSON contract:',
            '{"title":"...","summary":"...","tasks":[{"id":"...","title":"...","description":"...","priority":"high|medium|low","dependsOn":["id"]}]}',
            'Rules: task count must be 3 to 7, dependsOn optional array, no additional nesting.',
            'Planner plain-text input:',
            stageAText,
          ].join('\n\n');

          try {
            const stageBResponse = await callAiRespond(
              {
                projectId,
                language: project.language,
                agentRole: 'Planner',
                model: task.model,
                inputText: plannerStageBPrompt,
                context: {
                  snapshotId: snapshot.id,
                  conversionMode: 'planner-minimal-v1',
                },
              },
              { agent: 'Planner' },
              snapshotAttachmentContext,
              { timeoutMs: executionTaskTimeoutMs }
            );

            try {
              plan = validatePlannerStructuredPlan(stageBResponse.text);
              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                agent: 'Planner',
                message: 'planner parse success',
              });
            } catch (parseError) {
              fallbackReason = parseError instanceof Error ? parseError.message : 'Unknown planner parse error';
              dispatch({
                type: 'ADD_LOG',
                level: 'error',
                agent: 'Planner',
                message: `planner parse failure: ${fallbackReason}`,
              });
              plan = buildPlannerFallbackPlan(project, stageAText);
              usedFallback = true;
            }
          } catch (conversionError) {
            fallbackReason =
              conversionError instanceof Error
                ? conversionError.message
                : 'Unknown planner conversion stage error';
            dispatch({
              type: 'ADD_LOG',
              level: 'error',
              agent: 'Planner',
              message: `planner parse failure: ${fallbackReason}`,
            });
            plan = buildPlannerFallbackPlan(project, stageAText);
            usedFallback = true;
          }

          const plannerMarkdown = buildPlannerArtifactMarkdown(plan, stageAText, {
            usedFallback,
            fallbackReason,
          });

          updatedArtifacts[plannerArtifactIndex] = {
            ...plannerArtifact,
            content: plannerMarkdown,
            producedBy: 'Planner',
            generatedAt: new Date(),
          };

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: 'planner artifact save started',
          });

          try {
            dispatch({
              type: 'UPDATE_TASK',
              projectId,
              taskId,
              patch: { producesArtifacts: updatedArtifacts },
            });
            dispatch({
              type: 'ADD_LOG',
              level: 'success',
              agent: 'Planner',
              message: 'planner artifact save success',
            });
          } catch (saveError) {
            const detail = saveError instanceof Error ? saveError.message : 'Unknown planner artifact save error';
            dispatch({
              type: 'ADD_LOG',
              level: 'error',
              agent: 'Planner',
              message: `planner artifact save failure: ${detail}`,
            });
            failLiveTask('Planner', `planner artifact save failure: ${detail}`);
            return;
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: 'Planner',
            message: 'planner task graph save started',
          });

          try {
            const liveProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
            if (liveProject) {
              const nonPlanner = liveProject.tasks.filter((candidate) => candidate.id !== taskId);
              nonPlanner.forEach((candidate, index) => {
                const mapped = plan.tasks[index];
                if (!mapped) return;
                dispatch({
                  type: 'UPDATE_TASK',
                  projectId,
                  taskId: candidate.id,
                  patch: {
                    title: `${candidate.agent}: ${mapped.title}`,
                    description: mapped.description,
                  },
                });
              });
            }
            dispatch({
              type: 'ADD_LOG',
              level: 'success',
              agent: 'Planner',
              message: 'planner task graph save success',
            });
          } catch (graphError) {
            const detail = graphError instanceof Error ? graphError.message : 'Unknown planner task graph save error';
            dispatch({
              type: 'ADD_LOG',
              level: 'error',
              agent: 'Planner',
              message: `planner task graph save failure: ${detail}`,
            });
          }

          dispatch({
            type: 'UPDATE_TASK',
            projectId,
            taskId,
            patch: {
              status: usedFallback ? 'completed_with_fallback' : 'done',
              errorMessage: usedFallback ? `Planner fallback used: ${fallbackReason || 'conversion failed'}` : undefined,
            },
          });
          dispatch({
            type: 'UPDATE_AGENT_STATUS',
            agent: 'Planner',
            status: 'idle',
            lastOutput: usedFallback ? 'completed_with_fallback' : 'completed',
          });
          dispatch({
            type: 'ADD_LOG',
            level: usedFallback ? 'warning' : 'success',
            agent: 'Planner',
            message: `planner final status: ${usedFallback ? 'completed_with_fallback' : 'completed'}`,
          });
          return;
        }

        for (let index = 0; index < updatedArtifacts.length; index += 1) {
          const { liveTask } = getLiveTask();
          if (!liveTask || liveTask.status !== 'running') {
            return;
          }

          const artifact = updatedArtifacts[index];
          const extractionIntent = deriveDocumentTableIntent(snapshot.projectPrompt, { defaultMode: 'booking' });

          if (artifactCanBeGeneratedLocally(project, task, artifact, snapshot)) {
            const builderBundle = findBuilderExecutionBundle(project.tasks);

            if (
              task.agent === 'Builder' &&
              artifact.path === SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH &&
              shouldUseSegmentedWebsiteBuild(project, snapshot)
            ) {
              const modelPayload = buildSegmentedWebsiteContentModelPayload(project, snapshot);
              if (!modelPayload) {
                failLiveTask(
                  task.agent,
                  `${task.agent}: verified source content is insufficient for deterministic website model normalization.`
                );
                return;
              }

              const selectedContent = JSON.stringify(modelPayload, null, 2);
              updatedArtifacts[index] = {
                ...artifact,
                content: selectedContent,
                rawContent: selectedContent,
                producedBy: task.agent,
                generatedAt: new Date(),
              };

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message: `${task.agent}: normalized verified website content model generated locally (${artifact.path}).`,
              });
              continue;
            }

            if (
              task.agent === 'Builder' &&
              shouldUseSegmentedWebsiteBuild(project, snapshot) &&
              (isSegmentedWebsiteCopyArtifactPath(artifact.path) ||
                isSegmentedWebsiteSourceArtifactPath(artifact.path))
            ) {
              const websiteModel =
                resolveSegmentedWebsiteContentModelFromTaskArtifacts(project.tasks, snapshot) ??
                buildSegmentedWebsiteContentModelPayload(project, snapshot);
              const verifiedContent = websiteModel?.verified ?? deriveVerifiedWebsiteContent(snapshot.siteSnapshots);
              if (!hasSufficientVerifiedWebsiteContent(verifiedContent)) {
                failLiveTask(
                  task.agent,
                  `${task.agent}: verified source content is insufficient for deterministic website generation.`
                );
                return;
              }

              const copySections =
                websiteModel?.copySections ??
                buildDeterministicWebsiteCopySections({
                  projectName: project.name,
                  verified: verifiedContent,
                  language: project.language,
                });

              if (isSegmentedWebsiteCopyArtifactPath(artifact.path)) {
                const sectionKey = resolveSegmentedWebsiteCopySectionByPath(artifact.path);
                if (!sectionKey) {
                  failLiveTask(
                    task.agent,
                    `${task.agent}: unknown website copy artifact mapping for ${artifact.path}.`
                  );
                  return;
                }

                const selectedSection = copySections[sectionKey];
                const selectedContent = JSON.stringify(selectedSection, null, 2);

                updatedArtifacts[index] = {
                  ...artifact,
                  content: selectedContent,
                  rawContent: selectedContent,
                  producedBy: task.agent,
                  generatedAt: new Date(),
                };

                dispatch({
                  type: 'ADD_LOG',
                  level: 'info',
                  agent: task.agent,
                  message: `${task.agent}: deterministic website copy section generated locally (${artifact.path}).`,
                });
                continue;
              }

              const sectionOverrides = resolveWebsiteCopySectionsFromTaskArtifacts(project.tasks, snapshot);
              const crossRunRisk = hasSegmentedWebsiteCrossRunRisk(project.tasks, snapshot);

              if (artifact.path === 'index.html') {
                const diagnostics = buildDeterministicWebsiteRenderDiagnostics({
                  projectName: project.name,
                  verified: verifiedContent,
                  copySections: sectionOverrides,
                  language: project.language,
                  crossRunContamination: crossRunRisk,
                });

                dispatch({
                  type: 'ADD_LOG',
                  level: diagnostics.firstCorruptionPoint ? 'warning' : 'info',
                  agent: task.agent,
                  message:
                    `${task.agent}: website pipeline diagnostics (` +
                    `firstCorruptionPoint=${diagnostics.firstCorruptionPoint ?? 'none'}) ` +
                    `${JSON.stringify(diagnostics.phases)}`,
                });
              }

              const websiteArtifacts = buildDeterministicWebsiteArtifacts({
                projectName: project.name,
                projectDescription: project.description,
                verified: verifiedContent,
                copySections: sectionOverrides,
                language: project.language,
                portraitImage: (() => {
                  const portraitPlan = buildPortraitAssetPlan(snapshot);
                  if (!portraitPlan) return null;
                  return {
                    src: portraitPlan.assetPath,
                    alt: portraitPlan.alt,
                  };
                })(),
              });

              const selectedContent =
                artifact.path === 'index.html'
                  ? websiteArtifacts.indexHtml
                  : artifact.path === 'styles.css'
                  ? websiteArtifacts.stylesCss
                  : websiteArtifacts.scriptJs;

              updatedArtifacts[index] = {
                ...artifact,
                content: selectedContent,
                rawContent: selectedContent,
                producedBy: task.agent,
                generatedAt: new Date(),
              };

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message: `${task.agent}: deterministic website file generated locally (${artifact.path}) from verified structured content.`,
              });
              continue;
            }

            if (task.agent === 'Builder' && artifact.path === 'patch-plan.md') {
              const generatedFilesArtifact = updatedArtifacts.find((candidate) => candidate.path === 'generated-files.json');
              const executionBundle = generatedFilesArtifact?.executionOutput ?? null;
              if (!executionBundle) {
                failLiveTask(task.agent, `${task.agent}: patch-plan generation requires parsed generated-files.json output first.`);
                return;
              }

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message: `${task.agent}: generating ${artifact.path} locally from structured bundle`,
              });

              updatedArtifacts[index] = {
                ...artifact,
                content: buildPatchPlanFromExecutionBundle(executionBundle, project),
                rawContent: '',
                producedBy: task.agent,
                generatedAt: new Date(),
              };
              continue;
            }

            if (
              task.agent === 'Builder' &&
              artifact.path === 'generated-files.json' &&
              shouldUseSegmentedWebsiteBuild(project, snapshot)
            ) {
              const indexHtml = getLatestArtifactContent(project.tasks, 'index.html');
              const stylesCss = getLatestArtifactContent(project.tasks, 'styles.css');
              const scriptJsRaw = getLatestArtifactContent(project.tasks, 'script.js');
              const sourceUrl = resolvePrimaryWebsiteSourceUrl(project, snapshot);

              if (!indexHtml?.trim()) {
                failLiveTask(task.agent, `${task.agent}: segmented website bundle assembly requires non-empty index.html.`);
                return;
              }
              if (!stylesCss?.trim()) {
                failLiveTask(task.agent, `${task.agent}: segmented website bundle assembly requires non-empty styles.css.`);
                return;
              }

              const portraitPlan = buildPortraitAssetPlan(snapshot);
              const portraitBundleFile = portraitPlan
                ? await materializePortraitBundleFile(portraitPlan)
                : null;

              const assembled = assembleSegmentedWebsiteSeedBundle({
                indexHtml,
                stylesCss,
                scriptJsRaw,
                noScriptMarker: SEGMENTED_WEBSITE_NO_SCRIPT_MARKER,
                sourceUrl,
                rawProjectPrompt: snapshot.projectPrompt,
                portraitRequirement: portraitPlan
                  ? {
                      assetPath: portraitPlan.assetPath,
                      materializedFile: portraitBundleFile,
                    }
                  : null,
              });

              if (!assembled.ok) {
                failLiveTask(
                  task.agent,
                  `${task.agent}: ${assembled.error}`
                );
                return;
              }

              const stabilized = stabilizeCodeExecutionBundle({
                bundle: assembled.bundle,
                projectName: project.name,
                projectDescription: project.description,
                latestRevisionFeedback: project.latestRevisionFeedback,
                outputType: project.outputType,
                language: project.language,
                sourceUrl,
              });

              updatedArtifacts[index] = {
                ...artifact,
                content: stabilized.bundle.summary,
                rawContent: JSON.stringify(stabilized.bundle, null, 2),
                executionOutput: stabilized.bundle,
                producedBy: task.agent,
                generatedAt: new Date(),
              };

              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                agent: task.agent,
                message:
                  `${task.agent}: assembled deterministic website bundle from segmented artifacts ` +
                  `(${stabilized.bundle.files.length} file(s)).`,
              });
              continue;
            }

            if (!builderBundle) {
              failLiveTask(task.agent, `${task.agent}: local packaging requires Builder generated-files execution bundle.`);
              return;
            }

            const mode = classifyCodeGenerationMode({
              name: project.name,
              description: project.description,
              latestRevisionFeedback: project.latestRevisionFeedback,
              outputType: project.outputType,
            });
            const stabilized = stabilizeCodeExecutionBundle({
              bundle: builderBundle,
              projectName: project.name,
              projectDescription: project.description,
              latestRevisionFeedback: project.latestRevisionFeedback,
              outputType: project.outputType,
              language: project.language,
            });

            if (task.agent === 'Tester' && artifact.path === 'bundle-export.md') {
              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message: `${task.agent}: generating deterministic packaging notes from Builder bundle`,
              });

              updatedArtifacts[index] = {
                ...artifact,
                content: buildDeterministicCodePackagingNotes({
                  bundle: stabilized.bundle,
                  mode,
                  entryPoint: stabilized.entryPoint,
                }),
                rawContent: '',
                producedBy: task.agent,
                generatedAt: new Date(),
              };
              continue;
            }

            if (task.agent === 'Integrator' && artifact.path === 'final-summary.md') {
              const reviewNotes = getLatestArtifactContent(project.tasks, 'review-notes.md');
              const packagingNotes = getLatestArtifactContent(project.tasks, 'bundle-export.md');

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message: `${task.agent}: generating deterministic final summary from shared source bundle`,
              });

              updatedArtifacts[index] = {
                ...artifact,
                content: buildDeterministicCodeFinalSummary({
                  bundle: stabilized.bundle,
                  mode,
                  entryPoint: stabilized.entryPoint,
                  reviewNotes,
                  packagingNotes,
                  rawProjectPrompt: snapshot.projectPrompt,
                  rawDebateSummary: snapshot.approvedDebateSummary,
                }),
                rawContent: '',
                producedBy: task.agent,
                generatedAt: new Date(),
              };
              continue;
            }

            failLiveTask(task.agent, `${task.agent}: unsupported local artifact generation target ${artifact.path}.`);
            return;
          }

          const isDeterministicDocumentExporterStage = isDocumentGeneratedFilesStage(
            project,
            task,
            artifact.path
          );

          if (isDeterministicDocumentExporterStage) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: task.agent,
              message: `${task.agent}: generating deterministic document export bundle (no OpenAI call).`,
            });

            const validatedRowsRaw = getLatestArtifactContent(project.tasks, 'validated-rows.json');
            const summaryMetadataRaw = getLatestArtifactContent(project.tasks, 'summary-metadata.json');

            const deterministicExport = buildDeterministicDocumentExecutionBundle({
              validatedRowsRaw,
              summaryMetadataRaw,
              language: project.language,
              requestedOutputPrompt: snapshot.projectPrompt,
            });

            updatedArtifacts[index] = {
              ...artifact,
              content: deterministicExport.bundle.summary,
              rawContent: JSON.stringify(deterministicExport.bundle, null, 2),
              executionOutput: deterministicExport.bundle,
              producedBy: task.agent,
              generatedAt: new Date(),
            };

            dispatch({
              type: 'ADD_LOG',
              level: 'success',
              agent: task.agent,
              message:
                `${task.agent}: deterministic export bundle ready ` +
                `(${deterministicExport.invoiceSummary.summary.invoiceCount} row(s), ${deterministicExport.bundle.files.length} file(s)).`,
            });
            continue;
          }

          if (
            task.agent === 'Builder' &&
            artifact.path === 'generated-files.json' &&
            shouldUseSegmentedWebsiteBuild(project, snapshot)
          ) {
            failLiveTask(
              task.agent,
              `${task.agent}: website generated-files assembly must be deterministic/local; OpenAI fallback is disabled to avoid timeout-prone monolithic generation.`
            );
            return;
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: task.agent,
            message: `${task.agent}: building prompt (${artifact.path})`,
          });

          const prompt = buildExecutionArtifactPrompt(task, artifact, snapshot, project);
          const compactContext = buildExecutionAgentContext(task, snapshot);
          const lightweightContext = {
            snapshotId: snapshot.id,
            cycleNumber: snapshot.cycleNumber,
            projectPrompt: shorten(snapshot.projectPrompt, 1200),
            revisionPrompt: shorten(snapshot.revisionPrompt ?? '', 600),
            executionPlan: shorten(getLatestArtifactContent(project.tasks, 'execution-plan.md') ?? '', 1200),
            architectureReview: shorten(getLatestArtifactContent(project.tasks, 'architecture-review.md') ?? '', 1200),
          };
          const modelContext = isSegmentedWebsiteSourceArtifactPath(artifact.path)
            ? lightweightContext
            : compactContext;
          const promptSize = estimatePromptSize(prompt, modelContext);
          const requiresStructuredOutput = artifactRequiresStructuredExecutionOutput(task, artifact);
          const shouldChunkPdfExtraction = shouldChunkBuilderPdfExtraction(task, artifact.path, snapshot, project);
          const structuredOnlyStage = shouldUseStructuredOnlyStage(artifact.path);
          const structuredAttachmentContext = buildSnapshotAttachmentContext(snapshot, new Set<string>());

          if (structuredOnlyStage) {
            const upstreamCountSource =
              artifact.path === 'normalized-rows.json'
                ? 'extracted-rows.json'
                : artifact.path === 'validated-rows.json'
                ? 'normalized-rows.json'
                : artifact.path === 'summary-metadata.json'
                ? 'validated-rows.json'
                : 'validated-rows.json';
            const upstreamRows = tryExtractRowsCount(getLatestArtifactContent(project.tasks, upstreamCountSource));
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: task.agent,
              message:
                `${task.agent}: stage=${artifact.path} uses structured-data-only context (no PDF re-read)` +
                `${typeof upstreamRows === 'number' ? `; inputRows=${upstreamRows}` : ''}.`,
            });
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: task.agent,
            message: `${task.agent}: prompt size estimate chars=${promptSize.chars}, tokens~=${promptSize.tokensApprox}`,
          });

          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            agent: task.agent,
            message: shouldChunkPdfExtraction
              ? `${task.agent}: calling OpenAI with PDF chunking enabled (${snapshot.pdfTexts.length} PDFs)`
              : `${task.agent}: calling OpenAI`,
          });

          let response: AiRespondResult;
          if (shouldChunkPdfExtraction) {
            const maxFilesPerChunk = resolveBuilderPdfChunkSize(project, snapshot);
            const pdfChunks = chunkArray(snapshot.pdfTexts, maxFilesPerChunk);
            const extractedRowsAcrossChunks: BuilderExtractionRow[] = [];
            const completedChunkSummaries: Array<{
              pass: 'pass1' | 'pass2';
              chunk: number;
              files: string[];
              rows: number;
            }> = [];
            const enrichmentEnabled = shouldRunBuilderChunkEnrichment(project, task);

            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: task.agent,
              message:
                `${task.agent}: chunking ${snapshot.pdfTexts.length} PDF(s) into ${pdfChunks.length} chunk(s)` +
                ` (max ${maxFilesPerChunk} files/chunk).`,
            });

            const persistPartialChunkDebug = (
              pass: 'pass1' | 'pass2',
              chunkNumber: number,
              chunkFiles: string[],
              reason: string
            ) => {
              const debugPayload = {
                status: 'partial_chunk_failure',
                failedPass: pass,
                failedChunk: chunkNumber,
                failedFiles: chunkFiles,
                reason,
                completedChunks: completedChunkSummaries,
                extractedRowsSoFar: extractedRowsAcrossChunks.length,
                dedupedRowsSoFar: mergeExtractionRows(extractedRowsAcrossChunks).length,
              };
              const debugContent = JSON.stringify(debugPayload, null, 2);
              updatedArtifacts[index] = {
                ...artifact,
                content: debugContent,
                rawContent: debugContent,
                executionOutput: null,
                producedBy: task.agent,
                generatedAt: new Date(),
              };
              dispatch({
                type: 'UPDATE_TASK',
                projectId,
                taskId,
                patch: { producesArtifacts: updatedArtifacts },
              });
            };

            for (let chunkIndex = 0; chunkIndex < pdfChunks.length; chunkIndex += 1) {
              const pdfChunk = pdfChunks[chunkIndex];
              const chunkFiles = pdfChunk.map((entry) => `${entry.title} (${entry.attachmentId})`);

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent: task.agent,
                message:
                  `${task.agent}: pass1 processing chunk ${chunkIndex + 1}/${pdfChunks.length} ` +
                  `with ${pdfChunk.length} file(s): ${chunkFiles.join(', ')}`,
              });

              const pass1ChunkPrompt = buildBuilderChunkPass1Prompt(
                project,
                snapshot,
                chunkIndex,
                pdfChunks.length,
                pdfChunk,
                extractionIntent
              );
              const chunkAttachmentContext = buildSnapshotAttachmentContext(
                snapshot,
                new Set(pdfChunk.map((entry) => entry.attachmentId))
              );

              let pass1ChunkResponse: AiRespondResult;
              try {
                pass1ChunkResponse = await callAiRespond(
                  {
                    projectId,
                    language: project.language,
                    agentRole: task.agent,
                    model: task.model,
                    responseMode: 'default',
                    inputText: pass1ChunkPrompt,
                    context: {
                      artifactPath: artifact.path,
                      snapshotId: snapshot.id,
                      cycleNumber: snapshot.cycleNumber,
                      extractionChunk: {
                        pass: 'pass1',
                        chunkNumber: chunkIndex + 1,
                        chunkCount: pdfChunks.length,
                        files: pdfChunk.map((entry) => ({
                          attachmentId: entry.attachmentId,
                          title: entry.title,
                        })),
                      },
                    },
                  },
                  { agent: task.agent },
                  chunkAttachmentContext,
                  { timeoutMs: executionTaskTimeoutMs }
                );
              } catch (error) {
                const detail = formatAiExecutionError(error);
                const infra = error instanceof AiRequestError ? error : null;
                const chunkLabel = `chunk ${chunkIndex + 1}/${pdfChunks.length}`;
                persistPartialChunkDebug('pass1', chunkIndex + 1, chunkFiles, detail.message);
                failLiveTask(
                  task.agent,
                  `${task.agent}: pass1 OpenAI call failed for ${artifact.path} (${chunkLabel}) files=[${chunkFiles.join(', ')}]: ${detail.message}`,
                  {
                    artifactPath: artifact.path,
                    rawBodySnippet: infra?.rawBodySnippet ?? null,
                  }
                );
                return;
              }

              let pass1RowsForChunk: BuilderExtractionRow[] = [];
              try {
                pass1RowsForChunk = parseBuilderChunkRows(pass1ChunkResponse.text, pdfChunk);
                pass1RowsForChunk = mergeBookingFallbackRows(pass1RowsForChunk, pdfChunk, extractionIntent);
                completedChunkSummaries.push({
                  pass: 'pass1',
                  chunk: chunkIndex + 1,
                  files: chunkFiles,
                  rows: pass1RowsForChunk.length,
                });
              } catch (error) {
                const parseDetail = error instanceof Error ? error.message : 'Unknown chunk parse failure';
                persistPartialChunkDebug('pass1', chunkIndex + 1, chunkFiles, parseDetail);
                failLiveTask(
                  task.agent,
                  `${task.agent}: pass1 chunk parse failed for ${artifact.path} (chunk ${chunkIndex + 1}/${pdfChunks.length}) ` +
                    `files=[${chunkFiles.join(', ')}]: ${parseDetail}`
                );
                return;
              }

              let mergedChunkRows = pass1RowsForChunk;
              if (enrichmentEnabled && pass1RowsForChunk.length > 0) {
                dispatch({
                  type: 'ADD_LOG',
                  level: 'info',
                  agent: task.agent,
                  message:
                    `${task.agent}: pass2 enrichment chunk ${chunkIndex + 1}/${pdfChunks.length} ` +
                    `files=[${chunkFiles.join(', ')}]`,
                });

                const pass2ChunkPrompt = buildBuilderChunkPass2Prompt(
                  project,
                  snapshot,
                  chunkIndex,
                  pdfChunks.length,
                  pdfChunk,
                  pass1RowsForChunk
                );

                let pass2ChunkResponse: AiRespondResult;
                try {
                  pass2ChunkResponse = await callAiRespond(
                    {
                      projectId,
                      language: project.language,
                      agentRole: task.agent,
                      model: task.model,
                      responseMode: 'default',
                      inputText: pass2ChunkPrompt,
                      context: {
                        artifactPath: artifact.path,
                        snapshotId: snapshot.id,
                        cycleNumber: snapshot.cycleNumber,
                        extractionChunk: {
                          pass: 'pass2',
                          chunkNumber: chunkIndex + 1,
                          chunkCount: pdfChunks.length,
                          files: pdfChunk.map((entry) => ({
                            attachmentId: entry.attachmentId,
                            title: entry.title,
                          })),
                        },
                      },
                    },
                    { agent: task.agent },
                    chunkAttachmentContext,
                    { timeoutMs: executionTaskTimeoutMs }
                  );
                } catch (error) {
                  const detail = formatAiExecutionError(error);
                  const infra = error instanceof AiRequestError ? error : null;
                  persistPartialChunkDebug('pass2', chunkIndex + 1, chunkFiles, detail.message);
                  failLiveTask(
                    task.agent,
                    `${task.agent}: pass2 OpenAI call failed for ${artifact.path} (chunk ${chunkIndex + 1}/${pdfChunks.length}) files=[${chunkFiles.join(', ')}]: ${detail.message}`,
                    {
                      artifactPath: artifact.path,
                      rawBodySnippet: infra?.rawBodySnippet ?? null,
                    }
                  );
                  return;
                }

                try {
                  const pass2RowsForChunk = parseBuilderChunkRows(pass2ChunkResponse.text, pdfChunk);
                  completedChunkSummaries.push({
                    pass: 'pass2',
                    chunk: chunkIndex + 1,
                    files: chunkFiles,
                    rows: pass2RowsForChunk.length,
                  });
                  mergedChunkRows = mergeBookingFallbackRows(
                    mergeChunkPassRows(pass1RowsForChunk, pass2RowsForChunk),
                    pdfChunk,
                    extractionIntent
                  );
                } catch (error) {
                  const parseDetail = error instanceof Error ? error.message : 'Unknown chunk parse failure';
                  persistPartialChunkDebug('pass2', chunkIndex + 1, chunkFiles, parseDetail);
                  failLiveTask(
                    task.agent,
                    `${task.agent}: pass2 chunk parse failed for ${artifact.path} (chunk ${chunkIndex + 1}/${pdfChunks.length}) files=[${chunkFiles.join(', ')}]: ${parseDetail}`
                  );
                  return;
                }
              }

              extractedRowsAcrossChunks.push(...mergedChunkRows);
              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                agent: task.agent,
                message:
                  `${task.agent}: chunk ${chunkIndex + 1}/${pdfChunks.length} extracted ` +
                  `${mergedChunkRows.length} row(s)` +
                  `${enrichmentEnabled ? ' (pass1 + optional pass2).' : ' (pass1 only).'}`,
              });
            }

            const mergedRows = mergeExtractionRows(extractedRowsAcrossChunks);
            const mergedRowsSummary = buildMergedRowsSummary(mergedRows, extractionIntent);
            const rowsForFinalPrompt = mergedRows
              .slice(0, BUILDER_MAX_MERGED_ROWS_FOR_FINAL_PROMPT)
              .map((row) => ({
                sourceAttachmentId: row.sourceAttachmentId,
                sourceTitle: row.sourceTitle,
                values: normalizeRowValues(row.values),
              }));
            const droppedRows = Math.max(0, mergedRows.length - rowsForFinalPrompt.length);

            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: task.agent,
              message:
                `${task.agent}: merged chunk rows ${mergedRows.length} total` +
                `${droppedRows > 0 ? ` (trimmed ${droppedRows} row(s) for final prompt)` : ''}.`,
            });

            if (artifact.path === 'extracted-rows.json') {
              response = {
                text: JSON.stringify(
                  {
                    chunking: {
                      chunkCount: pdfChunks.length,
                      maxFilesPerChunk,
                      completedChunks: completedChunkSummaries,
                      extractionPasses: enrichmentEnabled
                        ? ['pass1_required_fields', 'pass2_optional_enrichment']
                        : ['pass1_required_fields'],
                    },
                    mergedRowsCount: mergedRows.length,
                    summary: mergedRowsSummary,
                    rows: rowsForFinalPrompt,
                  },
                  null,
                  2
                ),
                meta: null,
              };
            } else {
              const finalPrompt = [
                prompt,
                'Chunk extraction merge data (use as canonical extracted records, keep source traceability):',
                JSON.stringify(
                  {
                    chunking: {
                      chunkCount: pdfChunks.length,
                      maxFilesPerChunk,
                      completedChunks: completedChunkSummaries,
                      extractionPasses: enrichmentEnabled
                        ? ['pass1_required_fields', 'pass2_optional_enrichment']
                        : ['pass1_required_fields'],
                    },
                    mergedRowsCount: mergedRows.length,
                    summary: mergedRowsSummary,
                    rows: rowsForFinalPrompt,
                  },
                  null,
                  2
                ),
              ].join('\n\n');

              try {
                response = await callAiRespond(
                  {
                    projectId,
                    language: project.language,
                    agentRole: task.agent,
                    model: task.model,
                    responseMode: requiresStructuredOutput ? 'structured_execution_bundle' : 'default',
                    inputText: finalPrompt,
                    context: {
                      artifactPath: artifact.path,
                      ...modelContext,
                      chunking: {
                        chunkCount: pdfChunks.length,
                        maxFilesPerChunk,
                        mergedRowsCount: mergedRows.length,
                        mergedRowsTrimmed: droppedRows,
                        extractionPasses: enrichmentEnabled
                          ? ['pass1_required_fields', 'pass2_optional_enrichment']
                          : ['pass1_required_fields'],
                      },
                    },
                  },
                  { agent: task.agent },
                  structuredAttachmentContext,
                  { timeoutMs: executionTaskTimeoutMs }
                );
              } catch (error) {
                const detail = formatAiExecutionError(error);
                const infra = error instanceof AiRequestError ? error : null;
                failLiveTask(task.agent, `${task.agent}: final merged OpenAI call failed for ${artifact.path}: ${detail.message}`, {
                  artifactPath: artifact.path,
                  rawBodySnippet: infra?.rawBodySnippet ?? null,
                });
                if (infra?.kind === 'infrastructure') {
                  dispatch({
                    type: 'ADD_LOG',
                    level: 'error',
                    agent: task.agent,
                    message:
                      `${task.agent} failed because AI endpoint returned non-JSON/HTML or gateway failure` +
                      `${infra.statusCode ? ` (HTTP ${infra.statusCode})` : ''}.`,
                  });
                }
                return;
              }
            }
          } else {
            try {
              response = await callAiRespond(
                {
                  projectId,
                  language: project.language,
                  agentRole: task.agent,
                  model: task.model,
                  responseMode: requiresStructuredOutput ? 'structured_execution_bundle' : 'default',
                  inputText: prompt,
                  context: {
                    artifactPath: artifact.path,
                    ...modelContext,
                  },
                },
                { agent: task.agent },
                structuredOnlyStage ? structuredAttachmentContext : snapshotAttachmentContext,
                { timeoutMs: executionTaskTimeoutMs }
              );
            } catch (error) {
              const detail = formatAiExecutionError(error);
              const infra = error instanceof AiRequestError ? error : null;
              failLiveTask(task.agent, `${task.agent}: OpenAI call failed for ${artifact.path}: ${detail.message}`, {
                artifactPath: artifact.path,
                rawBodySnippet: infra?.rawBodySnippet ?? null,
              });
              if (infra?.kind === 'infrastructure') {
                dispatch({
                  type: 'ADD_LOG',
                  level: 'error',
                  agent: task.agent,
                  message:
                    `${task.agent} failed because AI endpoint returned non-JSON/HTML or gateway failure` +
                    `${infra.statusCode ? ` (HTTP ${infra.statusCode})` : ''}.`,
                });
              }
              return;
            }
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            agent: task.agent,
            message: `${task.agent}: OpenAI returned (${artifact.path})`,
          });

          if (!response.text || !response.text.trim()) {
            failLiveTask(task.agent, `${task.agent}: artifact parsing failed for ${artifact.path} (empty output).`);
            return;
          }

          if (artifactRequiresStructuredExecutionOutput(task, artifact)) {
            const parsedExecutionOutput = parseExecutionOutputBundle(response.text, task, project);
            if (parsedExecutionOutput.error) {
              updatedArtifacts[index] = {
                ...artifact,
                content: response.text,
                rawContent: response.text,
                executionOutput: null,
                producedBy: task.agent,
                generatedAt: new Date(),
              };

              dispatch({
                type: 'UPDATE_TASK',
                projectId,
                taskId,
                patch: { producesArtifacts: updatedArtifacts },
              });

              failLiveTask(
                task.agent,
                `${task.agent}: structured execution output invalid for ${artifact.path}: ${parsedExecutionOutput.error}`
              );
              return;
            }

            const executionBundle = parsedExecutionOutput.bundle;
            if (!executionBundle) {
              failLiveTask(
                task.agent,
                `${task.agent}: structured execution output missing for ${artifact.path}`
              );
              return;
            }

            updatedArtifacts[index] = {
              ...artifact,
              content: executionBundle.summary,
              rawContent: response.text,
              executionOutput: executionBundle,
              producedBy: task.agent,
              generatedAt: new Date(),
            };
            continue;
          }

          updatedArtifacts[index] = {
            ...artifact,
            content: response.text,
            rawContent: response.text,
            producedBy: task.agent,
            generatedAt: new Date(),
          };
        }

        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          agent: task.agent,
          message: `${task.agent}: saving artifact`,
        });

        try {
          dispatch({
            type: 'UPDATE_TASK',
            projectId,
            taskId,
            patch: { producesArtifacts: updatedArtifacts },
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unknown artifact save error';
          failLiveTask(task.agent, `${task.agent}: artifact save failed: ${detail}`);
          return;
        }

        dispatch({
          type: 'ADD_LOG',
          level: 'success',
          agent: task.agent,
          message: `${task.agent} agent completed`,
        });

        completeTask(projectId, taskId, { skipFailure: true, lastOutput: task.title });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown execution runner error';
        failLiveTask(task.agent, `${task.agent}: execution runner failed: ${detail}`);
      } finally {
        clearTimeout(stallTimer);
      }
    },
    [
      buildPlannerArtifactMarkdown,
      buildPlannerFallbackPlan,
      buildExecutionAgentContext,
      buildExecutionArtifactPrompt,
      callAiRespond,
      completeTask,
      executionTaskTimeoutMs,
      validatePlannerStructuredPlan,
    ]
  );

  const startTask = useCallback(
    (project: Project, task: Task) => {
      if (task.agent === 'Planner') {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: 'Planner',
          message:
            `REAL PLANNER PATH REACHED ${REAL_PLANNER_BUILD_MARKER} ` +
            `(startTask -> ${project.simulationMode ? 'simulation' : 'runLiveTaskExecution'})`,
        });
      }

      dispatch({
        type: 'UPDATE_TASK',
        projectId: project.id,
        taskId: task.id,
        patch: { status: 'running', errorMessage: undefined },
      });
      dispatch({
        type: 'UPDATE_AGENT_STATUS',
        agent: task.agent,
        status: 'active',
        lastOutput: task.title,
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        agent: task.agent,
        message: translateProjectWithVars(project.language, 'workflow.task.transition.running', {
          title: task.title,
        }),
      });

      const startLogKey = agentStartLogKey[task.agent];
      if (startLogKey) {
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          agent: task.agent,
          message: translateProject(project.language, startLogKey),
        });
      }

      if (!project.simulationMode) {
        setTimeout(() => {
          void runLiveTaskExecution(project.id, task.id);
        }, 0);
        return;
      }

      if (task.agent === 'Planner') {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: 'Planner',
          message: 'planner final status: simulation_branch_no_openai',
        });
      }

      const speed = executionSpeedRef.current;
      const config = SPEED_CONFIG[speed];
      const durationMs =
        config.minTaskMs + Math.round(Math.random() * (config.maxTaskMs - config.minTaskMs));
      taskTimersRef.current[task.id] = setTimeout(() => completeTask(project.id, task.id), durationMs);
    },
    [agentStartLogKey, completeTask, runLiveTaskExecution, translateProject, translateProjectWithVars]
  );

  const schedulerTick = useCallback(
    (projectId: string, forceBatch = false) => {
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!project?.taskGraph) return;

      syncTaskAvailability(project);

      const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!refreshedProject?.taskGraph) return;

      const phase = derivePhaseFromTasks(refreshedProject.tasks);
      const previousPhase = projectPhaseRef.current[projectId];
      if (phase !== previousPhase) {
        projectPhaseRef.current[projectId] = phase;
        dispatch({ type: 'SET_PHASE', phase });
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          message: translateProjectWithVars(refreshedProject.language, 'workflow.advanceTo', {
            phase: translateProject(refreshedProject.language, `phase.${phase}` as TranslationKey),
          }),
        });
      }

      syncAgentStatusesFromTasks(refreshedProject);

      if (phase === 'complete') {
        const completionSnapshotId =
          refreshedProject.executionSnapshot?.id ??
          `cycle-${refreshedProject.revisionRound + 1}-${refreshedProject.tasks.length}`;
        if (completedSnapshotRef.current[projectId] !== completionSnapshotId) {
          completedSnapshotRef.current[projectId] = completionSnapshotId;

          const cycleNumber = refreshedProject.revisionRound + 1;
          const status = deriveRevisionExecutionStatus(refreshedProject.tasks);
          let finalSummary = findIntegratorFinalSummary(refreshedProject.tasks) ?? undefined;

          let baselineUpdated = false;
          let generatedFilesCount: number | undefined;

          if (status === 'completed' || status === 'completed_with_fallback') {
            const builderBundle = findBuilderExecutionBundle(refreshedProject.tasks);
            if (builderBundle) {
              const mergedFiles = mergeExecutionBaselineFiles(
                refreshedProject.latestStableFiles,
                builderBundle
              );
              dispatch({
                type: 'SET_STABLE_BASELINE',
                projectId,
                bundle: {
                  ...builderBundle,
                  files: mergedFiles,
                },
                files: mergedFiles,
              });
              baselineUpdated = true;
              generatedFilesCount = mergedFiles.length;
              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                message: `Stable baseline updated for cycle ${cycleNumber} (${mergedFiles.length} files).`,
              });
            }
          }

          if (status === 'failed') {
            const propagationSummary = buildWorkflowFailurePropagationSummary(refreshedProject.tasks);
            if (propagationSummary) {
              dispatch({
                type: 'ADD_LOG',
                level: 'warning',
                message: propagationSummary,
              });
              if (!finalSummary) {
                finalSummary = propagationSummary;
              }
            }
          }

          dispatch({
            type: 'COMPLETE_REVISION_CYCLE',
            projectId,
            cycleNumber,
            status,
            baselineUpdated,
            finalSummary,
            generatedFilesCount,
          });
        }

        const scheduler = schedulerIntervalsRef.current[projectId];
        if (scheduler) {
          clearInterval(scheduler);
          delete schedulerIntervalsRef.current[projectId];
          setSchedulerPaused(projectId, false, false);
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: translateProject(refreshedProject.language, 'workflow.exec.log.complete'),
          });
        }
        return;
      }

      if (schedulerPausedRef.current[projectId] && !forceBatch) {
        return;
      }

      for (const task of refreshedProject.tasks) {
        if (task.status !== 'queued' && task.status !== 'blocked') {
          continue;
        }

        const prerequisite = validateTaskPrerequisites(refreshedProject, task);
        if (!prerequisite.ok && prerequisite.reason === 'dependency-failed') {
          const nextStatus: Task['status'] =
            task.status === 'blocked'
              ? 'blocked_due_to_failed_dependency'
              : 'canceled_due_to_failed_dependency';
          const trace = prerequisite.dependencyTask
            ? findDependencyFailureTrace(refreshedProject, prerequisite.dependencyTask)
            : findDependencyFailureTrace(refreshedProject, task);
          const reason = formatDependencyFailureMessage(
            task,
            prerequisite.dependencyTask,
            trace,
            prerequisite.artifactPath,
            nextStatus === 'blocked_due_to_failed_dependency' ? 'blocked' : 'canceled'
          );
          dispatch({
            type: 'UPDATE_TASK',
            projectId,
            taskId: task.id,
            patch: {
              status: nextStatus,
              errorMessage: reason,
            },
          });
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: task.agent,
            message: reason,
          });
        }
      }

      const postValidationProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!postValidationProject?.taskGraph) return;

      const validatedRunningTasks = postValidationProject.tasks.filter((task) => task.status === 'running');
      const validatedReadyTasks = postValidationProject.tasks.filter(
        (task) => task.status === 'queued' && dependenciesSatisfied(postValidationProject.tasks, task)
      );
      const validatedBlockedTasks = postValidationProject.tasks.filter((task) => task.status === 'blocked');

      if (!schedulerPausedRef.current[projectId] && validatedRunningTasks.length === 0 && validatedReadyTasks.length === 0 && validatedBlockedTasks.length > 0) {
        let propagatedBlockedTasks = 0;
        for (const blockedTask of validatedBlockedTasks) {
          const trace = findDependencyFailureTrace(postValidationProject, blockedTask);
          if (!trace) {
            continue;
          }

          const prerequisite = validateTaskPrerequisites(postValidationProject, blockedTask);
          const reason = formatDependencyFailureMessage(
            blockedTask,
            prerequisite.ok ? undefined : prerequisite.dependencyTask,
            trace,
            prerequisite.ok ? undefined : prerequisite.artifactPath,
            'blocked'
          );
          dispatch({
            type: 'UPDATE_TASK',
            projectId,
            taskId: blockedTask.id,
            patch: {
              status: 'blocked_due_to_failed_dependency',
              errorMessage: reason,
            },
          });
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: blockedTask.agent,
            message: reason,
          });
          propagatedBlockedTasks += 1;
        }

        if (propagatedBlockedTasks > 0) {
          return 0;
        }

        const blockedDetails: DeadlockTaskDetail[] = validatedBlockedTasks.map((task) => {
          const missingDependencies = task.dependsOn.filter(
            (dependencyId) => !postValidationProject.tasks.some((candidate) => candidate.id === dependencyId)
          );

          const unresolvedDependencies = task.dependsOn
            .map((dependencyId) => postValidationProject.tasks.find((candidate) => candidate.id === dependencyId))
            .filter(
              (dependency): dependency is Task =>
                Boolean(
                  dependency &&
                    dependency.status !== 'done' &&
                    dependency.status !== 'completed_with_fallback' &&
                    !isFailureTerminalStatus(dependency.status)
                )
            )
            .map((dependency) => `${dependency.title} [${dependency.status}]`);

          const prerequisite = validateTaskPrerequisites(postValidationProject, task);
          const unmetDependencies = [
            ...missingDependencies.map((dependencyId) => `missing dependency id ${dependencyId}`),
            ...unresolvedDependencies,
          ];

          if (!prerequisite.ok && prerequisite.reason !== 'dependency-failed') {
            const referenceTask = prerequisite.dependencyTask?.title ?? 'graph reference';
            const artifact = prerequisite.artifactPath ? ` (${prerequisite.artifactPath})` : '';
            unmetDependencies.push(`${prerequisite.reason}: ${referenceTask}${artifact}`);
          }

          return {
            taskId: task.id,
            taskTitle: task.title,
            unmetDependencies,
          };
        });

        const deadlockMessage = blockedDetails
          .map(
            (detail) =>
              `${detail.taskTitle} <= ${detail.unmetDependencies.join(', ') || 'dependency state unresolved'}`
          )
          .join(' | ');
        const signature = `${projectId}:${deadlockMessage}`;
        if (deadlockSignatureRef.current[projectId] !== signature) {
          deadlockSignatureRef.current[projectId] = signature;
          setDeadlocks((previous) => ({
            ...previous,
            [projectId]: {
              blockedTasks: blockedDetails,
              message: deadlockMessage,
            },
          }));
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: translateProjectWithVars(refreshedProject.language, 'workflow.scheduler.deadlock', {
              details: deadlockMessage,
            }),
          });
        }
        return 0;
      }

      if (deadlocks[projectId]) {
        setDeadlocks((previous) => ({ ...previous, [projectId]: null }));
        delete deadlockSignatureRef.current[projectId];
      }

      const slots = Math.max(0, postValidationProject.taskGraph.concurrencyLimit - validatedRunningTasks.length);
      let startedCount = 0;
      for (const task of validatedReadyTasks.slice(0, slots)) {
        const prerequisite = validateTaskPrerequisites(postValidationProject, task);
        if (!prerequisite.ok) {
          if (prerequisite.reason === 'dependency-pending') {
            continue;
          }

          const upstreamTask = prerequisite.dependencyTask?.title ?? 'unknown dependency';
          const upstreamArtifact = prerequisite.artifactPath ? ` (${prerequisite.artifactPath})` : '';
          const status: Task['status'] =
            prerequisite.reason === 'dependency-failed'
              ? 'canceled_due_to_failed_dependency'
              : 'blocked_due_to_failed_dependency';

          dispatch({
            type: 'UPDATE_TASK',
            projectId,
            taskId: task.id,
            patch: {
              status,
              errorMessage: `${prerequisite.details}`,
            },
          });
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            agent: task.agent,
            message: `${task.agent} blocked because required artifact is missing/invalid: ${upstreamTask}${upstreamArtifact}`,
          });
          continue;
        }

        startTask(postValidationProject, task);
        startedCount += 1;
      }

      return startedCount;
    },
    [
      autoPauseCheckpoints,
      derivePhaseFromTasks,
      deadlocks,
      setSchedulerPaused,
      startTask,
      syncAgentStatusesFromTasks,
      syncTaskAvailability,
      validateTaskPrerequisites,
      translateProject,
      translateProjectWithVars,
    ]
  );

  const generateExecutionTaskGraph = useCallback(
    (project: Project): TaskGraph => {
      const maxRetries = project.simulationMode ? 2 : 1;
      const statusFor = (dependsOn: string[]): Task['status'] => (dependsOn.length === 0 ? 'queued' : 'blocked');
      const taskModel = resolveOpenAiModel(project.model);
      const pipeline = decideExecutionPipeline(project);
      const codeMode = classifyCodeGenerationMode({
        name: project.name,
        description: project.description,
        latestRevisionFeedback: project.latestRevisionFeedback,
        outputType: project.outputType,
      });
      const codeModeLabel = getModeLabel(codeMode);

      if (pipeline === 'code') {
        const codePlanner = createTask({
          title: `CodePlanner: Execution plan (${codeModeLabel})`,
          description: `Generate prioritized implementation plan for ${codeModeLabel} output with deterministic packaging contract coverage.`,
          agent: 'Planner',
          provider: 'openai',
          model: taskModel,
          dependsOn: [],
          status: 'queued',
          producesArtifacts: [{ path: 'execution-plan.md', label: 'Execution Plan', kind: 'doc' }],
        });

        const appArchitect = createTask({
          title: `AppArchitect: Architecture review (${codeModeLabel})`,
          description: `Define file-level architecture, entry point, and deployability boundaries for ${codeModeLabel}.`,
          agent: 'Architect',
          provider: 'openai',
          model: taskModel,
          dependsOn: [codePlanner.id],
          status: statusFor([codePlanner.id]),
          producesArtifacts: [{ path: 'architecture-review.md', label: 'Architecture Review', kind: 'doc' }],
        });

        if (shouldUseSegmentedWebsiteBuild(project, project.executionSnapshot ?? undefined)) {
          const webContentNormalizer = createTask({
            title: `WebContentNormalizer: Normalize website content model (${codeModeLabel})`,
            description:
              'Normalize verified source facts, slot mapping, pricing/contact/address fields, and public-safe section model before rendering files.',
            agent: 'Builder',
            provider: 'openai',
            model: taskModel,
            dependsOn: [appArchitect.id],
            status: statusFor([appArchitect.id]),
            producesArtifacts: [
              { path: SEGMENTED_WEBSITE_CONTENT_MODEL_ARTIFACT_PATH, label: 'Website Content Model', kind: 'json' },
            ],
          });

          let latestCopyDependencyId = webContentNormalizer.id;
          const copyTasks = SEGMENTED_WEBSITE_COPY_ARTIFACTS.map((entry, sectionIndex) => {
            const titleLabel =
              entry.section === 'hero'
                ? 'Hero'
                : entry.section === 'about'
                ? 'O mne'
                : entry.section === 'approach'
                ? 'Pristup a vzdelavani'
                : entry.section === 'topics'
                ? 'Temata'
                : entry.section === 'servicesPricing'
                ? 'Sluzby a ceny'
                : entry.section === 'contact'
                ? 'Kontakt'
                : 'Mapa';

            const dependencyId = latestCopyDependencyId;
            const task = createTask({
              title: `WebCopyBuilder ${sectionIndex + 1}/7: ${titleLabel} (${codeModeLabel})`,
              description: `Generate rewritten public website copy section for ${titleLabel} only.`,
              agent: 'Builder',
              provider: 'openai',
              model: taskModel,
              dependsOn: [dependencyId],
              status: statusFor([dependencyId]),
              producesArtifacts: [{ path: entry.path, label: `Website Copy ${titleLabel}`, kind: 'json' }],
            });
            latestCopyDependencyId = task.id;
            return task;
          });

          const webHtmlBuilder = createTask({
            title: `WebHtmlBuilder: Generate index.html (${codeModeLabel})`,
            description: 'Generate only index.html from validated section-level website copy outputs.',
            agent: 'Builder',
            provider: 'openai',
            model: taskModel,
            dependsOn: [latestCopyDependencyId],
            status: statusFor([latestCopyDependencyId]),
            producesArtifacts: [{ path: 'index.html', label: 'Website HTML', kind: 'doc' }],
          });

          const webStyleBuilder = createTask({
            title: `WebStyleBuilder: Generate styles.css (${codeModeLabel})`,
            description: 'Generate only styles.css using current index.html as input.',
            agent: 'Builder',
            provider: 'openai',
            model: taskModel,
            dependsOn: [webHtmlBuilder.id],
            status: statusFor([webHtmlBuilder.id]),
            producesArtifacts: [{ path: 'styles.css', label: 'Website Styles', kind: 'doc' }],
          });

          const webScriptBuilder = createTask({
            title: `WebScriptBuilder: Generate script.js (${codeModeLabel})`,
            description:
              'Generate only script.js for interaction, or return no-script marker when JavaScript is unnecessary.',
            agent: 'Builder',
            provider: 'openai',
            model: taskModel,
            dependsOn: [webStyleBuilder.id],
            status: statusFor([webStyleBuilder.id]),
            producesArtifacts: [{ path: 'script.js', label: 'Website Script', kind: 'doc' }],
          });

          const webBundleAssembler = createTask({
            title: `WebBundleAssembler: Assemble generated-files.json (${codeModeLabel})`,
            description:
              'Assemble deterministic generated-files bundle locally from index.html, styles.css, and optional script.js.',
            agent: 'Builder',
            provider: 'openai',
            model: taskModel,
            dependsOn: [webScriptBuilder.id],
            status: statusFor([webScriptBuilder.id]),
            producesArtifacts: [
              { path: 'generated-files.json', label: 'Generated Files', kind: 'json' },
              { path: 'patch-plan.md', label: 'Patch Plan', kind: 'doc' },
            ],
          });

          const qaReviewer = createTask({
            title: `QA: Quality and risk review (${codeModeLabel})`,
            description:
              'Review assembled website source set for requirement coverage, structural contract completeness, and risks.',
            agent: 'Reviewer',
            provider: 'openai',
            model: taskModel,
            dependsOn: [webBundleAssembler.id],
            status: statusFor([webBundleAssembler.id]),
            producesArtifacts: [{ path: 'review-notes.md', label: 'Review Notes', kind: 'report' }],
            retryCount: 0,
            maxRetries,
          });

          const bundleExporter = createTask({
            title: `BundleExporter: Packaging notes (${codeModeLabel})`,
            description: 'Prepare deterministic packaging notes from generated source set and QA feedback.',
            agent: 'Tester',
            provider: 'openai',
            model: taskModel,
            dependsOn: [qaReviewer.id],
            status: statusFor([qaReviewer.id]),
            producesArtifacts: [{ path: 'bundle-export.md', label: 'Bundle Export', kind: 'report' }],
            retryCount: 0,
            maxRetries,
          });

          const integrator = createTask({
            title: `Integrator: Final combined result (${codeModeLabel})`,
            description: 'Assemble deterministic final result summary from shared generated source set and stage notes.',
            agent: 'Integrator',
            provider: 'openai',
            model: taskModel,
            dependsOn: [bundleExporter.id],
            status: statusFor([bundleExporter.id]),
            producesArtifacts: [{ path: 'final-summary.md', label: 'Final Summary', kind: 'doc' }],
          });

          return {
            tasks: [
              codePlanner,
              appArchitect,
              webContentNormalizer,
              ...copyTasks,
              webHtmlBuilder,
              webStyleBuilder,
              webScriptBuilder,
              webBundleAssembler,
              qaReviewer,
              bundleExporter,
              integrator,
            ],
            concurrencyLimit: 2,
            maxRetries,
          };
        }

        const fileBuilder = createTask({
          title: `FileBuilder: Generate runnable files (${codeModeLabel})`,
          description:
            'Generate runnable files and structured bundle output with source files, README, run/deploy instructions, and manifest.',
          agent: 'Builder',
          provider: 'openai',
          model: taskModel,
          dependsOn: [appArchitect.id],
          status: statusFor([appArchitect.id]),
          producesArtifacts: [
            { path: 'generated-files.json', label: 'Generated Files', kind: 'json' },
            { path: 'patch-plan.md', label: 'Patch Plan', kind: 'doc' },
          ],
        });

        const qaReviewer = createTask({
          title: `QA: Quality and risk review (${codeModeLabel})`,
          description: 'Review generated source set for requirement coverage, structural contract completeness, and functional gaps.',
          agent: 'Reviewer',
          provider: 'openai',
          model: taskModel,
          dependsOn: [fileBuilder.id],
          status: statusFor([fileBuilder.id]),
          producesArtifacts: [{ path: 'review-notes.md', label: 'Review Notes', kind: 'report' }],
          retryCount: 0,
          maxRetries,
        });

        const bundleExporter = createTask({
          title: `BundleExporter: Packaging notes (${codeModeLabel})`,
          description: 'Prepare deterministic packaging notes from generated source set and QA feedback.',
          agent: 'Tester',
          provider: 'openai',
          model: taskModel,
          dependsOn: [qaReviewer.id],
          status: statusFor([qaReviewer.id]),
          producesArtifacts: [{ path: 'bundle-export.md', label: 'Bundle Export', kind: 'report' }],
          retryCount: 0,
          maxRetries,
        });

        const integrator = createTask({
          title: `Integrator: Final combined result (${codeModeLabel})`,
          description: 'Assemble deterministic final result summary from shared generated source set and stage notes.',
          agent: 'Integrator',
          provider: 'openai',
          model: taskModel,
          dependsOn: [bundleExporter.id],
          status: statusFor([bundleExporter.id]),
          producesArtifacts: [{ path: 'final-summary.md', label: 'Final Summary', kind: 'doc' }],
        });

        return {
          tasks: [codePlanner, appArchitect, fileBuilder, qaReviewer, bundleExporter, integrator],
          concurrencyLimit: 2,
          maxRetries,
        };
      }

      const documentExtractor = createTask({
        title: 'DocumentExtractor: Required field extraction',
        description: 'Extract required invoice/document rows from attachments in small chunks with strict source mapping.',
        agent: 'Builder',
        provider: 'openai',
        model: taskModel,
        dependsOn: [],
        status: 'queued',
        producesArtifacts: [
          { path: 'extracted-rows.json', label: 'Extracted Rows', kind: 'json' },
        ],
      });

      const normalizer = createTask({
        title: 'Normalizer: Dataset normalization',
        description: 'Normalize extracted rows into a stable schema for downstream validation and summaries.',
        agent: 'Architect',
        provider: 'openai',
        model: taskModel,
        dependsOn: [documentExtractor.id],
        status: statusFor([documentExtractor.id]),
        producesArtifacts: [
          { path: 'normalized-rows.json', label: 'Normalized Rows', kind: 'json' },
        ],
      });

      const validator = createTask({
        title: 'Validator: Quality checks',
        description: 'Validate normalized rows for duplicates, missing fields, suspicious values, and consistency flags.',
        agent: 'Reviewer',
        provider: 'openai',
        model: taskModel,
        dependsOn: [normalizer.id],
        status: statusFor([normalizer.id]),
        producesArtifacts: [
          { path: 'validated-rows.json', label: 'Validated Rows', kind: 'json' },
        ],
        retryCount: 0,
        maxRetries,
      });

      const summarizer = createTask({
        title: 'Summarizer: Monthly and annual summaries',
        description: 'Build summary metadata and totals only from validated structured rows.',
        agent: 'Tester',
        provider: 'openai',
        model: taskModel,
        dependsOn: [validator.id],
        status: statusFor([validator.id]),
        producesArtifacts: [
          { path: 'summary-metadata.json', label: 'Summary Metadata', kind: 'json' },
        ],
        retryCount: 0,
        maxRetries,
      });

      const exporter = createTask({
        title: 'Exporter: CSV/XLSX/JSON export bundle',
        description: 'Generate machine-usable export bundle from validated rows and summary metadata without re-reading PDFs.',
        agent: 'Builder',
        provider: 'openai',
        model: taskModel,
        dependsOn: [summarizer.id],
        status: statusFor([summarizer.id]),
        producesArtifacts: [
          { path: 'generated-files.json', label: 'Generated Files', kind: 'json' },
          { path: 'patch-plan.md', label: 'Patch Plan', kind: 'doc' },
        ],
      });

      const integrator = createTask({
        title: 'Integrator: Final combined result',
        description: 'Assemble final preview/output from staged structured artifacts and exporter bundle.',
        agent: 'Integrator',
        provider: 'openai',
        model: taskModel,
        dependsOn: [exporter.id],
        status: statusFor([exporter.id]),
        producesArtifacts: [
          { path: 'final-summary.md', label: 'Final Summary', kind: 'doc' },
        ],
      });

      return {
        tasks: [documentExtractor, normalizer, validator, summarizer, exporter, integrator],
        concurrencyLimit: 2,
        maxRetries,
      };
    },
    []
  );

  const startTaskGraphExecution = useCallback(
    async (project: Project) => {
      const previous = schedulerIntervalsRef.current[project.id];
      if (previous) {
        clearInterval(previous);
      }

      const taskGraph = generateExecutionTaskGraph(project);
      const selectedPipeline = decideExecutionPipeline(project);

      const normalizedTaskGraph: TaskGraph = {
        ...taskGraph,
        concurrencyLimit: Math.max(2, taskGraph.concurrencyLimit),
      };
      delete completedSnapshotRef.current[project.id];
      dispatch({ type: 'SET_TASK_GRAPH', projectId: project.id, taskGraph: normalizedTaskGraph });
      checkpointHitRef.current[project.id] = { approval: false };
      dispatch({ type: 'SET_PHASE', phase: 'execution' });
      setSchedulerPaused(project.id, false, false);
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: translateProject(project.language, 'workflow.graph.generated'),
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: 'Execution phase started; remaining tasks will auto-continue through Integrator.',
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: `Execution pipeline selected: ${selectedPipeline}`,
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message:
          `Revision cycle ${project.revisionRound + 1} started with baseline files: ` +
          `${project.latestStableFiles.length}`,
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: `Execution agent timeout configured: ${executionTaskTimeoutMs} ms`,
      });
      projectPhaseRef.current[project.id] = 'execution';

      schedulerIntervalsRef.current[project.id] = setInterval(() => {
        schedulerTick(project.id);
      }, SPEED_CONFIG[executionSpeedRef.current].tickMs);
    },
    [
      generateExecutionTaskGraph,
      schedulerTick,
      setSchedulerPaused,
      translateProject,
      executionTaskTimeoutMs,
    ]
  );

  const approvePlan = useCallback(() => {
    if (!state.activeProject) return;
    const project = state.activeProject;
    const snapshot = createExecutionSnapshot(project);
    const cycleNumber = project.revisionRound + 1;
    const debateSummary = getLatestOrchestratorSummary(project) ?? '';

    dispatch({
      type: 'SET_EXECUTION_SNAPSHOT',
      projectId: project.id,
      snapshot,
    });
    dispatch({
      type: 'MARK_REVISION_APPROVED',
      projectId: project.id,
      cycleNumber,
      debateSummary,
      snapshotId: snapshot.id,
    });
    dispatch({
      type: 'ADD_LOG',
      level: 'info',
      message: `Execution snapshot prepared (${snapshot.id})`,
    });

    dispatch({ type: 'APPROVE_PLAN' });
    setTimeout(() => {
      const latestProject = stateRef.current.projects.find((candidate) => candidate.id === project.id);
      if (latestProject) {
        void startTaskGraphExecution(latestProject);
      }
    }, 0);
  }, [createExecutionSnapshot, startTaskGraphExecution, state.activeProject]);

  const pauseExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, true, true);
  }, [setSchedulerPaused]);

  const resumeExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, false, true);
    schedulerTick(project.id);
  }, [schedulerTick, setSchedulerPaused]);

  const stopExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;

    const interval = schedulerIntervalsRef.current[project.id];
    if (interval) {
      clearInterval(interval);
      delete schedulerIntervalsRef.current[project.id];
    }

    const stopReason = translateProject(project.language, 'workflow.scheduler.manualStopReason');
    project.tasks.forEach((task) => {
      const taskTimer = taskTimersRef.current[task.id];
      if (taskTimer) {
        clearTimeout(taskTimer);
        delete taskTimersRef.current[task.id];
      }

      if (
        task.status !== 'done' &&
        task.status !== 'failed' &&
        task.status !== 'completed_with_fallback'
      ) {
        dispatch({
          type: 'UPDATE_TASK',
          projectId: project.id,
          taskId: task.id,
          patch: {
            status: 'failed',
            errorMessage: stopReason,
          },
        });
      }
    });

    setSchedulerPaused(project.id, true, false);
    dispatch({
      type: 'ADD_LOG',
      level: 'warning',
      message: translateProject(project.language, 'workflow.scheduler.stopped'),
    });
    schedulerTick(project.id, true);
  }, [schedulerTick, setSchedulerPaused, translateProject]);

  const stepExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, true, false);
    const started = schedulerTick(project.id, true) ?? 0;
    dispatch({
      type: 'ADD_LOG',
      level: 'info',
      message: translateProjectWithVars(project.language, 'workflow.scheduler.stepStarted', {
        count: started,
      }),
    });
  }, [schedulerTick, setSchedulerPaused, translateProjectWithVars]);

  const repairDeadlock = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;

    syncTaskAvailability(project, true);
    setDeadlocks((previous) => ({ ...previous, [project.id]: null }));
    delete deadlockSignatureRef.current[project.id];

    dispatch({
      type: 'ADD_LOG',
      level: 'success',
      message: translateProject(project.language, 'workflow.scheduler.repairRan'),
    });

    schedulerTick(project.id, true);
  }, [schedulerTick, syncTaskAvailability, translateProject]);

  const updateAgentStatusFn = useCallback(
    (agent: AgentName, status: AgentStatus, lastOutput?: string) => {
      dispatch({ type: 'UPDATE_AGENT_STATUS', agent, status, lastOutput });
    },
    []
  );

  const addUserMessage = useCallback((content: string, attachmentIds?: string[]) => {
    dispatch({ type: 'ADD_USER_MESSAGE', content, attachmentIds });
  }, []);

  const ingestAttachment = useCallback(
    async (projectId: string, attachment: ProjectAttachment) => {
      try {
        const projectContext = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        const isWebsiteProject = projectContext?.outputType === 'website';

        if (attachment.kind === 'url') {
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            message: `URL fetch started: ${attachment.sourceUrl ?? attachment.downloadUrl ?? attachment.title}`,
          });
          if (isWebsiteProject) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: 'Website source ingestion: running structured URL extraction before debate/execution.',
            });
          }
        }

        const response = await fetch('/api/attachments/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: attachment.kind,
            title: attachment.title,
            sourceUrl: attachment.sourceUrl,
            downloadUrl: attachment.downloadUrl,
            mimeType: attachment.mimeType,
            ...(attachment.kind === 'url'
              ? {
                  maxPages: isWebsiteProject ? 8 : 5,
                  maxDepth: isWebsiteProject ? 2 : 1,
                }
              : {}),
          }),
        });

        const body = (await response.json()) as AttachmentIngestApiResponse;
        const ingest = body.ingest;
        if (!response.ok || !ingest) {
          throw new Error(body.error ?? 'Attachment ingestion failed');
        }

        if (attachment.kind === 'url') {
          ingest.crawlEvents?.forEach((eventMessage) => {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: eventMessage,
            });
          });

          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `URL fetch success: ${attachment.sourceUrl ?? attachment.downloadUrl ?? attachment.title}`,
          });
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            message: `Readable text extracted: ${ingest.extractedText?.length ?? 0} chars`,
          });
        }

        dispatch({
          type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
          projectId,
          attachmentId: attachment.id,
          ingestion: ingest,
        });

        const client = getFirebaseClient();
        if (client) {
          const preferredCollection = attachment.firestoreCollection ?? 'attachments';
          const persistIngestion = async (collection: 'attachments' | 'artifacts') => {
            await setDoc(
              doc(client.firestore, 'projects', projectId, collection, attachment.id),
              {
                ingestion: {
                  ...ingest,
                  lastIncludedAt: ingest.lastIncludedAt ? ingest.lastIncludedAt.toISOString() : null,
                },
              },
              { merge: true }
            );
          };

          try {
            await persistIngestion(preferredCollection);
          } catch (persistError) {
            const code = getFirebaseErrorCode(persistError);
            const detail = getFirebaseErrorMessage(persistError);
            const permissionDenied = code === 'permission-denied' || code === 'firestore/permission-denied';

            if (preferredCollection === 'attachments' && permissionDenied) {
              dispatch({
                type: 'ADD_LOG',
                level: 'warning',
                message:
                  `Ingestion metadata write denied at projects/${projectId}/attachments/${attachment.id}; retrying artifacts path.`,
              });
              await persistIngestion('artifacts');
            } else {
              throw new Error(
                `Ingestion metadata write failed at projects/${projectId}/${preferredCollection}/${attachment.id}: ${detail}`
              );
            }
          }
        }

        const projectForLog = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        if (projectForLog) {
          const logKeyByKind: Record<ProjectAttachmentKind, TranslationKey> = {
            url: 'attachments.log.urlParsed',
            pdf: 'attachments.log.pdfParsed',
            image: 'attachments.log.imageIncluded',
            zip: 'attachments.log.zipIndexed',
            file: 'attachments.log.fileUploaded',
          };
          dispatch({
            type: 'ADD_LOG',
            level: ingest.status === 'failed' ? 'warning' : 'info',
            message: translateProjectWithVars(projectForLog.language, logKeyByKind[attachment.kind], {
              title: attachment.title,
            }),
          });
        } else {
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message: `Project lookup failed in ingestAttachment log stage for id ${projectId}.`,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Ingestion failed';
        if (attachment.kind === 'url') {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `URL fetch failure: ${attachment.sourceUrl ?? attachment.downloadUrl ?? attachment.title} (${detail})`,
          });
        }
        dispatch({
          type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
          projectId,
          attachmentId: attachment.id,
          ingestion: {
            status: 'failed',
            error: detail,
          },
        });
        const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          message: project
            ? translateProjectWithVars(project.language, 'attachments.log.ingestFailed', {
                title: attachment.title,
                error: detail,
              })
            : `Attachment ingest failed (${attachment.title}): ${detail}`,
        });
      }
    },
    [translateProjectWithVars]
  );

  const attachToProject = useCallback(
    async (projectId: string, attachment: DraftAttachmentInput): Promise<ProjectAttachment> => {
      const createdAt = new Date();
      const artifactId = generateId();
      const source = attachment.source ?? 'message';

      const maybeQueueForNextRound = (attachmentId: string) => {
        const debateRoundState = debateRoundStateRef.current[projectId];
        if (!debateRoundState?.isRunning) {
          return;
        }

        dispatch({
          type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
          projectId,
          attachmentId,
          ingestion: {
            queuedForNextRound: true,
            queuedAtRound: debateRoundState.currentRound,
          },
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          message: 'Attachment queued for next round',
        });
      };

      const persistAttachmentMetadata = async (
        client: NonNullable<ReturnType<typeof getFirebaseClient>>,
        payload: Record<string, unknown>,
        preferredCollection: 'attachments' | 'artifacts',
        options?: { merge?: boolean }
      ): Promise<'attachments' | 'artifacts'> => {
        const merge = options?.merge ?? false;
        const persistToCollection = async (collection: 'attachments' | 'artifacts') => {
          dispatch({
            type: 'ADD_LOG',
            level: 'info',
            message: `Firestore metadata save started: projects/${projectId}/${collection}/${artifactId}`,
          });
          const targetRef = doc(client.firestore, 'projects', projectId, collection, artifactId);
          if (merge) {
            await setDoc(targetRef, payload, { merge: true });
          } else {
            await setDoc(targetRef, payload);
          }
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firestore metadata save success: projects/${projectId}/${collection}/${artifactId}`,
          });
        };

        try {
          await persistToCollection(preferredCollection);
          return preferredCollection;
        } catch (error) {
          const code = getFirebaseErrorCode(error);
          const detail = getFirebaseErrorMessage(error);
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message:
              `Firestore metadata save failed: projects/${projectId}/${preferredCollection}/${artifactId}` +
              `${code ? ` [${code}]` : ''} ${detail}`,
          });

          const permissionDenied = code === 'permission-denied' || code === 'firestore/permission-denied';
          if (!permissionDenied || preferredCollection === 'artifacts') {
            throw error;
          }

          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message:
              `Firestore metadata path not allowed for anonymous auth, retrying under projects/${projectId}/artifacts/${artifactId}`,
          });

          await persistToCollection('artifacts');
          return 'artifacts';
        }
      };

      if (attachment.kind === 'url') {
        const normalizedUrl = normalizeUserUrl(attachment.url);
        if (!normalizedUrl) {
          throw new Error('URL attachment is empty.');
        }

        const title = normalizedUrl;
        const urlArtifact: ProjectAttachment = {
          id: artifactId,
          projectId,
          kind: 'url',
          source,
          firestoreCollection: 'attachments',
          title,
          downloadUrl: normalizedUrl,
          sourceUrl: normalizedUrl,
          ingestion: { status: 'uploaded', summary: 'URL stored, waiting for ingestion.' },
          createdAt,
        };

        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          message: `URL attachment added: ${normalizedUrl}`,
        });

        const client = getFirebaseClient();
        if (client) {
          try {
            const savedCollection = await persistAttachmentMetadata(
              client,
              {
              ...urlArtifact,
              createdAt: createdAt.toISOString(),
              createdBy: firebaseUid,
              },
              urlArtifact.firestoreCollection ?? 'attachments'
            );
            urlArtifact.firestoreCollection = savedCollection;
            dispatch({
              type: 'ADD_LOG',
              level: 'success',
              message: `URL artifact persisted: projects/${projectId}/${savedCollection}/${artifactId}`,
            });
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'URL metadata save failed';
            dispatch({
              type: 'ADD_LOG',
              level: 'error',
              message: `Firestore metadata save failed (URL artifact): ${detail}`,
            });
          }
        }

        try {
          dispatch({ type: 'ADD_PROJECT_ATTACHMENT', projectId, attachment: urlArtifact });
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Project/message attachment link success: source=${source} artifact=${artifactId}`,
          });
        } catch (error) {
          const detail = getFirebaseErrorMessage(error);
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Project/message attachment link failed: source=${source} artifact=${artifactId} ${detail}`,
          });
          throw error;
        }

        maybeQueueForNextRound(urlArtifact.id);
        await ingestAttachment(projectId, urlArtifact);
        return urlArtifact;
      }

      const file = attachment.file;
      const derivedKind = detectFileKind(file);
      const localImageDataUrl = derivedKind === 'image' ? await readFileAsDataUrl(file) : null;
      const safeName = sanitizeFileName(file.name);
      const storagePath = `projects/${projectId}/attachments/${artifactId}/${safeName}`;

      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: `Storage upload started: ${file.name}`,
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: `Storage upload target path: ${storagePath}`,
      });

      const client = getFirebaseClient();
      if (!client) {
        const initError = getFirebaseInitError() ?? 'Firebase initialization failed';
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          message: `Storage upload failed before start: ${initError}`,
        });
        throw new Error(`Storage upload failed before start: ${initError}`);
      }

      const configuredBucket = normalizeBucketName(getFirebaseStorageBucketName());
      const runtimeBucket = normalizeBucketName(client.storage.app.options.storageBucket?.toString?.() ?? null);

      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: `Storage upload bucket: ${runtimeBucket ?? '<missing>'}`,
      });

      if (configuredBucket && runtimeBucket && configuredBucket !== runtimeBucket) {
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          message:
            `Storage bucket mismatch: configured=${configuredBucket}, runtime=${runtimeBucket}`,
        });
      }

      let currentUser = client.auth.currentUser;
      if (!currentUser) {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          message: 'Storage upload waiting for anonymous auth.',
        });
        try {
          const credential = await signInAnonymously(client.auth);
          currentUser = credential.user;
          setFirebaseUid(credential.user.uid);
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firebase auth restored for upload (uid: ${credential.user.uid})`,
          });
        } catch (authError) {
          const authDetail = getFirebaseErrorMessage(authError);
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Storage upload failed: missing auth (${authDetail})`,
          });
          throw new Error(`Missing auth for Firebase Storage upload: ${authDetail}`);
        }
      }

      try {
        const storageRef = ref(client.storage, storagePath);
        console.info(
          `[attachment-upload] start project=${projectId} artifact=${artifactId} bucket=${runtimeBucket ?? '<missing>'} path=${storagePath}`
        );
        await uploadBytes(storageRef, file, {
          contentType: file.type || undefined,
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'success',
          message: `Storage upload success: ${storagePath}`,
        });

        const downloadUrl = await getDownloadURL(storageRef);
        if (!downloadUrl || !downloadUrl.trim()) {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Download URL creation failed: ${storagePath}`,
          });
          throw new Error('Missing download URL after Firebase Storage upload.');
        }

        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          message: `Download URL created: ${downloadUrl}`,
        });

        const uploadedArtifact: ProjectAttachment = {
          id: artifactId,
          projectId,
          kind: derivedKind,
          source,
          firestoreCollection: 'attachments',
          title: file.name,
          mimeType: file.type || undefined,
          size: Number.isFinite(file.size) ? file.size : undefined,
          storagePath,
          downloadUrl,
          sourceUrl: downloadUrl,
          aiImageDataUrl: localImageDataUrl ?? undefined,
          ingestion: { status: 'uploaded', summary: 'File uploaded, waiting for ingestion.' },
          createdAt,
        };

        const { aiImageDataUrl: _localOnlyAiImageDataUrl, ...persistableArtifact } = uploadedArtifact;

        const savedCollection = await persistAttachmentMetadata(
          client,
          {
          ...persistableArtifact,
          createdAt: createdAt.toISOString(),
          createdBy: firebaseUid,
          },
          uploadedArtifact.firestoreCollection ?? 'attachments'
        );
        uploadedArtifact.firestoreCollection = savedCollection;

        try {
          dispatch({ type: 'ADD_PROJECT_ATTACHMENT', projectId, attachment: uploadedArtifact });
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Project/message attachment link success: source=${source} artifact=${artifactId}`,
          });
        } catch (error) {
          const detail = getFirebaseErrorMessage(error);
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Project/message attachment link failed: source=${source} artifact=${artifactId} ${detail}`,
          });
          throw error;
        }
        maybeQueueForNextRound(uploadedArtifact.id);
        await ingestAttachment(projectId, uploadedArtifact);
        return uploadedArtifact;
      } catch (error) {
        const code = getFirebaseErrorCode(error);
        const detail = getFirebaseErrorMessage(error);

        if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found') {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Storage bucket not found: ${runtimeBucket ?? '<missing>'}`,
          });
        }

        if (code === 'storage/unauthorized') {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Storage upload failed: permission denied for ${storagePath}`,
          });
        }

        if (code === 'storage/unauthenticated') {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: 'Storage upload failed: missing auth.',
          });
        }

        if (detail.toLowerCase().includes('missing download url')) {
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: `Download URL creation failed: ${storagePath}`,
          });
        }

        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          message: `Attachment pipeline failed${code ? ` [${code}]` : ''}: ${detail}`,
        });

        throw new Error(`File upload failed for ${file.name}: ${detail}`);
      }
    },
    [firebaseUid, ingestAttachment]
  );

  const addLog = useCallback(
    (message: string, level: LogEntry['level'], agent?: AgentName) => {
      dispatch({ type: 'ADD_LOG', message, level, agent });
    },
    []
  );

  const setProjectSimulationMode = useCallback((projectId: string, simulationMode: boolean) => {
    dispatch({ type: 'SET_PROJECT_SIMULATION_MODE', projectId, simulationMode });
  }, []);
  
  const setProjectDebateRounds = useCallback((projectId: string, debateRounds: number) => {
    dispatch({ type: 'SET_PROJECT_DEBATE_ROUNDS', projectId, debateRounds });
  }, []);

  const clampDebateRounds = useCallback((rounds: number) => Math.min(3, Math.max(1, rounds)), []);

  const formatRoundExcerpts = useCallback(
    (messages: Array<{ agent: AgentName; content: string }>) => {
      if (messages.length === 0) {
        return '';
      }
      return messages
        .map((message) => `${message.agent}: ${message.content.slice(0, 220)}`)
        .join('\n');
    },
    []
  );

  const buildSimulatedRoundMessage = useCallback(
    (
      language: AppLanguage,
      agent: AgentName,
      round: number,
      previousRoundMessages: Array<{ agent: AgentName; content: string }>,
      mode: DebateTaskType
    ) => {
      if (mode === 'observational' && round === 1) {
        if (language === 'cz') {
          if (agent === 'Strategist') {
            return 'Vidim vstupni obsah a popisuji primo to, co je citelne nebo viditelne. Pokud casti chybi, jasne uvedu co nelze potvrdit.';
          }
          if (agent === 'Skeptic') {
            return 'Opatrny popis: uvedu pouze skutecne viditelne prvky a nejistoty oznacim explicitne bez spekulaci.';
          }
          return 'Strucna odpoved pro uzivatele: co je na vstupu videt/cist + kratka poznamka o nejistote jen pokud je potreba.';
        }

        if (agent === 'Strategist') {
          return 'Direct factual description of visible/readable input only. If anything is missing, I clearly say what cannot be verified.';
        }
        if (agent === 'Skeptic') {
          return 'Cautious direct description: only observable facts, and uncertainties stated explicitly when needed.';
        }
        return 'Concise user-ready answer describing what is visible/readable, with a short uncertainty note only if needed.';
      }

      if (language === 'cz') {
        if (round === 1 && agent === 'Strategist') {
          return 'Navrhuji smer: nejdrive dorucit jasne MVP s merenim dopadu, pak rozsireni po validaci. Priorita je rychla hodnota pro uzivatele a stabilni zaklad pro dalsi iterace.';
        }
        if (round === 1 && agent === 'Skeptic') {
          return 'Rizika: nejasny rozsah, podceneni integraci a pozdni overeni kvality. Chci explicitni checkpointy, jasna akceptacni kriteria a omezeni scope creep.';
        }
        if (round === 1 && agent === 'Pragmatist') {
          return 'MVP: jen klicovy tok, minimalni UX polish, jasna metrika uspechu. Prakticke omezeni: kratky cas, omezeny rozpočet a potreba rychle zpetne vazby od uzivatelu.';
        }
        if (round === 2 && agent === 'Strategist') {
          return `Reaguji na Skeptic: "${previousRoundMessages.find((m) => m.agent === 'Skeptic')?.content.slice(0, 70) ?? ''}". Doplnuji rizikove checkpointy a gate po kazdem milniku, aby byl plan kontrolovatelny.`;
        }
        if (round === 2 && agent === 'Skeptic') {
          return `Reaguji na Pragmatist: "${previousRoundMessages.find((m) => m.agent === 'Pragmatist')?.content.slice(0, 70) ?? ''}". Souhlasim s uzkym MVP, ale jen s povinnymi testy a seznamem zavislosti pred realizaci.`;
        }
        if (round === 2 && agent === 'Pragmatist') {
          return `Reaguji na Strategist: "${previousRoundMessages.find((m) => m.agent === 'Strategist')?.content.slice(0, 70) ?? ''}". Plan upravuji na kratke iterace s dorucenim po malych funkcich a rychlym QA.`;
        }
        if (agent === 'Strategist') {
          return 'Finalni plan: 1) potvrdit scope a metriky, 2) postavit zakladni implementaci, 3) provest validaci, 4) dorucit MVP a pripravit iteraci v2.';
        }
        if (agent === 'Skeptic') {
          return 'Top rizika + mitigace: nejasne zadani -> explicitni acceptance criteria; technicky dluh -> code review gate; casovy skluz -> pevne milniky a scope lock pro v1.';
        }
        return 'MVP deliverables + timeline: den 1-2 scope+navrh, den 3-5 implementace, den 6 QA+opravy, den 7 doruceni MVP a seznam navazujicich kroku.';
      }

      if (round === 1 && agent === 'Strategist') {
        return 'Proposed direction: deliver a focused MVP first with measurable outcomes, then expand based on validation. Prioritize fast user value and a stable foundation for iteration.';
      }
      if (round === 1 && agent === 'Skeptic') {
        return 'Key risks: unclear scope, underestimated integrations, and late quality validation. We need explicit checkpoints, acceptance criteria, and controls for scope creep.';
      }
      if (round === 1 && agent === 'Pragmatist') {
        return 'MVP scope: core user flow only, minimal polish, clear success metric. Practical constraints: short timeline, limited resources, and need for rapid feedback.';
      }
      if (round === 2 && agent === 'Strategist') {
        return `Responding to Skeptic: "${previousRoundMessages.find((m) => m.agent === 'Skeptic')?.content.slice(0, 70) ?? ''}". I am adding risk checkpoints and milestone gates so the plan remains controlled.`;
      }
      if (round === 2 && agent === 'Skeptic') {
        return `Responding to Pragmatist: "${previousRoundMessages.find((m) => m.agent === 'Pragmatist')?.content.slice(0, 70) ?? ''}". Narrow MVP is fine, but only with mandatory testing and dependency checks before execution.`;
      }
      if (round === 2 && agent === 'Pragmatist') {
        return `Responding to Strategist: "${previousRoundMessages.find((m) => m.agent === 'Strategist')?.content.slice(0, 70) ?? ''}". I refine execution into short iterations with incremental delivery and quick QA loops.`;
      }
      if (agent === 'Strategist') {
        return 'Final plan: 1) confirm scope and metrics, 2) build core implementation, 3) validate quality and behavior, 4) ship MVP and prepare v2 iteration.';
      }
      if (agent === 'Skeptic') {
        return 'Top risks + mitigations: unclear requirements -> explicit acceptance criteria; technical debt -> review gates; schedule slippage -> fixed milestones and strict v1 scope.';
      }
      return 'MVP deliverables + timeline: day 1-2 scope+design, day 3-5 implementation, day 6 QA+fixes, day 7 MVP release and prioritized follow-ups.';
    },
    []
  );

  const runAutoDebate = useCallback(
    (projectId: string) => {
      if (debateRunsRef.current[projectId]) return;
      debateRunsRef.current[projectId] = true;

      void (async () => {
        try {
          const latestState = stateRef.current;
          const initialProject = latestState.projects.find((candidate) => candidate.id === projectId);
          if (!initialProject || initialProject.status !== 'debating') {
            return;
          }

          const rounds = clampDebateRounds(initialProject.debateRounds);
          const language = initialProject.language;
          const revisionPrompt = initialProject.latestRevisionFeedback?.trim() || null;
          const task = revisionPrompt || initialProject.description;
          const taskType = detectDebateTaskType(task);
          const isOneRoundDescriptive = rounds === 1 && taskType === 'observational';
          const previousSummary = getLatestOrchestratorSummary(initialProject);
          const revisionFeedback = initialProject.latestRevisionFeedback;
          const baselineFilesForDebate = initialProject.latestStableFiles;
          const debateRunRound = initialProject.revisionRound + 1;
          const roundMessages: Array<{ round: number; agent: AgentName; content: string }> = [];
          const debateAgents: AgentName[] = ['Strategist', 'Skeptic', 'Pragmatist'];

          const crossReplyRule =
            language === 'cz'
              ? 'Musis reagovat aspon na jeden konkretni bod od jineho agenta z 1. kola a explicitne uvést jmeno agenta.'
              : 'You must respond to at least one specific point from another agent in round 1 and explicitly name that agent.';

          for (let round = 1; round <= rounds; round += 1) {
            debateRoundStateRef.current[projectId] = { isRunning: true, currentRound: round };
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: translateProjectWithVars(language, 'workflow.debate.round.started', { round }),
            });

            const previousRoundMessages = roundMessages.filter((message) => message.round === round - 1);
            const roundOneMessages = roundMessages.filter((message) => message.round === 1);
            const projectAtRoundStart = stateRef.current.projects.find((candidate) => candidate.id === projectId);
            if (!projectAtRoundStart || projectAtRoundStart.status !== 'debating') {
              return;
            }

            const roundAttachmentSnapshot = buildAttachmentContext(projectAtRoundStart);
            const roundAttachmentCounts = getAttachmentTypeCounts(projectAtRoundStart.attachments);
            const snapshotLog =
              `Round ${round} snapshot: images=${roundAttachmentCounts.images}, ` +
              `pdfs=${roundAttachmentCounts.pdfs}, urls=${roundAttachmentCounts.urls}, zips=${roundAttachmentCounts.zips}`;

            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: snapshotLog,
            });
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: `Round ${round} snapshot urls=${roundAttachmentCounts.urls}`,
            });
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: `Cycle ${debateRunRound} baseline files available: ${baselineFilesForDebate.length}`,
            });

            roundAttachmentSnapshot.includedAttachmentIds.forEach((attachmentId) => {
              dispatch({
                type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
                projectId,
                attachmentId,
                ingestion: {
                  queuedForNextRound: false,
                  includedInRound: round,
                },
              });
            });

            for (const agent of debateAgents) {
              const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
              if (!refreshedProject || refreshedProject.status !== 'debating') {
                return;
              }

              dispatch({
                type: 'ADD_LOG',
                level: 'info',
                agent,
                message: snapshotLog,
              });

              dispatch({ type: 'UPDATE_AGENT_STATUS', agent, status: 'thinking' });

              let content = '';
              if (refreshedProject.simulationMode) {
                content = buildSimulatedRoundMessage(
                  language,
                  agent,
                  round,
                  previousRoundMessages,
                  isOneRoundDescriptive ? 'observational' : 'planning'
                );
              } else {
                const roleInstruction = isOneRoundDescriptive
                  ? language === 'cz'
                    ? agent === 'Strategist'
                      ? 'Role: Strategist. Dej primy fakticky popis toho, co je skutecne videt/cist.'
                      : agent === 'Skeptic'
                      ? 'Role: Skeptic. Dej opatrny primy popis bez spekulaci; nejistoty uveď explicitne jen kdyz je to nutne.'
                      : 'Role: Pragmatist. Dej strucnou odpoved pripravenou pro uzivatele.'
                    : agent === 'Strategist'
                    ? 'Role: Strategist. Provide a direct factual description of what is actually visible/readable.'
                    : agent === 'Skeptic'
                    ? 'Role: Skeptic. Provide a cautious direct description without speculation; mention uncertainty only when needed.'
                    : 'Role: Pragmatist. Provide a concise user-ready answer.'
                  : language === 'cz'
                  ? agent === 'Strategist'
                    ? 'Role: Strategist. Navrhni nejlepsi strategicky pristup.'
                    : agent === 'Skeptic'
                    ? 'Role: Skeptic. Kriticky oponuj predpoklady a rizika.'
                    : 'Role: Pragmatist. Definuj prakticky MVP plan a omezeni.'
                  : agent === 'Strategist'
                  ? 'Role: Strategist. Propose the best strategic approach.'
                  : agent === 'Skeptic'
                  ? 'Role: Skeptic. Critique assumptions and major risks.'
                  : 'Role: Pragmatist. Define practical MVP scope and constraints.';

                const roundInstruction = isOneRoundDescriptive
                  ? language === 'cz'
                    ? [
                        'Rezim: observational/descriptive, 1 kolo.',
                        'Odpovez primo z dostupneho vstupu (obrazek/PDF/URL/text).',
                        'Popisuj jen skutecne viditelne/citelne informace.',
                        'Nepis strategii, MVP plan, next steps ani meta komentar o tom, jak bys analyzoval.',
                        'Nezminuj budouci kola.',
                        'Kdyz chybi vstupni data, rekni to jasne.',
                      ].join(' ')
                    : [
                        'Mode: observational/descriptive, one round.',
                        'Answer directly from available input (image/PDF/URL/text).',
                        'Describe only what is actually visible/readable.',
                        'Do not provide strategy, MVP plan, next steps, or meta discussion about how you would analyze it.',
                        'Do not talk about future rounds.',
                        'If input data is missing, say that clearly.',
                      ].join(' ')
                  : round === 1
                  ? language === 'cz'
                    ? 'Round 1: pocatecni pozice.'
                    : 'Round 1: initial position.'
                  : round === 2
                  ? `Round 2: ${crossReplyRule}`
                  : language === 'cz'
                  ? agent === 'Strategist'
                    ? 'Round 3: konvergence. Dodaj finalni doporuceny plan krok za krokem.'
                    : agent === 'Skeptic'
                    ? 'Round 3: konvergence. Dodaj top rizika a mitigace.'
                    : 'Round 3: konvergence. Dodaj MVP deliverables a orientacni timeline.'
                  : agent === 'Strategist'
                  ? 'Round 3: convergence. Provide the final recommended step-by-step plan.'
                  : agent === 'Skeptic'
                  ? 'Round 3: convergence. Provide top risks and mitigations.'
                  : 'Round 3: convergence. Provide MVP deliverables and timeline.';

                const inputAvailabilityInstruction =
                  roundAttachmentSnapshot.includedAttachmentIds.length > 0 ||
                  roundAttachmentSnapshot.textSections.length > 0
                    ? language === 'cz'
                      ? 'Vstupni data jsou k dispozici, pouzij je primo v odpovedi.'
                      : 'Input data is available; use it directly in your answer.'
                    : language === 'cz'
                    ? 'Vstupni data nejsou dostupna nebo nejsou citelna; tuto skutecnost jasne uveď.'
                    : 'Input data is missing or unreadable; state this clearly.';

                const prompt = [
                  language === 'cz' ? 'Pis cesky. Bud vecny.' : 'Write in English. Be concise.',
                  roleInstruction,
                  roundInstruction,
                  inputAvailabilityInstruction,
                  language === 'cz' ? `Zadani: ${task}` : `Task: ${task}`,
                  previousSummary
                    ? language === 'cz'
                      ? `Predchozi souhrn: ${previousSummary.slice(0, 700)}`
                      : `Previous summary: ${previousSummary.slice(0, 700)}`
                    : '',
                  revisionFeedback
                    ? language === 'cz'
                      ? `Zpetna vazba uzivatele: ${revisionFeedback}`
                      : `User feedback: ${revisionFeedback}`
                    : '',
                  baselineFilesForDebate.length > 0
                    ? language === 'cz'
                      ? `Aktualni baseline soubory (${baselineFilesForDebate.length}):\n${baselineFilesForDebate
                          .slice(0, 20)
                          .map((file) => file.path)
                          .join('\n')}`
                      : `Current baseline files (${baselineFilesForDebate.length}):\n${baselineFilesForDebate
                          .slice(0, 20)
                          .map((file) => file.path)
                          .join('\n')}`
                    : '',
                  previousRoundMessages.length > 0
                    ? language === 'cz'
                      ? `Vybrane body z predchoziho kola:\n${formatRoundExcerpts(previousRoundMessages)}`
                      : `Selected points from previous round:\n${formatRoundExcerpts(previousRoundMessages)}`
                    : '',
                  round === 2 && roundOneMessages.length > 0
                    ? language === 'cz'
                      ? `Body z 1. kola pro reakci:\n${formatRoundExcerpts(roundOneMessages)}`
                      : `Round 1 points to respond to:\n${formatRoundExcerpts(roundOneMessages)}`
                    : '',
                  language === 'cz'
                    ? `Vystup max ${refreshedProject.maxWordsPerAgent} slov.`
                    : `Output max ${refreshedProject.maxWordsPerAgent} words.`,
                ]
                  .filter(Boolean)
                  .join('\n\n');

                try {
                  const response = await callAiRespond(
                    {
                      projectId,
                      language,
                      agentRole: agent,
                      model: refreshedProject.model,
                      inputText: prompt,
                      context: {
                        projectName: refreshedProject.name,
                        task,
                        debateRunRound,
                        round,
                        rounds,
                        revisionPrompt,
                        baselineFileCount: baselineFilesForDebate.length,
                        previousRoundExcerpts: formatRoundExcerpts(previousRoundMessages),
                        roundOneExcerpts: formatRoundExcerpts(roundOneMessages),
                        snapshotAttachmentCounts: roundAttachmentCounts,
                      },
                    },
                    { agent },
                    roundAttachmentSnapshot
                  );
                  content = response.text;
                } catch {
                  content = buildSimulatedRoundMessage(
                    language,
                    agent,
                    round,
                    previousRoundMessages,
                    isOneRoundDescriptive ? 'observational' : 'planning'
                  );
                }
              }

              dispatch({ type: 'AGENT_SPEAK', agent, content });
              roundMessages.push({ round, agent, content });
              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                message: translateProjectWithVars(language, 'workflow.debate.agent.roundDone', {
                  agent,
                  round,
                }),
                agent,
              });
            }

            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: translateProjectWithVars(language, 'workflow.debate.round.finished', { round }),
            });
          }

          debateRoundStateRef.current[projectId] = { isRunning: false, currentRound: 0 };

          const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          if (!refreshedProject || refreshedProject.status !== 'debating') {
            return;
          }

          const summaryContext = roundMessages
            .map((message) => `R${message.round} ${message.agent}: ${message.content.slice(0, 280)}`)
            .join('\n');

          let summary = '';
          if (refreshedProject.simulationMode) {
            if (isOneRoundDescriptive) {
              summary =
                language === 'cz'
                  ? [
                      'Final answer:',
                      'Pri tomto vstupu davam primy popis toho, co je skutecne videt nebo citelne.',
                      'Uncertainty (optional):',
                      'Pokud je cast vstupu nejasna nebo chybi, uvadim to explicitne.',
                    ].join('\n')
                  : [
                      'Final answer:',
                      'Direct description of what is actually visible/readable in the provided input.',
                      'Uncertainty (optional):',
                      'Any missing or unclear part is stated explicitly.',
                    ].join('\n');
            } else {
              summary =
                language === 'cz'
                  ? [
                      '1) Recommended plan',
                      '- Potvrdit scope a metriky, dorucit MVP v kratkych iteracich, potom rozsireni podle dopadu.',
                      '2) Tradeoffs',
                      '- V1 omezuje rozsah funkcionality, ale zrychluje doruceni a snizuje riziko.',
                      '3) Risks + mitigations',
                      '- Nejasne pozadavky -> acceptance criteria; skluz terminu -> milniky a scope lock; kvalita -> povinne QA gate.',
                      '4) MVP scope',
                      '- Klicovy uzivatelsky tok, zakladni validace, minimalni UX polish.',
                      '5) Next steps',
                      '- Schvalit plan, spustit realizaci, monitorovat metriky a pripravit backlog pro v2.',
                    ].join('\n')
                  : [
                      '1) Recommended plan',
                      '- Confirm scope and metrics, deliver MVP in short iterations, then expand based on outcomes.',
                      '2) Tradeoffs',
                      '- v1 limits feature breadth but improves delivery speed and risk control.',
                      '3) Risks + mitigations',
                      '- Unclear requirements -> acceptance criteria; schedule slip -> milestones and scope lock; quality -> mandatory QA gates.',
                      '4) MVP scope',
                      '- Core user flow, baseline validation, and minimal UX polish.',
                      '5) Next steps',
                      '- Approve plan, start execution, monitor metrics, and prepare prioritized v2 backlog.',
                    ].join('\n');
            }
          } else {
            const summaryPrompt = isOneRoundDescriptive
              ? [
                  language === 'cz' ? 'Pis cesky.' : 'Write in English.',
                  language === 'cz'
                    ? 'Vytvor pouze: "Final answer" a volitelne kratkou sekci "Uncertainty".'
                    : 'Produce only: "Final answer" and an optional short "Uncertainty" note.',
                  language === 'cz'
                    ? 'Nepouzivej sekce jako Recommended plan, Tradeoffs, MVP scope, Next steps.'
                    : 'Do not use sections like Recommended plan, Tradeoffs, MVP scope, Next steps.',
                  language === 'cz'
                    ? 'Syntetizuj primou odpoved z pozorovani agentu bez meta komentaru.'
                    : 'Synthesize a direct answer from agent observations without meta discussion.',
                  language === 'cz' ? `Zadani: ${task}` : `Task: ${task}`,
                  language === 'cz'
                    ? `Vybrane body z debaty:\n${summaryContext}`
                    : `Debate excerpts:\n${summaryContext}`,
                ].join('\n\n')
              : [
                  language === 'cz' ? 'Pis cesky.' : 'Write in English.',
                  language === 'cz'
                    ? 'Vytvor strukturovany vystup v sekcich presne:'
                    : 'Generate a structured output with exactly these sections:',
                  '1) Recommended plan',
                  '2) Tradeoffs',
                  '3) Risks + mitigations',
                  '4) MVP scope',
                  '5) Next steps',
                  language === 'cz' ? `Zadani: ${task}` : `Task: ${task}`,
                  language === 'cz'
                    ? `Vybrane body z debaty:\n${summaryContext}`
                    : `Debate excerpts:\n${summaryContext}`,
                ].join('\n\n');

            try {
              const response = await callAiRespond(
                {
                  projectId,
                  language,
                  agentRole: 'Orchestrator',
                  model: refreshedProject.model,
                  inputText: summaryPrompt,
                  context: {
                    projectName: refreshedProject.name,
                    task,
                    debateRunRound,
                    rounds,
                    revisionFeedback,
                  },
                },
                {},
                buildAttachmentContext(refreshedProject)
              );
              summary = response.text;
            } catch {
              if (isOneRoundDescriptive) {
                summary =
                  language === 'cz'
                    ? [
                        'Final answer:',
                        'Primy popis toho, co je skutecne videt nebo citelne ve vstupu.',
                        'Uncertainty (optional):',
                        'Nejasne nebo chybejici casti vstupu jsou uvedeny explicitne.',
                      ].join('\n')
                    : [
                        'Final answer:',
                        'Direct description of what is actually visible/readable in the input.',
                        'Uncertainty (optional):',
                        'Any unclear or missing input parts are stated explicitly.',
                      ].join('\n');
              } else {
                summary =
                  language === 'cz'
                    ? [
                        '1) Recommended plan',
                        '- Potvrdit scope a metriky, dorucit MVP v kratkych iteracich, potom rozsireni podle dopadu.',
                        '2) Tradeoffs',
                        '- V1 omezuje rozsah funkcionality, ale zrychluje doruceni a snizuje riziko.',
                        '3) Risks + mitigations',
                        '- Nejasne pozadavky -> acceptance criteria; skluz terminu -> milniky a scope lock; kvalita -> povinne QA gate.',
                        '4) MVP scope',
                        '- Klicovy uzivatelsky tok, zakladni validace, minimalni UX polish.',
                        '5) Next steps',
                        '- Schvalit plan, spustit realizaci, monitorovat metriky a pripravit backlog pro v2.',
                      ].join('\n')
                    : [
                        '1) Recommended plan',
                        '- Confirm scope and metrics, deliver MVP in short iterations, then expand based on outcomes.',
                        '2) Tradeoffs',
                        '- v1 limits feature breadth but improves delivery speed and risk control.',
                        '3) Risks + mitigations',
                        '- Unclear requirements -> acceptance criteria; schedule slip -> milestones and scope lock; quality -> mandatory QA gates.',
                        '4) MVP scope',
                        '- Core user flow, baseline validation, and minimal UX polish.',
                        '5) Next steps',
                        '- Approve plan, start execution, monitor metrics, and prepare prioritized v2 backlog.',
                      ].join('\n');
              }
            }
          }

          dispatch({ type: 'ORCHESTRATOR_SUMMARY', content: summary });
          dispatch({ type: 'REQUEST_APPROVAL' });
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: translateProject(language, 'workflow.debate.finishedAwaitingApproval'),
          });
        } catch (error) {
          const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          const language = project?.language ?? 'en';
          const message = error instanceof Error ? error.message : 'Unknown debate error';
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: translateProjectWithVars(language, 'workflow.openai.callError', { error: message }),
          });
        } finally {
          debateRoundStateRef.current[projectId] = { isRunning: false, currentRound: 0 };
          debateRunsRef.current[projectId] = false;
        }
      })();
    },
    [
      callAiRespond,
      buildAttachmentContext,
      buildSimulatedRoundMessage,
      clampDebateRounds,
      formatRoundExcerpts,
      translateProject,
      translateProjectWithVars,
    ]
  );

  const rejectPlan = useCallback(
    (feedback: string, attachmentIds?: string[]) => {
      const project = stateRef.current.activeProject;
      if (!project) return;

      if (project.revisionRound >= MAX_REVISION_ROUNDS) {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          message: translateProjectWithVars(project.language, 'workflow.revision.limitReached', {
            max: MAX_REVISION_ROUNDS,
          }),
        });
        return;
      }

      dispatch({ type: 'REJECT_PLAN', feedback, attachmentIds });
      setTimeout(() => runAutoDebate(project.id), 0);
    },
    [runAutoDebate, translateProjectWithVars]
  );

  const requestRevisionFromComplete = useCallback(
    (feedback: string, attachmentIds?: string[]) => {
      const project = stateRef.current.activeProject;
      if (!project) return;

      if (project.revisionRound >= MAX_REVISION_ROUNDS) {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          message: translateProjectWithVars(project.language, 'workflow.revision.limitReached', {
            max: MAX_REVISION_ROUNDS,
          }),
        });
        return;
      }

      dispatch({ type: 'REVISION_FROM_COMPLETE', feedback, attachmentIds });
      setTimeout(() => runAutoDebate(project.id), 0);
    },
    [runAutoDebate, translateProjectWithVars]
  );

  const reset = useCallback(() => {
    schedulerPausedRef.current = {};
    setPausedSchedulers({});
    checkpointHitRef.current = {};
    completedSnapshotRef.current = {};
    deadlockSignatureRef.current = {};
    setDeadlocks({});
    dispatch({ type: 'RESET' });
  }, []);

  const runDemo = useCallback(() => {
    const demoProject = createProject(
      translate(language, 'workflow.demo.projectName'),
      translate(language, 'workflow.demo.projectDescription'),
      language,
      'app'
    );
    dispatch({
      type: 'CREATE_PROJECT',
      name: demoProject.name,
      description: demoProject.description,
      language,
      provider: demoProject.provider,
      model: demoProject.model,
      outputType: demoProject.outputType,
      simulationMode: demoProject.simulationMode,
      debateRounds: demoProject.debateRounds,
      debateMode: demoProject.debateMode,
      maxWordsPerAgent: demoProject.maxWordsPerAgent,
    });

    dispatch({ type: 'START_DEBATE', task: translate(language, 'workflow.demo.task') });
  }, [language]);

  useEffect(() => {
    const project = state.activeProject;
    if (!project || state.currentPhase !== 'debate') return;
    if (project.debateMode === 'auto') {
      runAutoDebate(project.id);
    }
  }, [runAutoDebate, state.activeProject, state.currentPhase]);

  useEffect(() => {
    Object.keys(schedulerIntervalsRef.current).forEach((projectId) => {
      const currentInterval = schedulerIntervalsRef.current[projectId];
      if (currentInterval) {
        clearInterval(currentInterval);
      }
      schedulerIntervalsRef.current[projectId] = setInterval(() => {
        schedulerTick(projectId);
      }, SPEED_CONFIG[executionSpeed].tickMs);
    });
  }, [executionSpeed, schedulerTick]);

  useEffect(() => {
    if (!autoPauseCheckpoints) return;
    const project = state.activeProject;
    if (!project) return;
    const checkpointState = checkpointHitRef.current[project.id] ?? {
      approval: false,
    };
    if (state.currentPhase === 'awaiting-approval' && !checkpointState.approval) {
      checkpointHitRef.current[project.id] = {
        ...checkpointState,
        approval: true,
      };
      setSchedulerPaused(project.id, true, false);
      dispatch({
        type: 'ADD_LOG',
        level: 'warning',
        message: translateProject(project.language, 'workflow.scheduler.checkpoint.approval'),
      });
    }
  }, [autoPauseCheckpoints, setSchedulerPaused, state.activeProject, state.currentPhase, translateProject]);

  useEffect(() => {
    const project = state.activeProject;
    if (!project?.taskGraph) return;
    syncTaskAvailability(project);
  }, [state.activeProject?.id, state.activeProject?.updatedAt, syncTaskAvailability]);

  const schedulerState = useMemo(() => {
    const project = state.activeProject;
    const taskGraph = project?.taskGraph;
    const runningTasks = project?.tasks.filter((task) => task.status === 'running').length ?? 0;
    const done =
      project?.tasks.filter(
        (task) => task.status === 'done' || task.status === 'completed_with_fallback'
      ).length ?? 0;
    const queued = project?.tasks.filter((task) => task.status === 'queued').length ?? 0;
    const blocked =
      project?.tasks.filter(
        (task) => task.status === 'blocked' || task.status === 'blocked_due_to_failed_dependency'
      ).length ?? 0;
    const failed =
      project?.tasks.filter(
        (task) => task.status === 'failed' || task.status === 'canceled_due_to_failed_dependency'
      ).length ?? 0;
    const total = project?.tasks.length ?? 0;
    const isComplete = total > 0 && done + failed === total;
    return {
      isPaused: project ? Boolean(pausedSchedulers[project.id]) : false,
      isComplete,
      concurrencyLimit: taskGraph?.concurrencyLimit ?? 0,
      total,
      done,
      runningTasks,
      queued,
      blocked,
      failed,
      retryLimit: taskGraph?.maxRetries ?? 0,
      executionSpeed,
      autoPauseCheckpoints,
      deadlock: project ? deadlocks[project.id] ?? null : null,
    };
  }, [autoPauseCheckpoints, deadlocks, executionSpeed, pausedSchedulers, state.activeProject]);

  useEffect(() => {
    return () => {
      Object.values(schedulerIntervalsRef.current).forEach((interval) => clearInterval(interval));
      Object.values(taskTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const value: AppContextValue = {
    state,
    firebaseUid,
    language,
    setLanguage,
    t,
    tf,
    createProject: createProjectFn,
    selectProject,
    startDebate,
    agentSpeak,
    orchestratorSummary,
    requestApproval,
    approvePlan,
    rejectPlan,
    requestRevisionFromComplete,
    updateAgentStatus: updateAgentStatusFn,
    addUserMessage,
    attachToProject,
    addLog,
    setProjectSimulationMode,
    setProjectDebateRounds,
    schedulerState,
    setExecutionSpeed,
    setAutoPauseCheckpoints,
    repairDeadlock,
    pauseExecution,
    resumeExecution,
    stopExecution,
    stepExecution,
    reset,
    runDemo,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
