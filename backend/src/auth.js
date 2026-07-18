import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Freighter's signMessage follows SEP-53: it signs the SHA-256 of the message
 * prefixed with "Stellar Signed Message:\n", NOT the raw message bytes. To
 * verify, we must reconstruct the same digest the extension signed.
 */
const SEP53_PREFIX = "Stellar Signed Message:\n";
function sep53Digest(message) {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), Buffer.from(message, "utf8")]))
    .digest();
}

/**
 * Proof-of-key-ownership session auth.
 *
 * The user's Stellar address IS their identity here, so we don't invent a
 * separate account system. Instead:
 *
 *   1. Client asks for a challenge for its address.
 *   2. Client signs the challenge with its own key (Freighter).
 *   3. Server verifies the Ed25519 signature against that address and issues a
 *      short-lived bearer token.
 *
 * Every endpoint that reads or writes a user's vault, or revokes their proofs,
 * then requires that token — so nobody can act on an address they don't hold.
 * Without this, any caller could poison another person's economic memory, and
 * that memory is what the signed profiles are generated from.
 */

const TTL_MS = 60 * 60 * 1000; // 1 hour
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const challenges = new Map(); // address -> { nonce, expires }

function secret() {
  const s = process.env.EMP_SESSION_SECRET || process.env.EMP_VAULT_MASTER_KEY;
  if (!s) throw new Error("EMP_SESSION_SECRET (or EMP_VAULT_MASTER_KEY) not set");
  return s;
}

/** Issue a nonce the client must sign to prove it holds the address. */
export function createChallenge(address) {
  const nonce = randomBytes(24).toString("base64url");
  challenges.set(address, { nonce, expires: Date.now() + CHALLENGE_TTL_MS });
  return `PersonaOS wants to confirm you hold this account.\n\nAddress: ${address}\nNonce: ${nonce}`;
}

/**
 * Verify the signed challenge and mint a token.
 * The signature is over the raw challenge bytes, checked against the address's
 * own Ed25519 public key — so only the keyholder can pass.
 */
export function verifyChallenge(address, signatureB64) {
  const entry = challenges.get(address);
  if (!entry) throw new Error("No pending challenge for this address. Request one first.");
  if (Date.now() > entry.expires) {
    challenges.delete(address);
    throw new Error("The challenge expired. Request a new one.");
  }

  const message = `PersonaOS wants to confirm you hold this account.\n\nAddress: ${address}\nNonce: ${entry.nonce}`;

  let ok = false;
  try {
    const kp = Keypair.fromPublicKey(address);
    const sig = Buffer.from(signatureB64, "base64");
    // Freighter signs the SEP-53 digest; accept a raw-bytes signature too in
    // case a wallet version signs the message directly.
    ok = kp.verify(sep53Digest(message), sig) || kp.verify(Buffer.from(message, "utf8"), sig);
  } catch {
    throw new Error("That signature could not be read.");
  }
  if (!ok) throw new Error("That signature doesn't match this address.");

  challenges.delete(address);
  return mintToken(address);
}

/** token = base64(address.expiry).hmac — stateless, so restarts don't log users out. */
function mintToken(address) {
  const expires = Date.now() + TTL_MS;
  const payload = `${address}.${expires}`;
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

/** Returns the address the token proves ownership of, or null. */
export function addressFromToken(token) {
  if (!token || typeof token !== "string") return null;
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;

  let payload;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const idx = payload.lastIndexOf(".");
  const address = payload.slice(0, idx);
  const expires = Number(payload.slice(idx + 1));
  if (!address || !expires || Date.now() > expires) return null;

  return address;
}

/**
 * Fastify preHandler: requires a valid token, and — when the route names a
 * subject — that the token proves ownership of exactly that subject.
 * Attach the subject via `getSubject(req)`.
 */
export function requireOwner(getSubject) {
  return async (req, reply) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const caller = addressFromToken(token);

    if (!caller) {
      return reply.code(401).send({ error: "Connect your wallet to continue." });
    }

    const subject = await getSubject(req);
    if (subject && subject !== caller) {
      return reply.code(403).send({ error: "You can only act on your own account." });
    }

    req.caller = caller;
  };
}
