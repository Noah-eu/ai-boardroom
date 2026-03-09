'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  AttachmentIngestion,
  AppLanguage,
  Agent,
  AgentName,
  AgentStatus,
  DebateMode,
  LogEntry,
  ProjectAttachment,
  ProjectAttachmentKind,
  ProjectUsage,
  OrchestratorState,
  OutputType,
  Project,
  ProjectStatus,
  Task,
  TaskGraph,
  UsageTotals,
  WorkflowPhase,
} from '@/types';
import { z } from 'zod';
import { getFirebaseClient, getFirebaseInitError } from '@/lib/firebase';
import {
  createInitialState,
  createLogEntry,
  createMessage,
  createProject,
  DEFAULT_AGENTS,
  generateId,
  PHASE_AGENTS,
  updateAgentStatus,
} from '@/orchestrator';
import { createTask, patchTask } from '@/tasks';
import { Language, TranslationKey, translate, translateWithVars } from '@/i18n';

type ExecutionSpeed = 'slow' | 'normal' | 'fast';

interface DeadlockTaskDetail {
  taskId: string;
  taskTitle: string;
  unmetDependencies: string[];
}

interface DeadlockState {
  blockedTasks: DeadlockTaskDetail[];
  message: string;
}

const SPEED_CONFIG: Record<ExecutionSpeed, { tickMs: number; minTaskMs: number; maxTaskMs: number }> = {
  slow: { tickMs: 1600, minTaskMs: 2200, maxTaskMs: 3600 },
  normal: { tickMs: 700, minTaskMs: 1300, maxTaskMs: 2800 },
  fast: { tickMs: 300, minTaskMs: 650, maxTaskMs: 1200 },
};

const MAX_REVISION_ROUNDS = 5;

const plannerAgentSchema = z.enum([
  'Planner',
  'Architect',
  'Builder',
  'Reviewer',
  'Tester',
  'Integrator',
]);

const plannerArtifactSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['doc', 'json', 'report', 'zip', 'image']),
});

const plannerTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  agent: plannerAgentSchema,
  dependsOn: z.array(z.string()).default([]),
  artifacts: z.array(plannerArtifactSchema).default([]),
});

const plannerTaskGraphSchema = z.object({
  tasks: z.array(plannerTaskSchema).min(1),
  concurrencyLimit: z.number().int().min(1).max(4).default(2),
  maxRetries: z.number().int().min(0).max(4).default(2),
});

type AiRespondPayload = {
  projectId: string;
  language: AppLanguage;
  agentRole: string;
  inputText: string;
  context?: unknown;
  attachmentContext?: {
    images?: Array<{ url: string; title: string }>;
  };
};

type AiUsageMeta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type AiRespondMeta = {
  model: string;
  usage: AiUsageMeta;
};

type AiRespondResult = {
  text: string;
  meta: AiRespondMeta | null;
};

type AiRespondLogContext = {
  agent?: AgentName;
};

type DraftAttachmentInput =
  | { kind: 'image' | 'pdf' | 'zip' | 'file'; file: File; source?: 'project' | 'message' }
  | { kind: 'url'; url: string; source?: 'project' | 'message' };

const MODEL_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function resolveModelRates(modelName: string | null): { input: number; output: number } {
  if (!modelName) {
    return MODEL_PRICING_PER_MILLION['gpt-4.1-mini'];
  }
  return MODEL_PRICING_PER_MILLION[modelName] ?? MODEL_PRICING_PER_MILLION['gpt-4.1-mini'];
}

function estimateCostUsd(totals: UsageTotals, modelName: string | null): number {
  const rates = resolveModelRates(modelName);
  const inputCost = (totals.inputTokens / 1_000_000) * rates.input;
  const outputCost = (totals.outputTokens / 1_000_000) * rates.output;
  return Number((inputCost + outputCost).toFixed(6));
}

function createEmptyUsage(): ProjectUsage {
  return {
    totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    session: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    estimatedProjectCostUsd: 0,
    sessionCostUsd: 0,
    activeModel: null,
    models: [],
    lastUpdatedAt: null,
    persistence: {
      lastSyncedAt: null,
      pendingSync: false,
    },
  };
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function detectFileKind(file: File): ProjectAttachmentKind {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/.test(name)) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || name.endsWith('.zip')) {
    return 'zip';
  }
  return 'file';
}

type Action =
  | {
      type: 'CREATE_PROJECT';
      name: string;
      description: string;
      language: AppLanguage;
      outputType: OutputType;
      simulationMode: boolean;
      debateRounds: number;
      debateMode: DebateMode;
      maxWordsPerAgent: number;
    }
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'START_DEBATE'; task: string }
  | { type: 'AGENT_SPEAK'; agent: AgentName; content: string }
  | { type: 'ORCHESTRATOR_SUMMARY'; content: string }
  | { type: 'REQUEST_APPROVAL' }
  | { type: 'APPROVE_PLAN' }
  | { type: 'REJECT_PLAN'; feedback: string; attachmentIds?: string[] }
  | { type: 'SET_PHASE'; phase: WorkflowPhase }
  | { type: 'UPDATE_AGENT_STATUS'; agent: AgentName; status: AgentStatus; lastOutput?: string }
  | { type: 'ADD_USER_MESSAGE'; content: string; attachmentIds?: string[] }
  | { type: 'ADD_LOG'; message: string; level: LogEntry['level']; agent?: AgentName }
  | { type: 'SET_TASK_GRAPH'; projectId: string; taskGraph: TaskGraph }
  | { type: 'ADD_TASK'; projectId: string; task: Task }
  | {
      type: 'UPDATE_TASK';
      projectId: string;
      taskId: string;
      patch: Partial<Omit<Task, 'id' | 'createdAt'>>;
    }
  | {
      type: 'SET_PROJECT_SIMULATION_MODE';
      projectId: string;
      simulationMode: boolean;
    }
  | {
      type: 'SET_PROJECT_DEBATE_ROUNDS';
      projectId: string;
      debateRounds: number;
    }
  | {
      type: 'ADD_PROJECT_USAGE';
      projectId: string;
      model: string;
      usage: AiUsageMeta;
    }
  | {
      type: 'ADD_PROJECT_ATTACHMENT';
      projectId: string;
      attachment: ProjectAttachment;
    }
  | {
      type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION';
      projectId: string;
      attachmentId: string;
      ingestion: AttachmentIngestion;
    }
  | { type: 'RESET' };

interface AppState extends OrchestratorState {
  projects: Project[];
  selectedProjectId: string | null;
}

function mapPhaseToProjectStatus(phase: WorkflowPhase): ProjectStatus {
  switch (phase) {
    case 'debate':
      return 'debating';
    case 'awaiting-approval':
      return 'awaiting-approval';
    case 'execution':
      return 'executing';
    case 'review':
      return 'reviewing';
    case 'testing':
      return 'testing';
    case 'integration':
      return 'integrating';
    case 'complete':
      return 'complete';
    default:
      return 'idle';
  }
}

function syncProjectById(
  state: AppState,
  projectId: string,
  updater: (project: Project) => Project
): AppState {
  const updatedProjects = state.projects.map((project) =>
    project.id === projectId ? updater(project) : project
  );
  const updatedActiveProject =
    state.activeProject?.id === projectId ? updater(state.activeProject) : state.activeProject;

  return {
    ...state,
    projects: updatedProjects,
    activeProject: updatedActiveProject,
  };
}

function dependencySatisfied(tasks: Task[], dependencyId: string): boolean {
  const dependencyTask = tasks.find((task) => task.id === dependencyId);
  return dependencyTask ? dependencyTask.status === 'done' || dependencyTask.status === 'failed' : false;
}

function dependenciesSatisfied(tasks: Task[], task: Task): boolean {
  return task.dependsOn.every((dependencyId) => dependencySatisfied(tasks, dependencyId));
}

