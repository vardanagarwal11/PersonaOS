# EMP — Technical Specification

> Companion to `PersonaOS_Economic_Memory_Protocol_Idea.md`.
> This doc fills every open technical decision. Locked stack choices:
> **Soroban** (attestations), **Ed25519 signed attestations + on-chain hash**
> (crypto), **server-side encrypted per-user vault** (data), **Gemini free tier**
> (AI). Scope target: hackathon MVP that is architecturally honest and extensible.

---

## 0. Locked Decisions (why)

| Concern | Choice | Why |
|---|---|---|
| On-chain anchor | Soroban contract on Stellar testnet | Native attestation storage + programmable consent/revocation; matches "programmable finance" vision |
| Proof scheme | Ed25519-signed JSON profile + SHA-256 hash on-chain | Real cryptographic verifiability, verifier-checkable, hackathon-doable. No ZK complexity in MVP |
| Raw data | Server-side per-user vault, encrypted at rest (AES-256-GCM) | AI needs to read raw data; "user-owned" enforced by per-user key + explicit consent gate, not client-only compute |
| AI engine | Gemini (`gemini-2.5-flash`, free tier) with structured output (`responseSchema`) | Free, strong reasoning, native JSON schema output for classification + profile generation |

Trade-offs accepted for MVP: no ZK (income proven by signed claim, not zero-knowledge); vault is server-trust model (v2 → client-side / TEE); Gemini free tier rate limits force batching.

---

## 1. System Architecture

```
                          ┌─────────────────────────────┐
  Uploads (PDF/JSON) ───▶ │  Ingestion + Parsers        │
  Bank / Resume /         │  (pdf-parse, GitHub API,     │
  GitHub / LinkedIn       │   LinkedIn export parse)     │
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │  Normalizer                 │  → canonical schemas
                          │  (raw → EMP data model)     │    (§4)
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
   Encrypted Vault  ◀────▶│  AI Semantic Engine (Gemini)│  classify txns,
   (per-user, AES-GCM)    │  structured output          │  extract meaning
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │  Economic Memory Store      │  Postgres +
                          │  (semantic txns + facts)    │  pgvector (recall)
                          └──────────────┬──────────────┘
                                         ▼
   Consent gate ────────▶ ┌─────────────────────────────┐
   (user approves         │  Profile Generator (Gemini) │  Loan/Hiring/etc
    profile type)         │  → confidence + reasoning   │  profile JSON
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │  Attestation Service        │  Ed25519 sign +
                          │  sign(profile) + hash        │  SHA-256(profile)
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │  Soroban Contract (Stellar) │  store hash + issuer
                          │  attest / verify / revoke   │  + consent record
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │  Verifier Portal / API      │  fetch profile, verify
                          │  GET /verify/:id            │  sig + on-chain hash
                          └─────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Tech |
|---|---|
| Backend API | Node.js + TypeScript, Fastify (or Express) |
| AI | Gemini API — `@google/genai` SDK, `gemini-2.5-flash`, `responseSchema` structured output |
| Stellar/chain | `@stellar/stellar-sdk` (JS) for tx submission; Soroban contract in **Rust** (`soroban-sdk`) |
| DB | Postgres 15 + `pgvector` extension |
| Vault crypto | Node `crypto` — AES-256-GCM at rest, per-user data key wrapped by master KMS key |
| Attestation sig | Ed25519 via `@stellar/stellar-sdk` `Keypair` (same curve Stellar uses — reuse it) |
| PDF parse | `pdf-parse` / `pdfjs-dist` for bank statements |
| Frontend | Next.js (upload UI, consent dashboard, verifier portal) |
| Wallet | Freighter (browser wallet) for user Stellar identity |

Ed25519 note: Stellar accounts ARE Ed25519 keypairs. Reuse `Keypair.sign()` for attestation signing — no separate crypto lib, and issuer identity is a Stellar account.

---

## 3. Stellar / Soroban Design

### 3.1 What lives on-chain vs off-chain

| On-chain (Soroban) | Off-chain (server) |
|---|---|
| Attestation hash (SHA-256 of signed profile) | Full profile JSON |
| Issuer address | Raw financial data (vault) |
| Subject (user) address | AI reasoning, embeddings |
| Profile type enum (loan/hiring/…) | |
| Issued-at ledger timestamp | |
| Revocation flag | |
| Consent record (subject approved type X) | |

Rule: **never put profile payload or raw data on-chain.** Only the hash + metadata. Payload is fetched off-chain and its hash re-checked against chain.

### 3.2 Soroban contract interface (Rust)

```rust
#[contract]
pub struct EmpAttestor;

