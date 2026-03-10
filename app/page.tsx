'use client';

import { useEffect, useRef, useState } from 'react';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ExecutionLog } from '@/components/layout/ExecutionLog';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { TopStatusBar } from '@/components/layout/TopStatusBar';
import { MobileShell } from '@/components/mobile/MobileShell';

export default function DashboardPage() {
  const MIN_TOP_HEIGHT = 260;
  const MIN_BOTTOM_HEIGHT = 170;
  const MIN_PREVIEW_WIDTH = 320;
  const MIN_LOG_WIDTH = 360;
  const [bottomHeight, setBottomHeight] = useState(192);
  const [previewWidth, setPreviewWidth] = useState(384);
  const [resizeAxis, setResizeAxis] = useState<'vertical' | 'horizontal' | null>(null);
  const bottomPanelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resizeAxis) return;

    const onPointerMove = (event: PointerEvent) => {
      if (resizeAxis === 'vertical') {
        const viewportHeight = window.innerHeight;
        const maxBottomHeight = viewportHeight - MIN_TOP_HEIGHT - 8;
        const nextBottomHeight = viewportHeight - event.clientY;
        const clamped = Math.max(MIN_BOTTOM_HEIGHT, Math.min(maxBottomHeight, nextBottomHeight));
        setBottomHeight(clamped);
        return;
      }

      const container = bottomPanelsRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const maxPreviewWidth = Math.max(MIN_PREVIEW_WIDTH, rect.width - MIN_LOG_WIDTH - 8);
      const nextPreviewWidth = rect.right - event.clientX;
      const clamped = Math.max(MIN_PREVIEW_WIDTH, Math.min(maxPreviewWidth, nextPreviewWidth));
      setPreviewWidth(clamped);
    };

    const onPointerUp = () => {
      setResizeAxis(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = resizeAxis === 'vertical' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [resizeAxis]);

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
            onPointerDown={() => setResizeAxis('vertical')}
            className="h-2 flex-shrink-0 cursor-row-resize bg-gray-900 hover:bg-blue-900/40 border-t border-b border-gray-800 transition-colors"
          >
            <div className="m-auto h-0.5 w-16 rounded bg-gray-700" />
          </div>

          <div
            ref={bottomPanelsRef}
            className="flex-shrink-0 flex overflow-hidden border-t border-gray-800"
            style={{ height: `${bottomHeight}px` }}
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              <ExecutionLog />
            </div>
            <div
              role="separator"
              aria-label="Resize logs and preview panels"
              aria-orientation="vertical"
              onPointerDown={() => setResizeAxis('horizontal')}
              className="group flex w-2 flex-shrink-0 cursor-col-resize items-center justify-center bg-gray-900 hover:bg-blue-900/30 transition-colors"
            >
              <div className="h-16 w-0.5 rounded bg-gray-700 group-hover:bg-blue-500" />
            </div>
            <div className="flex-shrink-0 overflow-hidden border-l border-gray-800" style={{ width: `${previewWidth}px` }}>
              <PreviewPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile dashboard with single active panel */}
      <MobileShell />
    </div>
  );
}
