/**
 * The profile types EMP can issue. Scoring for each lives in scoring.js
 * (deterministic numbers) and the human-readable reasoning is written by
 * gemini.js. There is no mock/baseline profile: a proof is only ever built from
 * a user's real economic memory, and issuance is refused when there isn't
 * enough of it.
 */
export const PROFILE_TYPES = ["loan", "hiring", "freelancer", "insurance"];
