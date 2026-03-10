'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Message, MessageSender, ProjectAttachment } from '@/types';
import { TranslationKey } from '@/i18n';

const senderColors: Record<string, string> = {
  user: 'text-blue-300',
  orchestrator: 'text-purple-300',
  Strategist: 'text-indigo-300',
  Skeptic: 'text-orange-300',
  Pragmatist: 'text-teal-300',
  Planner: 'text-blue-300',
  Architect: 'text-violet-300',
  Builder: 'text-emerald-300',
  Reviewer: 'text-sky-300',
  Tester: 'text-pink-300',
  Integrator: 'text-amber-300',
};

const senderBgColors: Record<string, string> = {
  user: 'bg-blue-600',
  orchestrator: 'bg-purple-700',
  Strategist: 'bg-indigo-700',
  Skeptic: 'bg-orange-700',
  Pragmatist: 'bg-teal-700',
  Planner: 'bg-blue-700',
  Architect: 'bg-violet-700',
  Builder: 'bg-emerald-700',
  Reviewer: 'bg-sky-700',
  Tester: 'bg-pink-700',
  Integrator: 'bg-amber-700',
};

function getInitials(sender: MessageSender): string {
  if (sender === 'user') return 'U';
  if (sender === 'orchestrator') return 'OR';
  return sender.slice(0, 2).toUpperCase();
}

