import { UrlIngestFailureCode, UrlIngestFailureReason } from '../types';

export class UrlIngestError extends Error {
  reason: UrlIngestFailureReason;

  constructor(reason: UrlIngestFailureReason) {
    super(reason.message);
    this.name = 'UrlIngestError';
    this.reason = reason;
  }
}

export function buildUrlFailureReason(params: {
  code: UrlIngestFailureCode;
  stage: UrlIngestFailureReason['stage'];
  message: string;
  retryable: boolean;
  url?: string;
  finalUrl?: string;
  statusCode?: number;
  contentType?: string;
}): UrlIngestFailureReason {
  return {
    code: params.code,
    stage: params.stage,
    message: params.message,
    retryable: params.retryable,
    url: params.url,
    finalUrl: params.finalUrl,
    statusCode: params.statusCode,
    contentType: params.contentType,
  };
}

export function normalizeSourceUrlForIngest(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const hasAnyScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);

  if (hasAnyScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new UrlIngestError(
      buildUrlFailureReason({
        code: 'invalid_url',
        stage: 'normalize',
        message: `Unsupported URL scheme in input: ${rawUrl}`,
        retryable: false,
        url: rawUrl,
      })
    );
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new UrlIngestError(
        buildUrlFailureReason({
          code: 'invalid_url',
          stage: 'normalize',
          message: `Unsupported protocol: ${parsed.protocol}`,
          retryable: false,
          url: rawUrl,
        })
      );
    }
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    if (error instanceof UrlIngestError) throw error;
    throw new UrlIngestError(
      buildUrlFailureReason({
        code: 'invalid_url',
        stage: 'normalize',
        message: `Invalid URL input: ${rawUrl}`,
        retryable: false,
        url: rawUrl,
      })
    );
  }
}

function bodyLooksBlocked(bodyPreview: string): boolean {
  const lowered = bodyPreview.toLowerCase();
  return (
    lowered.includes('captcha') ||
    lowered.includes('access denied') ||
    lowered.includes('attention required') ||
    lowered.includes('verify you are human') ||
    lowered.includes('enable javascript') ||
    lowered.includes('bot protection') ||
    lowered.includes('cloudflare')
  );
}

function headersLookBlocked(headers?: Headers): boolean {
  if (!headers) return false;
  const challenge = headers.get('cf-mitigated') || headers.get('x-bot-protection');
  return Boolean(challenge);
}

export function isHtmlContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.includes('text/html') || lower.includes('application/xhtml+xml');
}

export function assessFetchedPage(params: {
  requestUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  bodyPreview: string;
  headers?: Headers;
}): { ok: true } | { ok: false; reason: UrlIngestFailureReason } {
  const blockedByStatus = [401, 403, 429, 451].includes(params.statusCode);
  const blockedBySignals = bodyLooksBlocked(params.bodyPreview) || headersLookBlocked(params.headers);

  if (blockedByStatus || blockedBySignals) {
    return {
      ok: false,
      reason: buildUrlFailureReason({
        code: 'blocked_or_bot_protected',
        stage: 'fetch',
        message: `Source blocked or bot-protected (HTTP ${params.statusCode}).`,
        retryable: params.statusCode === 429,
        url: params.requestUrl,
        finalUrl: params.finalUrl,
        statusCode: params.statusCode,
        contentType: params.contentType,
      }),
    };
  }

  if (params.statusCode < 200 || params.statusCode >= 300) {
    return {
      ok: false,
      reason: buildUrlFailureReason({
        code: 'http_error',
        stage: 'fetch',
        message: `URL fetch failed (HTTP ${params.statusCode}).`,
        retryable: params.statusCode >= 500,
        url: params.requestUrl,
        finalUrl: params.finalUrl,
        statusCode: params.statusCode,
        contentType: params.contentType,
      }),
    };
  }

  if (!isHtmlContentType(params.contentType)) {
    return {
      ok: false,
      reason: buildUrlFailureReason({
        code: 'non_html_response',
        stage: 'fetch',
        message: `Non-HTML content (${params.contentType || 'unknown'}).`,
        retryable: false,
        url: params.requestUrl,
        finalUrl: params.finalUrl,
        statusCode: params.statusCode,
        contentType: params.contentType,
      }),
    };
  }

  if (!params.bodyPreview.trim()) {
    return {
      ok: false,
      reason: buildUrlFailureReason({
        code: 'empty_content',
        stage: 'parse',
        message: 'Fetched HTML is empty.',
        retryable: false,
        url: params.requestUrl,
        finalUrl: params.finalUrl,
        statusCode: params.statusCode,
        contentType: params.contentType,
      }),
    };
  }

  return { ok: true };
}

