import { AIProvider, AgentName, OpenAIModel, Task, TaskArtifact, TaskStatus } from '@/types';
import { generateId } from '@/orchestrator';

interface CreateTaskInput {
  title: string;
  description: string;
  agent: AgentName;
  provider?: AIProvider;
  model?: OpenAIModel;
  dependsOn?: string[];
  producesArtifacts?: TaskArtifact[];
  status?: TaskStatus;
  retryCount?: number;
  maxRetries?: number;
}

export function createTask(
  input: CreateTaskInput
): Task {
  const now = new Date();
  return {
    id: generateId(),
    title: input.title,
    description: input.description,
    agent: input.agent,
    provider: input.provider ?? 'openai',
    model: input.model ?? 'gpt-4.1-mini',
    status: input.status ?? 'queued',
    dependsOn: input.dependsOn ?? [],
    producesArtifacts: input.producesArtifacts ?? [],
    createdAt: now,
    updatedAt: now,
    retryCount: input.retryCount ?? 0,
    maxRetries: input.maxRetries,
  };
}

export function patchTask(
  tasks: Task[],
  taskId: string,
  patch: Partial<Omit<Task, 'id' | 'createdAt'>>
): Task[] {
  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          ...patch,
          updatedAt: new Date(),
        }
      : task
  );
}

export function getTasksByAgent(tasks: Task[], agent: AgentName): Task[] {
  return tasks.filter((task) => task.agent === agent);
}

export function getTasksByStatus(tasks: Task[], status: TaskStatus): Task[] {
  return tasks.filter((task) => task.status === status);
}

export function getStatusColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    blocked: 'text-amber-300',
    queued: 'text-gray-400',
    running: 'text-blue-400',
    done: 'text-green-400',
    failed: 'text-red-400',
    completed_with_fallback: 'text-cyan-300',
  };
  return colors[status];
}

export function getStatusBadgeClass(status: TaskStatus): string {
  const classes: Record<TaskStatus, string> = {
    blocked: 'bg-amber-900 text-amber-200',
    queued: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900 text-blue-300',
    done: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
    completed_with_fallback: 'bg-cyan-900 text-cyan-200',
  };
  return classes[status];
}
