# EMP — Economic Memory Protocol

AI-native economic identity on Stellar. See `EMP_Technical_Spec.md` for the full design.

## Status

| Piece | State |
|---|---|
| Soroban contract (`contracts/emp-attestor`) | ✅ built, 5 unit tests pass, deployed to testnet |
| Attestation core (sign + hash + anchor + verify + revoke) | ✅ working end-to-end on testnet |
| Frontend (Issue / Verify / Manage, real Freighter) | ✅ built, verified end-to-end via UI |
| Gemini AI pipeline (classify + profile gen) | ✅ built — enable with GEMINI_API_KEY (mock fallback when unset) |
| Data ingestion + encrypted vault | ✅ built — bank CSV / GitHub / resume / LinkedIn export → AES-256-GCM vault |

Deployed contract (testnet): `CCWWLHKPNRLMYKYSI4NZNTYHJAOONJOKMKX4YWHGWI3BVXLPCFLGUNSK`

## Contract

```bash
cd contracts/emp-attestor
cargo test                    # run unit tests
stellar contract build        # -> target/wasm32v1-none/release/emp_attestor.wasm
```

### Deploy (fresh)

```bash
stellar keys generate issuer --network testnet --fund
stellar contract deploy --wasm target/wasm32v1-none/release/emp_attestor.wasm \
  --source issuer --network testnet
# NOTE: this contract uses a manual init() fn, NOT a constructor.
# After deploy you MUST call init separately, or attest() fails with Error #2 (NotInit):
stellar contract invoke --id <CONTRACT_ID> --source issuer \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --issuer <ISSUER_ADDRESS>
```

## Quick start

One command boots the backend (:4000) and frontend (:4001) together. It installs
deps on first run and creates `frontend/.env` if missing. You still need a
filled-in `backend/.env` (copy from `backend/.env.example`).

```bash
# from the repo root
npm install     # installs root + backend + frontend deps
npm run dev     # starts both; open http://localhost:4001
```

Platform launchers do the same with separate log windows:

```bash
./start.sh          # macOS / Linux  (--fresh to reinstall deps)
./start.ps1         # Windows        (-Fresh to reinstall deps)
```

## Backend (run alone)

```bash
cd backend
npm install
# fill backend/.env: EMP_CONTRACT_ID, EMP_ISSUER_SECRET, RPC + passphrase
npm start
```

### End-to-end test

```bash
# issue a loan profile (MVP: server also submits subject consent via subjectSecret)
curl -X POST localhost:3000/persona/loan -H 'content-type: application/json' \
  -d '{"subjectPub":"G...","subjectSecret":"S...","nonce":1}'

# verify (runs Ed25519 sig check + on-chain hash match)
curl localhost:3000/verify/<attestationId>

# revoke -> verify then returns valid:false
curl -X POST localhost:3000/revoke/<attestationId>
```

## Environment

Copy the examples and fill values:

```bash
cp backend/.env.example backend/.env      # already populated for testnet in this repo
cp frontend/.env.example frontend/.env
```

Backend needs: `EMP_CONTRACT_ID`, `EMP_ISSUER_SECRET`, `EMP_VAULT_MASTER_KEY`
(any 32+ char secret), and optionally `GEMINI_API_KEY`. Without a Gemini key the
server runs in mock-profile mode so the crypto + chain loop still works.

## AI pipeline & ingestion

- **Ingest** (writes to the encrypted per-user vault, §6):
  - `POST /ingest/bank` — multipart CSV upload (fields: `subjectPub`, `file`)
  - `POST /ingest/github` — `{ subjectPub, username }`
  - `POST /ingest/resume` — `{ subjectPub, text }`
  - `POST /ingest/linkedin` — `{ subjectPub, positionsCsv?, skillsCsv? }` (from the
    user's own LinkedIn data export — the legal path; LinkedIn has no open API)
  - `GET /vault/:subjectPub` — aggregated facts only (never raw descriptions)
- **Classify**: new transactions are batch-classified by Gemini on ingest and
  cached in the vault (never re-called for unchanged data — free-tier limits).
- **Profile gen**: `/persona/:type` builds the profile from aggregated economic-
  memory facts via Gemini structured output, then signs + anchors it. Raw data
  never leaves the vault; only the signed profile does.

Sample data: `samples/bank_sample.csv`.

## Frontend

Next.js app router + real Freighter signing. Three routes = three verbs:
`Issue` (/), `Verify` (/verify), `Manage` (/manage).

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000 (or set PORT)
# needs backend running; API base = NEXT_PUBLIC_API (default http://localhost:3000)
```

Consent flow uses real Freighter: server builds an unsigned `grant_consent`
XDR (`/consent/build`), the user signs it in Freighter, server submits it
(`/consent/submit`). The server never sees the subject secret. Then
`/persona/:type` anchors the signed profile — the contract rejects it if
consent isn't already on-chain.

## Verification model (§3.5 of spec)

A verifier trusts a profile iff all three hold:
1. `Ed25519.verify(signature, canonicalJson(profile), issuerPubkey)` — authenticity
2. `SHA256(canonicalJson(profile)) == onchain.hash` — integrity + anchoring
3. `onchain.revoked == false` — validity

Contract `verify(id, hash)` folds checks 2+3; the server does check 1.

## Auth model

The Stellar address is the identity. A user proves they hold it by signing a
nonce with Freighter (`/auth/challenge` → `/auth/verify`), receiving a
short-lived HMAC session token. Every vault- or proof-touching route
(`/ingest/*`, `/vault`, `/list`, `/persona`, `/revoke`) requires that token
**and** that it proves ownership of the subject being acted on. `/verify` is
intentionally public — a verifier must be able to check a proof without an
account.

## Known limitations (before production)

This is a hackathon build. What's solid: the contract, the crypto (Ed25519
signing, AES-256-GCM vault, canonical-JSON hashing), the auth model, and the
AI pipeline with retry/fallback. What must change before real use:

- **Storage is a JSON file, not a database.** `attestations.json` and the vault
  files are read-modify-write with no locking, so concurrent requests to the
  same record can clobber each other (a lost write on simultaneous issue or
  ingest). Single-user demo traffic never hits this; production must move to a
  real datastore (Postgres, or per-user rows with row-level locking) — this is
  the first thing to replace.
- **Vault master key is an env secret**, not a KMS. Rotating it makes existing
  encrypted vaults unreadable. Move to a managed KMS with envelope encryption.
- **Consent is MVP-simple.** The contract enforces on-chain consent before
  `attest`, but a production flow should also handle consent expiry and
  per-verifier scoping.
- **No rate limiting** on the public `/verify` or the auth endpoints.
- **Session tokens are stateless HMAC** with no revocation list; a leaked token
  is valid until it expires (1h). Add server-side revocation for production.
