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
import { PROFILE_TYPES } from "./profiles.js";
import { hasEnoughData } from "./scoring.js";
import { loadVault, mergeVault, saveVault } from "./vault.js";
import { parseBankCsv, parseGithub, parseLinkedInExport } from "./ingest.js";
import { classifyTransactions, buildAiProfile, aggregateFacts, extractResume } from "./gemini.js";
import { createChallenge, verifyChallenge, addressFromToken, requireOwner } from "./auth.js";

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

// CORS_ORIGIN is a comma-separated allowlist of frontend origins in production
// (e.g. "https://personaos.vercel.app"). Unset means open — fine for local dev,
// but set it once the frontend is deployed so only it can call the API.
const corsEnv = process.env.CORS_ORIGIN;
await app.register(cors, {
  origin: corsEnv ? corsEnv.split(",").map((s) => s.trim()) : true,
});
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true, issuer: issuer.publicKey(), ai: AI_ENABLED }));

// --- helper: classify any new transactions in a vault record, then persist ---
async function classifyAndStore(userId, record) {
  if (!AI_ENABLED) return record;
  const unclassified = record.transactions.filter((t) => !t.category);
  if (!unclassified.length) return record;

  const BATCH = 80; // free-tier friendly (§5.4)
  let classifiedAny = false;

  for (let i = 0; i < unclassified.length; i += BATCH) {
    const slice = unclassified.slice(i, i + BATCH);
    try {
      const results = await classifyTransactions(slice);
      const map = new Map(results.map((r) => [r.id, r]));
      for (const t of record.transactions) {
        const r = map.get(t.id);
        if (r) {
          t.category = r.category;
          t.meaning = r.meaning;
          t.confidence = r.confidence;
          classifiedAny = true;
        }
      }
    } catch (e) {
      // The upload already succeeded — the data is safely in the vault. A failed
      // classification just leaves those transactions unlabelled, and the next
      // ingest or issue picks them up. Losing the upload would be far worse.
      app.log.warn({ err: e.message }, "classification batch failed; leaving batch unclassified");
      break;
    }
  }

  if (classifiedAny) await saveVault(userId, record);
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

// ---------- Auth (proof of key ownership) ----------
// A person's Stellar address is their identity, so they prove they hold it by
// signing a nonce. Everything that touches a vault requires that proof.

/** Step 1: get a challenge to sign. Body: { address } */
app.post("/auth/challenge", async (req, reply) => {
  const { address } = req.body || {};
  if (!address) return reply.code(400).send({ error: "address required" });
  return { message: createChallenge(address) };
});

/** Step 2: exchange the signed challenge for a token. Body: { address, signature } */
app.post("/auth/verify", async (req, reply) => {
  const { address, signature } = req.body || {};
  if (!address || !signature) return reply.code(400).send({ error: "address and signature required" });
  try {
    return { token: verifyChallenge(address, signature) };
  } catch (e) {
    return reply.code(401).send({ error: e.message });
  }
});

// ---------- Ingestion (§4) ----------
// All ingestion writes to the per-user encrypted vault and classifies new txns.
// Every route below is owner-gated: you can only feed your own Twin.

const ownsBody = requireOwner((req) => req.body?.subjectPub);
const ownsParam = requireOwner((req) => req.params.subjectPub);

/**
 * Bank statement CSV upload (multipart: field "subjectPub", file "file").
 * Multipart bodies aren't parsed before the preHandler runs, so this route
 * authorises after reading the parts rather than via requireOwner.
 */
app.post("/ingest/bank", async (req, reply) => {
  const parts = await collectMultipart(req);
  const subjectPub = parts.fields.subjectPub;
  if (!subjectPub || !parts.file) return reply.code(400).send({ error: "subjectPub and file required" });

  const header = req.headers.authorization || "";
  const caller = addressFromToken(header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!caller) return reply.code(401).send({ error: "Connect your wallet to continue." });
  if (caller !== subjectPub) return reply.code(403).send({ error: "You can only act on your own account." });

  const partial = parseBankCsv(parts.file.toString("utf8"), parts.fields.currency || "INR");
  let rec = await mergeVault(subjectPub, partial);
  rec = await classifyAndStore(subjectPub, rec);
  return { ingested: partial.transactions.length, totalTransactions: rec.transactions.length };
});

/** GitHub public profile ingest. Body: { subjectPub, username } */
app.post("/ingest/github", { preHandler: ownsBody }, async (req, reply) => {
  const { subjectPub, username } = req.body || {};
  if (!subjectPub || !username) return reply.code(400).send({ error: "subjectPub and username required" });
  const partial = await parseGithub(username);
  await mergeVault(subjectPub, partial);
  return { ok: true, skills: partial.skills.map((s) => s.name) };
});

/**
 * Résumé text ingest. Body: { subjectPub, text }
 * Gemini extracts structured work + skills, which merge into the vault and feed
 * the hiring score. Requires AI — without a key, résumé text can't be scored.
 */
app.post("/ingest/resume", { preHandler: ownsBody }, async (req, reply) => {
  const { subjectPub, text } = req.body || {};
  if (!subjectPub || !text) return reply.code(400).send({ error: "subjectPub and text required" });
  if (!AI_ENABLED) {
    return reply.code(503).send({
      error: "Résumé parsing needs the AI engine, which isn't configured.",
      detail: "Add a bank statement or GitHub instead, or set GEMINI_API_KEY on the server.",
    });
  }

  let partial;
  try {
    partial = await extractResume(text);
  } catch {
    return reply.code(502).send({ error: "Couldn't read that résumé. Try again in a moment." });
  }
  partial.uploadsMeta = partial.uploadsMeta.map((m) => ({ ...m, uploadedAt: new Date().toISOString() }));
  await mergeVault(subjectPub, partial);
  return { ok: true, roles: partial.work.length, skills: partial.skills.map((s) => s.name) };
});

/** LinkedIn export ingest. Body: { subjectPub, positionsCsv?, skillsCsv? } */
app.post("/ingest/linkedin", { preHandler: ownsBody }, async (req, reply) => {
  const { subjectPub, positionsCsv, skillsCsv } = req.body || {};
  if (!subjectPub) return reply.code(400).send({ error: "subjectPub required" });
  const partial = parseLinkedInExport({ positionsCsv, skillsCsv });
  await mergeVault(subjectPub, partial);
  return { ok: true, roles: partial.work.length, skills: partial.skills.length };
});

/** Vault summary for the UI (no raw descriptions — aggregated facts only). */
app.get("/vault/:subjectPub", { preHandler: ownsParam }, async (req) => {
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

/**
 * List issued attestations (dashboard). Optional ?subject=G... filter.
 *
 * Revocation state is read from the contract, not from the local store. The
 * store's flag is only a cache — a proof revoked by another client, or by a
 * previous run of this server, would otherwise still show as standing here.
 */
app.get("/list", { preHandler: requireOwner((req) => req.query.subject) }, async (req) => {
  const store = await loadStore();
  // Always scope to the authenticated caller. Falling back to "everything" when
  // no subject is given would hand one token-holder every user's proofs.
  const subject = req.caller;
  const rows = Object.entries(store).filter(([, r]) => r.subjectPub === subject);

  // Reconcile against the chain, but never let a slow or unreachable RPC hang
  // the dashboard: each lookup races a short timeout and falls back to the
  // cached flag. Results are written back so the cache self-heals.
  const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  let dirty = false;
  const out = await Promise.all(
    rows.map(async ([id, r]) => {
      let revoked = !!r.revoked;
      try {
        const att = await withTimeout(chain.getAttestation(issuer, Buffer.from(id, "hex")), 4000);
        if (!!att.revoked !== revoked) {
          revoked = !!att.revoked;
          store[id].revoked = revoked;
          dirty = true;
        }
      } catch {
        // Keep the cached flag rather than failing the whole list.
      }
      return {
        attestationId: id,
        profileType: r.profileType,
        subjectPub: r.subjectPub,
        confidence: r.profile.confidence,
        revoked,
        createdAt: r.createdAt,
      };
    })
  );

  if (dirty) await saveStore(store);
  return out;
});

/**
 * Issue a profile: build → sign → hash → anchor on Soroban → store payload.
 * Body: { subjectPub, subjectSecret?, nonce }
 * With real Freighter flow, consent is already on-chain (via /consent/*), so
 * subjectSecret is omitted; the contract rejects attest if consent is missing.
 */
app.post("/persona/:type", { preHandler: ownsBody }, async (req, reply) => {
  const type = req.params.type;
  if (!PROFILE_TYPES.includes(type)) {
    return reply.code(400).send({ error: `unknown profile type ${type}` });
  }
  const { subjectPub, nonce = 1 } = req.body || {};
  if (!subjectPub) return reply.code(400).send({ error: "subjectPub required" });

  // Consent must already be on-chain (granted via /consent/* with the subject's
  // own key). The contract rejects attest() without it, so there is no path here
  // that issues a proof the subject didn't agree to.

  // A signed, anchored proof must never contain fabricated numbers. Load the
  // user's economic memory, classify it, and refuse to issue if there isn't
  // enough real data to stand behind a score.
  let rec = await loadVault(subjectPub);
  rec = await classifyAndStore(subjectPub, rec);
  const facts = aggregateFacts(rec);

  if (!hasEnoughData(type, facts)) {
    return reply.code(422).send({
      error: "Not enough data to issue this proof.",
      detail:
        "Add your financial history in the Vault first — a proof is generated from real transactions, never fabricated.",
      have: { transactions: facts.txnCount, months: facts.monthsOfHistory, roles: facts.totalRoles },
    });
  }

  // Numbers are computed deterministically by the scorer; Gemini only writes the
  // explanation. Scoring never fails, so there is no mock fallback.
  const profile = await buildAiProfile(type, { subjectPub, facts });

  const signature = signProfile(issuer, profile);
  const hash = profileHash(profile);
  const id = attestationId(issuer.publicKey(), subjectPub, type, nonce);

  try {
    await chain.attest(issuer, { id, subjectPub, profileType: type, hash });
  } catch (e) {
    const msg = String(e?.message || e);
    // Contract error #3 = NoConsent. Consent is granted via /consent/* with the
    // subject's own key before issuing.
    if (/#3\b|NoConsent/.test(msg)) {
      return reply.code(409).send({
        error: "Consent hasn't been granted for this profile yet.",
        detail: "Approve the consent step in your wallet before issuing this proof.",
      });
    }
    app.log.error({ err: msg }, "attest failed");
    return reply.code(502).send({ error: "Couldn't anchor the proof on Stellar. Try again." });
  }

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

/**
 * Withdraw a proof. Only the person the proof is about can withdraw it — the
 * server signs the on-chain revocation with the issuer key, so without this
 * check anyone could invalidate anyone else's credentials.
 */
app.post(
  "/revoke/:id",
  { preHandler: requireOwner(async (req) => (await loadStore())[req.params.id]?.subjectPub) },
  async (req, reply) => {
    const idHex = req.params.id;
    const store = await loadStore();
    if (!store[idHex]) return reply.code(404).send({ error: "not found" });
    await chain.revoke(issuer, Buffer.from(idHex, "hex"));
    store[idHex].revoked = true;
    await saveStore(store);
    return { revoked: true, attestationId: idHex };
  }
);

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
