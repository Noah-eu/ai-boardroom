'use client';

import React, { useMemo, useState } from 'react';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ExecutionLog } from '@/components/layout/ExecutionLog';
import { MobileChatWorkspace } from '@/components/mobile/MobileChatWorkspace';
import { MobilePreviewWorkspace } from '@/components/mobile/MobilePreviewWorkspace';
import { MobileProjectSheet } from '@/components/mobile/MobileProjectSheet';
import { useApp } from '@/context/AppContext';

type MobileTab = 'chat' | 'output' | 'activity';
type MobileSheet = 'projects' | 'agents' | 'settings' | null;

interface MobileSheetFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function MobileSheetFrame({ title, onClose, children }: MobileSheetFrameProps) {
  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      <button type="button" aria-label={title} className="absolute inset-0" onClick={onClose} />
      <div
        className="relative mt-auto flex max-h-[96vh] w-full flex-col overflow-hidden rounded-t-[2rem] border border-gray-800 bg-gray-950 shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="flex items-center gap-4 border-b border-gray-800 px-5 pb-4 pt-5"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <div className="h-2 w-12 rounded-full bg-gray-700" />
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-14 min-w-14 rounded-full border border-gray-700 bg-gray-900 px-4 text-base font-medium text-gray-200"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

export function MobileShell() {
  const { state, t, language, setLanguage, setProjectDebateRounds } = useApp();
  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [activeSheet, setActiveSheet] = useState<MobileSheet>(null);
  const activeProject = state.activeProject;

  const taskSummary = useMemo(() => {
    const tasks = activeProject?.taskGraph?.tasks ?? activeProject?.tasks ?? [];
    const done = tasks.filter((task) => task.status === 'done' || task.status === 'completed_with_fallback').length;
    return { done, total: tasks.length };
  }, [activeProject]);

  const statusLabel = activeProject
    ? t(`status.project.${activeProject.status}` as const)
    : t('mobile.noProjectSelected');
  const phaseLabel = t(`phase.${state.currentPhase}` as const);

  return (
    <div className="flex h-full flex-col bg-gray-950 lg:hidden">
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950/95 backdrop-blur">
        <div className="px-5 pb-5" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveSheet('projects')}
              className="min-h-14 rounded-full border border-gray-700 bg-gray-900 px-4 text-sm font-medium text-gray-100"
            >
              {t('sidebar.projects')}
            </button>

            <div className="min-w-0 flex-1 px-1">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">
                {activeProject ? t('mobile.activeProject') : t('mobile.noProjectSelected')}
              </p>
              <h1 className="truncate text-base font-semibold text-gray-100">
                {activeProject?.name ?? 'AI Boardroom'}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => setActiveSheet('agents')}
              className="min-h-14 rounded-full border border-gray-700 bg-gray-900 px-4 text-sm font-medium text-gray-100"
            >
              {t('agents.title')}
            </button>
            <button
              type="button"
              onClick={() => setActiveSheet('settings')}
              className="min-h-14 rounded-full border border-gray-700 bg-gray-900 px-4 text-sm font-medium text-gray-100"
            >
              {t('mobile.settings')}
            </button>
          </div>

          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200">
              {t('statusBar.phase')}: {phaseLabel}
            </span>
            <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200">
              {t('mobile.status')}: {statusLabel}
            </span>
            {taskSummary.total > 0 && (
              <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200">
                {taskSummary.done}/{taskSummary.total} {t('preview.tasks')}
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {([
              { id: 'chat', label: t('mobile.chat') },
              { id: 'output', label: t('mobile.output') },
              { id: 'activity', label: t('mobile.activity') },
            ] as const).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-14 rounded-2xl border px-4 py-3 text-base font-medium transition-colors ${
                    isActive
                      ? 'border-blue-600/70 bg-blue-900/50 text-blue-100'
                      : 'border-gray-800 bg-gray-900 text-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'chat' && <MobileChatWorkspace />}
        {activeTab === 'output' && <MobilePreviewWorkspace />}
        {activeTab === 'activity' && <ExecutionLog mode="mobile" />}
      </main>

      {activeSheet === 'projects' && (
        <MobileSheetFrame title={t('mobile.projectsSheetTitle')} onClose={() => setActiveSheet(null)}>
          <MobileProjectSheet onProjectActivated={() => setActiveSheet(null)} />
        </MobileSheetFrame>
      )}

      {activeSheet === 'agents' && (
        <MobileSheetFrame title={t('mobile.agentsSheetTitle')} onClose={() => setActiveSheet(null)}>
          <AgentsPanel mode="mobile" />
        </MobileSheetFrame>
      )}

      {activeSheet === 'settings' && (
        <MobileSheetFrame title={t('mobile.settingsSheetTitle')} onClose={() => setActiveSheet(null)}>
          <div className="h-full overflow-y-auto px-5 py-5 text-gray-100" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="rounded-[1.5rem] border border-gray-800 bg-gray-900/70 p-5">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">
                {t('projectForm.language')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`min-h-14 rounded-2xl border text-base font-medium ${
                    language === 'en'
                      ? 'border-blue-600 bg-blue-900/40 text-blue-100'
                      : 'border-gray-700 bg-gray-950 text-gray-300'
                  }`}
                >
                  {t('lang.en')}
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('cz')}
                  className={`min-h-14 rounded-2xl border text-base font-medium ${
                    language === 'cz'
                      ? 'border-blue-600 bg-blue-900/40 text-blue-100'
                      : 'border-gray-700 bg-gray-950 text-gray-300'
                  }`}
                >
                  {t('lang.cz')}
                </button>
              </div>
            </div>

            {activeProject && (
              <div className="mt-5 rounded-[1.5rem] border border-gray-800 bg-gray-900/70 p-5">
                <p className="mb-1 text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">
                  {t('projectForm.debateRounds')}
                </p>
                <p className="mb-4 text-sm text-gray-500">{activeProject.name}</p>
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((round) => (
                    <button
                      key={round}
                      type="button"
                      onClick={() => setProjectDebateRounds(activeProject.id, round)}
                      className={`min-h-14 rounded-2xl border text-base font-medium ${
                        activeProject.debateRounds === round
                          ? 'border-blue-600 bg-blue-900/40 text-blue-100'
                          : 'border-gray-700 bg-gray-950 text-gray-300'
                      }`}
                    >
                      {round}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </MobileSheetFrame>
      )}
    </div>
  );
}