//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { ChatMessage } from '@/types/session';
import { ALL_FIELDS, TOTAL_STEPS, type IntakeField, type IntakeAnswer } from '@/lib/intake-flow';
import { useTranslation } from '@/hooks/use-translation';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Shape of /api/intake responses (POST and GET share these fields). */
interface IntakeResponse {
  type?: 'question' | 'ready';
  field?: IntakeField;
  next?: IntakeField | null;
  answers?: IntakeAnswer[];
  step?: { current: number | null; total: number } | null;
  /** Message key for a rejected answer; resolved with `t()` before display. */
  errorKey?: string;
  editedField?: string;
}

/** 1-based step number for a field, or null. */
function stepFor(field: IntakeField | null): number | null {
  if (!field) return null;
  const idx = ALL_FIELDS.findIndex((f) => f.key === field.key);
  return idx === -1 ? null : idx + 1;
}

interface ChatInterfaceProps {
  initialMessages: ChatMessage[];
  initialNextQuestion: IntakeField | null;
  onReady: (runId: string) => void;
}

// Module-level counter for generating stable, unique per-component message IDs.
// Using a counter (not crypto.randomUUID) keeps the ID predictable and avoids
// a hydration mismatch: the same counter value is produced whether the component
// is initialized during SSR or on the client.
let _id = 0;
function uid(): string {
  return `m${++_id}`;
}

/**
 * ChatInterface — chat-style intake conversation.
 *
 * - Fresh session: shows welcome message + first question.
 * - Resumed session: shows prior user messages + "welcome back" + next question.
 * - On 'ready' from server: POSTs to /api/workflow/start, calls onReady(runId).
 * - Skip button appears once Tier-2 questions begin.
 * - Send button disabled while request in-flight (prevents double-submit).
 */
