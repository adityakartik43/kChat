"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A synthesised ring/ringback tone.
 *
 * Web Audio is used rather than an audio file so the app ships no binary
 * assets and has nothing to load before a call can ring. The tone is a
 * deliberately plain dual-tone pattern, not music.
 */

/** Cadence of one burst, in seconds. */
const BURST_SECONDS = 0.9;
/** Gap between bursts. */
const GAP_SECONDS = 0.35;

export interface Ringtone {
  startRinging: () => void;
  stopRinging: () => void;
}

/**
 * Returns controls for a looping ringtone.
 *
 * The `AudioContext` is created lazily on the first ring: browsers refuse to
 * start one before a user gesture, and creating it eagerly would leave it in a
 * suspended state.
 */
export function useRingtone(): Ringtone {
  const contextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const stopRinging = useCallback(() => {
    activeRef.current = false;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const playBurst = useCallback((context: AudioContext) => {
    const start = context.currentTime;

    // Two frequencies a major third apart read as a European dial tone.
    for (const frequency of [440, 523.25]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // Fade in and out so the burst does not click at either edge.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.setValueAtTime(0.08, start + BURST_SECONDS - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + BURST_SECONDS);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + BURST_SECONDS + 0.02);
    }
  }, []);

  const startRinging = useCallback(() => {
    // The AudioContext type is not exported consistently across TS DOM libs
    // in every Node/TS combination, so the constructor is reached through
    // `window` where it is always present in a browser.
    const Ctor = window.AudioContext;

    if (!Ctor) return;

    const context = contextRef.current ?? new Ctor();
    contextRef.current = context;

    // A context created inside an async callback can start suspended.
    void context.resume();

    if (activeRef.current) return;
    activeRef.current = true;

    const loop = () => {
      if (!activeRef.current) return;

      playBurst(context);
      timerRef.current = setTimeout(loop, BURST_SECONDS + GAP_SECONDS);
    };

    loop();
  }, [playBurst]);

  // Stop and release the audio hardware when the provider unmounts, so a
  // navigated-away tab does not keep ringing.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  return { startRinging, stopRinging };
}
