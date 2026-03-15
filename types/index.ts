export type AppLanguage = 'en' | 'cz';
export type OutputType = 'app' | 'website' | 'document' | 'plan' | 'other';
export type DebateMode = 'auto' | 'interactive';
export const ALLOWED_OPENAI_MODELS = ['gpt-4.1-mini', 'gpt-5.4'] as const;
export type OpenAIModel = typeof ALLOWED_OPENAI_MODELS[number];
export type AIProvider = 'openai';
export type OpenAITextVerbosity = 'low' | 'medium' | 'high';

export function isAllowedOpenAiModel(value: string): value is OpenAIModel {
  return (ALLOWED_OPENAI_MODELS as readonly string[]).includes(value);
}

export function resolveOpenAiModel(
  value?: string | null,
  fallback: OpenAIModel = 'gpt-4.1-mini'
): OpenAIModel {
  if (typeof value === 'string' && isAllowedOpenAiModel(value)) {
    return value;
  }
  return fallback;
}

export function resolveReasoningConfig(
  model?: string | null
): { effort: 'low' } | undefined {
  if (model !== 'gpt-5.4') {
    return undefined;
  }

  return { effort: 'low' };
}

export function resolveTextVerbosity(
  model?: string | null,
  preferred: OpenAITextVerbosity = 'low'
): OpenAITextVerbosity | undefined {
  if (model === 'gpt-4.1-mini') {
    return 'medium';
  }

  if (model === 'gpt-5.4') {
    return preferred;
  }

  return undefined;
}

// Agent types
export type AgentName =
  | 'Strategist'
  | 'Skeptic'
  | 'Pragmatist'
  | 'Planner'
  | 'Architect'
  | 'Builder'
  | 'Reviewer'
  | 'Tester'
  | 'Integrator';

export type AgentStatus = 'idle' | 'active' | 'thinking' | 'error';

export type AgentPhase = 'debate' | 'execution' | 'review' | 'testing' | 'integration';

export interface Agent {
  name: AgentName;
  role: string;
  phase: AgentPhase;
  status: AgentStatus;
  lastOutput: string | null;
  description: string;
}

// Task types
export type ArtifactKind = 'doc' | 'json' | 'report' | 'zip' | 'image';

export interface ExecutionOutputFile {
  path: string;
  content: string;
}

export interface ExecutionOutputBundle {
  status: 'success' | 'failed';
  summary: string;
  files: ExecutionOutputFile[];
  notes: string[];
  removePaths?: string[];
}

export type InvoiceAmountType = 'overpayment' | 'underpayment' | 'unknown';

export interface InvoiceSummaryRow {
  sourceFileName: string | null;
  invoiceNumber: string | null;
  accommodationId: string | null;
  currency: string | null;
  amountInInvoiceCurrency: number | null;
  amountCzk: number | null;
  commission: number | null;
  paymentServiceFee: number | null;
  roomSales: number | null;
  supplierVatId: string | null;
  customerVatId: string | null;
  variableSymbol: string | null;
  amount: number | null;
  amountType: InvoiceAmountType;
  normalizedSign: -1 | 0 | 1 | null;
  billingPeriod: string | null;
  issueDate: string | null;
  dueDate: string | null;
  supplierName: string | null;
  supplyPoint: string | null;
  note: string | null;
  extractionWarning: string | null;
  confidence: number | null;
}

export interface InvoiceSummaryMeta {
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
}

export interface InvoiceSummaryResult {
  rows: InvoiceSummaryRow[];
  summary: InvoiceSummaryMeta;
}

export type RevisionExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_fallback'
  | 'failed';

export interface ProjectRevisionCycle {
  cycleNumber: number;
  userPrompt: string;
  requestedAt: Date;
  debateSummary?: string;
  approved: boolean;
  approvedAt?: Date;
  executionSnapshotId?: string;
  executionStatus: RevisionExecutionStatus;
  baselineUpdated: boolean;
  completedAt?: Date;
  finalSummary?: string;
  generatedFilesCount?: number;
}

