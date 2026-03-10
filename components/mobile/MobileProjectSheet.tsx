'use client';

import React from 'react';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';

interface MobileProjectSheetProps {
  onProjectActivated?: () => void;
}

export function MobileProjectSheet({ onProjectActivated }: MobileProjectSheetProps) {
  return <ProjectSidebar mode="mobile" onProjectActivated={onProjectActivated} />;
}