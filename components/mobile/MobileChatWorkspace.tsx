'use client';

import React from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';

export function MobileChatWorkspace() {
  return (
    <div className="h-full bg-gray-950">
      <ChatPanel mode="mobile" />
    </div>
  );
}