import { AppLanguage, ExecutionOutputBundle, OutputType } from '../../types';
import { renderAppArtifact } from './adapters/app';
import { renderDocumentArtifact } from './adapters/document';
import { renderPlanArtifact } from './adapters/plan';
import { renderWebsiteArtifact } from './adapters/website';

export type ArtifactFamily = 'website' | 'app' | 'document' | 'plan';

export type LocaleMode =
  | { type: 'single'; targetLanguage: AppLanguage }
  | { type: 'multilingual'; locales: AppLanguage[] };

export interface ArtifactPipelineAttachmentInput {
  id: string;
  kind: 'url' | 'image' | 'pdf' | 'zip' | 'file';
  title: string;
  text?: string;
  sourceUrl?: string;
  locale?: AppLanguage;
}

export interface ArtifactPipelineInput {
  runId: string;
  prompt: string;
  outputTypeHint?: OutputType;
  attachments?: ArtifactPipelineAttachmentInput[];
  localeMode: LocaleMode;
  sourceArtifacts?: {
    validatedRowsRaw?: string | null;
    summaryMetadataRaw?: string | null;
  };
  packaging?: {
    mode?: 'replace' | 'patch';
    previousFilePaths?: string[];
  };
  runtimeMetadata?: {
    promptSource?: 'projectPrompt' | 'revisionPrompt';
    cycleNumber?: number;
    requestedFamily?: ArtifactFamily;
    orchestration?: {
      approvedDebateSummary?: string;
      missingInputNotes?: string[];
    };
  };
}

export interface VerifiedFact {
  id: string;
  runId: string;
  key: string;
  value: string;
  source: 'prompt' | 'attachment';
  sourceRef: string;
  locale: AppLanguage | 'neutral';
  provenance: 'current-run';
}

interface NormalizedInput {
  runId: string;
  prompt: string;
  outputTypeHint: OutputType;
  localeMode: LocaleMode;
  attachments: Array<ArtifactPipelineAttachmentInput & { text: string }>;
  sourceArtifacts?: ArtifactPipelineInput['sourceArtifacts'];
  packaging?: ArtifactPipelineInput['packaging'];
  runtimeMetadata?: ArtifactPipelineInput['runtimeMetadata'];
}

interface WebsiteStructuredModel {
  family: 'website';
  runId: string;
  schemaId: string;
  localeMode: LocaleMode;
  title: string;
  sections: Array<{ id: string; heading: string; body: string }>;
}

interface AppStructuredModel {
  family: 'app';
  runId: string;
  schemaId: string;
  localeMode: LocaleMode;
  appName: string;
  screens: Array<{ id: string; name: string; purpose: string; fields: string[] }>;
}

interface DocumentStructuredModel {
  family: 'document';
  runId: string;
  schemaId: string;
  localeMode: LocaleMode;
  title: string;
  summary: string;
  factsTable: Array<{ key: string; value: string }>;
  sourceArtifacts?: ArtifactPipelineInput['sourceArtifacts'];
}

interface PlanStructuredModel {
  family: 'plan';
  runId: string;
  schemaId: string;
  localeMode: LocaleMode;
  title: string;
  phases: Array<{ id: string; name: string; objectives: string[] }>;
}

export type ArtifactStructuredModel =
  | WebsiteStructuredModel
  | AppStructuredModel
  | DocumentStructuredModel
  | PlanStructuredModel;

export interface ArtifactPipelineResult {
  runId: string;
  family: ArtifactFamily;
  localeMode: LocaleMode;
  normalizedInput: NormalizedInput;
  facts: VerifiedFact[];
  structuredModel: ArtifactStructuredModel;
  bundle: ExecutionOutputBundle;
  metadata: {
    schemaId: string;
    factCount: number;
    planningSummary: string;
    validationWarnings: string[];
  };
}

const NOISE_PATTERNS = [
  /\b(nav|menu|footer|header)\b/i,
  /\bprivacy policy\b/i,
  /\bcookie settings\b/i,
  /\bterms of service\b/i,
  /\bundefined\b/i,
  /\blorem ipsum\b/i,
  /\[object object\]/i,
  /__internal__/i,
];

