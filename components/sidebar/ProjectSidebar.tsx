'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { AppLanguage, DebateMode, OutputType, ProjectStatus } from '@/types';

const statusConfig: Record<ProjectStatus, { color: string; dot: string }> = {
  idle: { color: 'text-gray-400', dot: 'bg-gray-500' },
  debating: { color: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse' },
  'awaiting-approval': { color: 'text-orange-400', dot: 'bg-orange-400 animate-pulse' },
  executing: { color: 'text-blue-400', dot: 'bg-blue-400 animate-pulse' },
  reviewing: { color: 'text-sky-400', dot: 'bg-sky-400 animate-pulse' },
  testing: { color: 'text-pink-400', dot: 'bg-pink-400 animate-pulse' },
  integrating: { color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  complete: { color: 'text-green-400', dot: 'bg-green-400' },
  failed: { color: 'text-red-400', dot: 'bg-red-500' },
};

type FormDraftAttachment =
  | { id: string; kind: 'file' | 'image' | 'pdf' | 'zip'; file: File; title: string }
  | { id: string; kind: 'url'; url: string; title: string };

function formatSize(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeUserUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

interface NewProjectFormProps {
  onSubmit: (
    name: string,
    description: string,
    projectLanguage: AppLanguage,
    outputType: OutputType,
    debateRounds: number,
    debateMode: DebateMode,
    maxWordsPerAgent: number,
    attachments: FormDraftAttachment[]
  ) => void;
  onCancel: () => void;
  t: ReturnType<typeof useApp>['t'];
  defaultLanguage: AppLanguage;
}

function NewProjectForm({ onSubmit, onCancel, t, defaultLanguage }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectLanguage, setProjectLanguage] = useState<AppLanguage>(defaultLanguage);
  const [outputType, setOutputType] = useState<OutputType>('other');
  const [debateRounds, setDebateRounds] = useState(3);
  const [debateMode, setDebateMode] = useState<DebateMode>('auto');
  const [maxWordsPerAgent, setMaxWordsPerAgent] = useState(180);
  const [attachments, setAttachments] = useState<FormDraftAttachment[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!attachmentMenuRef.current) return;
      if (!attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && description.trim()) {
      const normalizedPendingLink = normalizeUserUrl(linkValue);
      const hasPendingLink = Boolean(normalizedPendingLink);
      const pendingLinkAlreadyAdded = attachments.some(
        (attachment) => attachment.kind === 'url' && attachment.url === normalizedPendingLink
      );

      const submissionAttachments =
        hasPendingLink && !pendingLinkAlreadyAdded
          ? [
              ...attachments,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kind: 'url' as const,
                url: normalizedPendingLink,
                title: normalizedPendingLink,
              },
            ]
          : attachments;

      onSubmit(
        name.trim(),
        description.trim(),
        projectLanguage,
        outputType,
        debateRounds,
        debateMode,
        maxWordsPerAgent,
        submissionAttachments
      );
    }
  };

  const addFileAttachment = (file: File, kind: 'file' | 'image' | 'pdf' | 'zip') => {
    const draft: FormDraftAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      file,
      title: file.name,
    };
    setAttachments((previous) => [...previous, draft]);
  };

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>, kind: 'file' | 'image' | 'pdf' | 'zip') => {
    const files = Array.from(event.target.files ?? []);
    files.forEach((file) => addFileAttachment(file, kind));
    event.target.value = '';
    setShowAttachmentMenu(false);
  };

  const addLinkAttachment = () => {
    const normalizedUrl = normalizeUserUrl(linkValue);
    if (!normalizedUrl) return;
    const draft: FormDraftAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'url',
      url: normalizedUrl,
      title: normalizedUrl,
    };
    setAttachments((previous) => [...previous, draft]);
    setLinkValue('');
    setShowLinkInput(false);
    setShowAttachmentMenu(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-3 mb-3 max-h-[calc(100vh-220px)] overflow-y-auto overflow-x-hidden bg-gray-900 rounded-lg border border-gray-700 p-3"
    >
      <p className="text-xs font-semibold text-gray-100 mb-2">{t('projectForm.title')}</p>
      <input
        type="text"
        placeholder={t('projectForm.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      />
      <textarea
        placeholder={t('projectForm.prompt')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="w-full resize-none bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      />
      <label className="block text-[10px] font-medium text-gray-300 mb-1">{t('projectForm.language')}</label>
      <select
        value={projectLanguage}
        onChange={(e) => setProjectLanguage(e.target.value as AppLanguage)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      >
        <option value="en">{t('lang.en')}</option>
        <option value="cz">{t('lang.cz')}</option>
      </select>
      <label className="block text-[10px] font-medium text-gray-300 mb-1">{t('projectForm.outputType')}</label>
      <select
        value={outputType}
        onChange={(e) => setOutputType(e.target.value as OutputType)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      >
        <option value="app">{t('outputType.app')}</option>
        <option value="website">{t('outputType.website')}</option>
        <option value="document">{t('outputType.document')}</option>
        <option value="plan">{t('outputType.plan')}</option>
        <option value="other">{t('outputType.other')}</option>
      </select>
      <label className="block text-[10px] font-medium text-gray-300 mb-1">{t('projectForm.debateRounds')}</label>
      <select
        value={debateRounds}
        onChange={(e) => setDebateRounds(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      >
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
      </select>
      <label className="block text-[10px] font-medium text-gray-300 mb-1">{t('projectForm.debateMode')}</label>
      <select
        value={debateMode}
        onChange={(e) => setDebateMode(e.target.value as DebateMode)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      >
        <option value="auto">{t('projectForm.debateModeAuto')}</option>
        <option value="interactive">{t('projectForm.debateModeInteractive')}</option>
      </select>
      <label className="block text-[10px] font-medium text-gray-300 mb-1">{t('projectForm.maxWordsPerAgent')}</label>
      <input
        type="number"
        min={140}
        max={220}
        step={10}
        value={maxWordsPerAgent}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isNaN(next)) return;
          setMaxWordsPerAgent(Math.max(140, Math.min(220, next)));
        }}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 mb-2"
      />

      <div className="mb-2 rounded border border-gray-700 bg-gray-950/40 p-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-medium text-gray-300">{t('projectForm.attachments')}</p>
          <div ref={attachmentMenuRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setShowAttachmentMenu((previous) => !previous)}
              className="h-7 w-7 rounded border border-gray-700 bg-gray-900 text-sm text-gray-200"
              title={t('attachments.menuOpen')}
            >
              +
            </button>
            {showAttachmentMenu && (
              <div className="absolute right-0 top-8 z-20 w-32 rounded border border-gray-700 bg-gray-950 p-1">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-900">{t('attachments.option.file')}</button>
                <button type="button" onClick={() => photoInputRef.current?.click()} className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-900">{t('attachments.option.photo')}</button>
                <button type="button" onClick={() => pdfInputRef.current?.click()} className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-900">{t('attachments.option.pdf')}</button>
                <button type="button" onClick={() => zipInputRef.current?.click()} className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-900">{t('attachments.option.zip')}</button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLinkInput(true);
                    setShowAttachmentMenu(false);
                  }}
                  className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-900"
                >
                  {t('attachments.option.link')}
                </button>
              </div>
            )}
          </div>
        </div>

        {showLinkInput && (
          <div className="mt-2 flex gap-1.5">
            <input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder={t('attachments.linkPlaceholder')}
              className="flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-100 placeholder-gray-400"
            />
            <button type="button" onClick={addLinkAttachment} disabled={!linkValue.trim()} className="rounded border border-blue-700/60 bg-blue-900/40 px-2 py-1 text-[11px] text-blue-100 disabled:opacity-50">
              {t('attachments.addLink')}
            </button>
          </div>
        )}

        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200">
                <span className="max-w-28 truncate">{attachment.title}</span>
                <span className="text-gray-400">{t(`attachments.kind.${attachment.kind}` as const)}</span>
                {'file' in attachment && attachment.file.size > 0 && (
                  <span className="text-gray-500">{formatSize(attachment.file.size)}</span>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))}
                  className="rounded border border-gray-700 px-1 text-gray-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-gray-500">{t('projectForm.attachmentsEmpty')}</p>
        )}

        <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => onFilePicked(event, 'file')} />
        <input ref={photoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onFilePicked(event, 'image')} />
        <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(event) => onFilePicked(event, 'pdf')} />
        <input ref={zipInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" onChange={(event) => onFilePicked(event, 'zip')} />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || !description.trim()}
          className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-300 disabled:opacity-80 text-white text-xs font-medium rounded transition-colors"
        >
          {t('projectForm.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
        >
          {t('projectForm.cancel')}
        </button>
      </div>
    </form>
  );
}

interface ProjectSidebarProps {
  mode?: 'desktop' | 'mobile';
  onProjectActivated?: () => void;
}

export function ProjectSidebar({ mode = 'desktop', onProjectActivated }: ProjectSidebarProps) {
  const {
    state,
    createProject,
    attachToProject,
    addLog,
    startDebate,
    selectProject,
    language,
    setLanguage,
    t,
  } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [buildInfo, setBuildInfo] = useState<{ branch: string; commit: string } | null>(null);
  const isMobile = mode === 'mobile';

  useEffect(() => {
    let isMounted = true;
    fetch('/api/build-info')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        if (typeof data.branch === 'string' && typeof data.commit === 'string') {
          setBuildInfo({ branch: data.branch, commit: data.commit });
        }
      })
      .catch(() => {
        // Keep footer hidden if build info is unavailable.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreate = async (
    name: string,
    description: string,
    projectLanguage: AppLanguage,
    outputType: OutputType,
    debateRounds: number,
    debateMode: DebateMode,
    maxWordsPerAgent: number,
    attachments: FormDraftAttachment[]
  ) => {
    let projectId: string;
    try {
      const createdProject = await createProject(
        name,
        description,
        projectLanguage,
        outputType,
        false,
        debateRounds,
        debateMode,
        maxWordsPerAgent,
        false
      );
      projectId = createdProject.projectId;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project creation failed.';
      addLog(`Project creation failed before attachment upload: ${detail}`, 'error');
      return;
    }

    if (!projectId) {
      addLog('Project creation failed in ProjectSidebar.handleCreate: missing projectId.', 'error');
      return;
    }

    setShowForm(false);
    addLog(`starting pending attachment upload for project id: ${projectId}`, 'info');

    const pendingUrlCount = attachments.filter((attachment) => attachment.kind === 'url').length;
    if (pendingUrlCount > 0) {
      addLog(`pending project URL attachments detected: ${pendingUrlCount}`, 'info');
    }

    let attachmentUploadFailed = false;
    let uploadedCount = 0;
    let uploadedUrlCount = 0;
    try {
      for (const attachment of attachments) {
        if (attachment.kind === 'url') {
          await attachToProject(projectId, {
            kind: 'url',
            url: attachment.url,
            source: 'project',
          });
          uploadedUrlCount += 1;
        } else {
          await attachToProject(projectId, {
            kind: attachment.kind,
            file: attachment.file,
            source: 'project',
          });
        }
        uploadedCount += 1;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project attachment upload failed.';
      addLog(detail, 'error');
      attachmentUploadFailed = true;
    }

    if (attachmentUploadFailed) {
      addLog('Project debate not started because attachment upload/ingestion failed.', 'error');
      return;
    }

    if (uploadedCount !== attachments.length) {
      addLog(
        `Attachment count mismatch before debate start (expected=${attachments.length}, uploaded=${uploadedCount}).`,
        'error'
      );
      return;
    }

    if (pendingUrlCount !== uploadedUrlCount) {
      addLog(
        `URL attachment mismatch before debate start (expected=${pendingUrlCount}, uploaded=${uploadedUrlCount}).`,
        'error'
      );
      return;
    }

    addLog('pending attachment upload success', 'success');
    addLog('debate start allowed', 'info');
    startDebate(description, projectId);
    onProjectActivated?.();
  };

  return (
    <div className={`h-full flex flex-col bg-gray-950 ${isMobile ? '' : 'border-r border-gray-800'}`}>
      {/* Header */}
      {!isMobile && (
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <h1 className="text-sm font-bold text-gray-100">AI Boardroom</h1>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setLanguage('en')}
              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                language === 'en'
                  ? 'bg-blue-700/60 border-blue-500 text-blue-100'
                  : 'bg-gray-900 border-gray-700 text-gray-300 hover:text-gray-100'
              }`}
            >
              {t('lang.en')}
            </button>
            <button
              onClick={() => setLanguage('cz')}
              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                language === 'cz'
                  ? 'bg-blue-700/60 border-blue-500 text-blue-100'
                  : 'bg-gray-900 border-gray-700 text-gray-300 hover:text-gray-100'
              }`}
            >
              {t('lang.cz')}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">{t('sidebar.subtitle')}</p>
      </div>
      )}

      {/* Projects label + new button */}
      <div className={`flex-shrink-0 flex items-center justify-between ${isMobile ? 'px-4 py-3 border-b border-gray-800' : 'px-3 py-2'}`}>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          {t('sidebar.projects')}
        </span>
        <button
          onClick={() => setShowForm(true)}
          title={t('sidebar.newProject')}
          className={`${isMobile ? 'min-h-10 min-w-10 rounded-lg border border-gray-700 bg-gray-900 text-base' : 'w-5 h-5 rounded text-sm'} flex items-center justify-center text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100`}
        >
          +
        </button>
      </div>

      {/* New project form */}
      {showForm && (
        <NewProjectForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          t={t}
          defaultLanguage={language}
        />
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {state.projects.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-gray-400 mb-3">{t('sidebar.noProjects')}</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
            >
              {t('sidebar.createFirst')}
            </button>
          </div>
        ) : (
          <div className="py-1">
            {state.projects.map((project) => {
              const isSelected = project.id === state.selectedProjectId;
              const sCfg = statusConfig[project.status];
              const statusLabel = t(`status.project.${project.status}` as const);
              return (
                <button
                  key={project.id}
                  onClick={() => {
                    selectProject(project.id);
                    onProjectActivated?.();
                  }}
                  className={`w-full text-left transition-colors ${isMobile ? 'px-4 py-3.5' : 'px-3 py-2.5'} ${
                    isSelected
                      ? 'bg-blue-600/20 border-r-2 border-blue-500'
                      : 'hover:bg-gray-800/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sCfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-medium truncate ${
                          isSelected ? 'text-blue-300' : 'text-gray-300'
                        }`}
                      >
                        {project.name}
                      </p>
                      <p className={`text-[10px] mt-0.5 ${sCfg.color}`}>{statusLabel}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-300">
                          {project.language.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`flex-shrink-0 border-t border-gray-800 p-3 ${isMobile ? 'pb-5' : ''}`}
        style={isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}
      >
        {buildInfo && (
          <p className="text-[9px] text-gray-500 text-center mt-2">
            {buildInfo.branch} {buildInfo.commit}
          </p>
        )}
      </div>
    </div>
  );
}
