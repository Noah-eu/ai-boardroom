'use client';

import { useEffect, useState } from 'react';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ExecutionLog } from '@/components/layout/ExecutionLog';
import { PreviewPanel } from '@/components/layout/PreviewPanel';

export default function DashboardPage() {
  const MIN_TOP_HEIGHT = 260;
  const MIN_BOTTOM_HEIGHT = 170;
  const [bottomHeight, setBottomHeight] = useState(192);
  const [isResizing, setIsResizing] = useState(false);

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
      {/* Main content area */}
      <div className="flex overflow-hidden" style={{ height: `calc(100% - ${bottomHeight + 8}px)` }}>
        {/* Left Sidebar – Project list */}
        <aside className="w-56 flex-shrink-0 flex flex-col overflow-hidden">
          <ProjectSidebar />
        </aside>

        {/* Center Panel – Chat window */}
        <main className="flex-1 flex flex-col overflow-hidden border-x border-gray-800">
          {/* Top chat area */}
          <div className="flex-1 overflow-hidden">
            <ChatPanel />
          </div>
        </main>

        {/* Right Panel – Agent cards */}
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

      {/* Bottom area – Execution log + Preview */}
      <div className="flex-shrink-0 flex overflow-hidden border-t border-gray-800" style={{ height: `${bottomHeight}px` }}>
        {/* Execution log spans 2/3 */}
        <div className="flex-1 overflow-hidden">
          <ExecutionLog />
        </div>
        {/* Preview panel spans 1/3 */}
        <div className="w-80 flex-shrink-0 overflow-hidden border-l border-gray-800">
          <PreviewPanel />
        </div>
      </div>
    </div>
  );
}
