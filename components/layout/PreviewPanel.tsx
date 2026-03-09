'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { translate, translateWithVars } from '@/i18n';
import { ProjectAttachment, Task, TaskStatus } from '@/types';

function formatAttachmentSize(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildImageAiStatusKeys(attachment: ProjectAttachment): Array<Parameters<typeof translate>[1]> {
  const keys: Array<Parameters<typeof translate>[1]> = ['attachments.aiStatus.uploaded'];
  if (attachment.ingestion?.linkedToAi || attachment.ingestion?.includedInContext) {
    keys.push('attachments.aiStatus.linked');
  }
  if (attachment.ingestion?.analyzedAt || attachment.ingestion?.lastIncludedAt) {
    keys.push('attachments.aiStatus.analyzed');
  }
  return keys;
}

function buildAttachmentStatusChips(
  attachment: ProjectAttachment,
  t: ReturnType<typeof useApp>['t'],
  tf: ReturnType<typeof useApp>['tf']
): string[] {
  const chips: string[] = [];
  chips.push(t(`attachments.status.${attachment.ingestion?.status ?? 'uploaded'}` as Parameters<typeof translate>[1]));

  const ingestion = attachment.ingestion;
  const isIngested = Boolean(
    ingestion?.extractedText || ingestion?.excerpt || ingestion?.zipFileTree || ingestion?.pageTitle
  );
  if (isIngested) {
    chips.push(t('attachments.status.ingested'));
  }
  if (ingestion?.queuedForNextRound) {
    chips.push(t('attachments.status.queuedNextRound'));
  }
  if (typeof ingestion?.includedInRound === 'number' && ingestion.includedInRound > 0) {
    chips.push(tf('attachments.status.includedRound', { round: ingestion.includedInRound }));
  }

  return chips;
}

export function PreviewPanel() {
  const {
    state,
    language,
    schedulerState,
    pauseExecution,
    resumeExecution,
    stepExecution,
    setExecutionSpeed,
    setAutoPauseCheckpoints,
    repairDeadlock,
  } = useApp();
  const project = state.activeProject;
  const projectLanguage = project?.language ?? language;
  const t = useCallback(
    (key: Parameters<typeof translate>[1]) => translate(projectLanguage, key),
    [projectLanguage]
  );
  const tf = useCallback(
    (key: Parameters<typeof translate>[1], vars: Record<string, string | number>) =>
      translateWithVars(projectLanguage, key, vars),
    [projectLanguage]
  );
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const tasks = useMemo(() => project?.taskGraph?.tasks ?? project?.tasks ?? [], [project]);
  const hasArtifacts = tasks.some((task) => task.producesArtifacts.length > 0);
  const doneTasksCount = tasks.filter((task) => task.status === 'done').length;
  const totalTasksCount = tasks.length;
  const isComplete = state.currentPhase === 'complete' || project?.status === 'complete';
  const debateSummary = useMemo(() => {
    if (!project) return '';
    const summaryMessage = [...project.messages]
      .reverse()
      .find((message) => message.sender === 'orchestrator' && message.type === 'system');
    return summaryMessage?.content ?? t('preview.noDebateSummary');
  }, [project, t]);
  const artifactItems = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'done' || task.status === 'failed')
        .flatMap((task) =>
          task.producesArtifacts.map((artifact) => ({
            taskId: task.id,
            taskTitle: task.title,
            ...artifact,
          }))
        ),
    [tasks]
  );
  const projectAttachments = useMemo<ProjectAttachment[]>(() => project?.attachments ?? [], [project]);
  const groupedAttachments = useMemo(() => {
    const projectLevel = projectAttachments.filter((attachment) => (attachment.source ?? 'message') === 'project');
    const messageLevel = projectAttachments.filter((attachment) => (attachment.source ?? 'message') === 'message');
    return { projectLevel, messageLevel };
  }, [projectAttachments]);

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      blocked: [],
      queued: [],
      running: [],
      done: [],
      failed: [],
    };
    tasks.forEach((task) => {
      groups[task.status].push(task);
    });
    return groups;
  }, [tasks]);

  const taskTitleMap = useMemo(() => {
    return tasks.reduce<Record<string, string>>((acc, task) => {
      acc[task.id] = task.title;
      return acc;
    }, {});
  }, [tasks]);

  const isAppProject = useMemo(() => {
    return project?.outputType === 'app' || project?.outputType === 'website';
  }, [project]);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedArtifactMeta = selectedTask?.producesArtifacts.find(
    (artifact) => artifact.path === selectedArtifact
  );

  useEffect(() => {
    if (!selectedTask) return;
    if (!selectedTask.producesArtifacts.length) {
      setSelectedArtifact(null);
      return;
    }
    if (!selectedArtifact || !selectedTask.producesArtifacts.some((artifact) => artifact.path === selectedArtifact)) {
      setSelectedArtifact(selectedTask.producesArtifacts[0].path);
    }
  }, [selectedArtifact, selectedTask]);

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-950 border-t border-gray-800 text-center px-6">
        <div className="text-2xl mb-2">🖼</div>
        <p className="text-xs text-gray-400">{t('preview.empty')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-950 border-t border-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-100">{t('preview.title')}</h3>
        {schedulerState.concurrencyLimit > 0 && (
          <span className="text-[10px] text-gray-300 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5">
            {t('preview.concurrency')}: {schedulerState.concurrencyLimit}
          </span>
        )}
        {schedulerState.concurrencyLimit > 0 && (
          <span className="text-[10px] text-gray-300 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5">
            {t('preview.runningNow')}: {schedulerState.runningTasks}
          </span>
        )}
        {schedulerState.retryLimit > 0 && (
          <span className="text-[10px] text-gray-300 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5">
            {t('preview.retryLimit')}: {schedulerState.retryLimit}
          </span>
        )}
        {totalTasksCount > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto">
            {doneTasksCount}/{totalTasksCount} {t('preview.tasks')}
          </span>
        )}
      </div>

      {schedulerState.total > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800 bg-gray-900/40">
          <p className="text-[11px] text-gray-200">
            {tf('preview.progressSummary', {
              done: schedulerState.done,
              total: schedulerState.total,
              running: schedulerState.runningTasks,
              queued: schedulerState.queued,
              blocked: schedulerState.blocked,
              failed: schedulerState.failed,
            })}
          </p>
        </div>
      )}

      {schedulerState.concurrencyLimit > 0 && (
        <div className="flex-shrink-0 sticky top-0 z-20 border-b border-gray-800 bg-gray-900/95 backdrop-blur-sm overflow-visible">
          <div className="px-4 py-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-gray-300 mr-1">{t('preview.schedulerControls')}</span>

            <button
              onClick={schedulerState.isPaused ? resumeExecution : pauseExecution}
              disabled={schedulerState.isComplete}
              className={`rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {schedulerState.isPaused ? t('preview.resume') : t('preview.pause')}
            </button>
            <button
              onClick={stepExecution}
              disabled={schedulerState.isComplete}
              className={`rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {t('preview.step')}
            </button>

            <div className="hidden min-[520px]:flex items-center gap-1 rounded border border-gray-700 bg-gray-900 p-0.5">
            {(['slow', 'normal', 'fast'] as const).map((speed) => (
              <button
                key={speed}
                onClick={() => setExecutionSpeed(speed)}
                disabled={schedulerState.isComplete}
                className={`rounded px-2 py-1 text-[10px] transition-colors ${
                  schedulerState.executionSpeed === speed
                    ? 'bg-blue-700/70 text-blue-100'
                    : 'text-gray-300 hover:bg-gray-800'
                } ${schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {t(`preview.speed.${speed}` as const)}
              </button>
            ))}
            </div>

            <button
              onClick={() => setAutoPauseCheckpoints(!schedulerState.autoPauseCheckpoints)}
              disabled={schedulerState.isComplete}
              className={`hidden min-[520px]:inline-flex rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:border-blue-600/60 ${
                schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {schedulerState.autoPauseCheckpoints
                ? t('preview.autoPauseOn')
                : t('preview.autoPauseOff')}
            </button>

            <details className="relative min-[520px]:hidden">
              <summary className="list-none cursor-pointer rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 select-none">
                {t('preview.more')}
              </summary>
              <div className="absolute right-0 mt-1 w-44 rounded border border-gray-700 bg-gray-950 p-2 shadow-xl space-y-1">
                <div className="grid grid-cols-3 gap-1">
                  {(['slow', 'normal', 'fast'] as const).map((speed) => (
                    <button
                      key={`more-${speed}`}
                      onClick={() => setExecutionSpeed(speed)}
                      disabled={schedulerState.isComplete}
                      className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                        schedulerState.executionSpeed === speed
                          ? 'bg-blue-700/70 text-blue-100'
                          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                      } ${schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {t(`preview.speed.${speed}` as const)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setAutoPauseCheckpoints(!schedulerState.autoPauseCheckpoints)}
                  disabled={schedulerState.isComplete}
                  className={`w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 ${
                    schedulerState.isComplete ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {schedulerState.autoPauseCheckpoints
                    ? t('preview.autoPauseOn')
                    : t('preview.autoPauseOff')}
                </button>
              </div>
            </details>

          {schedulerState.isComplete && (
              <span className="text-[10px] text-green-300 ml-auto">{t('preview.completeControls')}</span>
          )}
          {schedulerState.isPaused && (
              <span className="text-[10px] text-amber-300 ml-auto">{t('preview.schedulerPaused')}</span>
          )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {schedulerState.deadlock && !isComplete && (
          <div className="mb-3 rounded-lg border border-red-700/60 bg-red-950/30 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-red-300">
                {t('preview.deadlockTitle')}
              </span>
              <button
                onClick={repairDeadlock}
                className="ml-auto rounded border border-red-600/60 bg-red-900/40 px-2 py-1 text-[10px] text-red-100 hover:bg-red-800/50"
              >
                {t('preview.deadlockRepair')}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-red-100 leading-relaxed">{schedulerState.deadlock.message}</p>
          </div>
        )}

        <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('attachments.sectionTitle')}</p>
            <span className="text-[10px] text-gray-500">{projectAttachments.length}</span>
          </div>
          {projectAttachments.length === 0 ? (
            <p className="mt-1 text-[11px] text-gray-400">{t('attachments.none')}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {([
                { label: t('attachments.source.project'), items: groupedAttachments.projectLevel },
                { label: t('attachments.source.message'), items: groupedAttachments.messageLevel },
              ] as const).map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <div key={group.label} className="space-y-1.5">
                    <p className="text-[10px] text-gray-500">{group.label}</p>
                    {group.items.map((attachment) => (
                      <div key={attachment.id} className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-300">
                            {t(`attachments.kind.${attachment.kind}` as Parameters<typeof translate>[1])}
                          </span>
                          {buildAttachmentStatusChips(attachment, t, tf).map((statusChip) => (
                            <span key={`${attachment.id}-${statusChip}`} className="rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-[10px] text-gray-400">
                              {statusChip}
                            </span>
                          ))}
                          <p className="truncate text-[11px] text-gray-100">{attachment.title}</p>
                          {attachment.size && (
                            <span className="ml-auto text-[10px] text-gray-500">{formatAttachmentSize(attachment.size)}</span>
                          )}
                        </div>

                        {attachment.kind === 'image' && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {buildImageAiStatusKeys(attachment).map((key) => (
                              <span
                                key={`${attachment.id}-${key}`}
                                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200"
                              >
                                {t(key)}
                              </span>
                            ))}
                          </div>
                        )}

                        {attachment.ingestion?.excerpt && (
                          <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">{attachment.ingestion.excerpt}</p>
                        )}

                        {attachment.kind === 'zip' && attachment.ingestion?.zipFileTree && (
                          <div className="mt-1 rounded border border-gray-800 bg-black/30 px-1.5 py-1">
                            <p className="text-[10px] text-gray-500">{t('attachments.zipTree')}</p>
                            <p className="text-[10px] text-gray-300 whitespace-pre-wrap">
                              {attachment.ingestion.zipFileTree.slice(0, 12).join('\n')}
                            </p>
                          </div>
                        )}

                        {attachment.ingestion?.error && (
                          <p className="mt-1 text-[10px] text-red-300">{attachment.ingestion.error}</p>
                        )}

                        {attachment.kind === 'image' && attachment.downloadUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={attachment.downloadUrl}
                            alt={attachment.title}
                            className="mt-1 max-h-24 w-full rounded border border-gray-700 object-cover"
                          />
                        )}

                        {attachment.kind === 'url' && attachment.downloadUrl && (
                          <a
                            href={attachment.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-[10px] text-blue-300 underline"
                          >
                            {attachment.downloadUrl}
                          </a>
                        )}

                        {(attachment.kind === 'pdf' || attachment.kind === 'zip' || attachment.kind === 'file') &&
                          attachment.downloadUrl && (
                            <a
                              href={attachment.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex text-[10px] text-blue-300 underline"
                            >
                              {t('attachments.open')}
                            </a>
                          )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isComplete && (
          <div className="mb-3 rounded-lg border border-green-700/50 bg-green-950/20 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-green-300">
                {t('preview.completeBanner')}
              </span>
              <span className="ml-auto text-[10px] text-green-200">{t('preview.executionComplete')}</span>
            </div>
            <div className="mt-2 rounded border border-green-700/40 bg-green-950/30 px-2 py-1.5">
              <p className="text-xs text-green-100">{t('preview.finalResult')}</p>
            </div>

            {(
              <div className="mt-3 space-y-2">
                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.projectOutput')}</p>
                  <p className="mt-1 text-xs text-gray-100">{project.name}</p>
                  <p className="mt-1 text-[11px] text-gray-300 leading-relaxed">{project.description}</p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.implementationOutput')}</p>
                  <p className="mt-1 text-[11px] text-gray-200">
                    {tf('preview.implementationBody', { done: doneTasksCount, total: totalTasksCount })}
                  </p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.debateDecisions')}</p>
                  <p className="mt-1 text-[11px] text-gray-200 whitespace-pre-wrap leading-relaxed">{debateSummary}</p>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.keyArtifacts')}</p>
                  <div className="mt-1 space-y-1">
                    {artifactItems.length === 0 && (
                      <p className="text-[11px] text-gray-400">{t('preview.noArtifacts')}</p>
                    )}
                    {artifactItems.map((artifact) => (
                      <button
                        key={`${artifact.taskId}:${artifact.path}`}
                        onClick={() => {
                          setSelectedTaskId(artifact.taskId);
                          setSelectedArtifact(artifact.path);
                        }}
                        className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-left hover:border-blue-700/50"
                      >
                        <p className="text-[10px] text-gray-200">{artifact.label}</p>
                        <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                        <p className="text-[10px] text-gray-400">{artifact.taskTitle}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.architectureSummary')}</p>
                  <p className="mt-1 text-[11px] text-gray-200">
                    {t('preview.architectureBody')}
                  </p>
                </div>

                {isAppProject && (
                  <div className="rounded border border-blue-700/40 bg-blue-950/20 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-blue-300">{t('preview.generatedScreens')}</p>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Sidebar</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Chat Panel</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Agents Panel</span>
                      <span className="rounded bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">Execution & Preview</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!hasArtifacts && totalTasksCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-2xl mb-2">⏳</div>
            <p className="text-xs text-gray-400">
              {state.currentPhase === 'execution' || state.currentPhase === 'review' || state.currentPhase === 'testing'
                ? t('preview.loading')
                : t('preview.waiting')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(['blocked', 'queued', 'running', 'done', 'failed'] as TaskStatus[]).map((status) => {
              const items = groupedTasks[status];
              if (items.length === 0) return null;
              return (
                <div key={status} className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-gray-300">
                    {t(`status.task.${status}` as const)} ({items.length})
                  </p>
                  {items.map((task) => (
                    (() => {
                      const dependencyTitles = task.dependsOn.map((id) => taskTitleMap[id] ?? id);
                      const unresolvedDependencies = task.dependsOn
                        .map((id) => tasks.find((candidate) => candidate.id === id))
                        .filter((dependency): dependency is Task =>
                          Boolean(dependency && dependency.status !== 'done' && dependency.status !== 'failed')
                        )
                        .map((dependency) => dependency.title);
                      return (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`w-full text-left bg-gray-900 rounded border px-3 py-2 transition-colors ${
                        selectedTaskId === task.id
                          ? 'border-blue-600/70 bg-blue-950/20'
                          : 'border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          task.status === 'done'
                            ? 'bg-green-900/50 text-green-300'
                            : task.status === 'running'
                            ? 'bg-blue-900/50 text-blue-300'
                            : task.status === 'failed'
                            ? 'bg-red-900/50 text-red-300'
                            : task.status === 'blocked'
                            ? 'bg-amber-900/50 text-amber-200'
                            : 'bg-gray-800 text-gray-300'
                        }`}>
                          {t(`status.task.${task.status}` as const)}
                        </span>
                        <span className="text-xs text-gray-100 truncate">{task.title}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{task.agent}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-300 line-clamp-2">{task.description}</p>
                      <p className="mt-1 text-[10px] text-gray-400">
                        {t('preview.dependsOn')}: {dependencyTitles.length ? dependencyTitles.join(', ') : t('preview.none')}
                      </p>
                      {task.status === 'blocked' && unresolvedDependencies.length > 0 && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          {tf('preview.blockedReason', { deps: unresolvedDependencies.join(', ') })}
                        </p>
                      )}
                    </button>
                      );
                    })()
                  ))}
                </div>
              );
            })}

            {selectedTask && (
              <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('preview.artifactDetail')}</p>
                <p className="mt-1 text-[11px] text-gray-100">{selectedTask.title}</p>
                <p className="mt-1 text-[11px] text-gray-300 leading-relaxed">{selectedTask.description}</p>
                <p className="mt-1 text-[11px] text-gray-200">{t('preview.owner')}: {selectedTask.agent}</p>
                <p className="mt-1 text-[11px] text-gray-300">
                  {t('preview.dependsOn')}: {selectedTask.dependsOn.length
                    ? selectedTask.dependsOn.map((id) => taskTitleMap[id] ?? id).join(', ')
                    : t('preview.none')}
                </p>
                {selectedTask.errorMessage && (
                  <p className="mt-1 text-[11px] text-red-300">{selectedTask.errorMessage}</p>
                )}

                {selectedTask.producesArtifacts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedTask.producesArtifacts.map((artifact) => (
                      <button
                        key={artifact.path}
                        onClick={() => setSelectedArtifact(artifact.path)}
                        className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                          selectedArtifact === artifact.path
                            ? 'bg-blue-900/40 border-blue-700/60 text-blue-100'
                            : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-blue-700/50'
                        }`}
                      >
                        <p className="text-[10px] font-medium">{artifact.label}</p>
                        <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-2 rounded border border-gray-800 bg-black/40 px-2 py-1.5">
                  <p className="text-[10px] text-gray-400">{t('preview.snippet')}</p>
                  <p className="mt-1 text-[10px] text-gray-200 font-mono">
                    {selectedArtifactMeta ? `${selectedArtifactMeta.label} [${selectedArtifactMeta.kind}]` : ''}
                    {!selectedArtifactMeta && selectedTask.agent === 'Planner' && t('preview.snippet.planner')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Architect' && t('preview.snippet.architect')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Builder' && t('preview.snippet.builder')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Reviewer' && t('preview.snippet.reviewer')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Tester' && t('preview.snippet.tester')}
                    {!selectedArtifactMeta && selectedTask.agent === 'Integrator' && t('preview.snippet.integrator')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
