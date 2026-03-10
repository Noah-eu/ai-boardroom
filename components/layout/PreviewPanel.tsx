'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/context/AppContext';
import { translate, translateWithVars } from '@/i18n';
import { ProjectAttachment, Task, TaskStatus } from '@/types';

const DEFAULT_EXECUTION_TASK_TIMEOUT_MS = 90_000;

function resolveExecutionTaskTimeoutMs(): number {
  const raw = Number(process.env.NEXT_PUBLIC_EXECUTION_TASK_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_EXECUTION_TASK_TIMEOUT_MS;
  return Math.max(60_000, Math.min(120_000, Math.floor(raw)));
}

function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatAttachmentSize(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownArtifact(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function extractMarkdownSection(markdown: string, headingAliases: string[]): string {
  const lines = markdown.split('\n');
  const normalizedAliases = headingAliases.map((alias) => alias.toLowerCase());
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#')) continue;
    const title = line.replace(/^#+\s*/, '').trim().toLowerCase();
    if (normalizedAliases.includes(title)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';

  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith('#')) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function buildExecutionCompletionStatus(tasks: Task[]): 'completed' | 'completed_with_fallback' | 'failed' | 'in_progress' {
  if (tasks.some((task) => task.status === 'failed')) return 'failed';
  const hasActive = tasks.some((task) => ['queued', 'blocked', 'running'].includes(task.status));
  if (hasActive) return 'in_progress';
  if (tasks.some((task) => task.status === 'completed_with_fallback')) return 'completed_with_fallback';
  return 'completed';
}

function buildArtifactFallbackPreview(
  artifact: { path: string; label: string; kind: string },
  task?: Task | null
): string {
  const source = task ? `${task.agent} / ${task.title}` : 'Unknown task';
  return [
    `# ${artifact.label}`,
    '',
    '## Preview',
    'Obsah artefaktu zatim neni k dispozici jako markdown/text v pameti UI.',
    '',
    `- Soubor: ${artifact.path}`,
    `- Typ: ${artifact.kind}`,
    `- Zdroj: ${source}`,
    '',
    '## Co udelat dal',
    '- Pokud chcete realny obsah artefaktu, spustte projekt v Live rezimu (OpenAI).',
    '- V simulacnim rezimu mohou byt artefakty bez textoveho obsahu.',
  ].join('\n');
}

function MarkdownArtifactView({ content, isMobile = false }: { content: string; isMobile?: boolean }) {
  return (
    <div className={`prose prose-invert max-w-none break-words prose-pre:border prose-pre:border-gray-700 prose-pre:bg-black prose-code:text-blue-200 [overflow-wrap:anywhere] ${isMobile ? 'text-sm' : 'text-[12px]'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="overflow-x-hidden whitespace-pre-wrap break-words rounded-md border border-gray-700 bg-black p-4 text-inherit">
              {children}
            </pre>
          ),
          code: ({ className, children }) => (
            <code className={`${className ?? ''} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
              {children}
            </code>
          ),
          p: ({ children }) => <p className="break-words [overflow-wrap:anywhere]">{children}</p>,
          li: ({ children }) => <li className="break-words [overflow-wrap:anywhere]">{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
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

interface PreviewPanelProps {
  mode?: 'desktop' | 'mobile';
}

export function PreviewPanel({ mode = 'desktop' }: PreviewPanelProps) {
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
  const [nowTick, setNowTick] = useState(() => Date.now());
  const executionTimeoutMs = useMemo(() => resolveExecutionTaskTimeoutMs(), []);
  const isMobile = mode === 'mobile';

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
  const executionResultItems = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.producesArtifacts.map((artifact) => ({
          ...artifact,
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          taskAgent: task.agent,
        }))
      ),
    [tasks]
  );
  const executionCompletionStatus = useMemo(() => buildExecutionCompletionStatus(tasks), [tasks]);
  const integratorFinalArtifact = useMemo(() => {
    const integratorTask = [...tasks].reverse().find((task) => task.agent === 'Integrator');
    if (!integratorTask) return null;
    const artifact = integratorTask.producesArtifacts.find((item) => item.path === 'final-summary.md') ?? null;
    if (!artifact?.content) return null;

    const whatToDoNow =
      extractMarkdownSection(artifact.content, ['What to do now', 'Co udelat ted']) ||
      extractMarkdownSection(artifact.content, ['Next steps', 'Doporuceny dalsi krok']);
    const filesAffected = extractMarkdownSection(
      artifact.content,
      ['Files likely affected', 'Pravdepodobne dotcene soubory']
    );
    const recommendedNextAction =
      extractMarkdownSection(artifact.content, ['Recommended next action', 'Doporuceny dalsi krok']) ||
      extractMarkdownSection(artifact.content, ['Next steps', 'Dalsi kroky']);

    return {
      task: integratorTask,
      artifact,
      whatToDoNow,
      filesAffected,
      recommendedNextAction,
    };
  }, [tasks]);
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
      completed_with_fallback: [],
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

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedArtifactMeta = selectedTask?.producesArtifacts.find(
    (artifact) => artifact.path === selectedArtifact
  );
  const selectedArtifactOwner = selectedArtifactMeta?.producedBy ?? selectedTask?.agent ?? null;
  const selectedArtifactContent = useMemo(() => {
    if (!selectedArtifactMeta) return '';
    return selectedArtifactMeta.content?.trim()
      ? selectedArtifactMeta.content
      : buildArtifactFallbackPreview(selectedArtifactMeta, selectedTask);
  }, [selectedArtifactMeta, selectedTask]);

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
      <div className={`h-full flex flex-col items-center justify-center bg-gray-950 text-center px-6 ${isMobile ? '' : 'border-t border-gray-800'}`}>
        <div className="text-2xl mb-2">🖼</div>
        <p className="text-xs text-gray-400">{t('preview.empty')}</p>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col bg-gray-950 ${isMobile ? '' : 'border-t border-gray-800'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center gap-3 border-b border-gray-800 ${isMobile ? 'px-6 py-5' : 'px-4 py-2'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-xs'} font-semibold text-gray-100`}>{t('preview.title')}</h3>
        {schedulerState.concurrencyLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.concurrency')}: {schedulerState.concurrencyLimit}
          </span>
        )}
        {schedulerState.concurrencyLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.runningNow')}: {schedulerState.runningTasks}
          </span>
        )}
        {schedulerState.retryLimit > 0 && (
          <span className={`${isMobile ? 'text-sm px-3 py-2 rounded-xl' : 'text-[10px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
            {t('preview.retryLimit')}: {schedulerState.retryLimit}
          </span>
        )}
        {totalTasksCount > 0 && (
          <span className={`${isMobile ? 'text-sm' : 'text-[10px]'} ml-auto text-gray-400`}>
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
          <p className="mt-1 text-[11px] text-gray-300">
            Execution status:{' '}
            <span
              className={`rounded px-1.5 py-0.5 ${
                executionCompletionStatus === 'completed'
                  ? 'bg-green-900/40 text-green-200'
                  : executionCompletionStatus === 'completed_with_fallback'
                  ? 'bg-cyan-900/40 text-cyan-200'
                  : executionCompletionStatus === 'failed'
                  ? 'bg-red-900/40 text-red-200'
                  : 'bg-blue-900/40 text-blue-200'
              }`}
            >
              {executionCompletionStatus}
            </span>
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
      <div
        className={`flex-1 overflow-y-auto overflow-x-hidden ${isMobile ? 'px-5 py-5' : 'px-4 py-3'}`}
        style={isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}
      >
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
                          <div className="mt-1 space-y-1 rounded border border-gray-800 bg-black/20 px-1.5 py-1">
                            <p className="text-[10px] text-gray-300">
                              {attachment.ingestion?.pageTitle ?? attachment.title}
                            </p>
                            <a
                              href={attachment.sourceUrl ?? attachment.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-[10px] text-blue-300 underline break-all"
                            >
                              {attachment.sourceUrl ?? attachment.downloadUrl}
                            </a>
                            <p className="text-[10px] text-gray-500">
                              {attachment.ingestion?.extractedText
                                ? `Parsed content ready (${attachment.ingestion.extractedText.length} chars)`
                                : 'Parsed content pending'}
                            </p>
                            {typeof attachment.ingestion?.urlPageCount === 'number' && (
                              <p className="text-[10px] text-gray-400">
                                Pages indexed: {attachment.ingestion.urlPageCount}
                              </p>
                            )}
                            {attachment.ingestion?.urlPages && attachment.ingestion.urlPages.length > 0 && (
                              <div className="rounded border border-gray-800 bg-black/30 px-1.5 py-1">
                                <p className="text-[10px] text-gray-500">Visited pages</p>
                                <div className="mt-1 space-y-1">
                                  {attachment.ingestion.urlPages.slice(0, 6).map((page) => (
                                    <div key={`${attachment.id}-${page.url}`} className="rounded border border-gray-800 bg-black/20 px-1.5 py-1">
                                      <a
                                        href={page.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-blue-300 underline break-all"
                                      >
                                        {page.title}
                                      </a>
                                      <p className="text-[10px] text-gray-500 break-all">{page.url}</p>
                                      <p className="text-[10px] text-gray-400 leading-relaxed">{page.summary || page.excerpt}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
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

        {integratorFinalArtifact && (
          <div className="mb-3 rounded-lg border border-blue-700/50 bg-blue-950/20 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-blue-300">Final Result / Finalni vysledek</p>
            <p className="mt-1 text-[11px] text-blue-100">
              Source: {integratorFinalArtifact.artifact.path} ({integratorFinalArtifact.task.status})
            </p>

            <div className="mt-2 grid gap-2">
              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">What to do now / Co udelat ted</p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.whatToDoNow || 'Read final summary and start with the first ordered task.'}
                </p>
              </div>

              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">
                  Files likely affected / Pravdepodobne dotcene soubory
                </p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.filesAffected || 'See execution artifacts for file-level proposal details.'}
                </p>
              </div>

              <div className="rounded border border-blue-900/60 bg-gray-900/70 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-200">
                  Recommended next action / Doporuceny dalsi krok
                </p>
                <p className="mt-1 text-[11px] text-gray-100 whitespace-pre-wrap leading-relaxed">
                  {integratorFinalArtifact.recommendedNextAction || 'Approve the top-priority implementation package and execute in order.'}
                </p>
              </div>
            </div>
          </div>
        )}

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
            {(['blocked', 'queued', 'running', 'done', 'completed_with_fallback', 'failed'] as TaskStatus[]).map((status) => {
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
                      const runningForMs =
                        task.status === 'running'
                          ? Math.max(0, nowTick - new Date(task.updatedAt).getTime())
                          : 0;
                      const isStalled = task.status === 'running' && runningForMs > executionTimeoutMs;
                      const unresolvedDependencies = task.dependsOn
                        .map((id) => tasks.find((candidate) => candidate.id === id))
                        .filter((dependency): dependency is Task =>
                          Boolean(
                            dependency &&
                              dependency.status !== 'done' &&
                              dependency.status !== 'failed' &&
                              dependency.status !== 'completed_with_fallback'
                          )
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
                            : task.status === 'completed_with_fallback'
                            ? 'bg-cyan-900/50 text-cyan-200'
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
                      {task.status === 'running' && (
                        <p className={`mt-1 text-[10px] ${isStalled ? 'text-red-300' : 'text-blue-300'}`}>
                          Running: {formatDurationMs(runningForMs)}
                          {isStalled ? ' (timeout / stalled)' : ''}
                        </p>
                      )}
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

                {selectedArtifactMeta && (
                  <div className="mt-2 rounded border border-gray-700 bg-gray-950 px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] text-gray-400">Execution Results</p>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        agent: {selectedArtifactOwner}
                      </span>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        file: {selectedArtifactMeta.path}
                      </span>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-200">
                        type: {selectedArtifactMeta.kind}
                      </span>
                    </div>

                    <div className="mt-2 rounded border border-gray-800 bg-black/30 px-2 py-2">
                      {isMarkdownArtifact(selectedArtifactMeta.path) ? (
                        <MarkdownArtifactView content={selectedArtifactContent} isMobile={isMobile} />
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[10px] text-gray-400">Structured preview</p>
                          <pre className="overflow-x-hidden whitespace-pre-wrap break-words text-[10px] leading-relaxed text-gray-200 [overflow-wrap:anywhere]">
                            {selectedArtifactContent}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-2 rounded border border-gray-800 bg-black/40 px-2 py-1.5">
                  <p className="text-[10px] text-gray-400">{t('preview.snippet')}</p>
                  <p className="mt-1 text-[10px] text-gray-200 font-mono">
                    {selectedArtifactMeta
                      ? `${selectedArtifactMeta.label} [${selectedArtifactMeta.kind}]`
                      : ''}
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

            {executionResultItems.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Execution Results</p>
                <div className="mt-2 space-y-1">
                  {executionResultItems.map((artifact) => (
                    <button
                      key={`${artifact.taskId}:${artifact.path}:result`}
                      onClick={() => {
                        setSelectedTaskId(artifact.taskId);
                        setSelectedArtifact(artifact.path);
                      }}
                      className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                        selectedTaskId === artifact.taskId && selectedArtifact === artifact.path
                          ? 'bg-blue-900/40 border-blue-700/60 text-blue-100'
                          : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-blue-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-medium">{artifact.label}</p>
                        <span className="text-[10px] text-gray-400">{artifact.taskAgent}</span>
                        <span className={`ml-auto text-[10px] rounded px-1 py-0.5 ${
                          artifact.taskStatus === 'done'
                            ? 'bg-green-900/50 text-green-300'
                            : artifact.taskStatus === 'running'
                            ? 'bg-blue-900/50 text-blue-300'
                            : artifact.taskStatus === 'completed_with_fallback'
                            ? 'bg-cyan-900/50 text-cyan-200'
                            : artifact.taskStatus === 'queued' || artifact.taskStatus === 'blocked'
                            ? 'bg-gray-800 text-gray-300'
                            : 'bg-red-900/50 text-red-300'
                        }`}>
                          {artifact.taskStatus}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-gray-300">{artifact.path}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
