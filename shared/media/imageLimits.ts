/**
 * The size ceiling for one stored photograph
 * Indian Railways WRS Raipur
 *
 * Shared so that the client's cap and the server's refusal cannot drift
 * apart. If they did, the interesting failure is silent: the client would
 * send something the server rejects, or — worse — the server would accept
 * what the client no longer bounds.
 *
 * Neither side trusts the other. The client caps what it produces because
 * sending megabytes over a workshop connection is its own problem; the server
 * refuses what it is sent because a device on an older bundle, or a caller
 * that is not the app, must not be able to put an unbounded row into the
 * table that holds evidence beside the audit chain.
 */

/** Largest base64 payload accepted for a single photograph. */
export const MAX_STORED_PHOTO_BYTES = 3 * 1024 * 1024;