#[contracttype]
pub struct Attestation {
    pub issuer: Address,
    pub subject: Address,
    pub profile_type: Symbol,   // "loan" | "hiring" | "freelancer" | "insurance"
    pub hash: BytesN<32>,       // SHA-256 of signed profile JSON
    pub issued_ledger: u32,
    pub revoked: bool,
}

#[contractimpl]
impl EmpAttestor {
    // user records consent for a profile type before issuance
    pub fn grant_consent(env: Env, subject: Address, profile_type: Symbol);
    pub fn revoke_consent(env: Env, subject: Address, profile_type: Symbol);
    pub fn has_consent(env: Env, subject: Address, profile_type: Symbol) -> bool;

    // issuer anchors a signed profile. requires subject consent.
    pub fn attest(env: Env, id: BytesN<32>, a: Attestation) -> BytesN<32>;

    // anyone verifies an attestation exists and matches a hash
    pub fn verify(env: Env, id: BytesN<32>, hash: BytesN<32>) -> bool;

    // subject or issuer revokes
    pub fn revoke(env: Env, id: BytesN<32>);
    pub fn get(env: Env, id: BytesN<32>) -> Attestation;
}
```

- `subject.require_auth()` inside `grant_consent`/`revoke` → only the user can consent/revoke (Soroban auth).
- `issuer.require_auth()` inside `attest`.
- `attest` asserts `has_consent(subject, profile_type)` — enforces "explicit consent for every profile" on-chain.
- Storage: `env.storage().persistent()` keyed by `id`.

### 3.3 Attestation ID

`id = SHA-256(issuer || subject || profile_type || nonce)`. Deterministic, collision-safe, used as chain key.

### 3.4 Full attestation flow

1. User connects Freighter → Stellar address = subject identity.
2. User approves "Loan Profile" in UI → tx `grant_consent(subject, "loan")` (signed by user's Freighter).
3. Backend generates profile JSON (§5), signs with issuer Ed25519 key → `signature`.
4. Backend computes `hash = SHA256(canonical_json(profile))`.
5. Backend submits `attest(id, {issuer, subject, "loan", hash, ...})` (signed by issuer account).
6. Backend stores full profile + signature off-chain, returns `attestation_id` + verify URL.

### 3.5 Verification (verifier / bank side)

```
GET /verify/:attestation_id
 → server returns { profile, signature, issuer_pubkey, chain_id }
 verifier checks:
   1. Ed25519 verify(signature, canonical_json(profile), issuer_pubkey)   // authenticity
   2. SHA256(canonical_json(profile)) == on-chain Attestation.hash        // integrity + anchoring
   3. on-chain Attestation.revoked == false                              // validity
```

All three pass → profile is genuine, unmodified, anchored, unrevoked.

---

## 4. Data Model (Normalization schemas)

All raw inputs normalize to these canonical shapes before AI.

```ts
type Transaction = {
  id: string;
  date: string;          // ISO
  amount: number;        // signed: + credit, - debit
  currency: string;
  rawDescription: string;
  source: "bank" | "upi" | "wallet";
  // filled by AI engine:
  category?: string;     // "tuition" | "salary" | "rent" | "medical" | ...
  meaning?: string;      // human-readable ("College tuition")
  confidence?: number;
};

type WorkHistory = {
  source: "resume" | "linkedin" | "github";
  role: string; org: string; start: string; end?: string;
  verified: boolean;
};

type Skill = { name: string; evidence: string; source: string };

