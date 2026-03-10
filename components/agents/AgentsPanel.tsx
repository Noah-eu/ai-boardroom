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

interface AgentsPanelProps {
  mode?: 'desktop' | 'mobile';
}

export function AgentsPanel({ mode = 'desktop' }: AgentsPanelProps) {
  const { state, t } = useApp();
  const { agents, currentPhase } = state;
  const isMobile = mode === 'mobile';
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
    <div className={`h-full flex flex-col bg-gray-950 ${isMobile ? '' : 'border-l border-gray-800'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 border-b border-gray-800 ${isMobile ? 'px-5 py-4' : 'px-4 py-3'}`}>
        <h2 className={`${isMobile ? 'text-base' : 'text-sm'} font-semibold text-gray-100`}>{t('agents.title')}</h2>
        <p className={`${isMobile ? 'mt-1 text-sm' : 'mt-0.5 text-xs'} text-gray-400`}>
          {t('agents.phase')}:{' '}
          <span className="text-blue-400 font-medium">
            {phaseLabels[currentPhase]}
          </span>
        </p>
      </div>

      {/* Workflow progress */}
      <div className={`flex-shrink-0 border-b border-gray-800/50 ${isMobile ? 'px-5 py-3' : 'px-4 py-2'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {phaseOrder.filter((p) => p !== 'idle' && p !== 'summary').map((phase) => {
            const actualIdx = phaseOrder.indexOf(phase);
            const isDone = actualIdx < currentPhaseIdx;
            const isCurrent = phase === currentPhase;
            return (
              <span
                key={phase}
                className={`${isMobile ? 'text-xs px-2 py-1 rounded-lg' : 'text-[9px] px-1.5 py-0.5 rounded'} font-medium ${
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
      <div className={`flex-1 overflow-y-auto space-y-5 ${isMobile ? 'px-4 py-4' : 'px-3 py-3'}`}>
        {/* Debate group */}
        <div>
          <p className={`${isMobile ? 'mb-3 text-xs' : 'mb-2 text-[10px]'} px-1 font-semibold uppercase tracking-widest text-gray-400`}>
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
                compact={!isMobile}
              />
            ))}
          </div>
        </div>

        {/* Execution group */}
        <div>
          <p className={`${isMobile ? 'mb-3 text-xs' : 'mb-2 text-[10px]'} px-1 font-semibold uppercase tracking-widest text-gray-400`}>
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
                compact={!isMobile}
              />
            ))}
          </div>
        </div>

        {/* Review / QA group */}
        <div>
          <p className={`${isMobile ? 'mb-3 text-xs' : 'mb-2 text-[10px]'} px-1 font-semibold uppercase tracking-widest text-gray-400`}>
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
                compact={!isMobile}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
