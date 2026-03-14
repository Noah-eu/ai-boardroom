import { NextResponse } from 'next/server';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function toBase64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function isAllowedUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim() ?? '';

    if (!url || !isAllowedUrl(url)) {
      return NextResponse.json({ error: 'Invalid image URL.' }, { status: 400 });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Image fetch failed with status ${response.status}.` },
        { status: 502 }
      );
    }

    const mime = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Fetched content is not an image.' }, { status: 415 });
    }

    const buffer = await response.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return NextResponse.json({ error: 'Fetched image is empty.' }, { status: 502 });
    }

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `Fetched image exceeds ${MAX_IMAGE_BYTES} bytes limit.` },
        { status: 413 }
      );
    }

    const base64 = toBase64FromBytes(new Uint8Array(buffer));
    return NextResponse.json({ base64, mimeType: mime });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown materialization error';
    return NextResponse.json({ error: `Materialization failed: ${detail}` }, { status: 500 });
  }
}
