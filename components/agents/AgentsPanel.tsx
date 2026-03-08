'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { AgentCard } from './AgentCard';
import { WorkflowPhase } from '@/types';

const phaseLabels: Record<WorkflowPhase, string> = {
  idle: 'Idle',
  debate: 'Debate',
  summary: 'Summary',
  'awaiting-approval': 'Approval',
  execution: 'Execution',
  review: 'Review',
  testing: 'Testing',
  integration: 'Integration',
  complete: 'Complete',
};

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
  const { state } = useApp();
  const { agents, currentPhase } = state;

  const debateAgents = agents.filter((a) => a.phase === 'debate');
  const executionAgents = agents.filter((a) => a.phase === 'execution');
  const reviewAgents = agents.filter(
    (a) => a.phase === 'review' || a.phase === 'testing' || a.phase === 'integration'
  );

  const currentPhaseIdx = phaseOrder.indexOf(currentPhase);

  return (
    <div className="h-full flex flex-col bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-200">Agents</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Phase:{' '}
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
                    : 'bg-gray-800 text-gray-600'
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
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2 px-1">
            Debate
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
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>

        {/* Execution group */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2 px-1">
            Execution
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
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>

        {/* Review / QA group */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2 px-1">
            Review & QA
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
                isActive={agent.status === 'thinking' || agent.status === 'active'}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
