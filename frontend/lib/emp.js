import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
  getNetworkDetails,
} from "@stellar/freighter-api";

export const API = process.env.NEXT_PUBLIC_API || "http://localhost:3000";

export async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/** Connect Freighter, return the user's Stellar address (= subject identity). */
export async function connectWallet() {
  if (!(await isConnected())) {
    throw new Error("Freighter not detected. Install the Freighter extension.");
  }
  await requestAccess();
  const { address, error } = await getAddress();
  if (error) throw new Error(error);
  return address;
}

/**
 * Full consent flow with real Freighter signing:
 * 1. server builds unsigned grant_consent XDR
 * 2. Freighter signs it (subject's own key)
 * 3. server submits signed XDR to Soroban
 */
export async function grantConsent(subjectPub, type) {
  const { xdr } = await api("/consent/build", {
    method: "POST",
    body: JSON.stringify({ subjectPub, type }),
  });
  const net = await getNetworkDetails();
  const { signedTxXdr, error } = await signTransaction(xdr, {
    networkPassphrase: net.networkPassphrase,
    address: subjectPub,
  });
  if (error) throw new Error(typeof error === "string" ? error : error.message);
  const { hash } = await api("/consent/submit", {
    method: "POST",
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  return hash;
}

export function issueProfile(subjectPub, type, nonce = Date.now()) {
  return api(`/persona/${type}`, {
    method: "POST",
    body: JSON.stringify({ subjectPub, nonce }),
  });
}

export const verify = (id) => api(`/verify/${id}`);
export const revoke = (id) => api(`/revoke/${id}`, { method: "POST" });
export const list = (subject) => api(`/list${subject ? `?subject=${subject}` : ""}`);
