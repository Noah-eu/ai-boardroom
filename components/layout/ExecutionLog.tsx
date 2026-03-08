'use client';

import React, { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { LogLevel } from '@/types';

const levelConfig: Record<LogLevel, { icon: string; color: string; bg: string }> = {
  info: { icon: 'ℹ', color: 'text-blue-400', bg: '' },
  success: { icon: '✓', color: 'text-green-400', bg: '' },
  warning: { icon: '⚠', color: 'text-yellow-400', bg: '' },
  error: { icon: '✗', color: 'text-red-400', bg: '' },
};

function formatTimestamp(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ExecutionLog() {
  const { state } = useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.executionLog]);

  return (
    <div className="h-full flex flex-col bg-gray-950 border-t border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="text-xs font-semibold text-gray-300">Execution Log</h3>
        </div>
        <span className="text-[10px] text-gray-600 ml-auto">
          {state.executionLog.length} entries
        </span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto px-4 py-1 font-mono">
        {state.executionLog.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-700">No log entries yet</p>
          </div>
        ) : (
          state.executionLog.map((entry) => {
            const cfg = levelConfig[entry.level];
            return (
              <div key={entry.id} className="flex items-start gap-2 py-0.5 group">
                <span className="text-[10px] text-gray-700 flex-shrink-0 tabular-nums">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className={`text-[10px] flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                {entry.agent && (
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    [{entry.agent}]
                  </span>
                )}
                <span className="text-[10px] text-gray-400 leading-relaxed">{entry.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