export default function ChatInterface({
  initialMessages,
  initialNextQuestion,
  onReady,
}: ChatInterfaceProps) {
  const { t, tv, locale } = useTranslation();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  // Intake progress + editable-answers state
  const [currentField, setCurrentField] = useState<IntakeField | null>(initialNextQuestion);
  const [answers, setAnswers] = useState<IntakeAnswer[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // The answer just saved, highlighted in the panel for a few seconds so the
  // applicant can see the change went through.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  /*
   * Focus the answer being edited, with the caret after its text, so typing
   * starts straight away. `autoFocus` alone leaves the caret wherever the
   * browser puts it (before the text, in some), and applies only on mount.
   */
  useEffect(() => {
    const input = editInputRef.current;

    if (!editingKey || !input) return;

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editingKey]);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  // Populate initial message list once on mount
  useEffect(() => {
    const init: LocalMessage[] = [];

    if (initialMessages.length === 0) {
      init.push({ id: uid(), role: 'assistant', content: t('chat_welcome') });
    } else {
      for (const m of initialMessages) {
        init.push({ id: uid(), role: m.role, content: m.content });
      }
      init.push({ id: uid(), role: 'assistant', content: t('chat_welcome_back') });
    }

    if (initialNextQuestion && initialMessages.length > 0) {
      const text = initialNextQuestion.rationaleKey
        ? `${t(initialNextQuestion.promptKey)}\n\n${t(initialNextQuestion.rationaleKey)}`
        : t(initialNextQuestion.promptKey);
      init.push({ id: uid(), role: 'assistant', content: text });
      if (initialNextQuestion.tier >= 2) setShowSkip(true);
    } else if (initialMessages.length > 0) {
      // All tiers answered — prompt user to start analysis
      init.push({
        id: uid(),
        role: 'assistant',
        content: t('chat_run_prompt'),
      });
    }

    setMessages(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages, initialNextQuestion, locale]);

  // Load the answers-so-far snapshot for the progress bar + editable panel
  // (also covers resumed sessions). The conversational POST never returns PII,
  // so the panel is refreshed from this dedicated GET channel.
  async function refreshAnswers() {
    try {
      const res = await fetch('/api/intake', { method: 'GET', credentials: 'include' });
      const d = (await res.json()) as IntakeResponse;
      if (d.answers) setAnswers(d.answers);
    } catch {
      /* best-effort — panel just stays empty */
    }
  }

  useEffect(() => {
    void refreshAnswers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom on new messages. The list scrolls itself rather than
  // using scrollIntoView, which also scrolls the window and would pull the
  // progress header and the answers panel off screen.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;

    setIsPending(true);
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: trimmed }]);
    setInput('');

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: trimmed }),
      });

      const data = (await res.json()) as IntakeResponse;

      if (!res.ok) {
        if (data.field) setCurrentField(data.field);
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: data.errorKey ? t(data.errorKey) : t('chat_error_generic') },
        ]);
        return;
      }

      if (data.type === 'ready') {
        setCurrentField(null);
        await refreshAnswers();
        // All required fields collected — show confirmation then kick off the run.
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: t('chat_ready') },
        ]);
        if (await startAnalysis()) return;
      } else if (data.type === 'question' && data.field) {
        setCurrentField(data.field);
        const text = data.field.rationaleKey
          ? `${t(data.field.promptKey)}\n\n${t(data.field.rationaleKey)}`
          : t(data.field.promptKey);
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: text }]);
        if (data.field.tier >= 2) setShowSkip(true);
        // Refresh the progress bar + answers panel (PII comes only from this GET).
        void refreshAnswers();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: t('chat_error_generic') },
      ]);
    } finally {
      setIsPending(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  /**
   * Kick off the benefits analysis. Shared by the auto-start on `ready` and the
   * explicit "Run Analysis" button (shown once all info is collected, e.g. after
   * editing answers or stopping a run). Returns true when a run started.
   *
   * POST /api/workflow/start is idempotent: if a run is already in progress for
   * this session the server returns the existing runId without re-spawning.
   */
  async function startAnalysis(): Promise<boolean> {
    const startRes = await fetch('/api/workflow/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const startData = (await startRes.json()) as { runId?: string; error?: string };

    if (startData.runId) {
      onReady(startData.runId);
      return true;
    }
    // Non-503 error (e.g., session expired between intake and start)
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: 'assistant',
        content: `${t('chat_unable_to_start')}: ${startData.error ?? t('chat_please_retry')}`,
      },
    ]);
    return false;
  }

  /** "Run Analysis" button handler — start a run with the info collected so far. */
  async function handleRunAnalysis() {
    if (isPending) return;
    setIsPending(true);
    try {
      await startAnalysis();
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: t('chat_error_generic') },
      ]);
    } finally {
      setIsPending(false);
    }
  }

  /** Save an inline edit of a previously-answered field. */
  async function saveEdit(key: string) {
    if (savingKey) return;
    const value = editValue.trim();
    setEditError(null);
    setSavingKey(key);
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ edit: { key, value } }),
      });
      const data = (await res.json()) as IntakeResponse;
      if (!res.ok) {
        setEditError(data.errorKey ? t(data.errorKey) : t('chat_error_generic'));
        if (data.answers) setAnswers(data.answers);
        return;
      }
      setEditingKey(null);
      setEditValue('');
      setEditError(null);
      if (data.answers) setAnswers(data.answers);

      // Confirm in two places: the row itself, and the conversation (whose
      // live region also announces it to a screen reader).
      const saved = data.answers?.find((answer) => answer.key === key);
      const labelKey =
        saved?.labelKey ?? ALL_FIELDS.find((field) => field.key === key)?.labelKey;
      if (labelKey) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: tv('chat_answer_updated', {
              field: t(labelKey),
              value: saved?.value ?? value,
            }),
          },
        ]);
      }
      setSavedKey(key);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedKey(null), 4000);
      // Keep the progress indicator in sync with the recomputed next question.
      if (data.type === 'ready') setCurrentField(null);
      else if (data.field) setCurrentField(data.field);
    } catch {
      setEditError(t('chat_error_generic'));
      /* leave panel as-is on failure */
    } finally {
      setSavingKey(null);
    }
  }

  const step = stepFor(currentField);

  return (
    <div className="flex flex-col bg-slate-900 rounded-xl shadow-sm border border-slate-800 h-[580px]">
      {/* Progress indicator + editable answers panel */}
      {(currentField || answers.length > 0) && (
        <div className="px-4 pt-3 pb-2.5 border-b border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-1.5">
            <span className="text-xs font-medium text-slate-300">
              {currentField && step ? (
                <>
                  Step {step} of {TOTAL_STEPS}
                  <span className="text-slate-500"> · {t(currentField.labelKey)}</span>
                </>
              ) : (
                t('chat_all_set')
              )}
            </span>
            {/*
              A real button, not a text link in the corner: testers did not
              notice that earlier answers could be changed. The pencil and the
              border say "this does something"; `aria-expanded` tells a screen
              reader whether the answers below are showing.
            */}
            {answers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                aria-expanded={showPanel}
                aria-controls="chat-answers-panel"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-400/50 bg-blue-500/10 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-blue-500/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors"
              >
                <PencilIcon size={12} className="text-white" />
                {showPanel ? t('chat_hide_answers') : t('chat_edit_answers')}
              </button>
            )}
          </div>

          {/* Progress bar — fills by number of answered fields */}
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.round((answers.length / TOTAL_STEPS) * 100)}%` }}
            />
          </div>

          {answers.length > 0 && !showPanel && (
            <p className="mt-2 text-xs text-slate-400">{t('chat_edit_answers_hint')}</p>
          )}

          {/*
            Editable answers — stop and correct anything entered so far.
            Height-capped and scrollable so that opening it never squeezes the
            conversation below down to a sliver. The cap is sized for the
            580px chat box: about three rows on a desktop, and on a phone,
            where each row stacks, it still leaves the conversation ~180px.
          */}
          {showPanel && answers.length > 0 && (
            <div
              id="chat-answers-panel"
              className="mt-3 max-h-44 overflow-y-auto divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/40"
            >
              {answers.map((a) => {
                const isSaved = savedKey === a.key;
                const isSaving = savingKey === a.key;

                return (
                  <div
                    key={a.key}
                    data-testid={`chat-answer-${a.key}`}
                    className={`flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:gap-3 transition-colors duration-500 ${
                      isSaved ? 'bg-green-500/10' : ''
                    }`}
                  >
                    <span className="shrink-0 text-slate-400 sm:w-44 sm:pt-1.5">{t(a.labelKey)}</span>
                    {editingKey === a.key ? (
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={editInputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveEdit(a.key);
                              if (e.key === 'Escape') {
                                setEditingKey(null);
                                setEditError(null);
                              }
                            }}
                            disabled={isSaving}
                            className="min-w-0 flex-1 basis-48 rounded-md border border-slate-600 bg-slate-800 text-slate-100 px-2.5 py-1.5 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
                            aria-label={tv('chat_edit_field_aria', { field: t(a.labelKey) })}
                            aria-invalid={editError ? true : undefined}
                            inputMode={ALL_FIELDS.find((field) => field.key === a.key)?.inputMode}
                            placeholder={(() => {
                              const key = ALL_FIELDS.find(
                                (field) => field.key === a.key,
                              )?.placeholderKey;

                              return key ? t(key) : undefined;
                            })()}
                          />
                          <button
                            type="button"
                            onClick={() => void saveEdit(a.key)}
                            disabled={isSaving}
                            className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          >
                            {isSaving ? t('chat_saving') : t('chat_save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKey(null);
                              setEditError(null);
                            }}
                            disabled={isSaving}
                            className="rounded-md px-2 py-1.5 text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            {t('chat_cancel')}
                          </button>
                        </div>
                        {editError && (
                          <p className="mt-1.5 text-xs text-red-400" role="alert">{editError}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="min-w-0 flex-1 pt-1.5 text-slate-100 break-words">{a.value}</span>
                        {isSaved && (
                          <span
                            role="status"
                            className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300"
                          >
                            <span aria-hidden="true">✓</span>
                            {t('chat_saved')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(a.key);
                            setEditValue(a.value);
                            setEditError(null);
                            setSavedKey(null);
                          }}
                          aria-label={tv('chat_edit_field_button_aria', { field: t(a.labelKey) })}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 font-medium text-white hover:border-blue-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <PencilIcon />
                          {t('chat_edit')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/*
        Message list.

        `data-testid` here is a deliberate testing contract, not decoration: a
        conversation turn has no accessible role of its own, and end-to-end
        tests need to count turns and read the latest one. The interactive
        controls below carry accessible names instead and are addressed by role,
        so this is the smallest set of ids that does the job.
      */}
      <div
        ref={logRef}
        data-testid="chat-messages"
        role="log"
        aria-live="polite"
        aria-label={t('chat_log_aria')}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            data-testid={msg.role === 'user' ? 'user-message' : 'assistant-message'}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-200'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isPending && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-3xl px-4 py-3 flex gap-1 items-center">
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* Skip button */}
      {showSkip && !isPending && (
        <div className="px-4 pb-1">
          <button
            type="button"
            onClick={() => {
              setShowSkip(false);
              void sendMessage('skip');
            }}
            className="text-xs text-slate-400 underline hover:text-slate-600 focus:outline-none"
          >
            {t('chat_skip')}
          </button>
        </div>
      )}

      {/* Run Analysis — shown once all info is collected (e.g. after editing
          answers or stopping a run), so re-running is an explicit action. */}
      {currentField === null && answers.length > 0 && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => void handleRunAnalysis()}
            disabled={isPending}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-slate-900 transition-colors"
          >
            {isPending ? t('chat_starting') : t('chat_run_analysis')}
          </button>
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 py-3 border-t border-slate-800"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          rows={2}
          inputMode={currentField?.inputMode ?? 'text'}
          placeholder={
            currentField?.placeholderKey
              ? t(currentField.placeholderKey)
              : t('chat_placeholder')
          }
          className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 px-3 py-2 text-sm leading-snug focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={t('chat_input_aria')}
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
          aria-label={t('chat_send_aria')}
        >
          {t('chat_send')}
        </button>
      </form>
    </div>
  );
}

/** A small pencil, marking a control that changes an answer. Decorative. */
/*
 * Sized with width/height attributes as well as classes: when a dev server
 * serves a stylesheet without the size classes, an unsized SVG fills its
 * button.
 */
function PencilIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="currentColor"
      className={`shrink-0 ${className}`}
    >
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}
