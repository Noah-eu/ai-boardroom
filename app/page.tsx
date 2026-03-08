'use client';

import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ExecutionLog } from '@/components/layout/ExecutionLog';
import { PreviewPanel } from '@/components/layout/PreviewPanel';

export default function DashboardPage() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
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

      {/* Bottom area – Execution log + Preview */}
      <div className="h-48 flex-shrink-0 flex overflow-hidden border-t border-gray-800">
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