function getLatestOrchestratorSummary(project: Project): string | null {
  const message = [...project.messages]
    .reverse()
    .find((entry) => entry.sender === 'orchestrator' && entry.type === 'system');
  return message?.content ?? null;
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CREATE_PROJECT': {
      const project = createProject(
        action.name,
        action.description,
        action.language,
        action.outputType,
        action.simulationMode,
        action.debateRounds,
        action.debateMode,
        action.maxWordsPerAgent
      );
      return {
        ...state,
        projects: [...state.projects, project],
        selectedProjectId: project.id,
        activeProject: project,
        currentPhase: 'idle',
        agents: DEFAULT_AGENTS.map((a) => ({ ...a })),
        executionLog: [
          createLogEntry(
            translateWithVars(project.language, 'workflow.projectCreated', { name: project.name }),
            'success'
          ),
        ],
      };
    }

    case 'SELECT_PROJECT': {
      const project = state.projects.find((p) => p.id === action.projectId) ?? null;
      return {
        ...state,
        selectedProjectId: action.projectId,
        activeProject: project,
        currentPhase:
          project?.status === 'debating'
            ? 'debate'
            : project?.status === 'awaiting-approval'
            ? 'awaiting-approval'
            : project?.status === 'executing'
            ? 'execution'
            : project?.status === 'reviewing'
            ? 'review'
            : project?.status === 'testing'
            ? 'testing'
            : project?.status === 'integrating'
            ? 'integration'
            : project?.status === 'complete'
            ? 'complete'
            : 'idle',
      };
    }

    case 'START_DEBATE': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const welcomeMsg = createMessage(
        'orchestrator',
        translateWithVars(lang, 'workflow.startDebateWelcome', { task: action.task }),
        'system'
      );
      const log = createLogEntry(translate(lang, 'workflow.debateInitiated'), 'info');
      const phaseAgents = PHASE_AGENTS.debate;
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (phaseAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        messages: [...state.activeProject.messages, createMessage('user', action.task), welcomeMsg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'AGENT_SPEAK': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const agentInfo = state.agents.find((a) => a.name === action.agent);
      const msg = createMessage(action.agent, action.content, 'chat', agentInfo?.role);
      const log = createLogEntry(
        translateWithVars(lang, 'workflow.agentContributed', { agent: action.agent }),
        'info',
        action.agent
      );
      const updatedAgents = updateAgentStatus(state.agents, action.agent, 'idle', action.content);
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'ORCHESTRATOR_SUMMARY': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('orchestrator', action.content, 'system');
      const log = createLogEntry(translate(lang, 'workflow.summaryGenerated'), 'info');
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'awaiting-approval',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'awaiting-approval',
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REQUEST_APPROVAL': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('orchestrator', translate(lang, 'workflow.requestApproval'), 'approval-request');
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          messages: [...state.activeProject.messages, msg],
          updatedAt: new Date(),
        },
      };
    }

    case 'APPROVE_PLAN': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const msg = createMessage('user', translate(lang, 'workflow.approvedResponse'), 'approval-response');
      const log = createLogEntry(translate(lang, 'workflow.approvedLog'), 'success');
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'executing',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'execution',
        agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REJECT_PLAN': {
      if (!state.activeProject) return state;
      const lang = state.activeProject.language;
      const nextRound = state.activeProject.revisionRound + 1;
      const msg = createMessage('user', action.feedback, 'chat', undefined, action.attachmentIds);
      const log = createLogEntry(
        translateWithVars(lang, 'workflow.revision.requested', { round: nextRound }),
        'warning'
      );
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        latestRevisionFeedback: action.feedback,
        revisionRound: nextRound,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'SET_PHASE': {
      if (!state.activeProject) return state;
      const updatedProject: Project = {
        ...state.activeProject,
        status: mapPhaseToProjectStatus(action.phase),
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: action.phase,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
      };
    }

    case 'UPDATE_AGENT_STATUS': {
      const updatedAgents = updateAgentStatus(
        state.agents,
        action.agent,
        action.status,
        action.lastOutput
      );
      return { ...state, agents: updatedAgents };
    }

    case 'ADD_USER_MESSAGE': {
      if (!state.activeProject) return state;
      const msg = createMessage('user', action.content, 'chat', undefined, action.attachmentIds);
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        activeProject: updatedProject,
        projects: state.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
      };
    }

    case 'ADD_LOG': {
      const log = createLogEntry(action.message, action.level, action.agent);
      return {
        ...state,
        executionLog: [...state.executionLog, log],
      };
    }

    case 'SET_TASK_GRAPH': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        taskGraph: action.taskGraph,
        tasks: action.taskGraph.tasks,
        updatedAt: new Date(),
      }));
    }

    case 'ADD_TASK': {
      return syncProjectById(state, action.projectId, (project) => {
        const nextTasks = [...project.tasks, action.task];
        return {
          ...project,
          tasks: nextTasks,
          taskGraph: project.taskGraph
            ? { ...project.taskGraph, tasks: nextTasks }
            : { tasks: nextTasks, concurrencyLimit: 2, maxRetries: 2 },
          updatedAt: new Date(),
        };
      });
    }

    case 'UPDATE_TASK': {
      return syncProjectById(state, action.projectId, (project) => {
        const updatedTasks = patchTask(project.tasks, action.taskId, action.patch);
        return {
          ...project,
          tasks: updatedTasks,
          taskGraph: project.taskGraph ? { ...project.taskGraph, tasks: updatedTasks } : null,
          updatedAt: new Date(),
        };
      });
    }

    case 'SET_PROJECT_SIMULATION_MODE': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        simulationMode: action.simulationMode,
        updatedAt: new Date(),
      }));
    }
    case 'SET_PROJECT_DEBATE_ROUNDS': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        debateRounds: Math.min(3, Math.max(1, action.debateRounds)),
        updatedAt: new Date(),
      }));
    }

    case 'ADD_PROJECT_USAGE': {
      return syncProjectById(state, action.projectId, (project) => {
        const currentUsage = project.usage ?? createEmptyUsage();
        const nextTotals: UsageTotals = {
          inputTokens: currentUsage.totals.inputTokens + action.usage.inputTokens,
          outputTokens: currentUsage.totals.outputTokens + action.usage.outputTokens,
          totalTokens:
            currentUsage.totals.totalTokens +
            (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
        };
        const nextSession: UsageTotals = {
          inputTokens: currentUsage.session.inputTokens + action.usage.inputTokens,
          outputTokens: currentUsage.session.outputTokens + action.usage.outputTokens,
          totalTokens:
            currentUsage.session.totalTokens +
            (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
        };
        const modelName = action.model || currentUsage.activeModel || null;
        const modelIndex = currentUsage.models.findIndex((entry) => entry.model === action.model);
        const nextModels = [...currentUsage.models];

        if (modelIndex >= 0) {
          const current = nextModels[modelIndex];
          nextModels[modelIndex] = {
            ...current,
            calls: current.calls + 1,
            totals: {
              inputTokens: current.totals.inputTokens + action.usage.inputTokens,
              outputTokens: current.totals.outputTokens + action.usage.outputTokens,
              totalTokens:
                current.totals.totalTokens +
                (action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens),
            },
          };
        } else {
          nextModels.push({
            model: action.model,
            calls: 1,
            totals: {
              inputTokens: action.usage.inputTokens,
              outputTokens: action.usage.outputTokens,
              totalTokens: action.usage.totalTokens || action.usage.inputTokens + action.usage.outputTokens,
            },
          });
        }

        return {
          ...project,
          usage: {
            ...currentUsage,
            totals: nextTotals,
            session: nextSession,
            activeModel: modelName,
            models: nextModels,
            estimatedProjectCostUsd: estimateCostUsd(nextTotals, modelName),
            sessionCostUsd: estimateCostUsd(nextSession, modelName),
            lastUpdatedAt: new Date(),
            persistence: {
              ...currentUsage.persistence,
              pendingSync: true,
            },
          },
          updatedAt: new Date(),
        };
      });
    }

    case 'ADD_PROJECT_ATTACHMENT': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        attachments: [action.attachment, ...project.attachments],
        updatedAt: new Date(),
      }));
    }

    case 'UPDATE_PROJECT_ATTACHMENT_INGESTION': {
      return syncProjectById(state, action.projectId, (project) => ({
        ...project,
        attachments: project.attachments.map((attachment) =>
          attachment.id === action.attachmentId
            ? {
                ...attachment,
                ingestion: {
                  ...attachment.ingestion,
                  ...action.ingestion,
                },
              }
            : attachment
        ),
        updatedAt: new Date(),
      }));
    }

    case 'RESET': {
      return createInitialAppState();
    }

    default:
      return state;
  }
}

function createInitialAppState(): AppState {
  return {
    ...createInitialState(),
    projects: [],
    selectedProjectId: null,
  };
}

