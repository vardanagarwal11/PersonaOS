"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../wallet";
import { list, revoke } from "../../lib/emp";

const short = (s) => `${s.slice(0, 8)}…${s.slice(-6)}`;

export default function Manage() {
  const { address, connect } = useWallet();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    if (!address) return;
    setError("");
    try {
      setRows(await list(address));
    } catch (e) {
      setError(e.message);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  async function onRevoke(id) {
    setBusyId(id);
    setError("");
    try {
      await revoke(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="page">
      <p className="eyebrow">Consent dashboard</p>
      <h1 className="title">Your issued proofs.</h1>
      <p className="lede">
        Every attestation you've granted. Revoke any one and its on-chain flag flips instantly —
        verifiers will see the proof fail from that moment.
      </p>

      <div className="panel" style={{ marginTop: 36 }}>
        {!address ? (
          <>
            <p className="ptype" style={{ fontSize: 20 }}>Connect to view your proofs.</p>
            <div className="btn-row"><button className="btn gold" onClick={connect}>Connect Freighter</button></div>
          </>
        ) : rows.length === 0 ? (
          <p className="note">No attestations yet. Issue one from the Issue tab.</p>
        ) : (
          rows.map((r) => (
            <div className="row" key={r.attestationId}>
              <div>
                <div className="rtype">{r.profileType} profile</div>
                <div className="rid">{short(r.attestationId)}</div>
              </div>
              <div className="kv">{Math.round((r.confidence || 0) * 100)}%</div>
              <span className={`pill ${r.revoked ? "revoked" : "valid"}`}>
                {r.revoked ? "Revoked" : "Active"}
              </span>
              {r.revoked ? (
                <span className="note" style={{ margin: 0 }}>—</span>
              ) : (
                <button
                  className="btn rust"
                  style={{ padding: "8px 14px", fontSize: 13 }}
                  disabled={busyId === r.attestationId}
                  onClick={() => onRevoke(r.attestationId)}
                >
                  {busyId === r.attestationId ? "Revoking…" : "Revoke"}
                </button>
              )}
            </div>
          ))
        )}
        {error && <p className="err">✕ {error}</p>}
      </div>
    </section>
  );
}
