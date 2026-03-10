'use client';

import React, { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { translate } from '@/i18n';
import { LogLevel } from '@/types';

const levelConfig: Record<
  LogLevel,
  { icon: string; badgeClass: string; rowClass: string; messageClass: string }
> = {
  info: {
    icon: 'INFO',
    badgeClass: 'bg-blue-900/70 text-blue-200 border border-blue-700/60',
    rowClass: 'bg-blue-950/20 border-blue-900/40',
    messageClass: 'text-blue-100',
  },
  success: {
    icon: 'DONE',
    badgeClass: 'bg-green-900/70 text-green-200 border border-green-700/60',
    rowClass: 'bg-green-950/20 border-green-900/40',
    messageClass: 'text-green-100',
  },
  warning: {
    icon: 'WARN',
    badgeClass: 'bg-yellow-900/70 text-yellow-100 border border-yellow-700/60',
    rowClass: 'bg-yellow-950/20 border-yellow-900/40',
    messageClass: 'text-yellow-100',
  },
  error: {
    icon: 'ERR',
    badgeClass: 'bg-red-900/70 text-red-100 border border-red-700/60',
    rowClass: 'bg-red-950/20 border-red-900/40',
    messageClass: 'text-red-100',
  },
};

function formatTimestamp(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface ExecutionLogProps {
  mode?: 'desktop' | 'mobile';
}

export function ExecutionLog({ mode = 'desktop' }: ExecutionLogProps) {
  const { state, language } = useApp();
  const projectLanguage = state.activeProject?.language ?? language;
  const t = (key: Parameters<typeof translate>[1]) => translate(projectLanguage, key);
  const endRef = useRef<HTMLDivElement>(null);
  const isMobile = mode === 'mobile';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.executionLog]);

  return (
    <div className={`h-full flex flex-col bg-gray-950 ${isMobile ? '' : 'border-t border-gray-800'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center gap-3 border-b border-gray-700 bg-gray-900/70 ${isMobile ? 'px-5 py-4' : 'px-4 py-2'}`}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className={`${isMobile ? 'text-sm' : 'text-xs'} font-semibold tracking-wide text-gray-100`}>{t('log.title')}</h3>
        </div>
        <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} ml-auto font-medium text-gray-300`}>
          {state.executionLog.length} {t('log.entries')}
        </span>
      </div>

      {/* Log entries */}
      <div className={`flex-1 overflow-y-auto font-mono ${isMobile ? 'px-4 py-4' : 'px-3 py-2'}`}>
        {state.executionLog.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className={`${isMobile ? 'text-sm' : 'text-xs'} text-gray-400`}>{t('log.empty')}</p>
          </div>
        ) : (
          state.executionLog.map((entry) => {
            const cfg = levelConfig[entry.level];
            return (
              <div
                key={entry.id}
                className={`mb-2 grid ${isMobile ? 'grid-cols-[84px_60px_minmax(0,1fr)] gap-3 rounded-xl px-3 py-3' : 'grid-cols-[72px_52px_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5'} items-start border ${cfg.rowClass}`}
              >
                <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} flex-shrink-0 tabular-nums text-gray-200`}>
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className={`inline-flex justify-center rounded px-1.5 py-1 ${isMobile ? 'text-[10px]' : 'text-[9px]'} font-semibold ${cfg.badgeClass}`}>
                  {cfg.icon}
                </span>
                <div className="min-w-0">
                  {entry.agent && (
                    <span className={`mb-1 inline-block rounded border border-cyan-800/50 bg-cyan-950/40 px-2 py-1 ${isMobile ? 'text-xs' : 'text-[10px]'} text-cyan-200`}>
                      {entry.agent}
                    </span>
                  )}
                  <p className={`${isMobile ? 'text-sm' : 'text-[11px]'} break-words leading-relaxed ${cfg.messageClass}`}>
                    {entry.message}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
