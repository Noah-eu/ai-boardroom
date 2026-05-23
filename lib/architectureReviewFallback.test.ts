import { describe, expect, it } from 'vitest';
import {
  buildDeterministicArchitectureReviewFallback,
  shouldUseArchitectureReviewFallback,
} from './architectureReviewFallback';

describe('architectureReviewFallback', () => {
  it('enables fallback only for architect architecture-review artifact in code pipeline', () => {
    expect(
      shouldUseArchitectureReviewFallback({
        agent: 'Architect',
        artifactPath: 'architecture-review.md',
        isCodePipeline: true,
      })
    ).toBe(true);

    expect(
      shouldUseArchitectureReviewFallback({
        agent: 'Builder',
        artifactPath: 'architecture-review.md',
        isCodePipeline: true,
      })
    ).toBe(false);

    expect(
      shouldUseArchitectureReviewFallback({
        agent: 'Architect',
        artifactPath: 'execution-plan.md',
        isCodePipeline: true,
      })
    ).toBe(false);
  });

  it('produces deterministic markdown with required architecture sections', () => {
    const markdown = buildDeterministicArchitectureReviewFallback({
      projectName: 'Prompt reliability project',
      outputType: 'app',
      language: 'en',
      normalizedArchitectureInput: '## Architecture Input (normalized)\n- Objective: website build',
      executionPlanExcerpt: '- Step 1\n- Step 2',
      reason: 'openai-error',
    });

    expect(markdown).toContain('## Affected modules/components/files');
    expect(markdown).toContain('## Proposed structural changes');
    expect(markdown).toContain('## Technical constraints and assumptions');
    expect(markdown).toContain('## Normalized architecture handoff');
    expect(markdown).toContain('## Execution plan excerpt');
    expect(markdown).toContain('Fallback activated: model/infrastructure failure on architecture step.');
  });
});
