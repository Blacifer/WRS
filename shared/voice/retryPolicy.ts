/**
 * When to try speech recognition again, and when to stop
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS NOT INSIDE THE COMPONENT
 * ------------------------------------
 * It was, and it ran away. Web Speech restarts itself on every `onend` while
 * listening, and the handler restarted immediately with no counter and no
 * delay. One persistent failure therefore became a tight loop:
 *
 *     start → error → end → start → error → end → …
 *
 * A tablet on the shop floor reported roughly 150 "[Web Speech Error]
 * network" lines in a couple of seconds. On a device someone carries for a
 * shift that is a flat battery and a hammered endpoint, not a console
 * nuisance — and none of it was visible to a test, because the decision lived
 * among the JSX where nothing could reach it.
 *
 * WHAT THE ERRORS MEAN
 * --------------------
 * They are not equivalent, and treating them as one thing is what made the
 * loop possible:
 *
 *   no-speech   nobody spoke. Expected in a quiet bay, not a failure, and it
 *               must not count toward giving up or a silent inspector would
 *               look identical to a broken microphone.
 *   not-allowed the microphone was refused. Retrying cannot change that;
 *               only the person can.
 *   network     Web Speech could not reach its recognition service. On a
 *               restricted shop network or through a tunnel this is standing,
 *               not transient, so retrying forever cannot succeed.
 *   aborted     usually us stopping it. Harmless.
 */

export type SpeechErrorKind =
  | 'no-speech'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'network'
  | 'aborted'
  | 'audio-capture'
  | string;

/**
 * Consecutive failures before voice gives up.
 *
 * Low deliberately. Errors worth retrying clear within a second or two;
 * anything still failing after five attempts is a standing condition that
 * retrying will not resolve.
 */
export const MAX_CONSECUTIVE_ERRORS = 5;

/** A clean restart, fast enough that continuous listening feels unbroken. */
export const HEALTHY_RESTART_MS = 250;

export interface RetryDecision {
  /** Whether to start recognition again at all. */
  shouldRetry: boolean;
  /** How long to wait first, in milliseconds. */
  delayMs: number;
  /** Whether this failure counts toward the ceiling. */
  countsAsFailure: boolean;
  /** Shown to the inspector when giving up. Null while still retrying. */
  giveUpMessage: string | null;
}

/** Whether an error can ever be resolved by trying again. */
export function isRecoverable(error: SpeechErrorKind): boolean {
  return error !== 'not-allowed' && error !== 'service-not-allowed';
}

/**
 * Decides what to do after recognition ends.
 *
 * `consecutiveErrors` is the count BEFORE this event, so a healthy session
 * passes zero and gets the fast restart.
 */
export function decideRetry(
  consecutiveErrors: number,
  lastError: SpeechErrorKind | null,
  stillWanted: boolean
): RetryDecision {
  // The inspector turned it off. Nothing else matters.
  if (!stillWanted) {
    return { shouldRetry: false, delayMs: 0, countsAsFailure: false, giveUpMessage: null };
  }

  // Silence is not failure.
  if (lastError === 'no-speech' || lastError === 'aborted' || lastError === null) {
    return {
      shouldRetry: true,
      delayMs: HEALTHY_RESTART_MS,
      countsAsFailure: false,
      giveUpMessage: null
    };
  }

  if (!isRecoverable(lastError)) {
    return {
      shouldRetry: false,
      delayMs: 0,
      countsAsFailure: true,
      giveUpMessage:
        'Microphone access is blocked, so voice has stopped. Everything can still be recorded by tapping.'
    };
  }

  const failures = consecutiveErrors + 1;

  if (failures >= MAX_CONSECUTIVE_ERRORS) {
    return {
      shouldRetry: false,
      delayMs: 0,
      countsAsFailure: true,
      giveUpMessage:
        lastError === 'network'
          ? 'Voice recognition cannot reach its service on this network, so it has stopped. ' +
            'Everything can still be recorded by tapping — nothing is lost.'
          : `Voice recognition stopped after repeated errors (${lastError}). Tap to record instead.`
    };
  }

  /*
   * Exponential back-off, capped. The cap matters as much as the growth: an
   * unbounded doubling would eventually schedule a restart minutes away and
   * look, to the inspector, exactly like the feature being broken.
   */
  return {
    shouldRetry: true,
    delayMs: Math.min(500 * 2 ** failures, 8000),
    countsAsFailure: true,
    giveUpMessage: null
  };
}
