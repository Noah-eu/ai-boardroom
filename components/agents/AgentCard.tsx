'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { AgentName, AgentStatus } from '@/types';

interface AgentCardProps {
  name: AgentName;
  role: string;
  status: AgentStatus;
  lastOutput: string | null;
  description: string;
  isActive?: boolean;
  activeTaskTitle?: string | null;
  compact?: boolean;
}

const statusConfig: Record<AgentStatus, { labelKey: 'agent.status.idle' | 'agent.status.active' | 'agent.status.thinking' | 'agent.status.error'; dotClass: string; badgeClass: string }> = {
  idle: {
    labelKey: 'agent.status.idle',
    dotClass: 'bg-gray-500',
    badgeClass: 'bg-gray-800 text-gray-300 border border-gray-700',
  },
  active: {
    labelKey: 'agent.status.active',
    dotClass: 'bg-green-500',
    badgeClass: 'bg-green-950 text-green-300 border border-green-800',
  },
  thinking: {
    labelKey: 'agent.status.thinking',
    dotClass: 'bg-yellow-400 animate-pulse',
    badgeClass: 'bg-yellow-950 text-yellow-300 border border-yellow-800',
  },
  error: {
    labelKey: 'agent.status.error',
    dotClass: 'bg-red-500',
    badgeClass: 'bg-red-950 text-red-300 border border-red-800',
  },
};

const phaseConfig: Record<string, { color: string }> = {
  Strategist: { color: 'from-indigo-900/30 to-indigo-950/60 border-indigo-800/40' },
  Skeptic: { color: 'from-orange-900/30 to-orange-950/60 border-orange-800/40' },
  Pragmatist: { color: 'from-teal-900/30 to-teal-950/60 border-teal-800/40' },
  Planner: { color: 'from-blue-900/30 to-blue-950/60 border-blue-800/40' },
  Architect: { color: 'from-violet-900/30 to-violet-950/60 border-violet-800/40' },
  Builder: { color: 'from-emerald-900/30 to-emerald-950/60 border-emerald-800/40' },
  Reviewer: { color: 'from-sky-900/30 to-sky-950/60 border-sky-800/40' },
  Tester: { color: 'from-pink-900/30 to-pink-950/60 border-pink-800/40' },
  Integrator: { color: 'from-amber-900/30 to-amber-950/60 border-amber-800/40' },
};

const agentInitials: Record<AgentName, string> = {
  Strategist: 'ST',
  Skeptic: 'SK',
  Pragmatist: 'PR',
  Planner: 'PL',
  Architect: 'AR',
  Builder: 'BU',
  Reviewer: 'RE',
  Tester: 'TE',
  Integrator: 'IN',
};

export function AgentCard({
  name,
  role,
  status,
  lastOutput,
  description,
  isActive = false,
  activeTaskTitle = null,
  compact = true,
}: AgentCardProps) {
  const { t } = useApp();
  const cfg = statusConfig[status];
  const colors = phaseConfig[name] ?? { color: 'from-gray-900/30 to-gray-950/60 border-gray-800/40' };

  return (
    <div
      className={`
        ${compact ? 'rounded-lg p-3' : 'rounded-xl p-4'} border bg-gradient-to-b transition-all duration-200
        ${colors.color}
        ${isActive ? 'ring-1 ring-blue-500/50 shadow-md shadow-blue-500/10' : ''}
      `}
    >
      {/* Header */}
      <div className={`${compact ? 'mb-2 gap-2' : 'mb-3 gap-3'} flex items-center`}>
        <div className={`flex flex-shrink-0 items-center justify-center border border-gray-700 bg-gray-800 ${compact ? 'h-8 w-8 rounded-md' : 'h-10 w-10 rounded-lg'}`}>
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-gray-300`}>{agentInitials[name]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
            <span className={`truncate ${compact ? 'text-sm' : 'text-base'} font-semibold text-gray-100`}>{name}</span>
            <span className={`inline-flex items-center gap-1 font-medium ${cfg.badgeClass} ${compact ? 'rounded px-1.5 py-0.5 text-[10px]' : 'rounded-lg px-2 py-1 text-xs'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
              {t(cfg.labelKey)}
            </span>
          </div>
          <p className={`truncate ${compact ? 'text-[11px]' : 'text-sm'} text-gray-300`}>{role}</p>
        </div>
      </div>

      {/* Last output */}
      <div className="mt-1">
        {status === 'active' && activeTaskTitle && (
          <p className={`${compact ? 'mb-1 text-[10px]' : 'mb-2 text-xs'} text-blue-200`}>
            {t('agent.activeTask')}: <span className="text-blue-100">{activeTaskTitle}</span>
          </p>
        )}
        {lastOutput ? (
          <p className={`line-clamp-2 ${compact ? 'text-[11px]' : 'text-sm'} leading-relaxed text-gray-300`}>
            {lastOutput}
          </p>
        ) : (
          <p className={`${compact ? 'text-[11px]' : 'text-sm'} italic text-gray-400`}>{description}</p>
        )}
      </div>

      {/* Thinking indicator */}
      {status === 'thinking' && (
        <div className={`${compact ? 'mt-2 gap-1' : 'mt-3 gap-2'} flex items-center`}>
          <div className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`${compact ? 'h-1 w-1' : 'h-1.5 w-1.5'} rounded-full bg-yellow-400 animate-bounce`}
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
          <span className={`ml-1 ${compact ? 'text-[10px]' : 'text-xs'} text-yellow-400/70`}>{t('agent.processing')}</span>
        </div>
      )}
    </div>
  );
}