const EN_STOPWORDS = new Set(['the', 'and', 'with', 'for', 'to', 'from']);
const CZ_STOPWORDS = new Set(['a', 's', 'pro', 'na', 'od', 'v', 'z']);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isNoise(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  if (normalized.length < 2) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function detectLocale(value: string): AppLanguage | 'neutral' {
  const tokens = normalizeWhitespace(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
  const hasCzDiacritics = /[ěščřžýáíéůúďťň]/i.test(value);
  const enHits = tokens.filter((token) => EN_STOPWORDS.has(token)).length;
  const czHits = tokens.filter((token) => CZ_STOPWORDS.has(token)).length;

  if (hasCzDiacritics || czHits > enHits + 1) return 'cz';
  if (enHits > czHits + 1) return 'en';
  return 'neutral';
}

function includesToken(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function selectArtifactFamily(input: {
  prompt: string;
  outputTypeHint?: OutputType;
  attachmentKinds?: ArtifactPipelineAttachmentInput['kind'][];
}): ArtifactFamily {
  if (input.outputTypeHint === 'website') return 'website';
  if (input.outputTypeHint === 'app') return 'app';
  if (input.outputTypeHint === 'document') return 'document';
  if (input.outputTypeHint === 'plan') return 'plan';

  const normalized = normalizeWhitespace(input.prompt).toLowerCase();
  const attachmentKinds = input.attachmentKinds ?? [];

  const documentSignals = [
    /\bdocument\b/,
    /\breport\b/,
    /\bpdf\b/,
    /\bcsv\b/,
    /\bxlsx\b/,
    /\bsummary\b/,
    /\bextract\b/,
    /\bdokument\b/,
    /\btabulk\w*/,
  ];
  const planSignals = [/\bplan\b/, /\broadmap\b/, /\bexecution\b/, /\bimplementation\b/, /\breview notes\b/];
  const websiteSignals = [/\bwebsite\b/, /\blanding page\b/, /\bhomepage\b/, /\bsite\b/];
  const appSignals = [/\bapp\b/, /\bdashboard\b/, /\btool\b/, /\bmvp\b/, /\binternal\b/];

  if (includesToken(normalized, documentSignals)) return 'document';
  if (includesToken(normalized, planSignals)) return 'plan';
  if (includesToken(normalized, websiteSignals)) return 'website';
  if (includesToken(normalized, appSignals)) return 'app';

  if (attachmentKinds.includes('pdf')) return 'document';
  if (attachmentKinds.includes('url')) return 'website';
  return 'plan';
}

export function normalizeInput(input: ArtifactPipelineInput): NormalizedInput {
  return {
    runId: input.runId,
    prompt: normalizeWhitespace(input.prompt),
    outputTypeHint: input.outputTypeHint ?? 'other',
    localeMode: input.localeMode,
    attachments: (input.attachments ?? []).map((attachment) => ({
      ...attachment,
      text: normalizeWhitespace(attachment.text ?? ''),
    })),
    sourceArtifacts: input.sourceArtifacts,
    packaging: input.packaging,
    runtimeMetadata: input.runtimeMetadata,
  };
}

function parseFactsFromText(params: {
  runId: string;
  source: 'prompt' | 'attachment';
  sourceRef: string;
  text: string;
}): VerifiedFact[] {
  const lines = params.text
    .split(/\n|[.;]/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const facts: VerifiedFact[] = [];
  lines.forEach((line, index) => {
    if (isNoise(line)) return;

    const split = line.includes(':') ? line.split(':') : line.split('-');
    let key: string;
    let value: string;
    if (split.length >= 2) {
      key = normalizeWhitespace(split[0]);
      value = normalizeWhitespace(split.slice(1).join(' '));
    } else {
      key = `fact_${index + 1}`;
      value = line;
    }

    if (isNoise(key) || isNoise(value)) return;

    facts.push({
      id: `${params.runId}:${params.source}:${index}`,
      runId: params.runId,
      key,
      value,
      source: params.source,
      sourceRef: params.sourceRef,
      locale: detectLocale(`${key} ${value}`),
      provenance: 'current-run',
    });
  });

  return facts;
}

export function extractVerifiedFacts(input: NormalizedInput): VerifiedFact[] {
  const promptFacts = parseFactsFromText({
    runId: input.runId,
    source: 'prompt',
    sourceRef: 'prompt',
    text: input.prompt,
  });

  const attachmentFacts = input.attachments.flatMap((attachment) =>
    parseFactsFromText({
      runId: input.runId,
      source: 'attachment',
      sourceRef: attachment.id,
      text: attachment.text,
    })
  );

  const merged = [...promptFacts, ...attachmentFacts].filter((fact) => fact.runId === input.runId);

  if (input.localeMode.type === 'single') {
    const targetLanguage = input.localeMode.targetLanguage;
    return merged.filter((fact) => fact.locale === 'neutral' || fact.locale === targetLanguage);
  }

  const allowed = new Set(input.localeMode.locales);
  return merged.filter((fact) => fact.locale === 'neutral' || allowed.has(fact.locale));
}

function fallbackFact(localeMode: LocaleMode): VerifiedFact {
  return {
    id: 'fallback:neutral',
    runId: 'fallback',
    key: 'request',
    value:
      localeMode.type === 'single'
        ? localeMode.targetLanguage === 'cz'
          ? 'Generuj neutralni vystup podle zadani.'
          : 'Generate a neutral output from the request.'
        : 'Generate locale-scoped outputs from the request.',
    source: 'prompt',
    sourceRef: 'prompt',
    locale: 'neutral',
    provenance: 'current-run',
  };
}

function buildSchemaId(runId: string, family: ArtifactFamily, facts: VerifiedFact[]): string {
  return `${family}:${runId}:${facts.length}:${Date.now().toString(36)}`;
}

export function buildStructuredModel(params: {
  runId: string;
  family: ArtifactFamily;
  localeMode: LocaleMode;
  facts: VerifiedFact[];
  sourceArtifacts?: ArtifactPipelineInput['sourceArtifacts'];
}): ArtifactStructuredModel {
  const facts = params.facts.length > 0 ? params.facts : [fallbackFact(params.localeMode)];
  const schemaId = buildSchemaId(params.runId, params.family, facts);

  if (params.family === 'website') {
    const sections = facts.slice(0, 6).map((fact, index) => ({
      id: `section-${index + 1}`,
      heading: fact.key,
      body: fact.value,
    }));
    return {
      family: 'website',
      runId: params.runId,
      schemaId,
      localeMode: params.localeMode,
      title: facts[0]?.value ?? 'Website',
      sections,
    };
  }

  if (params.family === 'app') {
    const screens = facts.slice(0, 5).map((fact, index) => ({
      id: `screen-${index + 1}`,
      name: fact.key,
      purpose: fact.value,
      fields: [`${fact.key}_input`, `${fact.key}_output`],
    }));
    return {
      family: 'app',
      runId: params.runId,
      schemaId,
      localeMode: params.localeMode,
      appName: facts[0]?.value ?? 'Generated App',
      screens,
    };
  }

  if (params.family === 'document') {
    return {
      family: 'document',
      runId: params.runId,
      schemaId,
      localeMode: params.localeMode,
      title: facts[0]?.value ?? 'Generated Document',
      summary: facts.map((fact) => `${fact.key}: ${fact.value}`).join(' | '),
      factsTable: facts.map((fact) => ({ key: fact.key, value: fact.value })),
      sourceArtifacts: params.sourceArtifacts,
    };
  }

  const phases = facts.slice(0, 5).map((fact, index) => ({
    id: `phase-${index + 1}`,
    name: fact.key,
    objectives: [fact.value],
  }));
  return {
    family: 'plan',
    runId: params.runId,
    schemaId,
    localeMode: params.localeMode,
    title: facts[0]?.value ?? 'Execution Plan',
    phases,
  };
}

export function validateInvariants(params: {
  runId: string;
  family: ArtifactFamily;
  localeMode: LocaleMode;
  facts: VerifiedFact[];
  structuredModel: ArtifactStructuredModel;
  previousRunIds?: string[];
}): string[] {
  const warnings: string[] = [];

  if (params.previousRunIds?.includes(params.runId)) {
    warnings.push('run_id_reused');
  }

  if (params.facts.some((fact) => fact.provenance !== 'current-run' || fact.runId !== params.runId)) {
    warnings.push('cross_run_fact_contamination');
  }

  if (params.structuredModel.runId !== params.runId) {
    warnings.push('structured_model_run_mismatch');
  }

  if (params.facts.length === 0) {
    warnings.push('no_verified_facts');
  }

  if (params.localeMode.type === 'single') {
    const targetLanguage = params.localeMode.targetLanguage;
    const invalidLocaleFact = params.facts.find(
      (fact) => fact.locale !== 'neutral' && fact.locale !== targetLanguage
    );
    if (invalidLocaleFact) {
      warnings.push('single_locale_mixed_content');
    }
  }

  return warnings;
}

function validateStructuredModel(structuredModel: ArtifactStructuredModel, family: ArtifactFamily): string[] {
  const warnings: string[] = [];

  if (structuredModel.family !== family) {
    warnings.push('structured_model_family_mismatch');
  }

  if (family === 'website') {
    const model = structuredModel as WebsiteStructuredModel;
    if (model.sections.length === 0) warnings.push('website_schema_empty');
  }

  if (family === 'app') {
    const model = structuredModel as AppStructuredModel;
    if (model.screens.length === 0) warnings.push('app_schema_empty');
  }

  if (family === 'document') {
    const model = structuredModel as DocumentStructuredModel;
    if (model.factsTable.length === 0 && !model.sourceArtifacts) warnings.push('document_schema_empty');
  }

  if (family === 'plan') {
    const model = structuredModel as PlanStructuredModel;
    if (model.phases.length === 0) warnings.push('plan_schema_empty');
  }

  return warnings;
}

function normalizeBundlePath(filePath: string): string {
  return filePath.replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function packageArtifactBundle(params: {
  bundle: ExecutionOutputBundle;
  runId: string;
  family: ArtifactFamily;
  localeMode: LocaleMode;
  schemaId: string;
  factCount: number;
  packaging?: ArtifactPipelineInput['packaging'];
  runtimeMetadata?: ArtifactPipelineInput['runtimeMetadata'];
  validationWarnings: string[];
}): ExecutionOutputBundle {
  const baseFiles = params.bundle.files.map((file) => ({
    path: normalizeBundlePath(file.path),
    content: file.content,
  }));

  const metadataFile = {
    path: 'artifact-pipeline-metadata.json',
    content: JSON.stringify(
      {
        runId: params.runId,
        family: params.family,
        schemaId: params.schemaId,
        localeMode: params.localeMode,
        factCount: params.factCount,
        validationWarnings: params.validationWarnings,
        packagingMode: params.packaging?.mode ?? 'patch',
        runtimeMetadata: params.runtimeMetadata ?? null,
      },
      null,
      2
    ),
  };

  const files = [...baseFiles.filter((file) => file.path !== metadataFile.path), metadataFile];
  const currentPaths = new Set(files.map((file) => file.path));
  const inheritedRemovePaths = (params.bundle.removePaths ?? []).map((filePath) => normalizeBundlePath(filePath));
  const replaceRemovePaths =
    params.packaging?.mode === 'replace'
      ? (params.packaging.previousFilePaths ?? [])
          .map((filePath) => normalizeBundlePath(filePath))
          .filter((filePath) => !currentPaths.has(filePath))
      : [];

  return {
    ...params.bundle,
    files,
    notes: Array.from(
      new Set([
        ...(params.bundle.notes ?? []),
        'Artifact pipeline packaging metadata emitted by common core.',
      ])
    ),
    removePaths: Array.from(new Set([...inheritedRemovePaths, ...replaceRemovePaths])),
  };
}

function renderFamilyBundle(params: {
  family: ArtifactFamily;
  model: ArtifactStructuredModel;
  localeMode: LocaleMode;
  runId: string;
}): ExecutionOutputBundle {
  if (params.family === 'website') {
    return renderWebsiteArtifact({
      model: params.model as WebsiteStructuredModel,
      runId: params.runId,
      localeMode: params.localeMode,
    });
  }
  if (params.family === 'app') {
    return renderAppArtifact({
      model: params.model as AppStructuredModel,
      runId: params.runId,
      localeMode: params.localeMode,
    });
  }
  if (params.family === 'document') {
    return renderDocumentArtifact({
      model: params.model as DocumentStructuredModel,
      runId: params.runId,
      localeMode: params.localeMode,
    });
  }
  return renderPlanArtifact({
    model: params.model as PlanStructuredModel,
    runId: params.runId,
    localeMode: params.localeMode,
  });
}

export function runArtifactPipeline(params: {
  input: ArtifactPipelineInput;
  previousRunIds?: string[];
}): ArtifactPipelineResult {
  const normalizedInput = normalizeInput(params.input);
  const family = selectArtifactFamily({
    prompt: normalizedInput.prompt,
    outputTypeHint: normalizedInput.outputTypeHint,
    attachmentKinds: normalizedInput.attachments.map((attachment) => attachment.kind),
  });

  const facts = extractVerifiedFacts(normalizedInput);
  const structuredModel = buildStructuredModel({
    runId: normalizedInput.runId,
    family,
    localeMode: normalizedInput.localeMode,
    facts,
    sourceArtifacts: normalizedInput.sourceArtifacts,
  });

  const validationWarnings = validateInvariants({
    runId: normalizedInput.runId,
    family,
    localeMode: normalizedInput.localeMode,
    facts,
    structuredModel,
    previousRunIds: params.previousRunIds,
  });

  validationWarnings.push(...validateStructuredModel(structuredModel, family));

  const renderedBundle = renderFamilyBundle({
    family,
    model: structuredModel,
    localeMode: normalizedInput.localeMode,
    runId: normalizedInput.runId,
  });

  const bundle = packageArtifactBundle({
    bundle: renderedBundle,
    runId: normalizedInput.runId,
    family,
    localeMode: normalizedInput.localeMode,
    schemaId: structuredModel.schemaId,
    factCount: facts.length,
    packaging: normalizedInput.packaging,
    runtimeMetadata: normalizedInput.runtimeMetadata,
    validationWarnings,
  });

  const planningSummary =
    family === 'plan'
      ? 'Planning adapter executed with phase model.'
      : `Core orchestration completed for ${family} with fact-first structured rendering.`;

  return {
    runId: normalizedInput.runId,
    family,
    localeMode: normalizedInput.localeMode,
    normalizedInput,
    facts,
    structuredModel,
    bundle,
    metadata: {
      schemaId: structuredModel.schemaId,
      factCount: facts.length,
      planningSummary,
      validationWarnings,
    },
  };
}