function formatTime(date: Date, locale: string): string {
  return new Date(date).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

type DraftAttachment =
  | {
      id: string;
      kind: 'image' | 'pdf' | 'zip' | 'file';
      file: File;
      title: string;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      title: string;
    };

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

interface MessageBubbleProps {
  message: Message;
  t: (key: TranslationKey) => string;
  tf: (key: TranslationKey, vars: Record<string, string | number>) => string;
  locale: string;
  approvalRound: number;
  attachmentMap: Record<string, ProjectAttachment>;
  isMobile?: boolean;
}

function MessageBubble({ message, t, tf, locale, approvalRound, attachmentMap, isMobile = false }: MessageBubbleProps) {
    const normalizedContent = message.content.toLowerCase();
    const isApprovedResponse =
      normalizedContent.includes('approved') ||
      normalizedContent.includes('schval') ||
      normalizedContent.includes('schvaleno');
  const isUser = message.sender === 'user';
  const isSystem = message.type === 'system';
  const isApprovalRequest = message.type === 'approval-request';
  const isApprovalResponse = message.type === 'approval-response';
  const color = senderColors[message.sender] ?? 'text-gray-300';
  const bgColor = senderBgColors[message.sender] ?? 'bg-gray-700';
  const bubbleWidthClass = isMobile && (isUser || isApprovalResponse) ? 'max-w-sm' : 'max-w-xs';
  const avatarClass = isMobile ? 'h-9 w-9 text-xs' : 'h-7 w-7 text-[10px]';
  const metaTextClass = isMobile ? 'text-xs' : 'text-xs';
  const bodyTextClass = isMobile ? 'text-sm' : 'text-xs';
  const messageAttachments = (message.attachmentIds ?? [])
    .map((attachmentId) => attachmentMap[attachmentId])
    .filter((attachment): attachment is ProjectAttachment => Boolean(attachment));

  const renderAttachmentList = () => {
    if (messageAttachments.length === 0) return null;

    return (
      <div className="mt-2 space-y-1">
        {messageAttachments.map((attachment) => (
          <div key={attachment.id} className={`${isMobile ? 'rounded-xl px-3 py-2' : 'rounded px-2 py-1'} border border-gray-600/60 bg-gray-900/70`}>
            <p className={`truncate ${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-100`}>{attachment.title}</p>
            <p className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>
              {t('attachments.kindLabel')}: {t(`attachments.kind.${attachment.kind}` as TranslationKey)}
              {attachment.size ? ` • ${formatSize(attachment.size)}` : ''}
            </p>
          </div>
        ))}
      </div>
    );
  };

  if (isSystem) {
    return (
      <div className="flex gap-3 py-2">
        <div className={`${avatarClass} rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white ${bgColor}`}>
          {getInitials(message.sender)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`${metaTextClass} font-semibold ${color}`}>
              {message.sender === 'orchestrator' ? t('chat.orchestrator') : message.sender}
            </span>
            {message.agentRole && (
              <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{message.agentRole}</span>
            )}
            <span className={`ml-auto ${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{formatTime(message.timestamp, locale)}</span>
          </div>
          <div className={`${isMobile ? 'rounded-xl px-4 py-3' : 'rounded-lg px-3 py-2'} border border-purple-800/30 bg-purple-950/40`}>
            <p className={`${bodyTextClass} leading-relaxed whitespace-pre-wrap text-gray-300`}>{message.content}</p>
            {renderAttachmentList()}
          </div>
        </div>
      </div>
    );
  }

  if (isApprovalRequest) {
    return (
      <div className="my-3 flex flex-col items-center gap-2">
        <div className={`${isMobile ? 'w-full max-w-xl rounded-xl px-5 py-4' : 'w-full max-w-lg rounded-lg px-4 py-3'} border border-yellow-700/40 bg-yellow-950/40`}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`${isMobile ? 'text-lg' : 'text-sm'} text-yellow-400`}>⚠</span>
                  <span className={`${isMobile ? 'text-sm' : 'text-xs'} font-semibold text-yellow-300`}>{tf('chat.approvalRequiredRound', { round: approvalRound })}</span>
          </div>
          <p className={`${isMobile ? 'text-sm' : 'text-xs'} leading-relaxed text-gray-300`}>{message.content}</p>
        </div>
      </div>
    );
  }

  if (isApprovalResponse) {
    return (
      <div className="flex justify-end py-2">
        <div className={bubbleWidthClass}>
          <div className="flex items-baseline gap-2 mb-1 justify-end">
            <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{formatTime(message.timestamp, locale)}</span>
            <span className={`${isMobile ? 'text-sm' : 'text-xs'} font-semibold text-blue-300`}>{t('chat.you')}</span>
          </div>
          <div className={`${isMobile ? 'rounded-xl px-4 py-3' : 'rounded-lg px-3 py-2'} ${
            isApprovedResponse
              ? 'bg-green-950/50 border border-green-700/40'
              : 'bg-red-950/50 border border-red-700/40'
          }`}>
            <p className={`${isMobile ? 'text-sm' : 'text-xs'} text-gray-200`}>{message.content}</p>
            {renderAttachmentList()}
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end py-2">
        <div className={bubbleWidthClass}>
          <div className="flex items-baseline gap-2 mb-1 justify-end">
            <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{formatTime(message.timestamp, locale)}</span>
            <span className={`${isMobile ? 'text-sm' : 'text-xs'} font-semibold text-blue-300`}>{t('chat.you')}</span>
          </div>
          <div className={`${isMobile ? 'rounded-xl px-4 py-3' : 'rounded-lg px-3 py-2'} border border-blue-600/30 bg-blue-600/20`}>
            <p className={`${isMobile ? 'text-sm' : 'text-xs'} leading-relaxed text-gray-200`}>{message.content}</p>
            {renderAttachmentList()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-2">
      <div className={`${avatarClass} rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white ${bgColor}`}>
        {getInitials(message.sender)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`${metaTextClass} font-semibold ${color}`}>{message.sender}</span>
          {message.agentRole && (
            <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{message.agentRole}</span>
          )}
          <span className={`ml-auto ${isMobile ? 'text-xs' : 'text-[10px]'} text-gray-400`}>{formatTime(message.timestamp, locale)}</span>
        </div>
        <div className={`${isMobile ? 'rounded-xl px-4 py-3' : 'rounded-lg px-3 py-2'} border border-gray-700/40 bg-gray-800/60`}>
          <p className={`${isMobile ? 'text-sm' : 'text-xs'} leading-relaxed whitespace-pre-wrap text-gray-300`}>{message.content}</p>
          {renderAttachmentList()}
        </div>
      </div>
    </div>
  );
}

interface ApprovalActionsProps {
  onApprove: () => void;
  t: (key: TranslationKey) => string;
  isMobile?: boolean;
}

function ApprovalActions({ onApprove, t, isMobile = false }: ApprovalActionsProps) {
  return (
    <div className={`flex-shrink-0 border-t border-yellow-800/30 bg-yellow-950/20 ${isMobile ? 'px-4 py-4' : 'px-4 py-3'}`}>
      <p className={`${isMobile ? 'mb-3 text-sm' : 'mb-2 text-xs'} font-medium text-yellow-300`}>{t('chat.reviewPlan')}</p>
      <p className={`${isMobile ? 'mb-3 rounded-xl px-3 py-2 text-sm' : 'mb-2 rounded px-2 py-1.5 text-[11px]'} border border-yellow-700/40 bg-yellow-950/30 text-yellow-200`}>
        {t('chat.revisionFeedbackHint')}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className={`w-full bg-green-700 font-medium text-white transition-colors hover:bg-green-600 ${isMobile ? 'rounded-xl px-4 py-3 text-sm' : 'rounded-lg px-3 py-2 text-xs'}`}
        >
          ✓ {t('chat.approve')}
        </button>
      </div>
    </div>
  );
}

interface ChatPanelProps {
  mode?: 'desktop' | 'mobile';
}

export function ChatPanel({ mode = 'desktop' }: ChatPanelProps) {
  const {
    state,
    approvePlan,
    rejectPlan,
    addUserMessage,
    addLog,
    attachToProject,
    startDebate,
    t,
    tf,
    language,
  } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const locale = language === 'cz' ? 'cs-CZ' : 'en-US';
  const isMobile = mode === 'mobile';

  const activeProject = state.activeProject;
  const messages = activeProject?.messages ?? [];
  const attachmentMap = (activeProject?.attachments ?? []).reduce<Record<string, ProjectAttachment>>(
    (acc, attachment) => {
      acc[attachment.id] = attachment;
      return acc;
    },
    {}
  );
  const isAwaitingApproval = state.currentPhase === 'awaiting-approval';
  const approvalRound = (activeProject?.revisionRound ?? 0) + 1;

  const lastApprovalRequestIndex = messages
    .map((message, index) => (message.type === 'approval-request' ? index : -1))
    .reduce((current, value) => Math.max(current, value), -1);
  const lastApprovalResponseIndex = messages
    .map((message, index) => (message.type === 'approval-response' ? index : -1))
    .reduce((current, value) => Math.max(current, value), -1);
  const hasPendingApprovalRequest = lastApprovalRequestIndex > lastApprovalResponseIndex;
  const showApprovalActionsResolved = isAwaitingApproval && hasPendingApprovalRequest;

  const messagesCount = messages.length;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesCount]);

  useEffect(() => {
    if (state.currentPhase !== 'debate') {
      setComposerNotice(null);
    }
  }, [state.currentPhase]);

  const removeDraftAttachment = (attachmentId: string) => {
    setDraftAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  };

  const addFileDraft = (file: File, kind: 'image' | 'pdf' | 'zip' | 'file') => {
    const draft: DraftAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      file,
      title: file.name,
    };
    setDraftAttachments((previous) => [...previous, draft]);
  };

  const onFilePicked = (
    event: React.ChangeEvent<HTMLInputElement>,
    kind: 'image' | 'pdf' | 'zip' | 'file'
  ) => {
    const files = Array.from(event.target.files ?? []);
    files.forEach((file) => addFileDraft(file, kind));
    event.target.value = '';
    setShowAttachmentMenu(false);
  };

  const handleAddLink = () => {
    const normalized = normalizeUserUrl(linkValue);
    if (!normalized) return;
    const draft: DraftAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'url',
      url: normalized,
      title: normalized,
    };
    setDraftAttachments((previous) => [...previous, draft]);
    setLinkValue('');
    setShowLinkInput(false);
    setShowAttachmentMenu(false);
  };

  const uploadDraftAttachments = async () => {
    if (!activeProject) {
      return [] as string[];
    }

    const normalizedPendingLink = normalizeUserUrl(linkValue);
    const pendingLinkAlreadyAdded = draftAttachments.some(
      (attachment) => attachment.kind === 'url' && attachment.url === normalizedPendingLink
    );

    const attachmentsToUpload: DraftAttachment[] =
      normalizedPendingLink && !pendingLinkAlreadyAdded
        ? [
            ...draftAttachments,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              kind: 'url',
              url: normalizedPendingLink,
              title: normalizedPendingLink,
            },
          ]
        : draftAttachments;

    if (attachmentsToUpload.length === 0) {
      return [] as string[];
    }

    const uploaded = await Promise.all(
      attachmentsToUpload.map(async (attachment) => {
        if (attachment.kind === 'url') {
          return attachToProject(activeProject.id, { kind: 'url', url: attachment.url, source: 'message' });
        }
        return attachToProject(activeProject.id, {
          kind: attachment.kind,
          file: attachment.file,
          source: 'message',
        });
      })
    );

    return uploaded.map((artifact) => artifact.id);
  };

  const handleNormalSend = async () => {
    if (!inputValue.trim() && draftAttachments.length === 0) return;
    if (!activeProject) return;

    setIsSending(true);
    const text = inputValue.trim();

    try {
      const attachmentIds = await uploadDraftAttachments();
      setInputValue('');
      setLinkValue('');
      setDraftAttachments([]);

      if (state.currentPhase === 'idle' && text) {
        startDebate(text);
      } else {
        addUserMessage(text || t('attachments.messageOnly'), attachmentIds);
        addLog(
          `Project/message attachment link success: source=message count=${attachmentIds.length}`,
          'success'
        );
        if (state.currentPhase === 'debate') {
          setComposerNotice(t('chat.debateSupplementalHint'));
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'message link failed';
      addLog(`Project/message attachment link failed: source=message ${detail}`, 'error');
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  const handleApprovalFeedbackSend = async () => {
    if (!isAwaitingApproval) return;
    if (!inputValue.trim()) return;
    if (!activeProject) return;

    setIsSending(true);
    const feedback = inputValue.trim();

    try {
      const attachmentIds = await uploadDraftAttachments();
      setInputValue('');
      setLinkValue('');
      setDraftAttachments([]);
      setComposerNotice(null);
      rejectPlan(feedback, attachmentIds);
      addLog(
        `Project/message attachment link success: source=message(awaiting-approval) count=${attachmentIds.length}`,
        'success'
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'approval feedback link failed';
      addLog(`Project/message attachment link failed: source=message(awaiting-approval) ${detail}`, 'error');
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    if (isAwaitingApproval) {
      await handleApprovalFeedbackSend();
      return;
    }
    await handleNormalSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!activeProject) {
    return (
      <div className={`h-full flex flex-col items-center justify-center bg-gray-950 text-center ${isMobile ? 'px-5 py-8' : 'px-8'}`}>
        <div className="text-4xl mb-4">🤖</div>
        <h3 className="text-base font-semibold text-gray-200 mb-2">{t('chat.noProjectTitle')}</h3>
        <p className={`text-gray-400 ${isMobile ? 'max-w-sm text-sm leading-relaxed' : 'max-w-xs text-sm'}`}>
          {t('chat.noProjectDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Header */}
      {!isMobile && (
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-100 truncate">
              {activeProject.name}
            </h2>
            <p className="text-xs text-gray-400 truncate">{activeProject.description}</p>
          </div>
        </div>
      </div>
      )}

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto space-y-1 ${isMobile ? 'px-4 py-4' : 'px-4 py-2'}`}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-3">💬</div>
            <p className={`text-gray-400 ${isMobile ? 'max-w-sm text-sm leading-relaxed' : 'text-sm'}`}>
              {t('chat.emptyPrompt')}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              t={t}
              tf={tf}
              locale={locale}
              approvalRound={approvalRound}
              attachmentMap={attachmentMap}
              isMobile={isMobile}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Approval actions */}
      {showApprovalActionsResolved && (
        <ApprovalActions
          onApprove={approvePlan}
          t={t}
          isMobile={isMobile}
        />
      )}

      {/* Input */}
      <div
        className={`flex-shrink-0 border-t border-gray-800 ${isMobile ? 'bg-gray-950/95 px-3 pt-3 backdrop-blur' : 'px-4 py-3'}`}
        style={isMobile ? { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' } : undefined}
      >
        <div className="mb-3 flex items-center justify-between rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300">
          <span className="font-medium">
            {t('chat.modeNormal')}
          </span>
          {isAwaitingApproval ? (
            <span className="text-yellow-300">{t('chat.revisionModeActiveHint')}</span>
          ) : null}
        </div>

        {draftAttachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {draftAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
              >
                <span className="max-w-40 truncate">{attachment.title}</span>
                <span className="text-gray-400">{t(`attachments.kind.${attachment.kind}` as TranslationKey)}</span>
                {'file' in attachment && attachment.file.size > 0 && (
                  <span className="text-gray-500">{formatSize(attachment.file.size)}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeDraftAttachment(attachment.id)}
                  className="rounded border border-gray-700 px-1.5 text-gray-300 hover:text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={isMobile ? 'space-y-3' : 'flex gap-2'}>
          <div className={isMobile ? 'flex gap-2' : 'contents'}>
            <div className="relative self-end">
              <button
                type="button"
                onClick={() => setShowAttachmentMenu((previous) => !previous)}
                className={`${isMobile ? 'h-14 w-14 text-2xl rounded-xl' : 'h-10 w-10 text-lg rounded-lg'} border border-gray-700 bg-gray-900 text-gray-200 hover:border-blue-600/60`}
                title={t('attachments.menuOpen')}
              >
                +
              </button>

              {showAttachmentMenu && (
                <div className={`absolute left-0 z-20 rounded-xl border border-gray-700 bg-gray-950 p-2 shadow-xl ${isMobile ? 'bottom-16 w-52' : 'bottom-12 w-36'}`}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-200 hover:bg-gray-900"
                  >
                    {t('attachments.option.file')}
                  </button>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-200 hover:bg-gray-900"
                  >
                    {t('attachments.option.photo')}
                  </button>
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-200 hover:bg-gray-900"
                  >
                    {t('attachments.option.pdf')}
                  </button>
                  <button
                    type="button"
                    onClick={() => zipInputRef.current?.click()}
                    className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-200 hover:bg-gray-900"
                  >
                    {t('attachments.option.zip')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLinkInput((previous) => !previous)}
                    className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-200 hover:bg-gray-900"
                  >
                    {t('attachments.option.link')}
                  </button>
                </div>
              )}
            </div>

            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isAwaitingApproval
                  ? t('chat.revisionFeedbackPlaceholder')
                  : state.currentPhase === 'idle'
                  ? t('chat.placeholderStart')
                  : t('chat.placeholderMessage')
              }
              rows={isMobile ? 3 : 2}
              className={`flex-1 resize-none rounded-xl px-4 py-3 text-base text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 transition-colors ${
                isAwaitingApproval
                  ? 'bg-orange-950/30 border border-orange-600/50 focus:border-orange-500 focus:ring-orange-500/30'
                  : 'bg-gray-900 border border-gray-600 focus:border-blue-500 focus:ring-blue-500/30'
              } ${isMobile ? 'min-h-[124px]' : ''}`}
            />
          </div>
          <button
            onClick={() => void handleSend()}
            disabled={(isAwaitingApproval ? !inputValue.trim() : (!inputValue.trim() && draftAttachments.length === 0)) || isSending}
            className={`${isMobile ? 'min-h-14 w-full rounded-xl' : 'self-end px-4 rounded-lg'} bg-blue-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-300 disabled:opacity-90`}
          >
            {isSending ? t('attachments.sending') : t('chat.send')}
          </button>
        </div>

        {showLinkInput && (
          <div className={`mt-3 ${isMobile ? 'space-y-3' : 'flex gap-2'}`}>
            <input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder={t('attachments.linkPlaceholder')}
              className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-400"
            />
            <button
              type="button"
              onClick={handleAddLink}
              disabled={!linkValue.trim()}
              className={`${isMobile ? 'min-h-14 w-full rounded-xl' : 'rounded'} border border-blue-700/60 bg-blue-900/40 px-3 py-2.5 text-sm text-blue-100 disabled:opacity-50`}
            >
              {t('attachments.addLink')}
            </button>
          </div>
        )}

        <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => onFilePicked(event, 'file')} />
        <input
          ref={photoInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => onFilePicked(event, 'image')}
        />
        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(event) => onFilePicked(event, 'pdf')}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(event) => onFilePicked(event, 'zip')}
        />

        {composerNotice && <p className="mt-2 text-xs text-yellow-300">{composerNotice}</p>}
        {isAwaitingApproval && !inputValue.trim() && (
          <p className="mt-2 text-xs text-gray-400">{t('chat.revisionFeedbackRequired')}</p>
        )}
        <p className="mt-2 text-xs text-gray-400">{t('chat.hint')}</p>
      </div>
    </div>
  );
}
