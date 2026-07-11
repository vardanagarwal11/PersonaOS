import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { profileHash, signProfile, verifyProfileSignature, attestationId, canonicalJson } from "./crypto.js";
import * as chain from "./stellar.js";
import { buildProfile, PROFILE_TYPES } from "./profiles.js";
import { loadVault, mergeVault, saveVault } from "./vault.js";
import { parseBankCsv, parseGithub, parseResumeText, parseLinkedInExport } from "./ingest.js";
import { classifyTransactions, buildAiProfile, aggregateFacts } from "./gemini.js";

const AI_ENABLED = !!process.env.GEMINI_API_KEY;

const __dir = dirname(fileURLToPath(import.meta.url));
const STORE = join(__dir, "..", "data", "attestations.json");

const issuer = Keypair.fromSecret(reqEnv("EMP_ISSUER_SECRET"));

function reqEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

// --- tiny JSON store (MVP off-chain payload store) ---
async function loadStore() {
  try {
    return JSON.parse(await readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}
async function saveStore(s) {
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(s, null, 2));
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true, issuer: issuer.publicKey(), ai: AI_ENABLED }));

// --- helper: classify any new transactions in a vault record, then persist ---
async function classifyAndStore(userId, record) {
  if (!AI_ENABLED) return record;
  const unclassified = record.transactions.filter((t) => !t.category);
  if (!unclassified.length) return record;
  const BATCH = 80; // free-tier friendly (§5.4)
  for (let i = 0; i < unclassified.length; i += BATCH) {
    const slice = unclassified.slice(i, i + BATCH);
    const results = await classifyTransactions(slice);
    const map = new Map(results.map((r) => [r.id, r]));
    for (const t of record.transactions) {
      const r = map.get(t.id);
      if (r) {
        t.category = r.category;
        t.meaning = r.meaning;
        t.confidence = r.confidence;
      }
    }
  }
  await saveVault(userId, record);
  return record;
}

// collect a multipart request into { fields, file } (first file part only)
async function collectMultipart(req) {
  const fields = {};
  let file = null;
  for await (const part of req.parts()) {
    if (part.type === "file") file = await part.toBuffer();
    else fields[part.fieldname] = part.value;
  }
  return { fields, file };
}

// expose config the frontend needs (contract id, network) — no secrets
app.get("/config", async () => ({
  contractId: process.env.EMP_CONTRACT_ID,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  rpcUrl: process.env.STELLAR_RPC_URL,
  issuer: issuer.publicKey(),
}));

// ---------- Ingestion (§4) ----------
// All ingestion writes to the per-user encrypted vault and classifies new txns.

/** Bank statement CSV upload (multipart file "file", field "subjectPub"). */
app.post("/ingest/bank", async (req, reply) => {
  const parts = await collectMultipart(req);
  const subjectPub = parts.fields.subjectPub;
  if (!subjectPub || !parts.file) return reply.code(400).send({ error: "subjectPub and file required" });
  const partial = parseBankCsv(parts.file.toString("utf8"), parts.fields.currency || "INR");
  let rec = await mergeVault(subjectPub, partial);
  rec = await classifyAndStore(subjectPub, rec);
  return { ingested: partial.transactions.length, totalTransactions: rec.transactions.length };
});

/** GitHub public profile ingest. Body: { subjectPub, username } */
app.post("/ingest/github", async (req, reply) => {
  const { subjectPub, username } = req.body || {};
  if (!subjectPub || !username) return reply.code(400).send({ error: "subjectPub and username required" });
  const partial = await parseGithub(username);
  await mergeVault(subjectPub, partial);
  return { ok: true, skills: partial.skills.map((s) => s.name) };
});

/** Resume text ingest. Body: { subjectPub, text } */
app.post("/ingest/resume", async (req, reply) => {
  const { subjectPub, text } = req.body || {};
  if (!subjectPub || !text) return reply.code(400).send({ error: "subjectPub and text required" });
  const partial = parseResumeText(text);
  const rec = await loadVault(subjectPub);
  rec.resumeText = partial._resumeText;
  rec.uploadsMeta.push(...partial.uploadsMeta);
  await saveVault(subjectPub, rec);
  return { ok: true, chars: text.length };
});

/** LinkedIn export ingest. Body: { subjectPub, positionsCsv?, skillsCsv? } */
app.post("/ingest/linkedin", async (req, reply) => {
  const { subjectPub, positionsCsv, skillsCsv } = req.body || {};
  if (!subjectPub) return reply.code(400).send({ error: "subjectPub required" });
  const partial = parseLinkedInExport({ positionsCsv, skillsCsv });
  await mergeVault(subjectPub, partial);
  return { ok: true, roles: partial.work.length, skills: partial.skills.length };
});

/** Vault summary for the UI (no raw descriptions — aggregated facts only). */
app.get("/vault/:subjectPub", async (req) => {
  const rec = await loadVault(req.params.subjectPub);
  return {
    transactionCount: rec.transactions.length,
    classified: rec.transactions.filter((t) => t.category).length,
    roles: rec.work.length,
    skills: rec.skills.length,
    facts: aggregateFacts(rec),
  };
});

