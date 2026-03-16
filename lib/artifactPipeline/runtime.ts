import { AppLanguage, ExecutionSnapshot, OutputType, Project, Task } from '../../types';
import {
  ArtifactFamily,
  ArtifactPipelineAttachmentInput,
  ArtifactPipelineInput,
  selectArtifactFamily,
} from './core';

function shorten(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
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

export function buildArtifactPipelineExecutionInput(params: {
  project: Pick<Project, 'id' | 'outputType' | 'language' | 'name' | 'description' | 'latestRevisionFeedback' | 'latestStableFiles'>;
  snapshot: Pick<ExecutionSnapshot, 'cycleNumber' | 'projectPrompt' | 'revisionPrompt' | 'approvedDebateSummary' | 'missingInputNotes' | 'pdfTexts' | 'siteSnapshots' | 'zipSnapshots' | 'imageInputs'>;
  family?: ArtifactFamily;
  sourceArtifacts?: {
    validatedRowsRaw?: string | null;
    summaryMetadataRaw?: string | null;
  };
}): ArtifactPipelineInput {
  const family = params.family ?? selectArtifactFamily({
    prompt: [params.project.name, params.project.description, params.project.latestRevisionFeedback ?? '', params.snapshot.projectPrompt].join(' '),
    outputTypeHint: params.project.outputType,
  });

  const promptSections = [
    `Project: ${params.project.name}`,
    `Requested artifact family: ${family}`,
    `Project prompt: ${params.snapshot.projectPrompt}`,
    params.snapshot.revisionPrompt ? `Revision request: ${params.snapshot.revisionPrompt}` : '',
    params.snapshot.approvedDebateSummary ? `Approved debate summary: ${params.snapshot.approvedDebateSummary}` : '',
    params.snapshot.missingInputNotes.length > 0
      ? `Missing inputs:\n${params.snapshot.missingInputNotes.map((note) => `- ${note}`).join('\n')}`
      : '',
  ].filter(Boolean);

  return {
    runId: `${params.project.id}-cycle-${params.snapshot.cycleNumber}-${family}`,
    prompt: promptSections.join('\n\n'),
    outputTypeHint: params.project.outputType,
    localeMode: { type: 'single', targetLanguage: params.project.language as AppLanguage },
    attachments: buildSnapshotAttachments(params.snapshot as ExecutionSnapshot),
    sourceArtifacts: params.sourceArtifacts,
    packaging: {
      mode: 'replace',
      previousFilePaths: params.project.latestStableFiles.map((file) => file.path),
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
