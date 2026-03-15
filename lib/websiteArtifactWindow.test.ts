import { describe, expect, it } from 'vitest';
import { Task } from '@/types';
import { getLatestArtifactContentWithinWindow, hasArtifactContentOutsideWindow } from './websiteArtifactWindow';

function makeTask(params: {
  id: string;
  artifactPath: string;
  content: string;
  generatedAt?: string;
}): Task {
  return {
    id: params.id,
    title: `task-${params.id}`,
    description: 'test',
    agent: 'Builder',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    status: 'done',
    dependsOn: [],
    producesArtifacts: [
      {
        path: params.artifactPath,
        label: params.artifactPath,
        kind: 'json',
        rawContent: params.content,
        generatedAt: params.generatedAt ? new Date(params.generatedAt) : undefined,
      },
    ],
    createdAt: new Date('2026-03-15T09:00:00.000Z'),
    updatedAt: new Date('2026-03-15T09:00:00.000Z'),
  };
}

describe('websiteArtifactWindow', () => {
  it('returns latest payload inside current execution window', () => {
    const tasks: Task[] = [
      makeTask({
        id: 'old',
        artifactPath: 'copy-hero.json',
        content: '{"title":"Old run"}',
        generatedAt: '2026-03-15T09:00:00.000Z',
      }),
      makeTask({
        id: 'new',
        artifactPath: 'copy-hero.json',
        content: '{"title":"Current run"}',
        generatedAt: '2026-03-15T10:05:00.000Z',
      }),
    ];

    const payload = getLatestArtifactContentWithinWindow(tasks, 'copy-hero.json', {
      minGeneratedAt: new Date('2026-03-15T10:00:00.000Z'),
    });

    expect(payload).toContain('Current run');
  });

  it('ignores stale payloads from previous runs when no current artifact exists', () => {
    const tasks: Task[] = [
      makeTask({
        id: 'old-only',
        artifactPath: 'copy-hero.json',
        content: '{"title":"Stale run"}',
        generatedAt: '2026-03-15T08:00:00.000Z',
      }),
    ];

    const payload = getLatestArtifactContentWithinWindow(tasks, 'copy-hero.json', {
      minGeneratedAt: new Date('2026-03-15T10:00:00.000Z'),
    });

    expect(payload).toBeNull();
    expect(
      hasArtifactContentOutsideWindow(tasks, 'copy-hero.json', {
        minGeneratedAt: new Date('2026-03-15T10:00:00.000Z'),
      })
    ).toBe(true);
  });
});