export function classifyUrlFetchException(url: string, error: unknown): UrlIngestFailureReason {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown fetch error');
  const lower = message.toLowerCase();

  if (lower.includes('abort') || lower.includes('timeout')) {
    return buildUrlFailureReason({
      code: 'timeout',
      stage: 'fetch',
      message: `URL fetch timed out: ${message}`,
      retryable: true,
      url,
    });
  }

  if (lower.includes('cert') || lower.includes('tls') || lower.includes('ssl')) {
    return buildUrlFailureReason({
      code: 'tls_error',
      stage: 'fetch',
      message: `TLS/SSL error: ${message}`,
      retryable: false,
      url,
    });
  }

  if (lower.includes('enotfound') || lower.includes('dns') || lower.includes('name not resolved')) {
    return buildUrlFailureReason({
      code: 'dns_error',
      stage: 'fetch',
      message: `DNS resolution failed: ${message}`,
      retryable: false,
      url,
    });
  }

  if (lower.includes('network') || lower.includes('socket') || lower.includes('connect')) {
    return buildUrlFailureReason({
      code: 'network_error',
      stage: 'fetch',
      message: `Network fetch error: ${message}`,
      retryable: true,
      url,
    });
  }

  return buildUrlFailureReason({
    code: 'unknown',
    stage: 'fetch',
    message: `Unknown URL fetch error: ${message}`,
    retryable: false,
    url,
  });
}

export function toUrlIngestFailureReason(error: unknown, fallbackUrl?: string): UrlIngestFailureReason {
  if (error instanceof UrlIngestError) {
    return error.reason;
  }

  const message = error instanceof Error ? error.message : String(error ?? 'Unknown ingest error');
  return buildUrlFailureReason({
    code: 'unknown',
    stage: 'crawl',
    message,
    retryable: false,
    url: fallbackUrl,
  });
}

export function pickDominantUrlFailure(reasons: UrlIngestFailureReason[]): UrlIngestFailureReason {
  if (reasons.length === 0) {
    return buildUrlFailureReason({
      code: 'crawl_no_readable_pages',
      stage: 'crawl',
      message: 'URL crawl produced no readable pages.',
      retryable: false,
    });
  }

  const priority: UrlIngestFailureCode[] = [
    'blocked_or_bot_protected',
    'timeout',
    'tls_error',
    'dns_error',
    'http_error',
    'non_html_response',
    'empty_content',
    'network_error',
    'parse_error',
    'invalid_url',
    'unknown',
  ];

  const byCode = new Map<UrlIngestFailureCode, UrlIngestFailureReason[]>();
  reasons.forEach((reason) => {
    const list = byCode.get(reason.code) ?? [];
    list.push(reason);
    byCode.set(reason.code, list);
  });

  for (const code of priority) {
    const list = byCode.get(code);
    if (list && list.length > 0) {
      return list[0];
    }
  }

  return reasons[0];
}

export function buildUrlFailedIngestionPayload(reason: UrlIngestFailureReason): {
  status: 'failed';
  error: string;
  failureReason: UrlIngestFailureReason;
} {
  return {
    status: 'failed',
    error: reason.message,
    failureReason: reason,
  };
}
