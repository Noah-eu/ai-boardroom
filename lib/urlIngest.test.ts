import { describe, expect, it } from 'vitest';
import {
  UrlIngestError,
  assessFetchedPage,
  buildUrlFailedIngestionPayload,
  classifyUrlFetchException,
  normalizeSourceUrlForIngest,
  pickDominantUrlFailure,
} from './urlIngest';

describe('urlIngest classification', () => {
  it('accepts successful HTML URL fetch', () => {
    const result = assessFetchedPage({
      requestUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      bodyPreview: '<html><body>hello</body></html>',
    });

    expect(result.ok).toBe(true);
  });

  it('accepts redirect success deterministically', () => {
    const result = assessFetchedPage({
      requestUrl: 'https://example.com',
      finalUrl: 'https://www.example.com/',
      statusCode: 200,
      contentType: 'text/html',
      bodyPreview: '<html><body>redirected</body></html>',
    });

    expect(result.ok).toBe(true);
  });

  it('classifies blocked source failures', () => {
    const result = assessFetchedPage({
      requestUrl: 'https://blocked.example.com',
      finalUrl: 'https://blocked.example.com',
      statusCode: 403,
      contentType: 'text/html',
      bodyPreview: '<html>Access denied. Please enable javascript and complete captcha.</html>',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('blocked_or_bot_protected');
    expect(result.reason.stage).toBe('fetch');
  });

  it('classifies non-html response failures', () => {
    const result = assessFetchedPage({
      requestUrl: 'https://example.com/file.pdf',
      finalUrl: 'https://example.com/file.pdf',
      statusCode: 200,
      contentType: 'application/pdf',
      bodyPreview: '%PDF',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('non_html_response');
  });

  it('classifies timeout exceptions', () => {
    const reason = classifyUrlFetchException(
      'https://example.com',
      new DOMException('The operation was aborted.', 'AbortError')
    );

    expect(reason.code).toBe('timeout');
    expect(reason.retryable).toBe(true);
  });

  it('propagates structured failure reason payload', () => {
    const reason = classifyUrlFetchException('https://example.com', new Error('network socket disconnected'));
    const payload = buildUrlFailedIngestionPayload(reason);

    expect(payload.status).toBe('failed');
    expect(payload.failureReason.code).toBe('network_error');
    expect(payload.error).toContain('Network fetch error');
  });

  it('picks dominant failure reason for crawl summary', () => {
    const dominant = pickDominantUrlFailure([
      classifyUrlFetchException('https://example.com', new Error('ENOTFOUND host')),
      classifyUrlFetchException('https://example.com', new Error('network socket disconnected')),
      new UrlIngestError({
        code: 'blocked_or_bot_protected',
        stage: 'fetch',
        message: 'blocked',
        retryable: false,
      }).reason,
    ]);

    expect(dominant.code).toBe('blocked_or_bot_protected');
  });

  it('normalizes URL canonical form with deterministic protocol and fragment handling', () => {
    expect(normalizeSourceUrlForIngest('example.com/path#section')).toBe('https://example.com/path');
    expect(() => normalizeSourceUrlForIngest('ftp://example.com')).toThrow();
  });
});
