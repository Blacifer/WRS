/**
 * Native Web Audio API Synthesizer for Spring Classification Feedback
 * Indian Railways WRS Raipur (RDSO G-95 Revision-II)
 *
 * 100% Offline & Native — Zero External Audio Files, CDNs, or Network Calls
 */

let audioCtx: AudioContext | null = null;

/**
 * Safely retrieve or initialize the AudioContext
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * PASS: Pure rising two-tone chime (880Hz -> 1175Hz for ~120-180ms)
 * Signals a successful, serviceable spring classification
 */
export function playPassChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tone 1: 880Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);

    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.08);

    // Tone 2: 1175Hz (D6) - Rising Chime
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1175, now + 0.06);

    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.25, now + 0.06);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.06);
    osc2.stop(now + 0.20);
  } catch (err) {
    // Gracefully ignore audio restrictions (e.g. autoplay policies)
    console.debug('[Audio] Pass chime skipped:', err);
  }
}

/**
 * CONDEMNED: Low warning buzz / double pulse (320Hz for ~180ms)
 * Signals an unserviceable / condemned spring requiring immediate removal
 */
export function playCondemnedBuzz(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Pulse 1: 320Hz Low Warning Tone (0ms -> 80ms)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(320, now);

    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.08);

    // Pulse 2: 320Hz Second Pulse (100ms -> 180ms)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(320, now + 0.10);

    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.25, now + 0.10);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.10);
    osc2.stop(now + 0.18);
  } catch (err) {
    // Gracefully ignore audio restrictions
    console.debug('[Audio] Condemned buzz skipped:', err);
  }
}
