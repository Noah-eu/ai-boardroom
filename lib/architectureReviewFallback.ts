import { AppLanguage, OutputType } from '@/types';

export type ArchitectureFallbackReason = 'openai-error' | 'empty-response';

export function shouldUseArchitectureReviewFallback(input: {
  agent: string;
  artifactPath: string;
  isCodePipeline: boolean;
}): boolean {
  return input.agent === 'Architect' && input.artifactPath === 'architecture-review.md' && input.isCodePipeline;
}

export function buildDeterministicArchitectureReviewFallback(params: {
  projectName: string;
  outputType: OutputType;
  language: AppLanguage;
  normalizedArchitectureInput: string;
  executionPlanExcerpt: string;
  reason: ArchitectureFallbackReason;
}): string {
  const isCz = params.language === 'cz';
  const title = isCz ? '# Architecture Review (stabilized fallback)' : '# Architecture Review (stabilized fallback)';
  const reasonText =
    params.reason === 'empty-response'
      ? 'Fallback activated: empty model output on architecture step.'
      : 'Fallback activated: model/infrastructure failure on architecture step.';

  const constraints = isCz
    ? [
        '- Deterministicka modularni struktura souboru',
        '- Jasne zavislosti mezi kroky implementation pipeline',
        '- Zadny raw prompt blob v architecture handoffu',
      ]
    : [
        '- Deterministic modular file structure',
        '- Clear dependencies across implementation pipeline steps',
        '- No raw prompt blob in architecture handoff',
      ];

  const moduleHints =
    params.outputType === 'website' || params.outputType === 'app'
      ? [
          '- Planner -> execution-plan.md',
          '- Architect -> architecture-review.md',
          '- Builder -> segmented copy/source builders or file builder',
          '- Reviewer/Tester/Integrator -> quality, export, final summary',
        ]
      : [
          '- Planner -> execution-plan.md',
          '- Architect -> architecture-review.md',
          '- Builder/Reviewer/Tester/Integrator -> staged artifact flow',
        ];

  return [
    title,
    '',
    '## Affected modules/components/files',
    `- Project: ${params.projectName}`,
    `- Output type: ${params.outputType}`,
    ...moduleHints,
    '',
    '## Proposed structural changes',
    '- Keep architecture decomposition stable and explicit across all downstream stages.',
    '- Preserve rich website graph decomposition when website intent and structured facts are present.',
    '- Drive source acquisition independently from website assembly.',
    '',
    '## Technical constraints and assumptions',
    ...constraints,
    `- ${reasonText}`,
    '',
    '## Normalized architecture handoff',
    params.normalizedArchitectureInput,
    '',
    '## Execution plan excerpt',
    params.executionPlanExcerpt || '- not available',
  ].join('\n');
}
