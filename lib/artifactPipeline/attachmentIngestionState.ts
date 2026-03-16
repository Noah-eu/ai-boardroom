import { AttachmentIngestion, AttachmentIngestionStatus, ProjectAttachment, ProjectAttachmentKind } from '../../types';

export type AttachmentRuntimeState = 'parsed' | 'pending' | 'failed';

export interface AttachmentRuntimeEntry {
  attachmentId: string;
  title: string;
  kind: ProjectAttachmentKind;
  state: AttachmentRuntimeState;
  reason?: string;
}

const PARSED_STATUSES: AttachmentIngestionStatus[] = ['parsed', 'ingested', 'indexed', 'included'];

function hasParsedPayload(kind: ProjectAttachmentKind, ingestion: AttachmentIngestion | undefined): boolean {
  if (!ingestion) return false;

  if (kind === 'url') {
    return Boolean(ingestion.extractedText?.trim() || (ingestion.urlPages?.length ?? 0) > 0);
  }

  if (kind === 'pdf') {
    return Boolean(ingestion.extractedText?.trim());
  }

  if (kind === 'zip') {
    return Boolean((ingestion.zipFileTree?.length ?? 0) > 0 || (ingestion.zipKeyFiles?.length ?? 0) > 0);
  }

  if (kind === 'image') {
    return true;
  }

  return true;
}

export function resolveAttachmentRuntimeState(attachment: Pick<ProjectAttachment, 'kind' | 'ingestion'>): AttachmentRuntimeState {
  const ingestion = attachment.ingestion;
  if (!ingestion) return 'pending';

  if (ingestion.status === 'failed' || ingestion.error) {
    return 'failed';
  }

  const parseStatusReached = PARSED_STATUSES.includes(ingestion.status);
  if (!parseStatusReached) {
    return 'pending';
  }

  return hasParsedPayload(attachment.kind, ingestion) ? 'parsed' : 'pending';
}

export function buildAttachmentRuntimeEntries(
  attachments: Array<Pick<ProjectAttachment, 'id' | 'title' | 'kind' | 'ingestion'>>
): AttachmentRuntimeEntry[] {
  return attachments.map((attachment) => ({
    attachmentId: attachment.id,
    title: attachment.title,
    kind: attachment.kind,
    state: resolveAttachmentRuntimeState(attachment),
    reason: attachment.ingestion?.error,
  }));
}

export function getAttachmentIngestionBlockers(
  entries: AttachmentRuntimeEntry[],
  kinds: ProjectAttachmentKind[] = ['url']
): {
  failed: AttachmentRuntimeEntry[];
  pending: AttachmentRuntimeEntry[];
} {
  const relevant = entries.filter((entry) => kinds.includes(entry.kind));
  return {
    failed: relevant.filter((entry) => entry.state === 'failed'),
    pending: relevant.filter((entry) => entry.state === 'pending'),
  };
}

export function sanitizeAttachmentIngestionForMerge(params: {
  current: AttachmentIngestion | undefined;
  patch: Partial<AttachmentIngestion>;
}): AttachmentIngestion | undefined {
  const merged = {
    ...params.current,
    ...params.patch,
  };

  if (!merged.status) {
    return undefined;
  }

  const clearParsedPayload = {
    extractedText: undefined,
    excerpt: undefined,
    pageTitle: undefined,
    urlPageCount: undefined,
    urlCrawlDepth: undefined,
    urlCrawlMaxPages: undefined,
    urlPages: undefined,
    zipFileTree: undefined,
    zipKeyFiles: undefined,
    zipPdfFiles: undefined,
  };

  if (merged.status === 'failed') {
    return {
      ...merged,
      ...clearParsedPayload,
      status: 'failed',
      includedInContext: false,
      linkedToAi: false,
      linkedToAiAt: undefined,
      analyzedAt: undefined,
      lastIncludedAt: undefined,
    };
  }

  if (merged.status === 'uploaded') {
    return {
      ...merged,
      ...clearParsedPayload,
      status: 'uploaded',
      error: undefined,
      includedInContext: false,
      linkedToAi: false,
      linkedToAiAt: undefined,
      analyzedAt: undefined,
      lastIncludedAt: undefined,
    };
  }

  return {
    ...merged,
    status: merged.status,
  };
}
