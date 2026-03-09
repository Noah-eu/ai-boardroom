import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

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

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

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
    const languageInstruction =
      language === 'cz'
        ? 'Respond in Czech language.'
        : 'Respond in English.';

    const client = new OpenAI({ apiKey });
    const imageInputs = (attachmentContext?.images ?? []).slice(0, 8).map((image) => ({
      type: 'input_image' as const,
      image_url: image.url,
    }));

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
