import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { resolveOpenAiModel } from '@/types';

const OPENAI_PRIMARY_TIMEOUT_MS = 18_000;
const OPENAI_RETRY_TIMEOUT_MS = 8_000;

function supportsReasoningControls(model: string): boolean {
  return (
    model.startsWith('gpt-5') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  );
}

function resolveOpenAiResponseProfile(agentRole: string, model: string, retry = false) {
  const role = agentRole.trim().toLowerCase();
  const isPlanner = role === 'planner';
  const isExecution = ['architect', 'builder', 'reviewer', 'tester', 'integrator'].includes(role);

  const maxOutputTokens = retry ? 700 : isExecution ? 1_000 : isPlanner ? 850 : 650;
  const verbosity = retry ? 'low' : isExecution ? 'medium' : 'low';

  return {
    max_output_tokens: maxOutputTokens,
    text: { verbosity } as const,
    ...(supportsReasoningControls(model)
      ? {
          reasoning: {
            effort: 'minimal' as const,
          },
        }
      : {}),
  };
}

function shouldRetryOpenAiRequest(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('overloaded')
  );
}

const requestSchema = z.object({
  projectId: z.string().min(1),
  language: z.enum(['cz', 'en']),
  agentRole: z.string().min(1),
  model: z.string().optional(),
  inputText: z.string().min(1),
  context: z.unknown().optional(),
  attachmentContext: z
    .object({
      images: z
        .array(
          z.object({
            url: z.string().min(1),
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

function normalizeRemoteImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('blob:')) {
    return null;
  }
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
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

async function createOpenAiResponse(
  client: OpenAI,
  model: string,
  agentRole: string,
  input: OpenAI.Responses.ResponseCreateParams['input']
): Promise<OpenAI.Responses.Response> {
  try {
    return await client.responses.create(
      {
        model,
        input,
        ...resolveOpenAiResponseProfile(agentRole, model),
      },
      {
        timeout: OPENAI_PRIMARY_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
  } catch (error) {
    if (!shouldRetryOpenAiRequest(error)) {
      throw error;
    }

    console.warn(`[ai/respond] Primary OpenAI request failed for ${agentRole}; retrying with tighter limits.`);
    return client.responses.create(
      {
        model,
        input,
        ...resolveOpenAiResponseProfile(agentRole, model, true),
      },
      {
        timeout: OPENAI_RETRY_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const envModel = resolveOpenAiModel(process.env.OPENAI_MODEL);

  if (!process.env.OPENAI_MODEL) {
    console.warn('[ai/respond] OPENAI_MODEL not set; using default gpt-4.1-mini');
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'OpenAI is not configured: set OPENAI_API_KEY (and optionally OPENAI_MODEL) in server environment.',
      },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request payload.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { language, projectId, agentRole, inputText, context, attachmentContext } = parsed.data;
    const model = resolveOpenAiModel(parsed.data.model, envModel);
    const languageInstruction =
      language === 'cz'
        ? 'Respond in Czech language.'
        : 'Respond in English.';

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
      console.warn('[ai/respond] Images requested but none were server-reachable for OpenAI input_image.');
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

    const response = await createOpenAiResponse(client, model, agentRole, requestInput);

    const text = extractResponseText(response);
    if (!text) {
      return NextResponse.json(
        { error: 'Model returned an empty response.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
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
    const message = error instanceof Error ? error.message : 'Unknown OpenAI error.';
    return NextResponse.json(
      { error: `OpenAI request failed: ${message}` },
      { status: 500 }
    );
  }
}
