'use client';

import React, { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { AgentCard } from './AgentCard';
import { WorkflowPhase } from '@/types';

const phaseOrder: WorkflowPhase[] = [
  'idle',
  'debate',
  'awaiting-approval',
  'execution',
  'review',
  'testing',
  'integration',
  'complete',
];

export function AgentsPanel() {
  const { state, t } = useApp();
  const { agents, currentPhase } = state;
  const tasks = useMemo(
    () => state.activeProject?.taskGraph?.tasks ?? state.activeProject?.tasks ?? [],
    [state.activeProject]
  );

  const activeTaskByAgent = useMemo(() => {
    const mapping: Partial<Record<(typeof agents)[number]['name'], string>> = {};
    tasks.forEach((task) => {
      if (task.status === 'running') {
        mapping[task.agent] = task.title;
      }
    });
    return mapping;
  }, [tasks]);

  const debateAgents = agents.filter((a) => a.phase === 'debate');
  const executionAgents = agents.filter((a) => a.phase === 'execution');
  const reviewAgents = agents.filter(
    (a) => a.phase === 'review' || a.phase === 'testing' || a.phase === 'integration'
  );

  const currentPhaseIdx = phaseOrder.indexOf(currentPhase);

  const phaseLabels: Record<WorkflowPhase, string> = {
    idle: t('phase.idle'),
    debate: t('phase.debate'),
    summary: t('phase.summary'),
    'awaiting-approval': t('phase.awaiting-approval'),
    execution: t('phase.execution'),
    review: t('phase.review'),
    testing: t('phase.testing'),
    integration: t('phase.integration'),
    complete: t('phase.complete'),
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-100">{t('agents.title')}</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {t('agents.phase')}:{' '}
          <span className="text-blue-400 font-medium">
            {phaseLabels[currentPhase]}
          </span>
        </p>
      </div>

      {/* Workflow progress */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800/50">
        <div className="flex items-center gap-1 flex-wrap">
          {phaseOrder.filter((p) => p !== 'idle' && p !== 'summary').map((phase) => {
            const actualIdx = phaseOrder.indexOf(phase);
            const isDone = actualIdx < currentPhaseIdx;
            const isCurrent = phase === currentPhase;
            return (
              <span
                key={phase}
                className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  isCurrent
                    ? 'bg-blue-600 text-white'
                    : isDone
                    ? 'bg-green-900/50 text-green-400'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {phaseLabels[phase]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Debate group */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
            {t('agents.group.debate')}
          </p>
          <div className="space-y-2">
            {debateAgents.map((agent) => (
              <AgentCard
                key={agent.name}
                name={agent.name}
                role={agent.role}
                status={agent.status}
                lastOutput={agent.lastOutput}
                description={agent.description}
                activeTaskTitle={activeTaskByAgent[agent.name] ?? null}
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>

        {/* Execution group */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
            {t('agents.group.execution')}
          </p>
          <div className="space-y-2">
            {executionAgents.map((agent) => (
              <AgentCard
                key={agent.name}
                name={agent.name}
                role={agent.role}
                status={agent.status}
                lastOutput={agent.lastOutput}
                description={agent.description}
                activeTaskTitle={activeTaskByAgent[agent.name] ?? null}
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>

        {/* Review / QA group */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
            {t('agents.group.review')}
          </p>
          <div className="space-y-2">
            {reviewAgents.map((agent) => (
              <AgentCard
                key={agent.name}
                name={agent.name}
                role={agent.role}
                status={agent.status}
                lastOutput={agent.lastOutput}
                description={agent.description}
                activeTaskTitle={activeTaskByAgent[agent.name] ?? null}
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
