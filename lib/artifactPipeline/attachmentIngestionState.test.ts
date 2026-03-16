import { describe, expect, it } from 'vitest';
import { normalizeInput } from './core';
import {
  buildAttachmentRuntimeEntries,
  getAttachmentIngestionBlockers,
  resolveAttachmentRuntimeState,
  sanitizeAttachmentIngestionForMerge,
} from './attachmentIngestionState';

describe('attachmentIngestionState', () => {
  it('classifies successful URL ingestion as parsed', () => {
    const state = resolveAttachmentRuntimeState({
      kind: 'url',
      ingestion: {
        status: 'parsed',
        extractedText: 'Parsed text from URL.',
        summary: 'Crawled pages',
      },
    });

    expect(state).toBe('parsed');
  });

  it('classifies failed URL ingestion as failed', () => {
    const state = resolveAttachmentRuntimeState({
      kind: 'url',
      ingestion: {
        status: 'failed',
        error: 'URL fetch failed (500)',
      },
    });

    expect(state).toBe('failed');
  });

  it('classifies URL ingestion as pending when parsed payload is not ready', () => {
    const state = resolveAttachmentRuntimeState({
      kind: 'url',
      ingestion: {
        status: 'uploaded',
        summary: 'Waiting for ingestion.',
      },
    });

    expect(state).toBe('pending');
  });

  it('clears stale parsed payload when ingestion transitions to failed', () => {
    const sanitized = sanitizeAttachmentIngestionForMerge({
      current: {
        status: 'parsed',
        extractedText: 'Old parsed text',
        urlPages: [
          {
            url: 'https://example.com',
            title: 'Example',
            excerpt: 'excerpt',
            summary: 'summary',
            extractedText: 'text',
            depth: 0,
          },
        ],
      },
      patch: {
        status: 'failed',
        error: 'Network failure',
      },
    });

    expect(sanitized?.status).toBe('failed');
    expect(sanitized?.extractedText).toBeUndefined();
    expect(sanitized?.urlPages).toBeUndefined();
    expect(sanitized?.includedInContext).toBe(false);
  });

  it('prevents downstream continuation when URL ingest is failed or pending', () => {
    const entries = buildAttachmentRuntimeEntries([
      {
        id: 'url-ok',
        title: 'ok',
        kind: 'url',
        ingestion: { status: 'parsed', extractedText: 'OK' },
      },
      {
        id: 'url-failed',
        title: 'failed',
        kind: 'url',
        ingestion: { status: 'failed', error: 'fail' },
      },
      {
        id: 'url-pending',
        title: 'pending',
        kind: 'url',
        ingestion: { status: 'uploaded', summary: 'waiting' },
      },
    ]);

    const blockers = getAttachmentIngestionBlockers(entries, ['url']);
    expect(blockers.failed.map((entry) => entry.attachmentId)).toContain('url-failed');
    expect(blockers.pending.map((entry) => entry.attachmentId)).toContain('url-pending');
  });

  it('is compatible with common core input normalization for parsed URL attachments', () => {
    const normalized = normalizeInput({
      runId: 'url-normalization',
      prompt: 'Build website from parsed URL source.',
      outputTypeHint: 'website',
      localeMode: { type: 'single', targetLanguage: 'en' },
      attachments: [
        {
          id: 'url-parsed',
          kind: 'url',
          title: 'Parsed URL',
          sourceUrl: 'https://example.com',
          text: 'Site snapshot source URL: https://example.com',
        },
      ],
    });

    expect(normalized.attachments).toHaveLength(1);
    expect(normalized.attachments[0].kind).toBe('url');
    expect(normalized.attachments[0].text).toContain('Site snapshot source URL');
  });
});
