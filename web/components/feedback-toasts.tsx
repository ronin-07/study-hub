'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { appendFeedback, feedbackDismissDelay } from '@/lib/feedback-queue';

export type FeedbackAction = { label: string; onClick: () => void | Promise<void> };
export type FeedbackMessage = {
  title: string;
  detail?: string;
  kind?: 'success' | 'error' | 'info';
  action?: FeedbackAction;
};
type Toast = FeedbackMessage & { id: number };

/** A bounded, accessible notification queue. Errors are never dismissed by a timer. */
export function useFeedbackToasts() {
  const [messages, setMessages] = useState<Toast[]>([]);
  const sequence = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setMessages(previous => previous.filter(message => message.id !== id));
  }, []);
  const notify = useCallback((message: FeedbackMessage) => {
    const id = ++sequence.current;
    setMessages(previous => appendFeedback(previous, { ...message, id }));
    const delay = feedbackDismissDelay(message.kind, !!message.action);
    if (delay !== null) timers.current.set(id, window.setTimeout(() => dismiss(id), delay));
    return id;
  }, [dismiss]);
  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);
  const clearAll = useCallback(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
    setMessages([]);
  }, []);
  return { messages, notify, dismiss, clearAll };
}

export function FeedbackToasts({ messages, dismiss }: { messages: Toast[]; dismiss: (id: number) => void }) {
  if (!messages.length) return null;
  return <div className="study-feedback-stack" aria-label="Study Hub notifications">
    {messages.map(message => {
      const kind = message.kind ?? 'info';
      const Icon = kind === 'success' ? CheckCircle2 : kind === 'error' ? AlertCircle : Info;
      return <div key={message.id} className={`study-feedback-toast is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
        <Icon className="study-feedback-icon" size={19} aria-hidden="true" />
        <div className="study-feedback-body"><strong>{message.title}</strong>{message.detail && <span>{message.detail}</span>}
          {message.action && <button className="study-feedback-action" type="button" onClick={() => { dismiss(message.id); void message.action?.onClick(); }}>{message.action.label}</button>}
        </div>
        <button type="button" className="study-feedback-dismiss" aria-label={`Dismiss ${message.title}`} onClick={() => dismiss(message.id)}><X size={16}/></button>
      </div>;
    })}
  </div>;
}
