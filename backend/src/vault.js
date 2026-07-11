import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per-user encrypted vault (§6 of spec).
 *
 * Each user's record is encrypted at rest with AES-256-GCM using a per-user
 * data key. The data key is derived from a master key (env EMP_VAULT_MASTER_KEY)
 * plus the userId, so no plaintext data key is stored. In production the master
 * key lives in a KMS; here it's an env secret.
 *
 * Storage is a JSON file per user under backend/data/vault/. Raw financial data
 * never leaves this module in plaintext except to the AI engine and profile
 * builder inside the process — it is never returned by any API and never
 * written on-chain.
 */

const __dir = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = join(__dir, "..", "data", "vault");

function masterKey() {
  const k = process.env.EMP_VAULT_MASTER_KEY;
  if (!k) throw new Error("EMP_VAULT_MASTER_KEY not set");
  return k;
}

/** Derive a stable 32-byte per-user data key from master key + userId. */
function userKey(userId) {
  return createHash("sha256").update(`${masterKey()}:${userId}`).digest();
}

function vaultPath(userId) {
  // hash the id so the filename never leaks the raw address
  const name = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  return join(VAULT_DIR, `${name}.enc`);
}

function encrypt(userId, plaintextObj) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", userKey(userId), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(plaintextObj), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") };
}

function decrypt(userId, blob) {
  const decipher = createDecipheriv("aes-256-gcm", userKey(userId), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(out.toString("utf8"));
}

const emptyRecord = (userId) => ({
  userId,
  stellarAddress: userId,
  transactions: [],
  work: [],
  skills: [],
  uploadsMeta: [],
});

/** Read and decrypt a user's vault record (empty record if none yet). */
export async function loadVault(userId) {
  try {
    const blob = JSON.parse(await readFile(vaultPath(userId), "utf8"));
    return decrypt(userId, blob);
  } catch {
    return emptyRecord(userId);
  }
}

/** Encrypt and persist a user's vault record. */
export async function saveVault(userId, record) {
  await mkdir(VAULT_DIR, { recursive: true });
  await writeFile(vaultPath(userId), JSON.stringify(encrypt(userId, record)));
}

/** Merge new normalized data into the user's vault (dedupes transactions by id). */
export async function mergeVault(userId, partial) {
  const rec = await loadVault(userId);
  if (partial.transactions?.length) {
    const seen = new Set(rec.transactions.map((t) => t.id));
    for (const t of partial.transactions) if (!seen.has(t.id)) rec.transactions.push(t);
  }
  if (partial.work?.length) rec.work.push(...partial.work);
  if (partial.skills?.length) rec.skills.push(...partial.skills);
  if (partial.uploadsMeta?.length) rec.uploadsMeta.push(...partial.uploadsMeta);
  await saveVault(userId, rec);
  return rec;
}
