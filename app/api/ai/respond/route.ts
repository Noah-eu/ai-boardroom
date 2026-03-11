import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { resolveOpenAiModel, resolveReasoningConfig, resolveTextVerbosity } from '@/types';

const OPENAI_PRIMARY_TIMEOUT_MS = 45_000;
const OPENAI_RETRY_TIMEOUT_MS = 20_000;

function resolveOpenAiResponseProfile(
  agentRole: string,
  model: string,
  retry = false,
  responseMode: 'default' | 'structured_execution_bundle' = 'default'
) {
  const role = agentRole.trim().toLowerCase();
  const isPlanner = role === 'planner';
  const isExecution = ['architect', 'builder', 'reviewer', 'tester', 'integrator'].includes(role);
  const isStructuredBundle = responseMode === 'structured_execution_bundle';

  const maxOutputTokens = isStructuredBundle
    ? retry
      ? 1_800
      : 3_200
    : retry
    ? 700
    : isExecution
    ? 1_000
    : isPlanner
    ? 850
    : 650;
  const preferredVerbosity = retry || isStructuredBundle ? 'low' : isExecution ? 'medium' : 'low';
  const verbosity = resolveTextVerbosity(model, preferredVerbosity);
  const reasoning = resolveReasoningConfig(model);

  return {
    max_output_tokens: maxOutputTokens,
    ...(verbosity ? { text: { verbosity } as const } : {}),
    ...(reasoning ? { reasoning } : {}),
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
  responseMode: z.enum(['default', 'structured_execution_bundle']).optional(),
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
  responseMode: 'default' | 'structured_execution_bundle',
  input: OpenAI.Responses.ResponseCreateParams['input']
): Promise<OpenAI.Responses.Response> {
  const primaryProfile = resolveOpenAiResponseProfile(agentRole, model, false, responseMode);
  try {
    console.info(
      '[ai/respond] OpenAI request',
      JSON.stringify({
        agentRole,
        resolvedModel: model,
        responseMode,
        reasoningIncluded: Boolean(primaryProfile.reasoning),
        reasoningEffort: primaryProfile.reasoning?.effort ?? null,
        textVerbosity: primaryProfile.text?.verbosity ?? null,
        retry: false,
      })
    );
    return await client.responses.create(
      {
        model,
        input,
        ...primaryProfile,
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
    const retryProfile = resolveOpenAiResponseProfile(agentRole, model, true, responseMode);
    console.info(
      '[ai/respond] OpenAI request',
      JSON.stringify({
        agentRole,
        resolvedModel: model,
        responseMode,
        reasoningIncluded: Boolean(retryProfile.reasoning),
        reasoningEffort: retryProfile.reasoning?.effort ?? null,
        textVerbosity: retryProfile.text?.verbosity ?? null,
        retry: true,
      })
    );
    return client.responses.create(
      {
        model,
        input,
        ...retryProfile,
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
  let debugSelectedModel: string | null = null;
  let debugResolvedModel = envModel;
  let debugReasoningIncluded = false;
  let debugTextVerbosity: string | null = null;
  let debugResponseMode: 'default' | 'structured_execution_bundle' = 'default';

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
    const selectedModel = parsed.data.model ?? null;
    const model = resolveOpenAiModel(parsed.data.model, envModel);
    const responseMode = parsed.data.responseMode ?? 'default';
    const responseProfile = resolveOpenAiResponseProfile(agentRole, model, false, responseMode);
    const reasoningIncluded = Boolean(responseProfile.reasoning);
    debugSelectedModel = selectedModel;
    debugResolvedModel = model;
    debugReasoningIncluded = reasoningIncluded;
    debugTextVerbosity = responseProfile.text?.verbosity ?? null;
    debugResponseMode = responseMode;
    const languageInstruction =
      language === 'cz'
        ? 'Respond in Czech language.'
        : 'Respond in English.';

    console.info(
      '[ai/respond] Request boundary',
      JSON.stringify({
        projectId,
        agentRole,
        selectedModel,
        resolvedModel: model,
        responseMode,
        envModel,
        reasoningIncluded,
        reasoningEffort: responseProfile.reasoning?.effort ?? null,
        textVerbosity: responseProfile.text?.verbosity ?? null,
      })
    );

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

    const response = await createOpenAiResponse(client, model, agentRole, responseMode, requestInput);

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
        requestedModel: selectedModel,
        resolvedModel: model,
        reasoningIncluded,
        reasoningEffort: responseProfile.reasoning?.effort ?? null,
        textVerbosity: responseProfile.text?.verbosity ?? null,
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
    console.error(
      '[ai/respond] Request failed',
      JSON.stringify({
        selectedModel: debugSelectedModel,
        resolvedModel: debugResolvedModel,
        responseMode: debugResponseMode,
        reasoningIncluded: debugReasoningIncluded,
        reasoningEffort: resolveReasoningConfig(debugResolvedModel)?.effort ?? null,
        textVerbosity: debugTextVerbosity,
        error: message,
      })
    );
    return NextResponse.json(
      { error: `OpenAI request failed: ${message}` },
      { status: 500 }
    );
  }
}
