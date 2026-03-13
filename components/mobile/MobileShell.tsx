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
        className="relative mt-auto flex max-h-[98dvh] w-full flex-col overflow-hidden rounded-t-[2.25rem] border border-gray-800 bg-gray-950 shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="flex flex-shrink-0 items-center gap-5 border-b border-gray-800 px-6 pb-5 pt-6"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <div className="h-2.5 w-14 rounded-full bg-gray-700" />
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-16 min-w-16 rounded-full border border-gray-700 bg-gray-900 px-5 text-lg font-medium text-gray-200"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">{children}</div>
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
        <div className="px-6 pb-6" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveSheet('projects')}
              className="min-h-16 rounded-full border border-gray-700 bg-gray-900 px-5 text-base font-medium text-gray-100"
            >
              {t('sidebar.projects')}
            </button>

            <div className="min-w-0 flex-1 px-1">
              <p className="text-sm uppercase tracking-[0.2em] text-gray-500">
                {activeProject ? t('mobile.activeProject') : t('mobile.noProjectSelected')}
              </p>
              <h1 className="truncate text-lg font-semibold text-gray-100">
                {activeProject?.name ?? 'AI Boardroom'}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => setActiveSheet('agents')}
              className="min-h-16 rounded-full border border-gray-700 bg-gray-900 px-5 text-base font-medium text-gray-100"
            >
              {t('agents.title')}
            </button>
            <button
              type="button"
              onClick={() => setActiveSheet('settings')}
              className="min-h-16 rounded-full border border-gray-700 bg-gray-900 px-5 text-base font-medium text-gray-100"
            >
              {t('mobile.settings')}
            </button>
          </div>

          <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
            <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-5 py-3 text-base text-gray-200">
              {t('statusBar.phase')}: {phaseLabel}
            </span>
            <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-5 py-3 text-base text-gray-200">
              {t('mobile.status')}: {statusLabel}
            </span>
            {taskSummary.total > 0 && (
              <span className="whitespace-nowrap rounded-full border border-gray-700 bg-gray-900 px-5 py-3 text-base text-gray-200">
                {taskSummary.done}/{taskSummary.total} {t('preview.tasks')}
              </span>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
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
                  className={`min-h-16 rounded-[1.4rem] border px-5 py-4 text-lg font-medium transition-colors ${
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
          <div className="h-full overflow-y-auto px-6 py-6 text-gray-100" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="rounded-[1.75rem] border border-gray-800 bg-gray-900/70 p-6">
              <p className="mb-5 text-base font-semibold uppercase tracking-[0.2em] text-gray-400">
                {t('projectForm.language')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`min-h-16 rounded-[1.4rem] border text-lg font-medium ${
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
                  className={`min-h-16 rounded-[1.4rem] border text-lg font-medium ${
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
              <div className="mt-6 rounded-[1.75rem] border border-gray-800 bg-gray-900/70 p-6">
                <p className="mb-2 text-base font-semibold uppercase tracking-[0.2em] text-gray-400">
                  {t('projectForm.debateRounds')}
                </p>
                <p className="mb-5 text-base text-gray-500">{activeProject.name}</p>
                <div className="grid grid-cols-3 gap-4">
                  {[1, 2, 3].map((round) => (
                    <button
                      key={round}
                      type="button"
                      onClick={() => setProjectDebateRounds(activeProject.id, round)}
                      className={`min-h-16 rounded-[1.4rem] border text-lg font-medium ${
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