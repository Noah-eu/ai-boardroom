import { ExecutionOutputBundle } from '../../../types';

interface PlanStructuredModel {
  family: 'plan';
  runId: string;
  schemaId: string;
  title: string;
  phases: Array<{ id: string; name: string; objectives: string[] }>;
}

interface RenderPlanInput {
  model: PlanStructuredModel;
  runId: string;
  localeMode: { type: 'single'; targetLanguage: 'en' | 'cz' } | { type: 'multilingual'; locales: Array<'en' | 'cz'> };
}

function buildPlanMarkdown(input: RenderPlanInput): string {
  const lines: string[] = ['# Execution Plan', '', `Run ID: ${input.runId}`, '', `Title: ${input.model.title}`, ''];

  input.model.phases.forEach((phase, index) => {
    lines.push(`## Phase ${index + 1}: ${phase.name}`);
    phase.objectives.forEach((objective) => lines.push(`- ${objective}`));
    lines.push('');
  });

  return lines.join('\n').trim();
}

export function renderPlanArtifact(input: RenderPlanInput): ExecutionOutputBundle {
  const planMd = buildPlanMarkdown(input);
  const reviewMd = [
    '# Review Notes',
    '',
    '- Validate every phase objective against current-run verified facts.',
    '- Reject stale references from previous runs.',
    '- Confirm locale consistency before final emit.',
  ].join('\n');

  return {
    status: 'success',
    summary: `Plan bundle emitted from structured schema ${input.model.schemaId}.`,
    files: [
      { path: 'execution-plan.md', content: planMd },
      { path: 'review-notes.md', content: reviewMd },
      {
        path: 'artifact-meta.json',
        content: JSON.stringify(
          {
            family: 'plan',
            runId: input.runId,
            schemaId: input.model.schemaId,
            localeMode: input.localeMode,
          },
          null,
          2
        ),
      },
    ],
    notes: ['Plan adapter rendered from current-run structured model only.'],
    removePaths: [],
  };
}
