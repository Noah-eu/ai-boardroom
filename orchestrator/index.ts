import {
  AIProvider,
  AppLanguage,
  Agent,
  AgentName,
  AgentStatus,
  DebateMode,
  OpenAIModel,
  LogEntry,
  Message,
  MessageSender,
  OrchestratorState,
  OutputType,
  Project,
  ProjectUsage,
  WorkflowPhase,
} from '@/types';

// Default agent configurations
export const DEFAULT_AGENTS: Agent[] = [
  {
    name: 'Strategist',
    role: 'Strategic Planner',
    phase: 'debate',
    status: 'idle',
    lastOutput: null,
    description: 'Defines high-level goals and strategic direction for the project.',
  },
  {
    name: 'Skeptic',
    role: 'Critical Analyst',
    phase: 'debate',
    status: 'idle',
    lastOutput: null,
    description: 'Challenges assumptions and identifies risks in proposed solutions.',
  },
  {
    name: 'Pragmatist',
    role: 'Practical Advisor',
    phase: 'debate',
    status: 'idle',
    lastOutput: null,
    description: 'Focuses on feasibility and practical implementation constraints.',
  },
  {
    name: 'Planner',
    role: 'Project Planner',
    phase: 'execution',
    status: 'idle',
    lastOutput: null,
    description: 'Breaks down approved plans into actionable tasks and milestones.',
  },
  {
    name: 'Architect',
    role: 'System Architect',
    phase: 'execution',
    status: 'idle',
    lastOutput: null,
    description: 'Designs system architecture and technical specifications.',
  },
  {
    name: 'Builder',
    role: 'Implementation Engineer',
    phase: 'execution',
    status: 'idle',
    lastOutput: null,
    description: 'Implements the solution according to the architectural design.',
  },
  {
    name: 'Reviewer',
    role: 'Code Reviewer',
    phase: 'review',
    status: 'idle',
    lastOutput: null,
    description: 'Reviews code quality, patterns, and adherence to specifications.',
  },
  {
    name: 'Tester',
    role: 'QA Engineer',
    phase: 'testing',
    status: 'idle',
    lastOutput: null,
    description: 'Validates functionality and ensures requirements are met.',
  },
  {
    name: 'Integrator',
    role: 'Integration Specialist',
    phase: 'integration',
    status: 'idle',
    lastOutput: null,
    description: 'Merges components and ensures seamless system integration.',
  },
];

// Phase to agents mapping
export const PHASE_AGENTS: Record<WorkflowPhase, AgentName[]> = {
  idle: [],
  debate: ['Strategist', 'Skeptic', 'Pragmatist'],
  summary: [],
  'awaiting-approval': [],
  execution: ['Planner', 'Architect', 'Builder'],
  review: ['Reviewer'],
  testing: ['Tester'],
  integration: ['Integrator'],
  complete: [],
};

// Generate a unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// Create a new log entry
export function createLogEntry(
  message: string,
  level: LogEntry['level'] = 'info',
  agent?: AgentName
): LogEntry {
  return {
    id: generateId(),
    timestamp: new Date(),
    level,
    message,
    agent,
  };
}

// Create a new message
export function createMessage(
  sender: MessageSender,
  content: string,
  type: Message['type'] = 'chat',
  agentRole?: string,
  attachmentIds?: string[]
): Message {
  return {
    id: generateId(),
    sender,
    content,
    type,
    timestamp: new Date(),
    agentRole,
    attachmentIds,
  };
}

// Create initial orchestrator state
export function createInitialState(): OrchestratorState {
  return {
    currentPhase: 'idle',
    activeProject: null,
    agents: DEFAULT_AGENTS.map((a) => ({ ...a })),
    executionLog: [],
  };
}

// Update agent status in the agents list
export function updateAgentStatus(
  agents: Agent[],
  name: AgentName,
  status: AgentStatus,
  lastOutput?: string
): Agent[] {
  return agents.map((agent) =>
    agent.name === name
      ? { ...agent, status, lastOutput: lastOutput ?? agent.lastOutput }
      : agent
  );
}

// Get next workflow phase
export function getNextPhase(current: WorkflowPhase): WorkflowPhase {
  const transitions: Record<WorkflowPhase, WorkflowPhase> = {
    idle: 'debate',
    debate: 'summary',
    summary: 'awaiting-approval',
    'awaiting-approval': 'execution',
    execution: 'review',
    review: 'testing',
    testing: 'integration',
    integration: 'complete',
    complete: 'complete',
  };
  return transitions[current];
}

// Get phase display label
export function getPhaseLabel(phase: WorkflowPhase): string {
  const labels: Record<WorkflowPhase, string> = {
    idle: 'Idle',
    debate: 'Debate Phase',
    summary: 'Generating Summary',
    'awaiting-approval': 'Awaiting Approval',
    execution: 'Execution Phase',
    review: 'Review Phase',
    testing: 'Testing Phase',
    integration: 'Integration Phase',
    complete: 'Complete',
  };
  return labels[phase];
}

// Create a new project
export function createProject(
  name: string,
  description: string,
  language: AppLanguage,
  outputType: OutputType,
  simulationMode = true,
  debateRounds = 3,
  debateMode: DebateMode = 'auto',
  maxWordsPerAgent = 180,
  projectId?: string,
  provider: AIProvider = 'openai',
  model: OpenAIModel = 'gpt-4.1-mini'
): Project {
  const now = new Date();
  const normalizedRounds = Math.min(3, Math.max(1, debateRounds));
  const initialUsage: ProjectUsage = {
    totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    session: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    estimatedProjectCostUsd: 0,
    sessionCostUsd: 0,
    activeModel: model,
    models: [],
    lastUpdatedAt: null,
    persistence: {
      lastSyncedAt: null,
      pendingSync: false,
    },
  };
  return {
    id: projectId ?? generateId(),
    name,
    description,
    language,
    provider,
    model,
    simulationMode,
    debateRounds: normalizedRounds,
    debateMode,
    maxWordsPerAgent,
    latestRevisionFeedback: null,
    revisionRound: 0,
    currentCycleNumber: 0,
    revisionHistory: [],
    outputType,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    taskGraph: null,
    tasks: [],
    messages: [],
    attachments: [],
    executionSnapshot: null,
    latestStableBundle: null,
    latestStableFiles: [],
    latestStableSummary: null,
    latestStableUpdatedAt: null,
    usage: initialUsage,
  };
}
