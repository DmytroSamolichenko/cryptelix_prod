import { apiFetch } from './apiClient';

export interface FeedbackStatus {
  has_row: boolean;
  status: 'not_offered' | 'skipped' | 'submitted' | null;
  created_at: string | null;
  skipped_at: string | null;
  force: boolean;
  can_offer: boolean;
  required_active_ms: number;
  skip_cooldown_seconds: number;
}

export async function fetchFeedbackStatus(): Promise<FeedbackStatus> {
  const res = await apiFetch('/api/v1/feedback/status');
  if (!res.ok) {
    throw new Error('Failed to load feedback status');
  }
  return (await res.json()) as FeedbackStatus;
}

export async function skipFeedback(): Promise<FeedbackStatus> {
  const res = await apiFetch('/api/v1/feedback/skip', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to skip survey');
  }
  return (await res.json()) as FeedbackStatus;
}

export async function submitFeedback(payload: {
  q1: number;
  q2: number;
  q3: number;
  comment?: string;
}): Promise<void> {
  const res = await apiFetch('/api/v1/feedback/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to submit survey');
  }
}
