/**
 * Haptic & Audio Feedback Utilities
 * Provides tactile and auditory feedback for "Greasy Gloves" UX on the shop floor.
 */

// Synthesize sounds using Web Audio API to avoid needing external audio files
class FeedbackEngine {
  private audioCtx: AudioContext | null = null;

  private getContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private playTone(frequency: number, type: OscillatorType, duration: number, volume: number = 0.1) {
    try {
      const ctx = this.getContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      
      // Envelope
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio feedback failed', e);
    }
  }

  /**
   * Success: High pitched double chime + double vibration
   */
  public success() {
    this.playTone(880, 'sine', 0.1, 0.1); // A5
    setTimeout(() => this.playTone(1760, 'sine', 0.2, 0.15), 100); // A6

    if (navigator.vibrate) {
      navigator.vibrate([50, 50, 50]);
    }
  }

  /**
   * Error: Low pitched buzz + long heavy vibration
   */
  public error() {
    this.playTone(150, 'sawtooth', 0.4, 0.1);

    if (navigator.vibrate) {
      navigator.vibrate([400]);
    }
  }

  /**
   * Action/Click: Short subtle pop + tiny tick vibration
   */
  public tap() {
    this.playTone(400, 'sine', 0.05, 0.05);

    if (navigator.vibrate) {
      navigator.vibrate(20);
    }
  }
}

export const feedback = new FeedbackEngine();
