'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { ProjectStatus } from '@/types';

const statusConfig: Record<ProjectStatus, { label: string; color: string; dot: string }> = {
  idle: { label: 'Idle', color: 'text-gray-400', dot: 'bg-gray-500' },
  debating: { label: 'Debating', color: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse' },
  'awaiting-approval': { label: 'Needs Review', color: 'text-orange-400', dot: 'bg-orange-400 animate-pulse' },
  executing: { label: 'Executing', color: 'text-blue-400', dot: 'bg-blue-400 animate-pulse' },
  reviewing: { label: 'Reviewing', color: 'text-sky-400', dot: 'bg-sky-400 animate-pulse' },
  testing: { label: 'Testing', color: 'text-pink-400', dot: 'bg-pink-400 animate-pulse' },
  integrating: { label: 'Integrating', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  complete: { label: 'Complete', color: 'text-green-400', dot: 'bg-green-400' },
  failed: { label: 'Failed', color: 'text-red-400', dot: 'bg-red-500' },
};

interface NewProjectFormProps {
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
}

function NewProjectForm({ onSubmit, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), description.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-3 mb-3 bg-gray-900 rounded-lg border border-gray-700 p-3">
      <p className="text-xs font-semibold text-gray-300 mb-2">New Project</p>
      <input
        type="text"
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 mb-2"
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="w-full resize-none bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 mb-2"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded transition-colors"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProjectSidebar() {
  const { state, createProject, selectProject, runDemo } = useApp();
  const [showForm, setShowForm] = useState(false);

  const handleCreate = (name: string, description: string) => {
    createProject(name, description);
    setShowForm(false);
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 border-r border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <h1 className="text-sm font-bold text-gray-100">AI Boardroom</h1>
        </div>
        <p className="text-[10px] text-gray-500">Multi-agent orchestration</p>
      </div>

      {/* Projects label + new button */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
          Projects
        </span>
        <button
          onClick={() => setShowForm(true)}
          title="New project"
          className="w-5 h-5 rounded flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-sm"
        >
          +
        </button>
      </div>

      {/* New project form */}
      {showForm && (
        <NewProjectForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {state.projects.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-gray-600 mb-3">No projects yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
            >
              Create first project
            </button>
          </div>
        ) : (
          <div className="py-1">
            {state.projects.map((project) => {
              const isSelected = project.id === state.selectedProjectId;
              const sCfg = statusConfig[project.status];
              return (
                <button
                  key={project.id}
                  onClick={() => selectProject(project.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 border-r-2 border-blue-500'
                      : 'hover:bg-gray-800/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sCfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-medium truncate ${
                          isSelected ? 'text-blue-300' : 'text-gray-300'
                        }`}
                      >
                        {project.name}
                      </p>
                      <p className={`text-[10px] mt-0.5 ${sCfg.color}`}>{sCfg.label}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Demo button */}
      <div className="flex-shrink-0 p-3 border-t border-gray-800">
        <button
          onClick={runDemo}
          className="w-full px-3 py-2 bg-purple-800/40 hover:bg-purple-700/50 border border-purple-700/40 text-purple-300 text-xs font-medium rounded-lg transition-colors"
        >
          ▶ Run Demo
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-1">Simulate a workflow</p>
      </div>
    </div>
  );
}