/**
 * Consent step 1: build an unsigned grant_consent tx for Freighter to sign.
 * Body: { subjectPub, type } -> { xdr }
 */
app.post("/consent/build", async (req, reply) => {
  const { subjectPub, type } = req.body || {};
  if (!subjectPub || !PROFILE_TYPES.includes(type)) {
    return reply.code(400).send({ error: "subjectPub and valid type required" });
  }
  const xdr = await chain.buildConsentTx(subjectPub, type);
  return { xdr };
});

/**
 * Consent step 2: submit the Freighter-signed XDR.
 * Body: { signedXdr } -> { hash }
 */
app.post("/consent/submit", async (req, reply) => {
  const { signedXdr } = req.body || {};
  if (!signedXdr) return reply.code(400).send({ error: "signedXdr required" });
  const hash = await chain.submitSignedXdr(signedXdr);
  return { hash };
});

/** List issued attestations (dashboard). Optional ?subject=G... filter. */
app.get("/list", async (req) => {
  const store = await loadStore();
  const subject = req.query.subject;
  return Object.entries(store)
    .filter(([, r]) => !subject || r.subjectPub === subject)
    .map(([id, r]) => ({
      attestationId: id,
      profileType: r.profileType,
      subjectPub: r.subjectPub,
      confidence: r.profile.confidence,
      revoked: !!r.revoked,
      createdAt: r.createdAt,
    }));
});

/**
 * Issue a profile: build → sign → hash → anchor on Soroban → store payload.
 * Body: { subjectPub, subjectSecret?, nonce }
 * With real Freighter flow, consent is already on-chain (via /consent/*), so
 * subjectSecret is omitted; the contract rejects attest if consent is missing.
 */
app.post("/persona/:type", async (req, reply) => {
  const type = req.params.type;
  if (!PROFILE_TYPES.includes(type)) {
    return reply.code(400).send({ error: `unknown profile type ${type}` });
  }
  const { subjectPub, subjectSecret, nonce = 1 } = req.body || {};
  if (!subjectPub) return reply.code(400).send({ error: "subjectPub required" });

  // MVP: server records consent on behalf of subject if secret provided.
  if (subjectSecret) {
    await chain.grantConsent(Keypair.fromSecret(subjectSecret), type);
  }

  // AI path: generate from the user's economic-memory facts. Falls back to the
  // mock builder when AI is off or the vault is empty (keeps the demo working).
  let profile;
  if (AI_ENABLED) {
    let rec = await loadVault(subjectPub);
    rec = await classifyAndStore(subjectPub, rec);
    const facts = aggregateFacts(rec);
    if (rec.transactions.length || rec.work.length) {
      profile = await buildAiProfile(type, { subjectPub, facts, resumeText: rec.resumeText });
    }
  }
  if (!profile) profile = buildProfile(type, { subjectPub });

  const signature = signProfile(issuer, profile);
  const hash = profileHash(profile);
  const id = attestationId(issuer.publicKey(), subjectPub, type, nonce);

  await chain.attest(issuer, { id, subjectPub, profileType: type, hash });

  const idHex = id.toString("hex");
  const store = await loadStore();
  store[idHex] = {
    profile,
    signature,
    issuerPub: issuer.publicKey(),
    profileType: type,
    subjectPub,
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  await saveStore(store);

  return {
    attestationId: idHex,
    verifyUrl: `/verify/${idHex}`,
    confidence: profile.confidence,
    reasoning: profile.reasoning,
  };
});

/**
 * Verify: return payload + run the three checks (§3.5) server-side so a
 * verifier can trust the result, and also return the raw pieces so a verifier
 * can re-check independently.
 */
app.get("/verify/:id", async (req, reply) => {
  const idHex = req.params.id;
  const store = await loadStore();
  const rec = store[idHex];
  if (!rec) return reply.code(404).send({ error: "attestation not found" });

  const id = Buffer.from(idHex, "hex");
  const hash = profileHash(rec.profile);

  const sigValid = verifyProfileSignature(rec.issuerPub, rec.profile, rec.signature);
  const onChainValid = await chain.verify(issuer, id, hash); // matches hash + not revoked

  return {
    valid: sigValid && onChainValid,
    checks: { signature: sigValid, onChainHashMatch: onChainValid },
    profile: rec.profile,
    signature: rec.signature,
    issuerPub: rec.issuerPub,
    canonical: canonicalJson(rec.profile),
  };
});

app.post("/revoke/:id", async (req, reply) => {
  const idHex = req.params.id;
  const store = await loadStore();
  if (!store[idHex]) return reply.code(404).send({ error: "not found" });
  await chain.revoke(issuer, Buffer.from(idHex, "hex"));
  store[idHex].revoked = true;
  await saveStore(store);
  return { revoked: true, attestationId: idHex };
});

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
