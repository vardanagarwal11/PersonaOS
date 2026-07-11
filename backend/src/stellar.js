import {
  Keypair,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

const server = new rpc.Server(RPC_URL);

function contract() {
  const id = process.env.EMP_CONTRACT_ID;
  if (!id) throw new Error("EMP_CONTRACT_ID not set");
  return new Contract(id);
}

/**
 * Build, simulate, sign, send, and await a contract invocation.
 * Returns the parsed native return value of the contract function.
 */
async function invoke(sourceKeypair, method, ...scArgs) {
  const account = await server.getAccount(sourceKeypair.publicKey());
  const op = contract().call(method, ...scArgs);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  tx = await server.prepareTransaction(tx); // simulate + assemble footprint/auth
  tx.sign(sourceKeypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }

  // poll until the ledger closes (bounded)
  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && result.status === "NOT_FOUND"; i++) {
    await sleep(1000);
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`tx ${sent.hash} status ${result.status}`);
  }
  return result.returnValue ? scValToNative(result.returnValue) : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const addr = (pub) => nativeToScVal(pub, { type: "address" });
const sym = (s) => nativeToScVal(s, { type: "symbol" });
const bytes32 = (buf) => nativeToScVal(buf, { type: "bytes" });

/** One-time: set the issuer account on the contract. */
export function init(issuerKeypair) {
  return invoke(issuerKeypair, "init", addr(issuerKeypair.publicKey()));
}

/** Subject grants consent (must be signed by the subject's key). */
export function grantConsent(subjectKeypair, profileType) {
  return invoke(subjectKeypair, "grant_consent", addr(subjectKeypair.publicKey()), sym(profileType));
}

/** Anchor a signed profile. Signed by the issuer. */
export function attest(issuerKeypair, { id, subjectPub, profileType, hash }) {
  return invoke(
    issuerKeypair,
    "attest",
    bytes32(id),
    addr(subjectPub),
    sym(profileType),
    bytes32(hash)
  );
}

/** Public read: does an attestation with this id match this hash and is live? */
export function verify(readerKeypair, id, hash) {
  return invoke(readerKeypair, "verify", bytes32(id), bytes32(hash));
}

export function revoke(callerKeypair, id) {
  return invoke(callerKeypair, "revoke", bytes32(id), addr(callerKeypair.publicKey()));
}

export function getAttestation(readerKeypair, id) {
  return invoke(readerKeypair, "get", bytes32(id));
}

/**
 * Build an UNSIGNED, prepared grant_consent tx for the subject to sign in
 * Freighter. Returns base64 XDR. The subject's own key signs client-side —
 * the server never sees the subject secret (real consent model).
 */
export async function buildConsentTx(subjectPub, profileType) {
  const account = await server.getAccount(subjectPub);
  const op = contract().call("grant_consent", addr(subjectPub), sym(profileType));
  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();
  tx = await server.prepareTransaction(tx);
  return tx.toXDR();
}

/** Submit a Freighter-signed XDR and await confirmation. */
export async function submitSignedXdr(signedXdr) {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && result.status === "NOT_FOUND"; i++) {
    await sleep(1000);
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`tx ${sent.hash} status ${result.status}`);
  }
  return sent.hash;
}

export { server, NETWORK_PASSPHRASE, Keypair };
