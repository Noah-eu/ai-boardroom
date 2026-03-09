'use client';

import React, { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { translate, TranslationKey } from '@/i18n';

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function TopStatusBar() {
  const { state, language, schedulerState, pauseExecution, resumeExecution, stopExecution } = useApp();
  const project = state.activeProject;
  const projectLanguage = project?.language ?? language;
  const t = (key: string) => translate(projectLanguage, key as TranslationKey);

  const usage = project?.usage;
  const isSimulated = Boolean(project?.simulationMode);
  const activeModel = usage?.activeModel ?? t('statusBar.modelUnknown');
  const displayTokens = useMemo(() => {
    if (isSimulated || !usage) {
      return { input: 0, output: 0, total: 0, projectCost: 0, sessionCost: 0 };
    }
    return {
      input: usage.totals.inputTokens,
      output: usage.totals.outputTokens,
      total: usage.totals.totalTokens,
      projectCost: usage.estimatedProjectCostUsd,
      sessionCost: usage.sessionCostUsd,
    };
  }, [isSimulated, usage]);

  if (!project) {
    return null;
  }

  return (
    <>
      <div className="hidden lg:flex items-center gap-2 border-b border-gray-800 bg-gray-950/95 px-3 py-2 text-[11px] text-gray-200">
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100">
          {t('statusBar.project')}: {project.name}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1">
          {t('statusBar.phase')}: {t(`phase.${state.currentPhase}` as const)}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1">
          {t('statusBar.mode')}: {isSimulated ? t('statusBar.mode.simulation') : t('statusBar.mode.live')}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1">
          {t('statusBar.model')}: {activeModel}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1">
          {t('statusBar.tokens')}: {formatTokens(displayTokens.input)} / {formatTokens(displayTokens.output)} / {formatTokens(displayTokens.total)}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-emerald-200">
          {t('statusBar.projectCost')}: {formatUsd(displayTokens.projectCost)}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-cyan-200">
          {t('statusBar.sessionCost')}: {formatUsd(displayTokens.sessionCost)}
        </span>
        {isSimulated && (
          <span className="rounded border border-emerald-700/60 bg-emerald-900/40 px-2 py-1 text-emerald-200">
            {t('statusBar.simulatedBadge')}
          </span>
        )}
        {project.taskGraph && (
          <>
            <button
              type="button"
              onClick={schedulerState.isPaused ? resumeExecution : pauseExecution}
              disabled={schedulerState.isComplete}
              className="ml-auto rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200 hover:border-blue-600/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {schedulerState.isPaused ? t('preview.resume') : t('preview.pause')}
            </button>
            <button
              type="button"
              onClick={stopExecution}
              disabled={schedulerState.isComplete}
              className="rounded border border-red-700/60 bg-red-900/30 px-2 py-1 text-red-100 hover:bg-red-800/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('statusBar.stop')}
            </button>
          </>
        )}
      </div>

      <div className="lg:hidden border-b border-gray-800 bg-gray-950/95 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-gray-200">
          <span className="truncate font-semibold text-gray-100">{project.name}</span>
          <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px]">
            {t(`phase.${state.currentPhase}` as const)}
          </span>
          <span className="ml-auto rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-emerald-200">
            {formatUsd(displayTokens.projectCost)}
          </span>
        </div>

        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-gray-300 select-none">
            {t('statusBar.mobileDetails')}
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-1.5 rounded border border-gray-800 bg-gray-900/60 p-2 text-[10px] text-gray-200">
            <p>{t('statusBar.mode')}: {isSimulated ? t('statusBar.mode.simulation') : t('statusBar.mode.live')}</p>
            <p>{t('statusBar.model')}: {activeModel}</p>
            <p>
              {t('statusBar.tokens')}: {formatTokens(displayTokens.input)} / {formatTokens(displayTokens.output)} / {formatTokens(displayTokens.total)}
            </p>
            <p>{t('statusBar.projectCost')}: {formatUsd(displayTokens.projectCost)}</p>
            <p>{t('statusBar.sessionCost')}: {formatUsd(displayTokens.sessionCost)}</p>
            {isSimulated && (
              <span className="inline-flex w-fit rounded border border-emerald-700/60 bg-emerald-900/40 px-1.5 py-0.5 text-emerald-200">
                {t('statusBar.simulatedBadge')}
              </span>
            )}
            {project.taskGraph && (
              <div className="mt-1 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={schedulerState.isPaused ? resumeExecution : pauseExecution}
                  disabled={schedulerState.isComplete}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {schedulerState.isPaused ? t('preview.resume') : t('preview.pause')}
                </button>
                <button
                  type="button"
                  onClick={stopExecution}
                  disabled={schedulerState.isComplete}
                  className="rounded border border-red-700/60 bg-red-900/30 px-2 py-1 text-[10px] text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('statusBar.stop')}
                </button>
              </div>
            )}
          </div>
        </details>
      </div>
    </>
  );
}