export interface TaskArtifact {
  path: string;
  label: string;
  kind: ArtifactKind;
  content?: string;
  rawContent?: string;
  executionOutput?: ExecutionOutputBundle | null;
  producedBy?: AgentName;
  generatedAt?: Date;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'blocked_due_to_failed_dependency'
  | 'canceled_due_to_failed_dependency'
  | 'completed_with_fallback';

export interface Task {
  id: string;
  title: string;
  description: string;
  agent: AgentName;
  provider: AIProvider;
  model: OpenAIModel;
  status: TaskStatus;
  dependsOn: string[];
  producesArtifacts: TaskArtifact[];
  createdAt: Date;
  updatedAt: Date;
  errorMessage?: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface TaskGraph {
  tasks: Task[];
  concurrencyLimit: number;
  maxRetries: number;
}

// Message types
export type MessageSender = AgentName | 'user' | 'orchestrator';

export type MessageType = 'chat' | 'system' | 'approval-request' | 'approval-response';

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
  type: MessageType;
  timestamp: Date;
  agentRole?: string;
  attachmentIds?: string[];
}

export type ProjectAttachmentKind = 'image' | 'pdf' | 'zip' | 'file' | 'url';

export type AttachmentIngestionStatus =
  | 'uploaded'
  | 'ingested'
  | 'included'
  | 'failed'
  | 'parsed'
  | 'indexed';

export interface AttachmentIngestion {
  status: AttachmentIngestionStatus;
  summary?: string;
  extractedText?: string;
  excerpt?: string;
  pageTitle?: string;
  sourceUrl?: string;
  urlPageCount?: number;
  urlCrawlDepth?: number;
  urlCrawlMaxPages?: number;
  urlPages?: Array<{
    url: string;
    title: string;
    metaDescription?: string;
    excerpt: string;
    summary: string;
    extractedText: string;
    depth: number;
    rendered?: boolean;
  }>;
  urlStructuredData?: {
    sourceUrl: string;
    pageTitle: string;
    visibleTextBlocks: string[];
    headings: string[];
    paragraphs: string[];
    navigationLabels: string[];
    contactFields: {
      emails: string[];
      phones: string[];
      addresses: string[];
      mailtoLinks: string[];
      telLinks: string[];
    };
    ctaTexts: string[];
    serviceNames: string[];
    pricingFields: string[];
    extractedLinks: Array<{
      href: string;
      label: string;
      kind: 'http' | 'mailto' | 'tel';
    }>;
    missingFields: string[];
    extractionWarnings: string[];
  };
  zipFileTree?: string[];
  zipKeyFiles?: Array<{ path: string; content: string }>;
  zipPdfFiles?: Array<{
    path: string;
    status: 'ingested' | 'failed' | 'text_unavailable';
    pageCount?: number;
    extractedText?: string;
    excerpt?: string;
    error?: string;
  }>;
  error?: string;
  includedInContext?: boolean;
  linkedToAi?: boolean;
  linkedToAiAt?: Date;
  analyzedAt?: Date;
  lastIncludedAt?: Date;
  queuedForNextRound?: boolean;
  queuedAtRound?: number;
  includedInRound?: number;
}

export interface ProjectAttachment {
  id: string;
  projectId: string;
  kind: ProjectAttachmentKind;
  source?: 'project' | 'message';
  firestoreCollection?: 'attachments' | 'artifacts';
  title: string;
  mimeType?: string;
  size?: number;
  storagePath?: string;
  downloadUrl?: string;
  sourceUrl?: string;
  aiImageDataUrl?: string;
  ingestion?: AttachmentIngestion;
  createdAt: Date;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsagePricingSnapshot {
  inputPerMillion: number;
  outputPerMillion: number;
  estimatedCostUsd: number;
}

export interface ModelUsageEntry {
  model: string;
  calls: number;
  totals: UsageTotals;
}

export interface ProjectUsage {
  totals: UsageTotals;
  session: UsageTotals;
  estimatedProjectCostUsd: number;
  sessionCostUsd: number;
  activeModel: string | null;
  models: ModelUsageEntry[];
  lastUpdatedAt: Date | null;
  // Prepared for future Firebase sync support.
  persistence: {
    lastSyncedAt: Date | null;
    pendingSync: boolean;
  };
}

// Project types
export type ProjectStatus =
  | 'idle'
  | 'debating'
  | 'awaiting-approval'
  | 'executing'
  | 'reviewing'
  | 'testing'
  | 'integrating'
  | 'complete'
  | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string;
  language: AppLanguage;
  provider: AIProvider;
  model: OpenAIModel;
  simulationMode: boolean;
  debateRounds: number;
  debateMode: DebateMode;
  maxWordsPerAgent: number;
  latestRevisionFeedback: string | null;
  revisionRound: number;
  currentCycleNumber: number;
  revisionHistory: ProjectRevisionCycle[];
  outputType: OutputType;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  taskGraph: TaskGraph | null;
  tasks: Task[];
  messages: Message[];
  attachments: ProjectAttachment[];
  executionSnapshot?: ExecutionSnapshot | null;
  latestStableBundle: ExecutionOutputBundle | null;
  latestStableFiles: ExecutionOutputFile[];
  latestStableSummary?: string | null;
  latestStableUpdatedAt: Date | null;
  usage: ProjectUsage;
}

export interface ExecutionSnapshot {
  id: string;
  createdAt: Date;
  cycleNumber: number;
  revisionPrompt: string | null;
  projectPrompt: string;
  approvedDebateSummary: string;
  latestStableSummary: string | null;
  latestStableFiles: ExecutionOutputFile[];
  projectAttachments: Array<{ id: string; title: string; kind: ProjectAttachmentKind; status: string }>;
  messageAttachments: Array<{ id: string; title: string; kind: ProjectAttachmentKind; status: string }>;
  imageInputs: Array<{
    attachmentId: string;
    title: string;
    source: 'project' | 'message';
    url: string;
    description?: string;
  }>;
  pdfTexts: Array<{
    attachmentId: string;
    title: string;
    source: 'project' | 'message';
    text: string;
  }>;
  zipSnapshots: Array<{
    attachmentId: string;
    title: string;
    source: 'project' | 'message';
    fileTree: string[];
    keyFiles: Array<{ path: string; content: string }>;
    pdfFiles: Array<{
      path: string;
      status: 'ingested' | 'failed' | 'text_unavailable';
      pageCount?: number;
      extractedText?: string;
      error?: string;
    }>;
  }>;
  siteSnapshots: Array<{
    attachmentId: string;
    title: string;
    source: 'project' | 'message';
    pageTitle?: string;
    summary?: string;
    extractedText?: string;
    pages?: Array<{ url: string; title: string; summary?: string; excerpt?: string }>;
    structuredData?: AttachmentIngestion['urlStructuredData'];
  }>;
  missingInputNotes: string[];
}

// Orchestrator types
export type WorkflowPhase =
  | 'idle'
  | 'debate'
  | 'summary'
  | 'awaiting-approval'
  | 'execution'
  | 'review'
  | 'testing'
  | 'integration'
  | 'complete';

export interface OrchestratorState {
  currentPhase: WorkflowPhase;
  activeProject: Project | null;
  agents: Agent[];
  executionLog: LogEntry[];
}

// Execution log types
export type LogLevel = 'info' | 'warning' | 'error' | 'success';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  agent?: AgentName;
}
