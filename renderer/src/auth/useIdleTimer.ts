import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
export const IDLE_LIMIT_MS = 15 * 60 * 1000;
export const WARNING_MS = 60 * 1000;
const HEARTBEAT_EVERY_MS = 60 * 1000;
const TICK_MS = 1000;

/**
 * Client half of the 15-minute inactivity rule (the backend enforces it too).
 * Real user activity — not background requests — keeps the session alive.
 */
export function useIdleTimer(opts: { onIdle: () => void; onHeartbeat: () => void; enabled: boolean }) {
  const lastActivity = useRef(Date.now());
  const lastHeartbeat = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const { onIdle, onHeartbeat, enabled } = opts;

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    lastActivity.current = Date.now();
    lastHeartbeat.current = Date.now();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, markActive, { passive: true });

    const timer = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivity.current;
      if (idleFor >= IDLE_LIMIT_MS) {
        setSecondsLeft(null);
        onIdle();
        return;
      }
      setSecondsLeft(idleFor >= IDLE_LIMIT_MS - WARNING_MS ? Math.ceil((IDLE_LIMIT_MS - idleFor) / 1000) : null);
      if (lastActivity.current > lastHeartbeat.current && now - lastHeartbeat.current >= HEARTBEAT_EVERY_MS) {
        lastHeartbeat.current = now;
        onHeartbeat();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActive);
    };
  }, [enabled, markActive, onIdle, onHeartbeat]);

  return { secondsLeft, stayActive: markActive };
}
