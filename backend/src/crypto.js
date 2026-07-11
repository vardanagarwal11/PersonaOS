import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Deterministic JSON serialization. Sign/verify and on-chain hashing must
 * operate on the exact same bytes, so we sort keys recursively and use no
 * whitespace. Any nondeterminism here breaks verification.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortDeep(v[k]);
        return acc;
      }, {});
  }
  return v;
}

/** SHA-256 of the canonical profile bytes. Returns a 32-byte Buffer. */
export function profileHash(profile) {
  return createHash("sha256").update(canonicalJson(profile), "utf8").digest();
}

/**
 * Sign a profile with the issuer's Ed25519 key (a Stellar Keypair).
 * Stellar accounts are Ed25519 keypairs, so the issuer identity IS a Stellar
 * account and we reuse Keypair.sign — no separate crypto library.
 * @returns base64 signature string
 */
export function signProfile(issuerKeypair, profile) {
  const bytes = Buffer.from(canonicalJson(profile), "utf8");
  return issuerKeypair.sign(bytes).toString("base64");
}

/** Verify an issuer signature over a profile. */
export function verifyProfileSignature(issuerPublicKey, profile, signatureB64) {
  const kp = Keypair.fromPublicKey(issuerPublicKey);
  const bytes = Buffer.from(canonicalJson(profile), "utf8");
  return kp.verify(bytes, Buffer.from(signatureB64, "base64"));
}

/**
 * Attestation id = SHA-256(issuer || subject || profile_type || nonce).
 * Deterministic, collision-safe, used as the on-chain storage key.
 */
export function attestationId(issuerPub, subjectPub, profileType, nonce) {
  return createHash("sha256")
    .update(issuerPub)
    .update(subjectPub)
    .update(profileType)
    .update(String(nonce))
    .digest();
}
