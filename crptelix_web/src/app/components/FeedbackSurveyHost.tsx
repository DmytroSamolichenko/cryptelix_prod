import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { FeedbackSurveyModal } from './FeedbackSurveyModal';
import {
  clearActiveMs,
  loadActiveMs,
  saveActiveMs,
} from '../lib/feedbackActiveTime';
import { fetchFeedbackStatus, type FeedbackStatus } from '../lib/feedbackApi';

interface FeedbackSurveyHostProps {
  userId: number;
}

/**
 * Tracks visible (active) app time and opens the survey when eligible.
 * Force mode after a 1h skip cooldown removes Skip.
 */
export function FeedbackSurveyHost({ userId }: FeedbackSurveyHostProps) {
  const [open, setOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [dismissedUntilReload, setDismissedUntilReload] = useState(false);

  const statusRef = useRef<FeedbackStatus | null>(null);
  const activeMsRef = useRef(loadActiveMs(userId));
  const visibleSinceRef = useRef<number | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    activeMsRef.current = loadActiveMs(userId);
    setDismissedUntilReload(false);
    setOpen(false);
  }, [userId]);

  const flushActive = useCallback(() => {
    if (visibleSinceRef.current != null) {
      const delta = Date.now() - visibleSinceRef.current;
      activeMsRef.current += Math.max(0, delta);
      visibleSinceRef.current = Date.now();
      saveActiveMs(userId, activeMsRef.current);
    }
  }, [userId]);

  const tryOpen = useCallback((status: FeedbackStatus) => {
    if (dismissedUntilReload || openRef.current) return;
    if (!status.has_row || !status.can_offer || status.status === 'submitted') return;

    if (status.force) {
      setForce(true);
      setOpen(true);
      return;
    }

    // not_offered (or skip before cooldown ends is already can_offer=false)
    const needed = status.required_active_ms ?? 30 * 60 * 1000;
    if (activeMsRef.current >= needed) {
      setForce(false);
      setOpen(true);
    }
  }, [dismissedUntilReload]);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchFeedbackStatus();
      statusRef.current = status;
      if (status.status === 'submitted') {
        clearActiveMs(userId);
        setOpen(false);
        return;
      }
      flushActive();
      tryOpen(status);
    } catch {
      // silent — survey is non-critical
    }
  }, [flushActive, tryOpen, userId]);

  // Visibility-aware active timer
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        visibleSinceRef.current = Date.now();
      } else {
        flushActive();
        visibleSinceRef.current = null;
      }
    };
    const onBlur = () => {
      flushActive();
      visibleSinceRef.current = null;
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        visibleSinceRef.current = Date.now();
      }
    };

    if (document.visibilityState === 'visible') {
      visibleSinceRef.current = Date.now();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      flushActive();
      const status = statusRef.current;
      if (status) tryOpen(status);
    }, 15_000);

    return () => {
      flushActive();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(tick);
    };
  }, [flushActive, tryOpen]);

  // Poll server status
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const handleCompleted = () => {
    clearActiveMs(userId);
    setOpen(false);
    setDismissedUntilReload(true);
    statusRef.current = statusRef.current
      ? { ...statusRef.current, status: 'submitted', can_offer: false, force: false }
      : null;
  };

  const handleSkipped = () => {
    setOpen(false);
    setDismissedUntilReload(true);
    // Will re-check on next session / after cooldown via status poll.
    // Allow re-offer after cooldown without full reload:
    window.setTimeout(() => setDismissedUntilReload(false), 1000);
    void refreshStatus();
  };

  return (
    <AnimatePresence>
      {open && (
        <FeedbackSurveyModal
          force={force}
          onCompleted={handleCompleted}
          onSkipped={handleSkipped}
        />
      )}
    </AnimatePresence>
  );
}
