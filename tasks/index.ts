import { Task, TaskStatus, AgentName } from '@/types';
import { generateId } from '@/orchestrator';

export function createTask(
  assignedAgent: AgentName,
  description: string,
  status: TaskStatus = 'queued'
): Task {
  const now = new Date();
  return {
    id: generateId(),
    assignedAgent,
    status,
    artifactRef: null,
    artifactLock: false,
    description,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTaskStatus(
  tasks: Task[],
  taskId: string,
  status: TaskStatus,
  artifactRef?: string
): Task[] {
  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status,
          artifactRef: artifactRef ?? task.artifactRef,
          updatedAt: new Date(),
        }
      : task
  );
}

export function lockTask(tasks: Task[], taskId: string): Task[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, artifactLock: true, updatedAt: new Date() } : task
  );
}

export function unlockTask(tasks: Task[], taskId: string): Task[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, artifactLock: false, updatedAt: new Date() } : task
  );
}

export function getTasksByAgent(tasks: Task[], agent: AgentName): Task[] {
  return tasks.filter((task) => task.assignedAgent === agent);
}

export function getTasksByStatus(tasks: Task[], status: TaskStatus): Task[] {
  return tasks.filter((task) => task.status === status);
}

export function getStatusColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    queued: 'text-gray-400',
    running: 'text-blue-400',
    done: 'text-green-400',
    failed: 'text-red-400',
  };
  return colors[status];
}

export function getStatusBadgeClass(status: TaskStatus): string {
  const classes: Record<TaskStatus, string> = {
    queued: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900 text-blue-300',
    done: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
  };
  return classes[status];
}
