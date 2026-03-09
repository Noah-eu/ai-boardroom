export type AppLanguage = 'en' | 'cz';
export type OutputType = 'app' | 'website' | 'document' | 'plan' | 'other';
export type DebateMode = 'auto' | 'interactive';

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
export type ArtifactKind = 'doc' | 'json' | 'report' | 'zip' | 'image';

export interface TaskArtifact {
  path: string;
  label: string;
  kind: ArtifactKind;
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked';

export interface Task {
  id: string;
  title: string;
  description: string;
  agent: AgentName;
  status: TaskStatus;
  dependsOn: string[];
  producesArtifacts: TaskArtifact[];
  createdAt: Date;
  updatedAt: Date;
  errorMessage?: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface TaskGraph {
  tasks: Task[];
  concurrencyLimit: number;
  maxRetries: number;
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
  language: AppLanguage;
  simulationMode: boolean;
  debateRounds: number;
  debateMode: DebateMode;
  maxWordsPerAgent: number;
  latestRevisionFeedback: string | null;
  revisionRound: number;
  outputType: OutputType;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  taskGraph: TaskGraph | null;
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
