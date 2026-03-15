import { Task } from '@/types';

function toEpoch(value: Date | string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readArtifactPayload(task: Task, artifactPath: string): string | null {
  const artifact = task.producesArtifacts.find((entry) => entry.path === artifactPath);
  if (!artifact) return null;
  if (artifact.rawContent?.trim()) return artifact.rawContent;
  if (artifact.content?.trim()) return artifact.content;
  return null;
}

function isInsideWindow(task: Task, artifactPath: string, minGeneratedAt?: Date | string): boolean {
  if (!minGeneratedAt) return true;
  const minEpoch = toEpoch(minGeneratedAt);
  if (minEpoch === null) return true;

  const artifact = task.producesArtifacts.find((entry) => entry.path === artifactPath);
  if (!artifact) return false;
  const generatedEpoch = toEpoch(artifact.generatedAt);
  if (generatedEpoch === null) return false;
  return generatedEpoch >= minEpoch;
}

export function getLatestArtifactContentWithinWindow(
  tasks: Task[],
  artifactPath: string,
  options?: {
    minGeneratedAt?: Date | string;
  }
): string | null {
  for (const task of [...tasks].reverse()) {
    if (!isInsideWindow(task, artifactPath, options?.minGeneratedAt)) continue;
    const payload = readArtifactPayload(task, artifactPath);
    if (payload) return payload;
  }
  return null;
}

export function hasArtifactContentOutsideWindow(
  tasks: Task[],
  artifactPath: string,
  options?: {
    minGeneratedAt?: Date | string;
  }
): boolean {
  if (!options?.minGeneratedAt) return false;
  const minEpoch = toEpoch(options.minGeneratedAt);
  if (minEpoch === null) return false;

  for (const task of tasks) {
    const artifact = task.producesArtifacts.find((entry) => entry.path === artifactPath);
    if (!artifact) continue;
    const payload = artifact.rawContent?.trim() ? artifact.rawContent : artifact.content?.trim() ? artifact.content : null;
    if (!payload) continue;
    const generatedEpoch = toEpoch(artifact.generatedAt);
    if (generatedEpoch === null || generatedEpoch < minEpoch) {
      return true;
    }
  }

  return false;
}
