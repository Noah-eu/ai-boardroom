import { AppLanguage, ExecutionSnapshot, OutputType, Project, Task } from '../../types';
import {
  ArtifactFamily,
  ArtifactPipelineAttachmentInput,
  ArtifactPipelineInput,
  DocumentArtifactIntent,
  selectArtifactFamily,
} from './core';

function shorten(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function resolveCurrentRunPrompt(snapshot: Pick<ExecutionSnapshot, 'projectPrompt' | 'revisionPrompt'>): {
  prompt: string;
  source: 'projectPrompt' | 'revisionPrompt';
} {
  const revisionPrompt = snapshot.revisionPrompt?.trim();
  if (revisionPrompt) {
    return {
      prompt: revisionPrompt,
      source: 'revisionPrompt',
    };
  }

  return {
    prompt: snapshot.projectPrompt.trim(),
    source: 'projectPrompt',
  };
}

function buildSnapshotAttachments(snapshot: ExecutionSnapshot): ArtifactPipelineAttachmentInput[] {
  const pdfAttachments = snapshot.pdfTexts.map((entry) => ({
    id: entry.attachmentId,
    kind: 'pdf' as const,
    title: entry.title,
    text: shorten(entry.text, 4000),
  }));

  const siteAttachments = snapshot.siteSnapshots.map((entry) => ({
    id: entry.attachmentId,
    kind: 'url' as const,
    title: entry.title,
    sourceUrl: entry.pages?.[0]?.url,
    text: shorten(
      [
        entry.pageTitle ? `Page title: ${entry.pageTitle}` : '',
        entry.summary ? `Summary: ${entry.summary}` : '',
        entry.extractedText ?? '',
        entry.pages?.length
          ? `Pages:\n${entry.pages.map((page) => `${page.title} ${page.url} ${page.summary ?? ''} ${page.excerpt ?? ''}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      5000
    ),
  }));

  const zipAttachments = snapshot.zipSnapshots.map((entry) => ({
    id: entry.attachmentId,
    kind: 'zip' as const,
    title: entry.title,
    text: shorten(
      [
        `File tree:\n${entry.fileTree.join('\n')}`,
        entry.keyFiles.length
          ? `Key files:\n${entry.keyFiles.map((file) => `${file.path}\n${file.content}`).join('\n\n')}`
          : '',
        entry.pdfFiles.length
          ? `PDF files:\n${entry.pdfFiles
              .map((file) => `${file.path} :: ${file.status}${file.error ? ` :: ${file.error}` : ''}`)
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      5000
    ),
  }));

  const imageAttachments = snapshot.imageInputs.map((entry) => ({
    id: entry.attachmentId,
    kind: 'image' as const,
    title: entry.title,
    sourceUrl: entry.url,
    text: entry.description ? shorten(entry.description, 800) : `Image reference: ${entry.title}`,
  }));

  return [...pdfAttachments, ...siteAttachments, ...zipAttachments, ...imageAttachments];
}

export function resolveProjectArtifactFamily(project: Pick<Project, 'name' | 'description' | 'latestRevisionFeedback' | 'outputType' | 'attachments'>): ArtifactFamily {
  return selectArtifactFamily({
    prompt: [project.name, project.description, project.latestRevisionFeedback ?? ''].join(' '),
    outputTypeHint: project.outputType,
    attachmentKinds: (project.attachments ?? []).map((attachment) => attachment.kind),
  });
}

export function resolveDocumentIntentHint(params: {
  prompt: string;
  attachmentKinds: ArtifactPipelineAttachmentInput['kind'][];
}): DocumentArtifactIntent {
  const normalized = params.prompt.toLowerCase();
  const invoiceSignals = [
    /\binvoice\b/,
    /\binvoices\b/,
    /\bfaktur\w*/,
    /\bextract\b/,
    /\bextraction\b/,
    /\bcsv\b/,
    /\bxlsx\b/,
    /\baccounting\b/,
    /\bledger\b/,
    /\bvariable symbol\b/,
  ];
  const summarySignals = [
    /\bdescribe\b/,
    /\bdescription\b/,
    /\bsummarize\b/,
    /\bsummary\b/,
    /\bpage\b/,
    /\bwebsite\b/,
    /\burl\b/,
    /\bpopi[sš]\b/,
    /\bpopis\b/,
    /\bshrn\w*/,
  ];

  if (invoiceSignals.some((pattern) => pattern.test(normalized))) {
    return 'invoice-extraction';
  }

  if (summarySignals.some((pattern) => pattern.test(normalized))) {
    return 'summary-description';
  }

  if (params.attachmentKinds.includes('url') && !params.attachmentKinds.includes('pdf')) {
    return 'summary-description';
  }

  return 'invoice-extraction';
}

export function buildArtifactPipelineExecutionInput(params: {
  project: Pick<Project, 'id' | 'outputType' | 'language' | 'name' | 'description' | 'latestRevisionFeedback' | 'latestStableFiles'>;
  snapshot: Pick<ExecutionSnapshot, 'cycleNumber' | 'projectPrompt' | 'revisionPrompt' | 'approvedDebateSummary' | 'missingInputNotes' | 'pdfTexts' | 'siteSnapshots' | 'zipSnapshots' | 'imageInputs'>;
  family?: ArtifactFamily;
  runtimeBuildCommitHash?: string;
  sourceArtifacts?: {
    validatedRowsRaw?: string | null;
    summaryMetadataRaw?: string | null;
  };
}): ArtifactPipelineInput {
  const currentRunPrompt = resolveCurrentRunPrompt(params.snapshot);
  const attachments = buildSnapshotAttachments(params.snapshot as ExecutionSnapshot);

  const family = params.family ?? selectArtifactFamily({
    prompt: currentRunPrompt.prompt,
    outputTypeHint: params.project.outputType,
  });

  const commitHash = (params.runtimeBuildCommitHash ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local').toString();
  const source = params.runtimeBuildCommitHash || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ? 'env' : 'local';

  return {
    runId: `${params.project.id}-cycle-${params.snapshot.cycleNumber}-${family}`,
    prompt: currentRunPrompt.prompt,
    outputTypeHint: params.project.outputType,
    localeMode: { type: 'single', targetLanguage: params.project.language as AppLanguage },
    attachments,
    sourceArtifacts: params.sourceArtifacts,
    packaging: {
      mode: 'replace',
      previousFilePaths: params.project.latestStableFiles.map((file) => file.path),
    },
    runtimeMetadata: {
      promptSource: currentRunPrompt.source,
      cycleNumber: params.snapshot.cycleNumber,
      requestedFamily: family,
      documentIntentHint:
        family === 'document'
          ? resolveDocumentIntentHint({
              prompt: currentRunPrompt.prompt,
              attachmentKinds: attachments.map((attachment) => attachment.kind),
            })
          : undefined,
      build: {
        commitHash,
        commitShort: commitHash.slice(0, 7),
        source,
      },
      orchestration: {
        approvedDebateSummary: params.snapshot.approvedDebateSummary,
        missingInputNotes: params.snapshot.missingInputNotes,
      },
    },
  };
}

export function shouldRouteGeneratedFilesThroughArtifactPipeline(params: {
  project: Pick<Project, 'name' | 'description' | 'latestRevisionFeedback' | 'outputType' | 'attachments'>;
  task: Pick<Task, 'agent'>;
  artifactPath: string;
  documentGeneratedFilesStage: boolean;
}): boolean {
  if (params.task.agent !== 'Builder' || params.artifactPath !== 'generated-files.json') {
    return false;
  }

  if (params.documentGeneratedFilesStage) {
    return true;
  }

  return resolveProjectArtifactFamily(params.project) === 'website';
}
