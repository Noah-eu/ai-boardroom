'use client';

import { useEffect, useState } from 'react';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ExecutionLog } from '@/components/layout/ExecutionLog';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { TopStatusBar } from '@/components/layout/TopStatusBar';
import { useApp } from '@/context/AppContext';

type MobileTab = 'chat' | 'agents' | 'log' | 'preview' | 'projects';

export default function DashboardPage() {
  const MIN_TOP_HEIGHT = 260;
  const MIN_BOTTOM_HEIGHT = 170;
  const { state, language, setLanguage, setProjectDebateRounds, t } = useApp();
  const [bottomHeight, setBottomHeight] = useState(192);
  const [isResizing, setIsResizing] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('chat');
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const activeProject = state.activeProject;

  useEffect(() => {
    if (!isResizing) return;

    const onPointerMove = (event: PointerEvent) => {
      const viewportHeight = window.innerHeight;
      const maxBottomHeight = viewportHeight - MIN_TOP_HEIGHT - 8;
      const nextBottomHeight = viewportHeight - event.clientY;
      const clamped = Math.max(MIN_BOTTOM_HEIGHT, Math.min(maxBottomHeight, nextBottomHeight));
      setBottomHeight(clamped);
    };

    const onPointerUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isResizing]);

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Desktop dashboard keeps original layout unchanged */}
      <div className="hidden h-full lg:flex lg:flex-col">
        <TopStatusBar />
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex overflow-hidden" style={{ height: `calc(100% - ${bottomHeight + 8}px)` }}>
            <aside className="w-56 flex-shrink-0 flex flex-col overflow-hidden">
              <ProjectSidebar />
            </aside>

            <main className="flex-1 flex flex-col overflow-hidden border-x border-gray-800">
              <div className="flex-1 overflow-hidden">
                <ChatPanel />
              </div>
            </main>

            <aside className="w-64 flex-shrink-0 flex flex-col overflow-hidden">
              <AgentsPanel />
            </aside>
          </div>

          <div
            role="separator"
            aria-label="Resize workspace and output panels"
            aria-orientation="horizontal"
            onPointerDown={() => setIsResizing(true)}
            className="h-2 flex-shrink-0 cursor-row-resize bg-gray-900 hover:bg-blue-900/40 border-t border-b border-gray-800 transition-colors"
          >
            <div className="m-auto h-0.5 w-16 rounded bg-gray-700" />
          </div>

          <div className="flex-shrink-0 flex overflow-hidden border-t border-gray-800" style={{ height: `${bottomHeight}px` }}>
            <div className="flex-1 overflow-hidden">
              <ExecutionLog />
            </div>
            <div className="w-80 flex-shrink-0 overflow-hidden border-l border-gray-800">
              <PreviewPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile dashboard with single active panel */}
      <div className="flex h-full flex-col lg:hidden">
        <header className="flex min-h-14 items-center justify-between border-b border-gray-800 px-4 py-2">
          <h1 className="text-base font-semibold text-gray-100">AI Boardroom</h1>
          <button
            type="button"
            onClick={() => setShowMobileSettings((value) => !value)}
            className="min-h-11 rounded-lg border border-gray-700 bg-gray-900 px-3 text-sm font-medium text-gray-200"
          >
            {t('preview.more')}
          </button>
        </header>

        <TopStatusBar />

        {showMobileSettings && (
          <div className="border-b border-gray-800 bg-gray-900/80 px-4 py-3">
            <div className="grid gap-3">
              <div>
                <p className="mb-1 text-xs text-gray-300">{t('projectForm.language')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLanguage('en')}
                    className={`min-h-11 rounded-lg border text-sm ${
                      language === 'en'
                        ? 'border-blue-600 bg-blue-900/40 text-blue-200'
                        : 'border-gray-700 bg-gray-950 text-gray-200'
                    }`}
                  >
                    {t('lang.en')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage('cz')}
                    className={`min-h-11 rounded-lg border text-sm ${
                      language === 'cz'
                        ? 'border-blue-600 bg-blue-900/40 text-blue-200'
                        : 'border-gray-700 bg-gray-950 text-gray-200'
                    }`}
                  >
                    {t('lang.cz')}
                  </button>
                </div>
              </div>

              {activeProject && (
                <>
                  <div>
                    <p className="mb-1 text-xs text-gray-300">{t('projectForm.debateRounds')}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3].map((round) => (
                        <button
                          key={round}
                          type="button"
                          onClick={() => setProjectDebateRounds(activeProject.id, round)}
                          className={`min-h-11 rounded-lg border text-sm ${
                            activeProject.debateRounds === round
                              ? 'border-blue-600 bg-blue-900/40 text-blue-200'
                              : 'border-gray-700 bg-gray-950 text-gray-200'
                          }`}
                        >
                          {round}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden pb-16">
          {activeMobileTab === 'chat' && <ChatPanel />}
          {activeMobileTab === 'agents' && <AgentsPanel />}
          {activeMobileTab === 'log' && <ExecutionLog />}
          {activeMobileTab === 'preview' && <PreviewPanel />}
          {activeMobileTab === 'projects' && <ProjectSidebar />}
        </main>

        <nav className="absolute inset-x-0 bottom-0 border-t border-gray-800 bg-gray-950/95 backdrop-blur">
          <div className="grid grid-cols-5 gap-1 px-2 py-2">
            {[
              { id: 'chat', label: 'Chat' },
              { id: 'agents', label: 'Agents' },
              { id: 'log', label: 'Log' },
              { id: 'preview', label: 'Preview' },
              { id: 'projects', label: 'Projects' },
            ].map((tab) => {
              const isActive = activeMobileTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveMobileTab(tab.id as MobileTab)}
                  className={`min-h-11 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-900/50 text-blue-200 border border-blue-700/60'
                      : 'text-gray-300 border border-transparent hover:bg-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
