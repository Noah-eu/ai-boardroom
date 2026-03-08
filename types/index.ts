// Agent types
export type AgentName =
  | 'Strategist'
  | 'Skeptic'
  | 'Pragmatist'
  | 'Planner'
  | 'Architect'
  | 'Builder'
  | 'Reviewer'
  | 'Tester'
  | 'Integrator';

export type AgentStatus = 'idle' | 'active' | 'thinking' | 'error';

export type AgentPhase = 'debate' | 'execution' | 'review' | 'testing' | 'integration';

export interface Agent {
  name: AgentName;
  role: string;
  phase: AgentPhase;
  status: AgentStatus;
  lastOutput: string | null;
  description: string;
}

// Task types
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  assignedAgent: AgentName;
  status: TaskStatus;
  artifactRef: string | null;
  artifactLock: boolean;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// Message types
export type MessageSender = AgentName | 'user' | 'orchestrator';

export type MessageType = 'chat' | 'system' | 'approval-request' | 'approval-response';

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
  type: MessageType;
  timestamp: Date;
  agentRole?: string;
}

// Project types
export type ProjectStatus =
  | 'idle'
  | 'debating'
  | 'awaiting-approval'
  | 'executing'
  | 'reviewing'
  | 'testing'
  | 'integrating'
  | 'complete'
  | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  tasks: Task[];
  messages: Message[];
}

// Orchestrator types
export type WorkflowPhase =
  | 'idle'
  | 'debate'
  | 'summary'
  | 'awaiting-approval'
  | 'execution'
  | 'review'
  | 'testing'
  | 'integration'
  | 'complete';

export interface OrchestratorState {
  currentPhase: WorkflowPhase;
  activeProject: Project | null;
  agents: Agent[];
  executionLog: LogEntry[];
}

// Execution log types
export type LogLevel = 'info' | 'warning' | 'error' | 'success';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  agent?: AgentName;
}
