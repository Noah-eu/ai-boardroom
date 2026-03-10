'use client';

import React from 'react';
import { PreviewPanel } from '@/components/layout/PreviewPanel';

export function MobilePreviewWorkspace() {
  return (
    <div className="h-full bg-gray-950">
      <PreviewPanel mode="mobile" />
    </div>
  );
}