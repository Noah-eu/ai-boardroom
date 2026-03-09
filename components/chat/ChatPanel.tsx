'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Message, MessageSender } from '@/types';
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

interface MessageBubbleProps {
  message: Message;
  t: (key: TranslationKey) => string;
  tf: (key: TranslationKey, vars: Record<string, string | number>) => string;
  locale: string;
  approvalRound: number;
}

function MessageBubble({ message, t, tf, locale, approvalRound }: MessageBubbleProps) {
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

  if (isSystem) {
    return (
      <div className="flex gap-3 py-2">
        <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white ${bgColor}`}>
          {getInitials(message.sender)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-xs font-semibold ${color}`}>
              {message.sender === 'orchestrator' ? t('chat.orchestrator') : message.sender}
            </span>
            {message.agentRole && (
              <span className="text-[10px] text-gray-400">{message.agentRole}</span>
            )}
            <span className="text-[10px] text-gray-400 ml-auto">{formatTime(message.timestamp, locale)}</span>
          </div>
          <div className="bg-purple-950/40 border border-purple-800/30 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isApprovalRequest) {
    return (
      <div className="my-3 flex flex-col items-center gap-2">
        <div className="bg-yellow-950/40 border border-yellow-700/40 rounded-lg px-4 py-3 max-w-lg w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-yellow-400 text-sm">⚠</span>
                  <span className="text-xs font-semibold text-yellow-300">{tf('chat.approvalRequiredRound', { round: approvalRound })}</span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  if (isApprovalResponse) {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-xs">
          <div className="flex items-baseline gap-2 mb-1 justify-end">
            <span className="text-[10px] text-gray-400">{formatTime(message.timestamp, locale)}</span>
            <span className="text-xs font-semibold text-blue-300">{t('chat.you')}</span>
          </div>
          <div className={`rounded-lg px-3 py-2 ${
            isApprovedResponse
              ? 'bg-green-950/50 border border-green-700/40'
              : 'bg-red-950/50 border border-red-700/40'
          }`}>
            <p className="text-xs text-gray-200">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-xs">
          <div className="flex items-baseline gap-2 mb-1 justify-end">
            <span className="text-[10px] text-gray-400">{formatTime(message.timestamp, locale)}</span>
            <span className="text-xs font-semibold text-blue-300">{t('chat.you')}</span>
          </div>
          <div className="bg-blue-600/20 border border-blue-600/30 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-200 leading-relaxed">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-2">
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white ${bgColor}`}>
        {getInitials(message.sender)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-xs font-semibold ${color}`}>{message.sender}</span>
          {message.agentRole && (
            <span className="text-[10px] text-gray-400">{message.agentRole}</span>
          )}
          <span className="text-[10px] text-gray-400 ml-auto">{formatTime(message.timestamp, locale)}</span>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2">
          <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
}

interface ApprovalActionsProps {
  onApprove: () => void;
  onReject: (feedback: string) => void;
  t: (key: TranslationKey) => string;
}

function ApprovalActions({ onApprove, onReject, t }: ApprovalActionsProps) {
  const [feedback, setFeedback] = useState('');
  const trimmedFeedback = feedback.trim();

  return (
    <div className="flex-shrink-0 border-t border-yellow-800/30 bg-yellow-950/20 px-4 py-3">
      <p className="text-xs text-yellow-300 mb-2 font-medium">{t('chat.reviewPlan')}</p>
      <label className="block text-[10px] text-gray-300 mb-1">{t('chat.revisionFeedback')}</label>
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        rows={2}
        className="mb-2 w-full resize-none rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        placeholder={t('chat.revisionFeedbackPlaceholder')}
      />
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors"
        >
          ✓ {t('chat.approve')}
        </button>
        <button
          onClick={() => {
            if (!trimmedFeedback) {
              return;
            }
            onReject(trimmedFeedback);
            setFeedback('');
          }}
          disabled={!trimmedFeedback}
          className="flex-1 px-3 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
        >
          ✕ {t('chat.reject')}
        </button>
      </div>
      {!trimmedFeedback && (
        <p className="mt-1 text-[10px] text-gray-400">{t('chat.revisionFeedbackRequired')}</p>
      )}
    </div>
  );
}

export function ChatPanel() {
  const {
    state,
    approvePlan,
    rejectPlan,
    addUserMessage,
    startDebate,
    t,
    tf,
    language,
    setProjectSimulationMode,
  } = useApp();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const locale = language === 'cz' ? 'cs-CZ' : 'en-US';

  const activeProject = state.activeProject;
  const messages = activeProject?.messages ?? [];
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

  const handleSend = () => {
    if (!inputValue.trim()) return;
    const text = inputValue.trim();
    setInputValue('');
    if (state.currentPhase === 'idle' && state.activeProject) {
      startDebate(text);
    } else {
      addUserMessage(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!activeProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-950 text-center px-8">
        <div className="text-4xl mb-4">🤖</div>
        <h3 className="text-base font-semibold text-gray-200 mb-2">{t('chat.noProjectTitle')}</h3>
        <p className="text-sm text-gray-400 max-w-xs">
          {t('chat.noProjectDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-100 truncate">
              {activeProject.name}
            </h2>
            <p className="text-xs text-gray-400 truncate">{activeProject.description}</p>
          </div>
          <button
            type="button"
            onClick={() => setProjectSimulationMode(activeProject.id, !activeProject.simulationMode)}
            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors ${
              activeProject.simulationMode
                ? 'border-emerald-700/60 bg-emerald-900/40 text-emerald-200'
                : 'border-blue-700/60 bg-blue-900/40 text-blue-200'
            }`}
            title={t('sidebar.simulationMode')}
          >
            {activeProject.simulationMode ? t('projectForm.simulationOn') : t('projectForm.simulationOff')}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-3">💬</div>
            <p className="text-sm text-gray-400">
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
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Approval actions */}
      {showApprovalActionsResolved && (
        <ApprovalActions onApprove={approvePlan} onReject={rejectPlan} t={t} />
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3">
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              state.currentPhase === 'idle'
                ? t('chat.placeholderStart')
                : t('chat.placeholderMessage')
            }
            rows={2}
            className="flex-1 resize-none bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-300 disabled:opacity-90 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors self-end"
          >
            {t('chat.send')}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">{t('chat.hint')}</p>
      </div>
    </div>
  );
}
