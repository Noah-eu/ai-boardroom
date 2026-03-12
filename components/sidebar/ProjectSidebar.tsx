'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { AppLanguage, DebateMode, OpenAIModel, OutputType, ProjectStatus, resolveOpenAiModel } from '@/types';

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

function modelCostHint(model: OpenAIModel): string {
  if (model === 'gpt-5.4') {
    return 'Higher cost profile: roughly 6.25x input and 9.4x output cost versus gpt-4.1-mini.';
  }
  return 'Lower-cost default for lighter runs.';
}

interface NewProjectFormProps {
  onSubmit: (
    name: string,
    description: string,
    projectLanguage: AppLanguage,
    model: OpenAIModel,
    outputType: OutputType,
    debateRounds: number,
    debateMode: DebateMode,
    maxWordsPerAgent: number,
    attachments: FormDraftAttachment[]
  ) => void;
  onCancel: () => void;
  t: ReturnType<typeof useApp>['t'];
  defaultLanguage: AppLanguage;
  defaultModel: OpenAIModel;
  isMobile?: boolean;
}

function NewProjectForm({ onSubmit, onCancel, t, defaultLanguage, defaultModel, isMobile = false }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectLanguage, setProjectLanguage] = useState<AppLanguage>(defaultLanguage);
  const [selectedModel, setSelectedModel] = useState<OpenAIModel>(defaultModel);
  const [modelTouched, setModelTouched] = useState(false);
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
    if (!modelTouched) {
      setSelectedModel(defaultModel);
    }
  }, [defaultModel, modelTouched]);

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
        selectedModel,
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
      className={`${isMobile ? 'mx-5 mb-6 rounded-[1.75rem] p-5 pb-8' : 'mx-3 mb-3 max-h-[calc(100vh-220px)] rounded-lg p-3'} ${isMobile ? '' : 'overflow-y-auto'} overflow-x-hidden border border-gray-700 bg-gray-900`}
    >
      <p className={`${isMobile ? 'mb-4 text-base' : 'mb-2 text-xs'} font-semibold text-gray-100`}>{t('projectForm.title')}</p>
      <input
        type="text"
        placeholder={t('projectForm.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      />
      <textarea
        placeholder={t('projectForm.prompt')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={isMobile ? 5 : 3}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full resize-none border border-gray-600 bg-gray-800 text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      />
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>{t('projectForm.language')}</label>
      <select
        value={projectLanguage}
        onChange={(e) => setProjectLanguage(e.target.value as AppLanguage)}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      >
        <option value="en">{t('lang.en')}</option>
        <option value="cz">{t('lang.cz')}</option>
      </select>
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>{t('projectForm.outputType')}</label>
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>OpenAI model</label>
      <select
        value={selectedModel}
        onChange={(e) => {
          setSelectedModel(resolveOpenAiModel(e.target.value));
          setModelTouched(true);
        }}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      >
        <option value="gpt-4.1-mini">gpt-4.1-mini</option>
        <option value="gpt-5.4">gpt-5.4</option>
      </select>
      <p className={`${isMobile ? 'mb-4 text-sm' : 'mb-2 text-[10px]'} text-gray-500`}>
        Light tasks default to the cheaper model. Switch to gpt-5.4 for heavier runs.
      </p>
      <div
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3 text-sm' : 'mb-2 rounded px-2 py-1.5 text-[10px]'} border ${
          selectedModel === 'gpt-5.4'
            ? 'border-amber-700/60 bg-amber-950/30 text-amber-200'
            : 'border-emerald-800/50 bg-emerald-950/20 text-emerald-200'
        }`}
      >
        {selectedModel === 'gpt-5.4' ? 'Cost note: ' : 'Model note: '}
        {modelCostHint(selectedModel)}
      </div>
      <select
        value={outputType}
        onChange={(e) => setOutputType(e.target.value as OutputType)}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      >
        <option value="app">{t('outputType.app')}</option>
        <option value="website">{t('outputType.website')}</option>
        <option value="document">{t('outputType.document')}</option>
        <option value="plan">{t('outputType.plan')}</option>
        <option value="other">{t('outputType.other')}</option>
      </select>
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>{t('projectForm.debateRounds')}</label>
      <select
        value={debateRounds}
        onChange={(e) => setDebateRounds(Number(e.target.value))}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      >
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
      </select>
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>{t('projectForm.debateMode')}</label>
      <select
        value={debateMode}
        onChange={(e) => setDebateMode(e.target.value as DebateMode)}
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      >
        <option value="auto">{t('projectForm.debateModeAuto')}</option>
        <option value="interactive">{t('projectForm.debateModeInteractive')}</option>
      </select>
      <label className={`${isMobile ? 'mb-2 text-sm' : 'mb-1 text-[10px]'} block font-medium text-gray-300`}>{t('projectForm.maxWordsPerAgent')}</label>
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
        className={`${isMobile ? 'mb-4 rounded-[1.25rem] px-4 py-3.5 text-base' : 'mb-2 rounded px-2 py-1.5 text-xs'} w-full border border-gray-600 bg-gray-800 text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30`}
      />

      <div className={`${isMobile ? 'mb-4 rounded-[1.25rem] p-4' : 'mb-2 rounded p-2'} border border-gray-700 bg-gray-950/40`}>
        <div className={`flex items-center ${isMobile ? 'gap-4' : 'gap-2'}`}>
          <p className={`${isMobile ? 'text-sm' : 'text-[10px]'} font-medium text-gray-300`}>{t('projectForm.attachments')}</p>
          <div ref={attachmentMenuRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setShowAttachmentMenu((previous) => !previous)}
              className={`${isMobile ? 'h-12 w-12 rounded-[1rem] text-xl' : 'h-7 w-7 rounded text-sm'} border border-gray-700 bg-gray-900 text-gray-200`}
              title={t('attachments.menuOpen')}
            >
              +
            </button>
            {showAttachmentMenu && (
              <div className={`absolute right-0 z-20 border border-gray-700 bg-gray-950 ${isMobile ? 'top-14 w-52 rounded-[1.25rem] p-2' : 'top-8 w-32 rounded p-1'}`}>
                <button type="button" onClick={() => fileInputRef.current?.click()} className={`w-full text-left text-gray-200 hover:bg-gray-900 ${isMobile ? 'rounded-xl px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}>{t('attachments.option.file')}</button>
                <button type="button" onClick={() => photoInputRef.current?.click()} className={`w-full text-left text-gray-200 hover:bg-gray-900 ${isMobile ? 'rounded-xl px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}>{t('attachments.option.photo')}</button>
                <button type="button" onClick={() => pdfInputRef.current?.click()} className={`w-full text-left text-gray-200 hover:bg-gray-900 ${isMobile ? 'rounded-xl px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}>{t('attachments.option.pdf')}</button>
                <button type="button" onClick={() => zipInputRef.current?.click()} className={`w-full text-left text-gray-200 hover:bg-gray-900 ${isMobile ? 'rounded-xl px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}>{t('attachments.option.zip')}</button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLinkInput(true);
                    setShowAttachmentMenu(false);
                  }}
                  className={`w-full text-left text-gray-200 hover:bg-gray-900 ${isMobile ? 'rounded-xl px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}
                >
                  {t('attachments.option.link')}
                </button>
              </div>
            )}
          </div>
        </div>

        {showLinkInput && (
          <div className={`${isMobile ? 'mt-4 gap-3' : 'mt-2 gap-1.5'} flex`}>
            <input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder={t('attachments.linkPlaceholder')}
              className={`flex-1 border border-gray-700 bg-gray-900 text-gray-100 placeholder-gray-400 ${isMobile ? 'rounded-[1.25rem] px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}
            />
            <button type="button" onClick={addLinkAttachment} disabled={!linkValue.trim()} className={`border border-blue-700/60 bg-blue-900/40 text-blue-100 disabled:opacity-50 ${isMobile ? 'rounded-[1.25rem] px-4 py-3 text-base' : 'rounded px-2 py-1 text-[11px]'}`}>
              {t('attachments.addLink')}
            </button>
          </div>
        )}

        {attachments.length > 0 ? (
          <div className={`flex flex-wrap ${isMobile ? 'mt-4 gap-3' : 'mt-2 gap-1'}`}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={`inline-flex items-center border border-gray-700 bg-gray-900 text-gray-200 ${isMobile ? 'gap-3 rounded-[1.1rem] px-3 py-3 text-sm' : 'gap-1 rounded px-1.5 py-1 text-[10px]'}`}>
                <span className={`${isMobile ? 'max-w-44' : 'max-w-28'} truncate`}>{attachment.title}</span>
                <span className="text-gray-400">{t(`attachments.kind.${attachment.kind}` as const)}</span>
                {'file' in attachment && attachment.file.size > 0 && (
                  <span className="text-gray-500">{formatSize(attachment.file.size)}</span>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))}
                  className={`rounded border border-gray-700 text-gray-300 ${isMobile ? 'px-2' : 'px-1'}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={`${isMobile ? 'mt-3 text-sm' : 'mt-1 text-[10px]'} text-gray-500`}>{t('projectForm.attachmentsEmpty')}</p>
        )}

        <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => onFilePicked(event, 'file')} />
        <input ref={photoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onFilePicked(event, 'image')} />
        <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(event) => onFilePicked(event, 'pdf')} />
        <input ref={zipInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" onChange={(event) => onFilePicked(event, 'zip')} />
      </div>

      <div className={`flex ${isMobile ? 'gap-4' : 'gap-2'}`} style={isMobile ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}>
        <button
          type="submit"
          disabled={!name.trim() || !description.trim()}
          className={`flex-1 bg-blue-600 font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-300 disabled:opacity-80 ${isMobile ? 'rounded-[1.25rem] py-4 text-lg' : 'rounded py-1.5 text-xs'}`}
        >
          {t('projectForm.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`flex-1 bg-gray-700 text-gray-300 transition-colors hover:bg-gray-600 ${isMobile ? 'rounded-[1.25rem] py-4 text-lg' : 'rounded py-1.5 text-xs'}`}
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
  const [buildInfo, setBuildInfo] = useState<{ branch: string; commit: string; openaiModelDefault: OpenAIModel } | null>(null);
  const isMobile = mode === 'mobile';

  useEffect(() => {
    let isMounted = true;
    fetch('/api/build-info')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        if (typeof data.branch === 'string' && typeof data.commit === 'string') {
          setBuildInfo({
            branch: data.branch,
            commit: data.commit,
            openaiModelDefault: resolveOpenAiModel(data.openaiModelDefault),
          });
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
    model: OpenAIModel,
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
        model,
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
      <div className={`flex-shrink-0 flex items-center justify-between ${isMobile ? 'border-b border-gray-800 px-6 py-5' : 'px-3 py-2'}`}>
        <span className={`${isMobile ? 'text-sm' : 'text-[10px]'} font-semibold text-gray-400 uppercase tracking-widest`}>
          {t('sidebar.projects')}
        </span>
        <button
          onClick={() => setShowForm(true)}
          title={t('sidebar.newProject')}
          className={`${isMobile ? 'min-h-14 min-w-14 rounded-[1.1rem] border border-gray-700 bg-gray-900 text-2xl' : 'w-5 h-5 rounded text-sm'} flex items-center justify-center text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100`}
        >
          +
        </button>
      </div>

      {showForm ? (
        <div
          className={`min-h-0 flex-1 ${isMobile ? 'overflow-y-auto overscroll-contain' : ''}`}
          style={isMobile ? { paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' } : undefined}
        >
          <NewProjectForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            t={t}
            defaultLanguage={language}
            defaultModel={buildInfo?.openaiModelDefault ?? 'gpt-4.1-mini'}
            isMobile={isMobile}
          />
        </div>
      ) : (
        <>
          {/* Project list */}
          <div className="flex-1 overflow-y-auto">
            {state.projects.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="mb-5 text-base text-gray-400">{t('sidebar.noProjects')}</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="rounded-[1.25rem] bg-blue-700 px-5 py-4 text-lg text-white transition-colors hover:bg-blue-600"
                >
                  {t('sidebar.createFirst')}
                </button>
              </div>
            ) : (
              <div className="py-3">
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
                      className={`w-full text-left transition-colors ${isMobile ? 'px-6 py-5' : 'px-3 py-2.5'} ${
                        isSelected
                          ? 'bg-blue-600/20 border-r-2 border-blue-500'
                          : 'hover:bg-gray-800/60'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <span className={`mt-2.5 h-2.5 w-2.5 rounded-full flex-shrink-0 ${sCfg.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p
                            className={`${isMobile ? 'text-base' : 'text-xs'} font-medium truncate ${
                              isSelected ? 'text-blue-300' : 'text-gray-300'
                            }`}
                          >
                            {project.name}
                          </p>
                          <p className={`mt-2 ${isMobile ? 'text-sm' : 'text-[10px]'} ${sCfg.color}`}>{statusLabel}</p>
                          <div className="mt-3 flex items-center gap-2">
                            <span className={`${isMobile ? 'text-sm px-3 py-1.5 rounded-xl' : 'text-[9px] px-1.5 py-0.5 rounded'} border border-gray-700 bg-gray-900 text-gray-300`}>
                              {project.language.toUpperCase()}
                            </span>
                            <span className={`${isMobile ? 'text-sm px-3 py-1.5 rounded-xl' : 'text-[9px] px-1.5 py-0.5 rounded'} border border-cyan-900/60 bg-cyan-950/30 text-cyan-200`}>
                              {project.model}
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
            className={`flex-shrink-0 border-t border-gray-800 p-3 ${isMobile ? 'px-6 pt-5 pb-7' : ''}`}
            style={isMobile ? { paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' } : undefined}
          >
            {buildInfo && (
              <p className="mt-2 text-center text-xs text-gray-500">
                {buildInfo.branch} {buildInfo.commit}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
