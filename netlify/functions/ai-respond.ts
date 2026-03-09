import OpenAI from 'openai';
import { z } from 'zod';

type NetlifyEvent = {
  httpMethod?: string;
  body?: string | null;
};

type NetlifyResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const requestSchema = z.object({
  projectId: z.string().min(1),
  language: z.enum(['cz', 'en']),
  agentRole: z.string().min(1),
  inputText: z.string().min(1),
  context: z.unknown().optional(),
  attachmentContext: z
    .object({
      images: z
        .array(
          z.object({
            url: z.string().url(),
            title: z.string().min(1),
            source: z.enum(['project', 'message']).optional(),
          })
        )
        .default([]),
    })
    .optional(),
});

function contextToString(context: unknown): string {
  if (context === undefined || context === null) {
    return 'None';
  }
  if (typeof context === 'string') {
    return context;
  }
  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return String(context);
  }
}

function extractResponseText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const textParts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join('\n').trim();
}

function extractUsage(response: OpenAI.Responses.Response): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usage = response.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      }
    | undefined;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function json(statusCode: number, payload: Record<string, unknown>): NetlifyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function normalizeRemoteImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResult> {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  if (!apiKey) {
    return json(500, { error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const parsedBody = JSON.parse(event.body ?? '{}');
    const parsed = requestSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return json(400, { error: 'Invalid request payload' });
    }

    const { language, projectId, agentRole, inputText, context, attachmentContext } = parsed.data;
    const languageInstruction = language === 'cz' ? 'Respond in Czech language.' : 'Respond in English.';

    const client = new OpenAI({ apiKey });
    const requestedImages = attachmentContext?.images ?? [];
    const invalidImageCount = requestedImages.filter((image) => !normalizeRemoteImageUrl(image.url)).length;
    const imageInputs = requestedImages
      .map((image) => normalizeRemoteImageUrl(image.url))
      .filter((url): url is string => Boolean(url))
      .slice(0, 8)
      .map((url) => ({
        type: 'input_image' as const,
        image_url: url,
      }));
    if (requestedImages.length > 0 && imageInputs.length === 0) {
      console.warn('[netlify/ai-respond] Images requested but none were server-reachable for OpenAI input_image.');
    }
    const requestInput = [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                `You are the ${agentRole} in an AI boardroom workflow.`,
                languageInstruction,
                'Be concise and practical unless explicitly asked for detail.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Project ID: ${projectId}`,
                `Agent role: ${agentRole}`,
                'Context:',
                contextToString(context),
                'User input:',
                inputText,
              ].join('\n\n'),
            },
            ...imageInputs,
          ],
        },
      ] as unknown as OpenAI.Responses.ResponseCreateParams['input'];

    const response = await client.responses.create({
      model,
      input: requestInput,
    });

    const text = extractResponseText(response);
    if (!text) {
      return json(500, { error: 'Model returned empty response' });
    }

    return json(200, {
      text,
      meta: {
        model: response.model,
        usage: extractUsage(response),
        imageContext: {
          requested: requestedImages.length,
          included: imageInputs.length,
          dropped: Math.max(0, requestedImages.length - imageInputs.length),
          invalid: invalidImageCount,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const short = message.slice(0, 180);
    return json(500, { error: `OpenAI request failed: ${short}` });
  }
}
