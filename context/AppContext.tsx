'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useReducer,
} from 'react';
import {
  Agent,
  AgentName,
  AgentStatus,
  LogEntry,
  Message,
  OrchestratorState,
  Project,
  WorkflowPhase,
} from '@/types';
import {
  createInitialState,
  createLogEntry,
  createMessage,
  createProject,
  DEFAULT_AGENTS,
  generateId,
  getNextPhase,
  PHASE_AGENTS,
  updateAgentStatus,
} from '@/orchestrator';

// Action types
type Action =
  | { type: 'CREATE_PROJECT'; name: string; description: string }
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'START_DEBATE'; task: string }
  | { type: 'AGENT_SPEAK'; agent: AgentName; content: string }
  | { type: 'ORCHESTRATOR_SUMMARY'; content: string }
  | { type: 'REQUEST_APPROVAL' }
  | { type: 'APPROVE_PLAN' }
  | { type: 'REJECT_PLAN' }
  | { type: 'ADVANCE_PHASE' }
  | { type: 'UPDATE_AGENT_STATUS'; agent: AgentName; status: AgentStatus; lastOutput?: string }
  | { type: 'ADD_USER_MESSAGE'; content: string }
  | { type: 'ADD_LOG'; message: string; level: LogEntry['level']; agent?: AgentName }
  | { type: 'RESET' };