type UserVaultRecord = {
  userId: string;
  stellarAddress: string;
  transactions: Transaction[];
  work: WorkHistory[];
  skills: Skill[];
  uploadsMeta: { type: string; uploadedAt: string }[];
};
```

Parsers (`bank PDF`, `github API`, `linkedin export`, `resume`) each output partial `UserVaultRecord`; normalizer merges.

**LinkedIn caveat:** no open API. MVP uses LinkedIn's official *data export* (user downloads their own archive ZIP, uploads it) — legal, user-owned, no scraping. Document this; it's the honest path.

---

## 5. AI Semantic Engine (Gemini)

### 5.1 Transaction classification

Batch transactions → single Gemini call with `responseSchema`:

```ts
const schema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      category: { type: "string" },
      meaning: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["id", "category", "meaning", "confidence"],
  },
};
// model: gemini-2.5-flash, config: { responseMimeType: "application/json", responseSchema: schema }
```

Free-tier rate limits (~15 RPM, 250k TPM on flash) → **batch 50–100 txns per call**, not one call per txn. Cache classifications in DB; only re-classify new txns.

### 5.2 Economic Memory recall

- Store each semantic transaction's `meaning` as a `pgvector` embedding (Gemini `text-embedding-004`, free).
- User questions ("show every education expense", "who repays me late") → embed query → vector search → feed top-k rows to Gemini for the natural-language answer.
- This is the "Economic Memory" — semantic, queryable, not raw.

### 5.3 Profile generation

Per profile type, one Gemini call with a strict `responseSchema`. Example Loan Profile schema:

```json
{
  "type": "object",
  "properties": {
    "monthlyIncome": { "type": "number" },
    "incomeStability": { "type": "number" },
    "debtRatio": { "type": "number" },
    "savingsTrend": { "type": "string", "enum": ["up","flat","down"] },
    "repaymentConsistency": { "type": "number" },
    "confidence": { "type": "number" },
    "reasoning": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["confidence","reasoning"]
}
```

Input = aggregated facts from Economic Memory (not raw txns). Output = the exact object that gets signed + anchored. `reasoning` array = the "Explainable AI" requirement, satisfied structurally.

### 5.4 Gemini free-tier engineering notes

- Model IDs: `gemini-2.5-flash` (reasoning/classification), `text-embedding-004` (embeddings).
- Rate limits are the real constraint. Design: queue + batch, persist all AI outputs, never re-call for unchanged data.
- No PII leaves to Gemini beyond what's needed — send normalized txn descriptions, not account numbers. Strip identifiers in normalizer.

---

## 6. Vault & Privacy

- Each user has a random 256-bit **data key**; data key encrypts vault rows (AES-256-GCM).
- Data key is wrapped (encrypted) by a master key (env/KMS). At-rest = encrypted.
- **Consent gate:** profile generation for type X is blocked unless on-chain `has_consent(subject, X)` is true. Enforced both server-side and in contract.
- Raw data never returned via any API and never written on-chain. Only signed derived profiles leave.
- Audit log: every profile issuance + consent + revocation is a Soroban tx → immutable audit trail (satisfies "audit logs" in vision).

---

## 7. API Surface

| Method | Route | Purpose |
|---|---|---|
| POST | `/ingest/bank` | upload + parse bank statement |
| POST | `/ingest/github` | pull GitHub via API |
| POST | `/ingest/linkedin` | upload LinkedIn export ZIP |
| POST | `/ingest/resume` | upload resume |
| POST | `/memory/query` | natural-language memory question |
| POST | `/consent/:type` | user grants consent (triggers Soroban tx) |
| POST | `/persona/loan` | generate + sign + anchor loan profile |
| POST | `/persona/hiring` | hiring profile |
| POST | `/persona/freelancer` | freelancer profile |
| POST | `/persona/insurance` | insurance profile |
| GET | `/verify/:id` | return profile + sig + chain data for verifier |
| POST | `/revoke/:id` | revoke attestation (Soroban tx) |

---

## 8. MVP Build Order (hackathon)

1. **Soroban contract** — `attest`/`verify`/`revoke`/consent. Deploy to testnet. (highest-risk, do first)
2. **Attestation service** — Ed25519 sign + hash + submit to contract + verify path.
3. **Bank statement parser** + normalizer → `Transaction[]`.
4. **Gemini classification** (batched) + Loan Profile generation.
5. **Consent flow** — Freighter connect + `grant_consent` tx.
6. **Verifier portal** — `/verify/:id` page that runs the 3 checks in §3.5.
7. Add remaining profile types + memory query if time.

Cut for MVP if short: pgvector memory query (stretch), LinkedIn/GitHub ingest (do bank + resume only), insurance profile.

---

## 9. Open Risks

- **Gemini rate limits** — free tier will throttle under demo load. Mitigation: pre-classify demo data, cache aggressively.
- **Soroban testnet latency** — attest tx confirmation adds seconds. Show pending state in UI.
- **Bank statement variety** — every bank's PDF differs. MVP: support 1–2 formats or a sample CSV; don't over-invest in universal parsing.
- **Trust model honesty** — vault is server-trust in MVP. State this openly; ZK / client-side is v2. Don't overclaim "raw data never leaves device" — it leaves to *your* server. Correct claim: "raw data never leaves the vault and is never shared with third parties; only signed proofs are."