interface AppContextValue {
  state: AppState;
  firebaseUid: string | null;
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
  tf: (key: TranslationKey, vars: Record<string, string | number>) => string;
  createProject: (
    name: string,
    description: string,
    projectLanguage: AppLanguage,
    outputType: OutputType,
    simulationMode: boolean,
    debateRounds: number,
    debateMode: DebateMode,
    maxWordsPerAgent: number,
    autoStartDebate?: boolean
  ) => void;
  selectProject: (id: string) => void;
  startDebate: (task: string) => void;
  agentSpeak: (agent: AgentName, content: string) => void;
  orchestratorSummary: (content: string) => void;
  requestApproval: () => void;
  approvePlan: () => void;
  rejectPlan: (feedback: string, attachmentIds?: string[]) => void;
  updateAgentStatus: (agent: AgentName, status: AgentStatus, lastOutput?: string) => void;
  addUserMessage: (content: string, attachmentIds?: string[]) => void;
  attachToProject: (projectId: string, attachment: DraftAttachmentInput) => Promise<ProjectAttachment>;
  addLog: (message: string, level: LogEntry['level'], agent?: AgentName) => void;
  setProjectSimulationMode: (projectId: string, simulationMode: boolean) => void;
  setProjectDebateRounds: (projectId: string, debateRounds: number) => void;
  schedulerState: {
    isPaused: boolean;
    isComplete: boolean;
    concurrencyLimit: number;
    total: number;
    done: number;
    runningTasks: number;
    queued: number;
    blocked: number;
    failed: number;
    retryLimit: number;
    executionSpeed: ExecutionSpeed;
    autoPauseCheckpoints: boolean;
    deadlock: DeadlockState | null;
  };
  setExecutionSpeed: (speed: ExecutionSpeed) => void;
  setAutoPauseCheckpoints: (enabled: boolean) => void;
  repairDeadlock: () => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  stopExecution: () => void;
  stepExecution: () => void;
  reset: () => void;
  runDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialAppState);
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [executionSpeed, setExecutionSpeed] = useState<ExecutionSpeed>('normal');
  const [autoPauseCheckpoints, setAutoPauseCheckpoints] = useState(true);
  const [pausedSchedulers, setPausedSchedulers] = useState<Record<string, boolean>>({});
  const [deadlocks, setDeadlocks] = useState<Record<string, DeadlockState | null>>({});
  const stateRef = useRef<AppState>(state);
  const executionSpeedRef = useRef<ExecutionSpeed>('normal');
  const schedulerIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const schedulerPausedRef = useRef<Record<string, boolean>>({});
  const taskTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const checkpointHitRef = useRef<Record<string, { approval: boolean; integrator: boolean }>>({});
  const deadlockSignatureRef = useRef<Record<string, string>>({});
  const debateRunsRef = useRef<Record<string, boolean>>({});
  const projectPhaseRef = useRef<Record<string, WorkflowPhase>>({});
  const firebaseConnectedLoggedRef = useRef(false);
  const firebaseErrorLoggedRef = useRef(false);
  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);
  const tf = useCallback(
    (key: TranslationKey, vars: Record<string, string | number>) =>
      translateWithVars(language, key, vars),
    [language]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    executionSpeedRef.current = executionSpeed;
  }, [executionSpeed]);

  useEffect(() => {
    let unsubAuth: (() => void) | undefined;

    const logFirebaseError = (message: string) => {
      if (firebaseErrorLoggedRef.current) {
        return;
      }
      firebaseErrorLoggedRef.current = true;
      dispatch({
        type: 'ADD_LOG',
        level: 'error',
        message: `Firebase: ${message}. Continuing in simulation mode.`,
      });
    };

    const ensureAnonymousSignIn = async (currentUser: User | null) => {
      if (currentUser) {
        setFirebaseUid(currentUser.uid);
        if (!firebaseConnectedLoggedRef.current) {
          firebaseConnectedLoggedRef.current = true;
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firebase: connected (uid: ${currentUser.uid})`,
          });
        }
        return;
      }

      setFirebaseUid(null);
      try {
        const client = getFirebaseClient();
        if (!client) {
          logFirebaseError(getFirebaseInitError() ?? 'initialization failed');
          return;
        }
        const credential = await signInAnonymously(client.auth);
        setFirebaseUid(credential.user.uid);
        if (!firebaseConnectedLoggedRef.current) {
          firebaseConnectedLoggedRef.current = true;
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: `Firebase: connected (uid: ${credential.user.uid})`,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'anonymous authentication failed';
        logFirebaseError(detail);
      }
    };

    try {
      const client = getFirebaseClient();
      if (!client) {
        logFirebaseError(getFirebaseInitError() ?? 'initialization failed');
        return;
      }

      unsubAuth = onAuthStateChanged(
        client.auth,
        (user) => {
          void ensureAnonymousSignIn(user);
        },
        (error) => {
          const detail = error instanceof Error ? error.message : 'auth state tracking failed';
          logFirebaseError(detail);
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'initialization failed';
      logFirebaseError(detail);
    }

    return () => {
      if (unsubAuth) {
        unsubAuth();
      }
    };
  }, []);

  const translateProject = useCallback((projectLanguage: AppLanguage, key: TranslationKey) => {
    return translate(projectLanguage, key);
  }, []);

  const translateProjectWithVars = useCallback(
    (projectLanguage: AppLanguage, key: TranslationKey, vars: Record<string, string | number>) => {
      return translateWithVars(projectLanguage, key, vars);
    },
    []
  );

  const resolveAiRespondEndpoint = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.host.includes('netlify.app')) {
      return '/.netlify/functions/ai-respond';
    }
    return '/api/ai/respond';
  }, []);

  const buildAttachmentContext = useCallback((project: Project) => {
    const projectAttachments = project.attachments.filter((attachment) => (attachment.source ?? 'message') === 'project');
    const messageAttachments = project.attachments.filter((attachment) => (attachment.source ?? 'message') === 'message');
    const includedAttachmentIds: string[] = [];
    const textSections: Array<{ title: string; kind: ProjectAttachmentKind; source: 'project' | 'message'; text: string }> = [];
    const images: Array<{ url: string; title: string; source: 'project' | 'message' }> = [];

    for (const attachment of project.attachments) {
      const source = (attachment.source ?? 'message') as 'project' | 'message';
      const ingestion = attachment.ingestion;
      let included = false;

      if (attachment.kind === 'image' && attachment.downloadUrl) {
        images.push({ url: attachment.downloadUrl, title: attachment.title, source });
        included = true;
      }

      if (ingestion?.extractedText) {
        textSections.push({
          title: attachment.title,
          kind: attachment.kind,
          source,
          text: ingestion.extractedText,
        });
        included = true;
      } else if (attachment.kind === 'zip' && ingestion?.zipFileTree) {
        const zipSummary = [
          `File tree:\n${ingestion.zipFileTree.slice(0, 80).join('\n')}`,
          ingestion.zipKeyFiles?.length
            ? `Key files:\n${ingestion.zipKeyFiles
                .map((file) => `${file.path}\n${file.content}`)
                .join('\n\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        textSections.push({
          title: attachment.title,
          kind: attachment.kind,
          source,
          text: zipSummary,
        });
        included = true;
      }

      if (included) {
        includedAttachmentIds.push(attachment.id);
      }
    }

    return {
      projectAttachments: projectAttachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        kind: attachment.kind,
        status: attachment.ingestion?.status ?? 'uploaded',
      })),
      messageAttachments: messageAttachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        kind: attachment.kind,
        status: attachment.ingestion?.status ?? 'uploaded',
      })),
      textSections,
      images,
      includedAttachmentIds,
    };
  }, []);

  const callAiRespond = useCallback(
    async (payload: AiRespondPayload, logContext?: AiRespondLogContext): Promise<AiRespondResult> => {
      const role = payload.agentRole;
      const project = stateRef.current.projects.find((candidate) => candidate.id === payload.projectId);
      const attachmentContext = project ? buildAttachmentContext(project) : null;
      const requestPayload: AiRespondPayload = {
        ...payload,
        context: {
          ...(typeof payload.context === 'object' && payload.context !== null ? payload.context : { raw: payload.context ?? null }),
          attachments: attachmentContext
            ? {
                projectAttachments: attachmentContext.projectAttachments,
                messageAttachments: attachmentContext.messageAttachments,
                extractedSections: attachmentContext.textSections.map((section) => ({
                  title: section.title,
                  source: section.source,
                  kind: section.kind,
                  content: section.text,
                })),
              }
            : null,
        },
        attachmentContext: {
          images: attachmentContext
            ? attachmentContext.images.map((image) => ({ url: image.url, title: image.title }))
            : [],
        },
      };

      if (logContext) {
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          agent: logContext.agent,
          message: translateProjectWithVars(payload.language, 'workflow.openai.callStart', { role }),
        });
      }

      try {
        const endpoint = resolveAiRespondEndpoint();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });

        const contentType = response.headers.get('content-type') ?? '';
        const rawBody = await response.text();
        let data: { text?: string; error?: string; meta?: AiRespondMeta } | null = null;

        if (contentType.includes('application/json')) {
          try {
            data = JSON.parse(rawBody) as { text?: string; error?: string; meta?: AiRespondMeta };
          } catch {
            data = null;
          }
        }

        if (!data) {
          const snippet = rawBody.slice(0, 200).replace(/\s+/g, ' ').trim();
          const detail = `status=${response.status} body="${snippet || '<empty>'}"`;
          console.warn(`[ai/respond] Non-JSON response from ${endpoint}: ${detail}`);
          throw new Error(`AI endpoint returned non-JSON response (${detail}).`);
        }

        if (!response.ok || !data.text) {
          const detail = data.error ? ` ${data.error}` : '';
          throw new Error(`AI request failed.${detail}`);
        }

        if (logContext) {
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            agent: logContext.agent,
            message: translateProject(payload.language, 'workflow.openai.callSuccess'),
          });
        }

        if (project && attachmentContext && attachmentContext.includedAttachmentIds.length > 0) {
          attachmentContext.includedAttachmentIds.forEach((attachmentId) => {
            dispatch({
              type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
              projectId: project.id,
              attachmentId,
              ingestion: {
                status: 'included',
                includedInContext: true,
                lastIncludedAt: new Date(),
              },
            });
          });

          if (logContext) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              agent: logContext.agent,
              message: `Attachments included in AI context: ${attachmentContext.includedAttachmentIds.length}`,
            });
          }
        }

        if (data.meta?.model && data.meta.usage) {
          dispatch({
            type: 'ADD_PROJECT_USAGE',
            projectId: payload.projectId,
            model: data.meta.model,
            usage: data.meta.usage,
          });
        }

        return {
          text: data.text,
          meta: data.meta ?? null,
        };
      } catch (error) {
        if (logContext) {
          const message = error instanceof Error ? error.message : 'Unknown OpenAI error';
          const shortError = message.length > 140 ? `${message.slice(0, 137)}...` : message;
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            agent: logContext.agent,
            message: translateProjectWithVars(payload.language, 'workflow.openai.callError', {
              error: shortError,
            }),
          });
        }
        throw error;
      }
    },
    [buildAttachmentContext, resolveAiRespondEndpoint, translateProject, translateProjectWithVars]
  );

  const materializePlannerGraph = useCallback((rawGraph: z.infer<typeof plannerTaskGraphSchema>): TaskGraph => {
    const idMap = new Map<string, string>();
    rawGraph.tasks.forEach((task) => {
      idMap.set(task.id, generateId());
    });

    const now = new Date();
    const tasks: Task[] = rawGraph.tasks.map((task) => {
      const dependsOn = task.dependsOn
        .map((dependencyId) => idMap.get(dependencyId))
        .filter((dependencyId): dependencyId is string => Boolean(dependencyId));
      return {
        id: idMap.get(task.id) as string,
        title: task.title,
        description: task.description,
        agent: task.agent,
        status: dependsOn.length === 0 ? 'queued' : 'blocked',
        dependsOn,
        producesArtifacts: task.artifacts,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        maxRetries: rawGraph.maxRetries,
      };
    });

    return {
      tasks,
      concurrencyLimit: rawGraph.concurrencyLimit,
      maxRetries: rawGraph.maxRetries,
    };
  }, []);

  const buildPlannerPrompt = useCallback((project: Project, strictJsonOnly: boolean) => {
    const instructions = [
      'Build a TaskGraph for this project.',
      'Return JSON with shape: {"tasks":[...],"concurrencyLimit":number,"maxRetries":number}.',
      'Each task must contain: id,title,description,agent,dependsOn,artifacts.',
      'Use agent values only from: Planner, Architect, Builder, Reviewer, Tester, Integrator.',
      'Use artifact kind values only from: doc,json,report,zip,image.',
      'dependsOn must reference task ids from the same payload.',
      'Include enough tasks to cover planning, architecture, implementation, review, testing, integration.',
    ];

    if (strictJsonOnly) {
      instructions.push('Return ONLY valid JSON.');
    }

    return `${instructions.join(' ')}\n\nProject name: ${project.name}\nProject description: ${project.description}\nOutput type: ${project.outputType}`;
  }, []);

  const setSchedulerPaused = useCallback(
    (projectId: string, paused: boolean, withLog: boolean) => {
      schedulerPausedRef.current = {
        ...schedulerPausedRef.current,
        [projectId]: paused,
      };
      setPausedSchedulers((previous) => ({ ...previous, [projectId]: paused }));

      if (!withLog) return;
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: translateProject(
          project.language,
          paused ? 'workflow.scheduler.paused' : 'workflow.scheduler.resumed'
        ),
      });
    },
    [translateProject]
  );

  const createProjectFn = useCallback(
    (
      name: string,
      description: string,
      projectLanguage: AppLanguage,
      outputType: OutputType,
      simulationMode: boolean,
      debateRounds: number,
      debateMode: DebateMode,
      maxWordsPerAgent: number,
      autoStartDebate = true
    ) => {
      dispatch({
        type: 'CREATE_PROJECT',
        name,
        description,
        language: projectLanguage,
        outputType,
        simulationMode,
        debateRounds,
        debateMode,
        maxWordsPerAgent,
      });
      if (autoStartDebate) {
        dispatch({ type: 'START_DEBATE', task: description });
      }
    },
    []
  );

  const selectProject = useCallback((id: string) => {
    dispatch({ type: 'SELECT_PROJECT', projectId: id });
  }, []);

  const startDebate = useCallback((task: string) => {
    dispatch({ type: 'START_DEBATE', task });
  }, []);

  const agentSpeak = useCallback((agent: AgentName, content: string) => {
    dispatch({ type: 'AGENT_SPEAK', agent, content });
  }, []);

  const orchestratorSummary = useCallback((content: string) => {
    dispatch({ type: 'ORCHESTRATOR_SUMMARY', content });
  }, []);

  const requestApproval = useCallback(() => {
    dispatch({ type: 'REQUEST_APPROVAL' });
  }, []);

  const derivePhaseFromTasks = useCallback((tasks: Task[]): WorkflowPhase => {
    if (tasks.length > 0 && tasks.every((task) => task.status === 'done' || task.status === 'failed')) {
      return 'complete';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Integrator')) {
      return 'integration';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Tester')) {
      return 'testing';
    }
    if (tasks.some((task) => task.status === 'running' && task.agent === 'Reviewer')) {
      return 'review';
    }
    if (tasks.some((task) => task.status === 'running')) {
      return 'execution';
    }
    return 'execution';
  }, []);

  const syncTaskAvailability = useCallback(
    (project: Project, logFixes = false) => {
      const taskIdSet = new Set(project.tasks.map((task) => task.id));
      let changed = false;

      project.tasks.forEach((task) => {
        if (task.status === 'done' || task.status === 'failed' || task.status === 'running') {
          return;
        }

        const validDependencies = task.dependsOn.filter((dependencyId) => taskIdSet.has(dependencyId));
        const missingDependencies = task.dependsOn.filter((dependencyId) => !taskIdSet.has(dependencyId));
        const shouldQueue = validDependencies.every((dependencyId) =>
          dependencySatisfied(project.tasks, dependencyId)
        );
        const expectedStatus: Task['status'] = shouldQueue ? 'queued' : 'blocked';

        if (
          missingDependencies.length > 0 ||
          task.status !== expectedStatus ||
          validDependencies.length !== task.dependsOn.length
        ) {
          changed = true;
          dispatch({
            type: 'UPDATE_TASK',
            projectId: project.id,
            taskId: task.id,
            patch: {
              dependsOn: validDependencies,
              status: expectedStatus,
            },
          });

          if (missingDependencies.length > 0 && logFixes) {
            dispatch({
              type: 'ADD_LOG',
              level: 'warning',
              message: translateProjectWithVars(project.language, 'workflow.task.dependenciesFixed', {
                title: task.title,
              }),
            });
          }
        }
      });

      return changed;
    },
    [translateProjectWithVars]
  );

  const syncAgentStatusesFromTasks = useCallback((project: Project) => {
    const latestState = stateRef.current;
    latestState.agents.forEach((agent) => {
      const hasRunningTask = project.tasks.some(
        (task) => task.agent === agent.name && task.status === 'running'
      );
      const hasQueuedTask = project.tasks.some(
        (task) =>
          task.agent === agent.name &&
          task.status === 'queued' &&
          dependenciesSatisfied(project.tasks, task)
      );

      const targetStatus: AgentStatus = hasRunningTask
        ? 'active'
        : hasQueuedTask
        ? 'thinking'
        : 'idle';

      if (agent.status !== targetStatus) {
        dispatch({ type: 'UPDATE_AGENT_STATUS', agent: agent.name, status: targetStatus });
      }
    });
  }, []);

  const rerouteDependencies = useCallback((project: Project, fromTaskId: string, toTaskId: string) => {
    project.tasks
      .filter(
        (task) =>
          task.id !== toTaskId &&
          task.status !== 'done' &&
          task.status !== 'running' &&
          task.dependsOn.includes(fromTaskId)
      )
      .forEach((task) => {
        dispatch({
          type: 'UPDATE_TASK',
          projectId: project.id,
          taskId: task.id,
          patch: {
            dependsOn: task.dependsOn.map((dependencyId) =>
              dependencyId === fromTaskId ? toTaskId : dependencyId
            ),
            status: 'blocked',
          },
        });
      });
  }, []);

  const completeTask = useCallback(
    (projectId: string, taskId: string) => {
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      const task = project?.tasks.find((candidate) => candidate.id === taskId);
      if (!project || !task || task.status !== 'running') {
        return;
      }

      const lang = project.language;
      const retryCount = task.retryCount ?? 0;
      const maxRetries = task.maxRetries ?? project.taskGraph?.maxRetries ?? 2;
      const failProbability = task.agent === 'Tester' ? 0.25 : task.agent === 'Reviewer' ? 0.15 : 0;
      const shouldFail = failProbability > 0 && retryCount < maxRetries && Math.random() < failProbability;

      if (shouldFail) {
        const errorMessage = translateProjectWithVars(lang, 'workflow.task.failedReason', {
          title: task.title,
        });
        dispatch({
          type: 'UPDATE_TASK',
          projectId,
          taskId,
          patch: { status: 'failed', errorMessage },
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.transition.failed', {
            title: task.title,
          }),
        });

        const reworkTask = createTask({
          title: translateProject(lang, 'workflow.task.rework.fixTitle'),
          description: translateProjectWithVars(lang, 'workflow.task.rework.fixDescription', {
            title: task.title,
          }),
          agent: 'Builder',
          dependsOn: [task.id],
          status: 'blocked',
          producesArtifacts: [
            {
              path: 'artifacts/rework-fix.json',
              label: translateProject(lang, 'workflow.artifact.reworkFix'),
              kind: 'json',
            },
          ],
          retryCount,
          maxRetries,
        });
        dispatch({ type: 'ADD_TASK', projectId, task: reworkTask });

        const followUpTask = createTask({
          title:
            task.agent === 'Tester'
              ? translateProject(lang, 'workflow.task.rework.retestTitle')
              : translateProject(lang, 'workflow.task.rework.rereviewTitle'),
          description: translateProjectWithVars(lang, 'workflow.task.rework.retestDescription', {
            title: task.title,
          }),
          agent: task.agent,
          dependsOn: [reworkTask.id],
          status: 'blocked',
          producesArtifacts: task.producesArtifacts,
          retryCount: retryCount + 1,
          maxRetries,
        });
        dispatch({ type: 'ADD_TASK', projectId, task: followUpTask });

        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.retryTriggered', {
            title: task.title,
            retry: retryCount + 1,
            max: maxRetries,
          }),
        });

        if (autoPauseCheckpoints) {
          setSchedulerPaused(projectId, true, false);
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message: translateProjectWithVars(lang, 'workflow.scheduler.checkpoint.failure', {
              title: task.title,
            }),
          });
        }

        rerouteDependencies(project, task.id, followUpTask.id);

        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          agent: 'Builder',
          message: translateProjectWithVars(lang, 'workflow.task.rework.created', {
            from: task.title,
            fix: reworkTask.title,
            retest: followUpTask.title,
          }),
        });

        dispatch({
          type: 'UPDATE_AGENT_STATUS',
          agent: task.agent,
          status: 'idle',
          lastOutput: errorMessage,
        });
      } else {
        dispatch({
          type: 'UPDATE_TASK',
          projectId,
          taskId,
          patch: { status: 'done', errorMessage: undefined },
        });
        dispatch({
          type: 'ADD_LOG',
          level: 'success',
          agent: task.agent,
          message: translateProjectWithVars(lang, 'workflow.task.transition.done', {
            title: task.title,
          }),
        });
        dispatch({
          type: 'UPDATE_AGENT_STATUS',
          agent: task.agent,
          status: 'idle',
          lastOutput: translateProjectWithVars(lang, 'workflow.task.doneSummary', {
            title: task.title,
          }),
        });
      }

      delete taskTimersRef.current[taskId];
    },
    [autoPauseCheckpoints, rerouteDependencies, setSchedulerPaused, translateProject, translateProjectWithVars]
  );

  const startTask = useCallback(
    (project: Project, task: Task) => {
      dispatch({
        type: 'UPDATE_TASK',
        projectId: project.id,
        taskId: task.id,
        patch: { status: 'running', errorMessage: undefined },
      });
      dispatch({
        type: 'UPDATE_AGENT_STATUS',
        agent: task.agent,
        status: 'active',
        lastOutput: task.title,
      });
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        agent: task.agent,
        message: translateProjectWithVars(project.language, 'workflow.task.transition.running', {
          title: task.title,
        }),
      });

      const speed = executionSpeedRef.current;
      const config = SPEED_CONFIG[speed];
      const durationMs =
        config.minTaskMs + Math.round(Math.random() * (config.maxTaskMs - config.minTaskMs));
      taskTimersRef.current[task.id] = setTimeout(() => completeTask(project.id, task.id), durationMs);
    },
    [completeTask, translateProjectWithVars]
  );

  const schedulerTick = useCallback(
    (projectId: string, forceBatch = false) => {
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!project?.taskGraph) return;

      syncTaskAvailability(project);

      const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
      if (!refreshedProject?.taskGraph) return;

      const phase = derivePhaseFromTasks(refreshedProject.tasks);
      const previousPhase = projectPhaseRef.current[projectId];
      if (phase !== previousPhase) {
        projectPhaseRef.current[projectId] = phase;
        dispatch({ type: 'SET_PHASE', phase });
        dispatch({
          type: 'ADD_LOG',
          level: 'info',
          message: translateProjectWithVars(refreshedProject.language, 'workflow.advanceTo', {
            phase: translateProject(refreshedProject.language, `phase.${phase}` as TranslationKey),
          }),
        });
      }

      syncAgentStatusesFromTasks(refreshedProject);

      if (phase === 'complete') {
        const scheduler = schedulerIntervalsRef.current[projectId];
        if (scheduler) {
          clearInterval(scheduler);
          delete schedulerIntervalsRef.current[projectId];
          setSchedulerPaused(projectId, false, false);
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: translateProject(refreshedProject.language, 'workflow.exec.log.complete'),
          });
        }
        return;
      }

      if (schedulerPausedRef.current[projectId] && !forceBatch) {
        return;
      }

      const runningTasks = refreshedProject.tasks.filter((task) => task.status === 'running');
      const readyTasks = refreshedProject.tasks.filter(
        (task) => task.status === 'queued' && dependenciesSatisfied(refreshedProject.tasks, task)
      );
      const blockedTasks = refreshedProject.tasks.filter((task) => task.status === 'blocked');

      if (!schedulerPausedRef.current[projectId] && runningTasks.length === 0 && readyTasks.length === 0 && blockedTasks.length > 0) {
        const blockedDetails: DeadlockTaskDetail[] = blockedTasks.map((task) => {
          const unmetDependencies = task.dependsOn
            .map((dependencyId) => refreshedProject.tasks.find((candidate) => candidate.id === dependencyId))
            .filter((dependency): dependency is Task => Boolean(dependency && dependency.status !== 'done' && dependency.status !== 'failed'))
            .map((dependency) => `${dependency.title} [${dependency.status}]`);
          return {
            taskId: task.id,
            taskTitle: task.title,
            unmetDependencies,
          };
        });

        const deadlockMessage = blockedDetails
          .map((detail) => `${detail.taskTitle} <= ${detail.unmetDependencies.join(', ') || 'unknown dependency'}`)
          .join(' | ');
        const signature = `${projectId}:${deadlockMessage}`;
        if (deadlockSignatureRef.current[projectId] !== signature) {
          deadlockSignatureRef.current[projectId] = signature;
          setDeadlocks((previous) => ({
            ...previous,
            [projectId]: {
              blockedTasks: blockedDetails,
              message: deadlockMessage,
            },
          }));
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: translateProjectWithVars(refreshedProject.language, 'workflow.scheduler.deadlock', {
              details: deadlockMessage,
            }),
          });
        }
        return 0;
      }

      if (deadlocks[projectId]) {
        setDeadlocks((previous) => ({ ...previous, [projectId]: null }));
        delete deadlockSignatureRef.current[projectId];
      }

      const slots = Math.max(0, refreshedProject.taskGraph.concurrencyLimit - runningTasks.length);
      let startedCount = 0;
      for (const task of readyTasks.slice(0, slots)) {
        const checkpointState = checkpointHitRef.current[projectId] ?? {
          approval: false,
          integrator: false,
        };
        if (autoPauseCheckpoints && task.agent === 'Integrator' && !checkpointState.integrator) {
          checkpointHitRef.current[projectId] = {
            ...checkpointState,
            integrator: true,
          };
          setSchedulerPaused(projectId, true, false);
          dispatch({
            type: 'ADD_LOG',
            level: 'warning',
            message: translateProject(refreshedProject.language, 'workflow.scheduler.checkpoint.integrator'),
          });
          break;
        }
        startTask(refreshedProject, task);
        startedCount += 1;
      }

      return startedCount;
    },
    [
      autoPauseCheckpoints,
      derivePhaseFromTasks,
      deadlocks,
      setSchedulerPaused,
      startTask,
      syncAgentStatusesFromTasks,
      syncTaskAvailability,
      translateProject,
      translateProjectWithVars,
    ]
  );

  const generateSimulatedTaskGraph = useCallback(
    (project: Project): TaskGraph => {
      const lang = project.language;
      const maxRetries = 2;
      const statusFor = (dependsOn: string[]): Task['status'] => (dependsOn.length === 0 ? 'queued' : 'blocked');

      const planner = createTask({
        title: translateProject(lang, 'workflow.task.title.planMvp'),
        description: translateProject(lang, 'workflow.task.desc.planMvp'),
        agent: 'Planner',
        dependsOn: [],
        status: 'queued',
        producesArtifacts: [
          { path: 'docs/execution-plan.md', label: translateProject(lang, 'workflow.artifact.executionPlan'), kind: 'doc' },
        ],
      });

      const architect = createTask({
        title: translateProject(lang, 'workflow.task.title.defineArchitecture'),
        description: translateProject(lang, 'workflow.task.desc.defineArchitecture'),
        agent: 'Architect',
        dependsOn: [planner.id],
        status: statusFor([planner.id]),
        producesArtifacts: [
          { path: 'docs/architecture-overview.md', label: translateProject(lang, 'workflow.artifact.architectureOverview'), kind: 'doc' },
        ],
      });

      const buildUi = createTask({
        title: translateProject(lang, 'workflow.task.title.buildUiSkeleton'),
        description: translateProject(lang, 'workflow.task.desc.buildUiSkeleton'),
        agent: 'Builder',
        dependsOn: [architect.id],
        status: statusFor([architect.id]),
        producesArtifacts: [
          { path: 'artifacts/ui-skeleton.json', label: translateProject(lang, 'workflow.artifact.uiSkeleton'), kind: 'json' },
        ],
      });

      const buildEngine = createTask({
        title: translateProject(lang, 'workflow.task.title.buildEngine'),
        description: translateProject(lang, 'workflow.task.desc.buildEngine'),
        agent: 'Builder',
        dependsOn: [architect.id],
        status: statusFor([architect.id]),
        producesArtifacts: [
          {
            path: 'artifacts/orchestration-engine.json',
            label: translateProject(lang, 'workflow.artifact.orchestrationEngine'),
            kind: 'json',
          },
        ],
      });

      const reviewer = createTask({
        title: translateProject(lang, 'workflow.task.title.reviewQuality'),
        description: translateProject(lang, 'workflow.task.desc.reviewQuality'),
        agent: 'Reviewer',
        dependsOn: [buildUi.id, buildEngine.id],
        status: statusFor([buildUi.id, buildEngine.id]),
        producesArtifacts: [
          { path: 'reports/review-notes.md', label: translateProject(lang, 'workflow.artifact.reviewNotes'), kind: 'report' },
        ],
        retryCount: 0,
        maxRetries,
      });

      const tester = createTask({
        title: translateProject(lang, 'workflow.task.title.runQaChecks'),
        description: translateProject(lang, 'workflow.task.desc.runQaChecks'),
        agent: 'Tester',
        dependsOn: [reviewer.id],
        status: statusFor([reviewer.id]),
        producesArtifacts: [
          { path: 'reports/test-results.md', label: translateProject(lang, 'workflow.artifact.testResults'), kind: 'report' },
        ],
        retryCount: 0,
        maxRetries,
      });

      const integrator = createTask({
        title: translateProject(lang, 'workflow.task.title.integrateOutputs'),
        description: translateProject(lang, 'workflow.task.desc.integrateOutputs'),
        agent: 'Integrator',
        dependsOn: [tester.id],
        status: statusFor([tester.id]),
        producesArtifacts: [
          { path: 'release/final-package.zip', label: translateProject(lang, 'workflow.artifact.finalPackage'), kind: 'zip' },
        ],
      });

      const tasks =
        project.outputType === 'app' || project.outputType === 'website'
          ? [planner, architect, buildUi, buildEngine, reviewer, tester, integrator]
          : [planner, architect, buildEngine, reviewer, tester, integrator];

      return {
        tasks,
        concurrencyLimit: 2,
        maxRetries,
      };
    },
    [translateProject]
  );

  const generatePlannerTaskGraph = useCallback(
    async (project: Project): Promise<TaskGraph> => {
      const attemptPlannerRequest = async (strictJsonOnly: boolean) => {
        const plannerResponse = await callAiRespond({
          projectId: project.id,
          language: project.language,
          agentRole: 'Planner',
          inputText: buildPlannerPrompt(project, strictJsonOnly),
          context: {
            projectName: project.name,
            projectDescription: project.description,
            outputType: project.outputType,
          },
        }, { agent: 'Planner' });

        const parsed = plannerTaskGraphSchema.parse(JSON.parse(plannerResponse.text));
        return materializePlannerGraph(parsed);
      };

      try {
        return await attemptPlannerRequest(false);
      } catch {
        return await attemptPlannerRequest(true);
      }
    },
    [buildPlannerPrompt, callAiRespond, materializePlannerGraph]
  );

  const startTaskGraphExecution = useCallback(
    async (project: Project) => {
      const previous = schedulerIntervalsRef.current[project.id];
      if (previous) {
        clearInterval(previous);
      }

      let taskGraph: TaskGraph;
      if (project.simulationMode) {
        taskGraph = generateSimulatedTaskGraph(project);
      } else {
        try {
          taskGraph = await generatePlannerTaskGraph(project);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown planner error';
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            agent: 'Planner',
            message: `OpenAI planner failed, falling back to simulation: ${message}`,
          });
          taskGraph = generateSimulatedTaskGraph(project);
        }
      }

      const normalizedTaskGraph: TaskGraph = {
        ...taskGraph,
        concurrencyLimit: Math.max(2, taskGraph.concurrencyLimit),
      };
      dispatch({ type: 'SET_TASK_GRAPH', projectId: project.id, taskGraph: normalizedTaskGraph });
      checkpointHitRef.current[project.id] = { approval: false, integrator: false };
      dispatch({ type: 'SET_PHASE', phase: 'execution' });
      setSchedulerPaused(project.id, false, false);
      dispatch({
        type: 'ADD_LOG',
        level: 'info',
        message: translateProject(project.language, 'workflow.graph.generated'),
      });
      projectPhaseRef.current[project.id] = 'execution';

      schedulerIntervalsRef.current[project.id] = setInterval(() => {
        schedulerTick(project.id);
      }, SPEED_CONFIG[executionSpeedRef.current].tickMs);
    },
    [
      generatePlannerTaskGraph,
      generateSimulatedTaskGraph,
      schedulerTick,
      setSchedulerPaused,
      translateProject,
    ]
  );

  const approvePlan = useCallback(() => {
    if (!state.activeProject) return;
    const project = state.activeProject;
    dispatch({ type: 'APPROVE_PLAN' });
    setTimeout(() => {
      void startTaskGraphExecution(project);
    }, 0);
  }, [startTaskGraphExecution, state.activeProject]);

  const pauseExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, true, true);
  }, [setSchedulerPaused]);

  const resumeExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, false, true);
    schedulerTick(project.id);
  }, [schedulerTick, setSchedulerPaused]);

  const stopExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;

    const interval = schedulerIntervalsRef.current[project.id];
    if (interval) {
      clearInterval(interval);
      delete schedulerIntervalsRef.current[project.id];
    }

    const stopReason = translateProject(project.language, 'workflow.scheduler.manualStopReason');
    project.tasks.forEach((task) => {
      const taskTimer = taskTimersRef.current[task.id];
      if (taskTimer) {
        clearTimeout(taskTimer);
        delete taskTimersRef.current[task.id];
      }

      if (task.status !== 'done' && task.status !== 'failed') {
        dispatch({
          type: 'UPDATE_TASK',
          projectId: project.id,
          taskId: task.id,
          patch: {
            status: 'failed',
            errorMessage: stopReason,
          },
        });
      }
    });

    setSchedulerPaused(project.id, true, false);
    dispatch({
      type: 'ADD_LOG',
      level: 'warning',
      message: translateProject(project.language, 'workflow.scheduler.stopped'),
    });
    schedulerTick(project.id, true);
  }, [schedulerTick, setSchedulerPaused, translateProject]);

  const stepExecution = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;
    setSchedulerPaused(project.id, true, false);
    const started = schedulerTick(project.id, true) ?? 0;
    dispatch({
      type: 'ADD_LOG',
      level: 'info',
      message: translateProjectWithVars(project.language, 'workflow.scheduler.stepStarted', {
        count: started,
      }),
    });
  }, [schedulerTick, setSchedulerPaused, translateProjectWithVars]);

  const repairDeadlock = useCallback(() => {
    const project = stateRef.current.activeProject;
    if (!project?.taskGraph) return;

    syncTaskAvailability(project, true);
    setDeadlocks((previous) => ({ ...previous, [project.id]: null }));
    delete deadlockSignatureRef.current[project.id];

    dispatch({
      type: 'ADD_LOG',
      level: 'success',
      message: translateProject(project.language, 'workflow.scheduler.repairRan'),
    });

    schedulerTick(project.id, true);
  }, [schedulerTick, syncTaskAvailability, translateProject]);

  const updateAgentStatusFn = useCallback(
    (agent: AgentName, status: AgentStatus, lastOutput?: string) => {
      dispatch({ type: 'UPDATE_AGENT_STATUS', agent, status, lastOutput });
    },
    []
  );

  const addUserMessage = useCallback((content: string, attachmentIds?: string[]) => {
    dispatch({ type: 'ADD_USER_MESSAGE', content, attachmentIds });
  }, []);

  const ingestAttachment = useCallback(
    async (projectId: string, attachment: ProjectAttachment) => {
      try {
        const response = await fetch('/api/attachments/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: attachment.kind,
            title: attachment.title,
            sourceUrl: attachment.sourceUrl,
            downloadUrl: attachment.downloadUrl,
            mimeType: attachment.mimeType,
          }),
        });

        const body = (await response.json()) as { ingest?: AttachmentIngestion; error?: string };
        const ingest = body.ingest;
        if (!response.ok || !ingest) {
          throw new Error(body.error ?? 'Attachment ingestion failed');
        }

        dispatch({
          type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
          projectId,
          attachmentId: attachment.id,
          ingestion: ingest,
        });

        const projectForPersist = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        const client = getFirebaseClient();
        if (projectForPersist && client) {
          await setDoc(
            doc(client.firestore, 'projects', projectId, 'attachments', attachment.id),
            {
              ingestion: {
                ...ingest,
                lastIncludedAt: ingest.lastIncludedAt ? ingest.lastIncludedAt.toISOString() : null,
              },
            },
            { merge: true }
          );
        }

        const projectForLog = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        if (projectForLog) {
          const logKeyByKind: Record<ProjectAttachmentKind, TranslationKey> = {
            url: 'attachments.log.urlParsed',
            pdf: 'attachments.log.pdfParsed',
            image: 'attachments.log.imageIncluded',
            zip: 'attachments.log.zipIndexed',
            file: 'attachments.log.fileUploaded',
          };
          dispatch({
            type: 'ADD_LOG',
            level: ingest.status === 'failed' ? 'warning' : 'info',
            message: translateProjectWithVars(projectForLog.language, logKeyByKind[attachment.kind], {
              title: attachment.title,
            }),
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Ingestion failed';
        dispatch({
          type: 'UPDATE_PROJECT_ATTACHMENT_INGESTION',
          projectId,
          attachmentId: attachment.id,
          ingestion: {
            status: 'failed',
            error: detail,
          },
        });
        const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
        dispatch({
          type: 'ADD_LOG',
          level: 'error',
          message: project
            ? translateProjectWithVars(project.language, 'attachments.log.ingestFailed', {
                title: attachment.title,
                error: detail,
              })
            : `Attachment ingest failed (${attachment.title}): ${detail}`,
        });
      }
    },
    [translateProjectWithVars]
  );

  const attachToProject = useCallback(
    async (projectId: string, attachment: DraftAttachmentInput): Promise<ProjectAttachment> => {
      const createdAt = new Date();
      const artifactId = generateId();
      const source = attachment.source ?? 'message';
      const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);

      if (!project) {
        throw new Error('No active project for attachment upload.');
      }

      if (attachment.kind === 'url') {
        const normalizedUrl = attachment.url.trim();
        const title = normalizedUrl;
        const urlArtifact: ProjectAttachment = {
          id: artifactId,
          projectId,
          kind: 'url',
          source,
          title,
          downloadUrl: normalizedUrl,
          sourceUrl: normalizedUrl,
          ingestion: { status: 'uploaded', summary: 'URL stored, waiting for ingestion.' },
          createdAt,
        };

        const client = getFirebaseClient();
        if (client) {
          try {
            await setDoc(doc(client.firestore, 'projects', projectId, 'attachments', artifactId), {
              ...urlArtifact,
              createdAt: createdAt.toISOString(),
              createdBy: firebaseUid,
            });
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'URL metadata save failed';
            dispatch({
              type: 'ADD_LOG',
              level: 'warning',
              message: `Attachment fallback (URL): ${detail}`,
            });
          }
        }

        dispatch({ type: 'ADD_PROJECT_ATTACHMENT', projectId, attachment: urlArtifact });
        await ingestAttachment(projectId, urlArtifact);
        return urlArtifact;
      }

      const file = attachment.file;
      const derivedKind = detectFileKind(file);
      const safeName = sanitizeFileName(file.name);
      const storagePath = `projects/${projectId}/attachments/${artifactId}/${safeName}`;

      const localFallback = (): ProjectAttachment => {
        const fallbackArtifact: ProjectAttachment = {
          id: artifactId,
          projectId,
          kind: derivedKind,
          source,
          title: file.name,
          mimeType: file.type || undefined,
          size: Number.isFinite(file.size) ? file.size : undefined,
          storagePath,
          downloadUrl: derivedKind === 'image' ? URL.createObjectURL(file) : undefined,
          ingestion: {
            status: 'failed',
            error: 'Server-side ingestion unavailable in local fallback mode.',
          },
          createdAt,
        };
        dispatch({ type: 'ADD_PROJECT_ATTACHMENT', projectId, attachment: fallbackArtifact });
        return fallbackArtifact;
      };

      const client = getFirebaseClient();
      if (!client) {
        return localFallback();
      }

      try {
        const storageRef = ref(client.storage, storagePath);
        await uploadBytes(storageRef, file, {
          contentType: file.type || undefined,
        });
        const downloadUrl = await getDownloadURL(storageRef);

        const uploadedArtifact: ProjectAttachment = {
          id: artifactId,
          projectId,
          kind: derivedKind,
          source,
          title: file.name,
          mimeType: file.type || undefined,
          size: Number.isFinite(file.size) ? file.size : undefined,
          storagePath,
          downloadUrl,
          ingestion: { status: 'uploaded', summary: 'File uploaded, waiting for ingestion.' },
          createdAt,
        };

        await setDoc(doc(client.firestore, 'projects', projectId, 'attachments', artifactId), {
          ...uploadedArtifact,
          createdAt: createdAt.toISOString(),
          createdBy: firebaseUid,
        });

        dispatch({ type: 'ADD_PROJECT_ATTACHMENT', projectId, attachment: uploadedArtifact });
        await ingestAttachment(projectId, uploadedArtifact);
        return uploadedArtifact;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'File upload failed';
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          message: `Attachment fallback (file): ${detail}`,
        });
        return localFallback();
      }
    },
    [firebaseUid, ingestAttachment]
  );

  const addLog = useCallback(
    (message: string, level: LogEntry['level'], agent?: AgentName) => {
      dispatch({ type: 'ADD_LOG', message, level, agent });
    },
    []
  );

  const setProjectSimulationMode = useCallback((projectId: string, simulationMode: boolean) => {
    dispatch({ type: 'SET_PROJECT_SIMULATION_MODE', projectId, simulationMode });
  }, []);
  
  const setProjectDebateRounds = useCallback((projectId: string, debateRounds: number) => {
    dispatch({ type: 'SET_PROJECT_DEBATE_ROUNDS', projectId, debateRounds });
  }, []);

  const clampDebateRounds = useCallback((rounds: number) => Math.min(3, Math.max(1, rounds)), []);

  const formatRoundExcerpts = useCallback(
    (messages: Array<{ agent: AgentName; content: string }>) => {
      if (messages.length === 0) {
        return '';
      }
      return messages
        .map((message) => `${message.agent}: ${message.content.slice(0, 220)}`)
        .join('\n');
    },
    []
  );

  const buildSimulatedRoundMessage = useCallback(
    (
      language: AppLanguage,
      agent: AgentName,
      round: number,
      previousRoundMessages: Array<{ agent: AgentName; content: string }>
    ) => {
      if (language === 'cz') {
        if (round === 1 && agent === 'Strategist') {
          return 'Navrhuji smer: nejdrive dorucit jasne MVP s merenim dopadu, pak rozsireni po validaci. Priorita je rychla hodnota pro uzivatele a stabilni zaklad pro dalsi iterace.';
        }
        if (round === 1 && agent === 'Skeptic') {
          return 'Rizika: nejasny rozsah, podceneni integraci a pozdni overeni kvality. Chci explicitni checkpointy, jasna akceptacni kriteria a omezeni scope creep.';
        }
        if (round === 1 && agent === 'Pragmatist') {
          return 'MVP: jen klicovy tok, minimalni UX polish, jasna metrika uspechu. Prakticke omezeni: kratky cas, omezeny rozpočet a potreba rychle zpetne vazby od uzivatelu.';
        }
        if (round === 2 && agent === 'Strategist') {
          return `Reaguji na Skeptic: "${previousRoundMessages.find((m) => m.agent === 'Skeptic')?.content.slice(0, 70) ?? ''}". Doplnuji rizikove checkpointy a gate po kazdem milniku, aby byl plan kontrolovatelny.`;
        }
        if (round === 2 && agent === 'Skeptic') {
          return `Reaguji na Pragmatist: "${previousRoundMessages.find((m) => m.agent === 'Pragmatist')?.content.slice(0, 70) ?? ''}". Souhlasim s uzkym MVP, ale jen s povinnymi testy a seznamem zavislosti pred realizaci.`;
        }
        if (round === 2 && agent === 'Pragmatist') {
          return `Reaguji na Strategist: "${previousRoundMessages.find((m) => m.agent === 'Strategist')?.content.slice(0, 70) ?? ''}". Plan upravuji na kratke iterace s dorucenim po malych funkcich a rychlym QA.`;
        }
        if (agent === 'Strategist') {
          return 'Finalni plan: 1) potvrdit scope a metriky, 2) postavit zakladni implementaci, 3) provest validaci, 4) dorucit MVP a pripravit iteraci v2.';
        }
        if (agent === 'Skeptic') {
          return 'Top rizika + mitigace: nejasne zadani -> explicitni acceptance criteria; technicky dluh -> code review gate; casovy skluz -> pevne milniky a scope lock pro v1.';
        }
        return 'MVP deliverables + timeline: den 1-2 scope+navrh, den 3-5 implementace, den 6 QA+opravy, den 7 doruceni MVP a seznam navazujicich kroku.';
      }

      if (round === 1 && agent === 'Strategist') {
        return 'Proposed direction: deliver a focused MVP first with measurable outcomes, then expand based on validation. Prioritize fast user value and a stable foundation for iteration.';
      }
      if (round === 1 && agent === 'Skeptic') {
        return 'Key risks: unclear scope, underestimated integrations, and late quality validation. We need explicit checkpoints, acceptance criteria, and controls for scope creep.';
      }
      if (round === 1 && agent === 'Pragmatist') {
        return 'MVP scope: core user flow only, minimal polish, clear success metric. Practical constraints: short timeline, limited resources, and need for rapid feedback.';
      }
      if (round === 2 && agent === 'Strategist') {
        return `Responding to Skeptic: "${previousRoundMessages.find((m) => m.agent === 'Skeptic')?.content.slice(0, 70) ?? ''}". I am adding risk checkpoints and milestone gates so the plan remains controlled.`;
      }
      if (round === 2 && agent === 'Skeptic') {
        return `Responding to Pragmatist: "${previousRoundMessages.find((m) => m.agent === 'Pragmatist')?.content.slice(0, 70) ?? ''}". Narrow MVP is fine, but only with mandatory testing and dependency checks before execution.`;
      }
      if (round === 2 && agent === 'Pragmatist') {
        return `Responding to Strategist: "${previousRoundMessages.find((m) => m.agent === 'Strategist')?.content.slice(0, 70) ?? ''}". I refine execution into short iterations with incremental delivery and quick QA loops.`;
      }
      if (agent === 'Strategist') {
        return 'Final plan: 1) confirm scope and metrics, 2) build core implementation, 3) validate quality and behavior, 4) ship MVP and prepare v2 iteration.';
      }
      if (agent === 'Skeptic') {
        return 'Top risks + mitigations: unclear requirements -> explicit acceptance criteria; technical debt -> review gates; schedule slippage -> fixed milestones and strict v1 scope.';
      }
      return 'MVP deliverables + timeline: day 1-2 scope+design, day 3-5 implementation, day 6 QA+fixes, day 7 MVP release and prioritized follow-ups.';
    },
    []
  );

  const runAutoDebate = useCallback(
    (projectId: string) => {
      if (debateRunsRef.current[projectId]) return;
      debateRunsRef.current[projectId] = true;

      void (async () => {
        try {
          const latestState = stateRef.current;
          const initialProject = latestState.projects.find((candidate) => candidate.id === projectId);
          if (!initialProject || initialProject.status !== 'debating') {
            return;
          }

          const rounds = clampDebateRounds(initialProject.debateRounds);
          const language = initialProject.language;
          const task = initialProject.description;
          const previousSummary = getLatestOrchestratorSummary(initialProject);
          const revisionFeedback = initialProject.latestRevisionFeedback;
          const debateRunRound = initialProject.revisionRound + 1;
          const roundMessages: Array<{ round: number; agent: AgentName; content: string }> = [];
          const debateAgents: AgentName[] = ['Strategist', 'Skeptic', 'Pragmatist'];

          const crossReplyRule =
            language === 'cz'
              ? 'Musis reagovat aspon na jeden konkretni bod od jineho agenta z 1. kola a explicitne uvést jmeno agenta.'
              : 'You must respond to at least one specific point from another agent in round 1 and explicitly name that agent.';

          for (let round = 1; round <= rounds; round += 1) {
            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: translateProjectWithVars(language, 'workflow.debate.round.started', { round }),
            });

            const previousRoundMessages = roundMessages.filter((message) => message.round === round - 1);
            const roundOneMessages = roundMessages.filter((message) => message.round === 1);

            for (const agent of debateAgents) {
              const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
              if (!refreshedProject || refreshedProject.status !== 'debating') {
                return;
              }

              dispatch({ type: 'UPDATE_AGENT_STATUS', agent, status: 'thinking' });

              let content = '';
              if (refreshedProject.simulationMode) {
                content = buildSimulatedRoundMessage(language, agent, round, previousRoundMessages);
              } else {
                const roleInstruction =
                  language === 'cz'
                    ? agent === 'Strategist'
                      ? 'Role: Strategist. Navrhni nejlepsi strategicky pristup.'
                      : agent === 'Skeptic'
                      ? 'Role: Skeptic. Kriticky oponuj predpoklady a rizika.'
                      : 'Role: Pragmatist. Definuj prakticky MVP plan a omezeni.'
                    : agent === 'Strategist'
                    ? 'Role: Strategist. Propose the best strategic approach.'
                    : agent === 'Skeptic'
                    ? 'Role: Skeptic. Critique assumptions and major risks.'
                    : 'Role: Pragmatist. Define practical MVP scope and constraints.';

                const roundInstruction =
                  round === 1
                    ? language === 'cz'
                      ? 'Round 1: pocatecni pozice.'
                      : 'Round 1: initial position.'
                    : round === 2
                    ? `Round 2: ${crossReplyRule}`
                    : language === 'cz'
                    ? agent === 'Strategist'
                      ? 'Round 3: konvergence. Dodaj finalni doporuceny plan krok za krokem.'
                      : agent === 'Skeptic'
                      ? 'Round 3: konvergence. Dodaj top rizika a mitigace.'
                      : 'Round 3: konvergence. Dodaj MVP deliverables a orientacni timeline.'
                    : agent === 'Strategist'
                    ? 'Round 3: convergence. Provide the final recommended step-by-step plan.'
                    : agent === 'Skeptic'
                    ? 'Round 3: convergence. Provide top risks and mitigations.'
                    : 'Round 3: convergence. Provide MVP deliverables and timeline.';

                const prompt = [
                  language === 'cz' ? 'Pis cesky. Bud vecny.' : 'Write in English. Be concise.',
                  roleInstruction,
                  roundInstruction,
                  language === 'cz' ? `Zadani: ${task}` : `Task: ${task}`,
                  previousSummary
                    ? language === 'cz'
                      ? `Predchozi souhrn: ${previousSummary.slice(0, 700)}`
                      : `Previous summary: ${previousSummary.slice(0, 700)}`
                    : '',
                  revisionFeedback
                    ? language === 'cz'
                      ? `Zpetna vazba uzivatele: ${revisionFeedback}`
                      : `User feedback: ${revisionFeedback}`
                    : '',
                  previousRoundMessages.length > 0
                    ? language === 'cz'
                      ? `Vybrane body z predchoziho kola:\n${formatRoundExcerpts(previousRoundMessages)}`
                      : `Selected points from previous round:\n${formatRoundExcerpts(previousRoundMessages)}`
                    : '',
                  round === 2 && roundOneMessages.length > 0
                    ? language === 'cz'
                      ? `Body z 1. kola pro reakci:\n${formatRoundExcerpts(roundOneMessages)}`
                      : `Round 1 points to respond to:\n${formatRoundExcerpts(roundOneMessages)}`
                    : '',
                  language === 'cz'
                    ? `Vystup max ${refreshedProject.maxWordsPerAgent} slov.`
                    : `Output max ${refreshedProject.maxWordsPerAgent} words.`,
                ]
                  .filter(Boolean)
                  .join('\n\n');

                try {
                  const response = await callAiRespond(
                    {
                      projectId,
                      language,
                      agentRole: agent,
                      inputText: prompt,
                      context: {
                        projectName: refreshedProject.name,
                        task,
                        debateRunRound,
                        round,
                        rounds,
                        previousRoundExcerpts: formatRoundExcerpts(previousRoundMessages),
                        roundOneExcerpts: formatRoundExcerpts(roundOneMessages),
                      },
                    },
                    { agent }
                  );
                  content = response.text;
                } catch {
                  content = buildSimulatedRoundMessage(language, agent, round, previousRoundMessages);
                }
              }

              dispatch({ type: 'AGENT_SPEAK', agent, content });
              roundMessages.push({ round, agent, content });
              dispatch({
                type: 'ADD_LOG',
                level: 'success',
                message: translateProjectWithVars(language, 'workflow.debate.agent.roundDone', {
                  agent,
                  round,
                }),
                agent,
              });
            }

            dispatch({
              type: 'ADD_LOG',
              level: 'info',
              message: translateProjectWithVars(language, 'workflow.debate.round.finished', { round }),
            });
          }

          const refreshedProject = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          if (!refreshedProject || refreshedProject.status !== 'debating') {
            return;
          }

          const summaryContext = roundMessages
            .map((message) => `R${message.round} ${message.agent}: ${message.content.slice(0, 280)}`)
            .join('\n');

          let summary = '';
          if (refreshedProject.simulationMode) {
            summary =
              language === 'cz'
                ? [
                    '1) Recommended plan',
                    '- Potvrdit scope a metriky, dorucit MVP v kratkych iteracich, potom rozsireni podle dopadu.',
                    '2) Tradeoffs',
                    '- V1 omezuje rozsah funkcionality, ale zrychluje doruceni a snizuje riziko.',
                    '3) Risks + mitigations',
                    '- Nejasne pozadavky -> acceptance criteria; skluz terminu -> milniky a scope lock; kvalita -> povinne QA gate.',
                    '4) MVP scope',
                    '- Klicovy uzivatelsky tok, zakladni validace, minimalni UX polish.',
                    '5) Next steps',
                    '- Schvalit plan, spustit realizaci, monitorovat metriky a pripravit backlog pro v2.',
                  ].join('\n')
                : [
                    '1) Recommended plan',
                    '- Confirm scope and metrics, deliver MVP in short iterations, then expand based on outcomes.',
                    '2) Tradeoffs',
                    '- v1 limits feature breadth but improves delivery speed and risk control.',
                    '3) Risks + mitigations',
                    '- Unclear requirements -> acceptance criteria; schedule slip -> milestones and scope lock; quality -> mandatory QA gates.',
                    '4) MVP scope',
                    '- Core user flow, baseline validation, and minimal UX polish.',
                    '5) Next steps',
                    '- Approve plan, start execution, monitor metrics, and prepare prioritized v2 backlog.',
                  ].join('\n');
          } else {
            const summaryPrompt = [
              language === 'cz' ? 'Pis cesky.' : 'Write in English.',
              language === 'cz'
                ? 'Vytvor strukturovany vystup v sekcich presne:'
                : 'Generate a structured output with exactly these sections:',
              '1) Recommended plan',
              '2) Tradeoffs',
              '3) Risks + mitigations',
              '4) MVP scope',
              '5) Next steps',
              language === 'cz' ? `Zadani: ${task}` : `Task: ${task}`,
              language === 'cz'
                ? `Vybrane body z debaty:\n${summaryContext}`
                : `Debate excerpts:\n${summaryContext}`,
            ].join('\n\n');

            try {
              const response = await callAiRespond(
                {
                  projectId,
                  language,
                  agentRole: 'Orchestrator',
                  inputText: summaryPrompt,
                  context: {
                    projectName: refreshedProject.name,
                    task,
                    debateRunRound,
                    rounds,
                    revisionFeedback,
                  },
                },
                {}
              );
              summary = response.text;
            } catch {
              summary =
                language === 'cz'
                  ? [
                      '1) Recommended plan',
                      '- Potvrdit scope a metriky, dorucit MVP v kratkych iteracich, potom rozsireni podle dopadu.',
                      '2) Tradeoffs',
                      '- V1 omezuje rozsah funkcionality, ale zrychluje doruceni a snizuje riziko.',
                      '3) Risks + mitigations',
                      '- Nejasne pozadavky -> acceptance criteria; skluz terminu -> milniky a scope lock; kvalita -> povinne QA gate.',
                      '4) MVP scope',
                      '- Klicovy uzivatelsky tok, zakladni validace, minimalni UX polish.',
                      '5) Next steps',
                      '- Schvalit plan, spustit realizaci, monitorovat metriky a pripravit backlog pro v2.',
                    ].join('\n')
                  : [
                      '1) Recommended plan',
                      '- Confirm scope and metrics, deliver MVP in short iterations, then expand based on outcomes.',
                      '2) Tradeoffs',
                      '- v1 limits feature breadth but improves delivery speed and risk control.',
                      '3) Risks + mitigations',
                      '- Unclear requirements -> acceptance criteria; schedule slip -> milestones and scope lock; quality -> mandatory QA gates.',
                      '4) MVP scope',
                      '- Core user flow, baseline validation, and minimal UX polish.',
                      '5) Next steps',
                      '- Approve plan, start execution, monitor metrics, and prepare prioritized v2 backlog.',
                    ].join('\n');
            }
          }

          dispatch({ type: 'ORCHESTRATOR_SUMMARY', content: summary });
          dispatch({ type: 'REQUEST_APPROVAL' });
          dispatch({
            type: 'ADD_LOG',
            level: 'success',
            message: translateProject(language, 'workflow.debate.finishedAwaitingApproval'),
          });
        } catch (error) {
          const project = stateRef.current.projects.find((candidate) => candidate.id === projectId);
          const language = project?.language ?? 'en';
          const message = error instanceof Error ? error.message : 'Unknown debate error';
          dispatch({
            type: 'ADD_LOG',
            level: 'error',
            message: translateProjectWithVars(language, 'workflow.openai.callError', { error: message }),
          });
        } finally {
          debateRunsRef.current[projectId] = false;
        }
      })();
    },
    [
      callAiRespond,
      buildSimulatedRoundMessage,
      clampDebateRounds,
      formatRoundExcerpts,
      translateProject,
      translateProjectWithVars,
    ]
  );

  const rejectPlan = useCallback(
    (feedback: string, attachmentIds?: string[]) => {
      const project = stateRef.current.activeProject;
      if (!project) return;

      if (project.revisionRound >= MAX_REVISION_ROUNDS) {
        dispatch({
          type: 'ADD_LOG',
          level: 'warning',
          message: translateProjectWithVars(project.language, 'workflow.revision.limitReached', {
            max: MAX_REVISION_ROUNDS,
          }),
        });
        return;
      }

      dispatch({ type: 'REJECT_PLAN', feedback, attachmentIds });
      setTimeout(() => runAutoDebate(project.id), 0);
    },
    [runAutoDebate, translateProjectWithVars]
  );

  const reset = useCallback(() => {
    schedulerPausedRef.current = {};
    setPausedSchedulers({});
    checkpointHitRef.current = {};
    deadlockSignatureRef.current = {};
    setDeadlocks({});
    dispatch({ type: 'RESET' });
  }, []);

  const runDemo = useCallback(() => {
    const demoProject = createProject(
      translate(language, 'workflow.demo.projectName'),
      translate(language, 'workflow.demo.projectDescription'),
      language,
      'app'
    );
    dispatch({
      type: 'CREATE_PROJECT',
      name: demoProject.name,
      description: demoProject.description,
      language,
      outputType: demoProject.outputType,
      simulationMode: demoProject.simulationMode,
      debateRounds: demoProject.debateRounds,
      debateMode: demoProject.debateMode,
      maxWordsPerAgent: demoProject.maxWordsPerAgent,
    });

    dispatch({ type: 'START_DEBATE', task: translate(language, 'workflow.demo.task') });
  }, [language]);

  useEffect(() => {
    const project = state.activeProject;
    if (!project || state.currentPhase !== 'debate') return;
    if (project.debateMode === 'auto') {
      runAutoDebate(project.id);
    }
  }, [runAutoDebate, state.activeProject, state.currentPhase]);

  useEffect(() => {
    Object.keys(schedulerIntervalsRef.current).forEach((projectId) => {
      const currentInterval = schedulerIntervalsRef.current[projectId];
      if (currentInterval) {
        clearInterval(currentInterval);
      }
      schedulerIntervalsRef.current[projectId] = setInterval(() => {
        schedulerTick(projectId);
      }, SPEED_CONFIG[executionSpeed].tickMs);
    });
  }, [executionSpeed, schedulerTick]);

  useEffect(() => {
    if (!autoPauseCheckpoints) return;
    const project = state.activeProject;
    if (!project) return;
    const checkpointState = checkpointHitRef.current[project.id] ?? {
      approval: false,
      integrator: false,
    };
    if (state.currentPhase === 'awaiting-approval' && !checkpointState.approval) {
      checkpointHitRef.current[project.id] = {
        ...checkpointState,
        approval: true,
      };
      setSchedulerPaused(project.id, true, false);
      dispatch({
        type: 'ADD_LOG',
        level: 'warning',
        message: translateProject(project.language, 'workflow.scheduler.checkpoint.approval'),
      });
    }
  }, [autoPauseCheckpoints, setSchedulerPaused, state.activeProject, state.currentPhase, translateProject]);

  useEffect(() => {
    const project = state.activeProject;
    if (!project?.taskGraph) return;
    syncTaskAvailability(project);
  }, [state.activeProject?.id, state.activeProject?.updatedAt, syncTaskAvailability]);

  const schedulerState = useMemo(() => {
    const project = state.activeProject;
    const taskGraph = project?.taskGraph;
    const runningTasks = project?.tasks.filter((task) => task.status === 'running').length ?? 0;
    const done = project?.tasks.filter((task) => task.status === 'done').length ?? 0;
    const queued = project?.tasks.filter((task) => task.status === 'queued').length ?? 0;
    const blocked = project?.tasks.filter((task) => task.status === 'blocked').length ?? 0;
    const failed = project?.tasks.filter((task) => task.status === 'failed').length ?? 0;
    const total = project?.tasks.length ?? 0;
    const isComplete = total > 0 && done + failed === total;
    return {
      isPaused: project ? Boolean(pausedSchedulers[project.id]) : false,
      isComplete,
      concurrencyLimit: taskGraph?.concurrencyLimit ?? 0,
      total,
      done,
      runningTasks,
      queued,
      blocked,
      failed,
      retryLimit: taskGraph?.maxRetries ?? 0,
      executionSpeed,
      autoPauseCheckpoints,
      deadlock: project ? deadlocks[project.id] ?? null : null,
    };
  }, [autoPauseCheckpoints, deadlocks, executionSpeed, pausedSchedulers, state.activeProject]);

  useEffect(() => {
    return () => {
      Object.values(schedulerIntervalsRef.current).forEach((interval) => clearInterval(interval));
      Object.values(taskTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const value: AppContextValue = {
    state,
    firebaseUid,
    language,
    setLanguage,
    t,
    tf,
    createProject: createProjectFn,
    selectProject,
    startDebate,
    agentSpeak,
    orchestratorSummary,
    requestApproval,
    approvePlan,
    rejectPlan,
    updateAgentStatus: updateAgentStatusFn,
    addUserMessage,
    attachToProject,
    addLog,
    setProjectSimulationMode,
    setProjectDebateRounds,
    schedulerState,
    setExecutionSpeed,
    setAutoPauseCheckpoints,
    repairDeadlock,
    pauseExecution,
    resumeExecution,
    stopExecution,
    stepExecution,
    reset,
    runDemo,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
