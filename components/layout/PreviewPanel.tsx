'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';

export function PreviewPanel() {
  const { state } = useApp();
  const project = state.activeProject;

  const hasArtifacts = project?.tasks.some((t) => t.artifactRef);
  const doneTasksCount = project?.tasks.filter((t) => t.status === 'done').length ?? 0;
  const totalTasksCount = project?.tasks.length ?? 0;

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-950 border-t border-gray-800 text-center px-6">
        <div className="text-2xl mb-2">🖼</div>
        <p className="text-xs text-gray-600">Artifacts &amp; previews will appear here</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-950 border-t border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-300">Preview</h3>
        {totalTasksCount > 0 && (
          <span className="text-[10px] text-gray-600 ml-auto">
            {doneTasksCount}/{totalTasksCount} tasks
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!hasArtifacts && totalTasksCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-2xl mb-2">⏳</div>
            <p className="text-xs text-gray-600">
              {state.currentPhase === 'execution' || state.currentPhase === 'review' || state.currentPhase === 'testing'
                ? 'Generating artifacts...'
                : 'Artifacts will appear after execution'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {project.tasks.map((task) => (
              <div
                key={task.id}
                className="bg-gray-900 rounded border border-gray-800 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    task.status === 'done'
                      ? 'bg-green-900/50 text-green-400'
                      : task.status === 'running'
                      ? 'bg-blue-900/50 text-blue-400'
                      : task.status === 'failed'
                      ? 'bg-red-900/50 text-red-400'
                      : 'bg-gray-800 text-gray-500'
                  }`}>
                    {task.status}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{task.description}</span>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">{task.assignedAgent}</span>
                </div>
                {task.artifactRef && (
                  <p className="mt-1 text-[10px] text-blue-400 font-mono truncate">
                    → {task.artifactRef}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