interface AppState extends OrchestratorState {
  projects: Project[];
  selectedProjectId: string | null;
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CREATE_PROJECT': {
      const project = createProject(action.name, action.description);
      return {
        ...state,
        projects: [...state.projects, project],
        selectedProjectId: project.id,
        activeProject: project,
        currentPhase: 'idle',
        agents: DEFAULT_AGENTS.map((a) => ({ ...a })),
        executionLog: [
          createLogEntry(`Project "${project.name}" created`, 'success'),
        ],
      };
    }

    case 'SELECT_PROJECT': {
      const project = state.projects.find((p) => p.id === action.projectId) ?? null;
      return {
        ...state,
        selectedProjectId: action.projectId,
        activeProject: project,
        currentPhase: project?.status === 'complete' ? 'complete' : 'idle',
      };
    }

    case 'START_DEBATE': {
      if (!state.activeProject) return state;
      const welcomeMsg = createMessage(
        'orchestrator',
        `Starting debate phase for task: "${action.task}". Debate agents are now analyzing the requirements.`,
        'system'
      );
      const log = createLogEntry('Debate phase initiated', 'info');
      const phaseAgents = PHASE_AGENTS['debate'];
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (phaseAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        messages: [
          ...state.activeProject.messages,
          createMessage('user', action.task),
          welcomeMsg,
        ],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'AGENT_SPEAK': {
      if (!state.activeProject) return state;
      const agentInfo = state.agents.find((a) => a.name === action.agent);
      const msg = createMessage(action.agent, action.content, 'chat', agentInfo?.role);
      const log = createLogEntry(
        `${action.agent} contributed to the discussion`,
        'info',
        action.agent
      );
      const updatedAgents = updateAgentStatus(
        state.agents,
        action.agent,
        'idle',
        action.content
      );
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'ORCHESTRATOR_SUMMARY': {
      if (!state.activeProject) return state;
      const msg = createMessage('orchestrator', action.content, 'system');
      const log = createLogEntry('Orchestrator generated debate summary', 'info');
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
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REQUEST_APPROVAL': {
      if (!state.activeProject) return state;
      const msg = createMessage(
        'orchestrator',
        'The debate has concluded. Please review the proposed solution above and approve or reject it.',
        'approval-request'
      );
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
      const msg = createMessage('user', 'Approved. Proceed with execution.', 'approval-response');
      const log = createLogEntry('User approved the plan. Starting execution phase.', 'success');
      const execAgents = PHASE_AGENTS['execution'];
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (execAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'executing',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'execution',
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'REJECT_PLAN': {
      if (!state.activeProject) return state;
      const msg = createMessage(
        'user',
        'Plan rejected. Please revise the approach.',
        'approval-response'
      );
      const log = createLogEntry('User rejected the plan. Returning to debate phase.', 'warning');
      const debateAgents = PHASE_AGENTS['debate'];
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (debateAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const updatedProject: Project = {
        ...state.activeProject,
        status: 'debating',
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        currentPhase: 'debate',
        agents: updatedAgents,
        activeProject: updatedProject,
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
        executionLog: [...state.executionLog, log],
      };
    }

    case 'ADVANCE_PHASE': {
      if (!state.activeProject) return state;
      const nextPhase = getNextPhase(state.currentPhase);
      const phaseAgents = PHASE_AGENTS[nextPhase] || [];
      const updatedAgents = state.agents.map((agent) => ({
        ...agent,
        status: (phaseAgents.includes(agent.name) ? 'thinking' : 'idle') as AgentStatus,
      }));
      const log = createLogEntry(`Advancing to ${nextPhase} phase`, 'info');
      return {
        ...state,
        currentPhase: nextPhase,
        agents: updatedAgents,
        executionLog: [...state.executionLog, log],
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
      const msg = createMessage('user', action.content);
      const updatedProject: Project = {
        ...state.activeProject,
        messages: [...state.activeProject.messages, msg],
        updatedAt: new Date(),
      };
      return {
        ...state,
        activeProject: updatedProject,
        projects: state.projects.map((p) =>
          p.id === updatedProject.id ? updatedProject : p
        ),
      };
    }

    case 'ADD_LOG': {
      const log = createLogEntry(action.message, action.level, action.agent);
      return {
        ...state,
        executionLog: [...state.executionLog, log],
      };
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
  createProject: (name: string, description: string) => void;
  selectProject: (id: string) => void;
  startDebate: (task: string) => void;
  agentSpeak: (agent: AgentName, content: string) => void;
  orchestratorSummary: (content: string) => void;
  requestApproval: () => void;
  approvePlan: () => void;
  rejectPlan: () => void;
  advancePhase: () => void;
  updateAgentStatus: (agent: AgentName, status: AgentStatus, lastOutput?: string) => void;
  addUserMessage: (content: string) => void;
  addLog: (message: string, level: LogEntry['level'], agent?: AgentName) => void;
  reset: () => void;
  // Demo helper
  runDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialAppState);

  const createProjectFn = useCallback((name: string, description: string) => {
    dispatch({ type: 'CREATE_PROJECT', name, description });
  }, []);

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

  const approvePlan = useCallback(() => {
    dispatch({ type: 'APPROVE_PLAN' });
  }, []);

  const rejectPlan = useCallback(() => {
    dispatch({ type: 'REJECT_PLAN' });
  }, []);

  const advancePhase = useCallback(() => {
    dispatch({ type: 'ADVANCE_PHASE' });
  }, []);

  const updateAgentStatusFn = useCallback(
    (agent: AgentName, status: AgentStatus, lastOutput?: string) => {
      dispatch({ type: 'UPDATE_AGENT_STATUS', agent, status, lastOutput });
    },
    []
  );

  const addUserMessage = useCallback((content: string) => {
    dispatch({ type: 'ADD_USER_MESSAGE', content });
  }, []);

  const addLog = useCallback(
    (message: string, level: LogEntry['level'], agent?: AgentName) => {
      dispatch({ type: 'ADD_LOG', message, level, agent });
    },
    []
  );

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Demo simulation: runs a full workflow on a sample project
  const runDemo = useCallback(() => {
    const demoProject = createProject('Build a Todo App', 'Create a simple todo list application with CRUD operations and local storage persistence.');
    dispatch({ type: 'CREATE_PROJECT', name: demoProject.name, description: demoProject.description });

    let delay = 300;
    const schedule = (fn: () => void, ms: number) => {
      delay += ms;
      setTimeout(fn, delay);
    };

    schedule(() => {
      dispatch({ type: 'START_DEBATE', task: 'Build a Todo App with CRUD operations and local storage persistence.' });
    }, 500);

    schedule(() => {
      dispatch({ type: 'AGENT_SPEAK', agent: 'Strategist', content: 'We should build a clean, component-based React application. The core goal is rapid value delivery with a scalable foundation. I recommend using React hooks for state management and localStorage for persistence.' });
    }, 1500);

    schedule(() => {
      dispatch({ type: 'UPDATE_AGENT_STATUS', agent: 'Skeptic', status: 'thinking' });
    }, 500);

    schedule(() => {
      dispatch({ type: 'AGENT_SPEAK', agent: 'Skeptic', content: 'I challenge the assumption that localStorage is sufficient. What happens when the user clears browser data? We should consider IndexedDB or a backend service. Also, are we handling concurrent edits?' });
    }, 2000);

    schedule(() => {
      dispatch({ type: 'UPDATE_AGENT_STATUS', agent: 'Pragmatist', status: 'thinking' });
    }, 500);

    schedule(() => {
      dispatch({ type: 'AGENT_SPEAK', agent: 'Pragmatist', content: 'For an MVP, localStorage is a reasonable tradeoff. We can abstract the storage layer behind an interface so it\'s swappable later. Let\'s ship fast and iterate. Concurrent editing is out of scope for v1.' });
    }, 2000);

    schedule(() => {
      dispatch({ type: 'ORCHESTRATOR_SUMMARY', content: '**Debate Summary:** The team agrees on a React-based todo application. Key decisions: (1) Use localStorage for MVP persistence with an abstracted storage interface for future flexibility. (2) Component-based architecture with React hooks. (3) Concurrent editing deferred to v2. The approach is pragmatic and delivers quick value.' });
    }, 1000);

    schedule(() => {
      dispatch({ type: 'REQUEST_APPROVAL' });
    }, 800);
  }, []);

  const value: AppContextValue = {
    state,
    createProject: createProjectFn,
    selectProject,
    startDebate,
    agentSpeak,
    orchestratorSummary,
    requestApproval,
    approvePlan,
    rejectPlan,
    advancePhase,
    updateAgentStatus: updateAgentStatusFn,
    addUserMessage,
    addLog,
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
