import { NextResponse } from 'next/server';
import { z } from 'zod';
import { load as loadHtml } from 'cheerio';
import { PDFParse } from 'pdf-parse';
import JSZip from 'jszip';

const requestSchema = z.object({
  kind: z.enum(['url', 'image', 'pdf', 'zip', 'file']),
  title: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  downloadUrl: z.string().url().optional(),
  mimeType: z.string().optional(),
});

type IngestPayload = {
  status: 'uploaded' | 'parsed' | 'indexed' | 'failed';
  summary?: string;
  extractedText?: string;
  excerpt?: string;
  pageTitle?: string;
  sourceUrl?: string;
  zipFileTree?: string[];
  zipKeyFiles?: Array<{ path: string; content: string }>;
  error?: string;
};

function trimText(value: string, max = 12000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function excerpt(value: string, max = 320): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

async function ingestUrl(sourceUrl: string): Promise<IngestPayload> {
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'AI-Boardroom-Ingest/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`URL fetch failed (${response.status})`);
  }

  const html = await response.text();
  const $ = loadHtml(html);
  $('script,style,noscript').remove();
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || sourceUrl;
  const text = trimText($('body').text());

  return {
    status: 'parsed',
    summary: `Fetched and parsed webpage content (${title}).`,
    pageTitle: title,
    sourceUrl,
    extractedText: text,
    excerpt: excerpt(text),
  };
}

async function ingestPdf(downloadUrl: string): Promise<IngestPayload> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const parser = new PDFParse({ data: Buffer.from(arrayBuffer) });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = trimText(parsed.text ?? '');

  return {
    status: 'parsed',
    summary: 'Extracted PDF text content.',
    extractedText: text,
    excerpt: excerpt(text),
  };
}

function isKeyTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [
    '.txt',
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.xml',
    '.csv',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.html',
    '.css',
    '.sql',
  ].some((ext) => lower.endsWith(ext));
}

async function ingestZip(downloadUrl: string): Promise<IngestPayload> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`ZIP download failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));
  const fileTree = entries.map((entry) => entry.name);

  const keyFiles: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    if (entry.dir) continue;
    if (!isKeyTextFile(entry.name)) continue;
    if (keyFiles.length >= 8) break;

    try {
      const content = await entry.async('text');
      keyFiles.push({
        path: entry.name,
        content: trimText(content, 4000),
      });
    } catch {
      // Ignore binary-like or unreadable entries.
    }
  }

  return {
    status: 'indexed',
    summary: 'ZIP unpacked and indexed.',
    zipFileTree: fileTree,
    zipKeyFiles: keyFiles,
    excerpt: excerpt(fileTree.slice(0, 12).join(' | '), 320),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
    }

    const payload = parsed.data;

    if (payload.kind === 'url') {
      if (!payload.sourceUrl) {
        return NextResponse.json({ error: 'URL is required for URL ingestion.' }, { status: 400 });
      }
      const result = await ingestUrl(payload.sourceUrl);
      return NextResponse.json({ ingest: result });
    }

    if (payload.kind === 'image') {
      const ingest: IngestPayload = {
        status: 'parsed',
        summary: 'Image attached and ready for multimodal context.',
        excerpt: payload.title,
      };
      return NextResponse.json({ ingest });
    }

    if (payload.kind === 'pdf') {
      if (!payload.downloadUrl) {
        return NextResponse.json({ error: 'downloadUrl is required for PDF ingestion.' }, { status: 400 });
      }
      const result = await ingestPdf(payload.downloadUrl);
      return NextResponse.json({ ingest: result });
    }

    if (payload.kind === 'zip') {
      if (!payload.downloadUrl) {
        return NextResponse.json({ error: 'downloadUrl is required for ZIP ingestion.' }, { status: 400 });
      }
      const result = await ingestZip(payload.downloadUrl);
      return NextResponse.json({ ingest: result });
    }

    const ingest: IngestPayload = {
      status: 'uploaded',
      summary: 'File uploaded. No specialized parser applied.',
      excerpt: payload.title,
    };
    return NextResponse.json({ ingest });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ingestion error';
    return NextResponse.json(
      {
        ingest: {
          status: 'failed',
          error: message,
        },
      },
      { status: 500 }
    );
  }
}
