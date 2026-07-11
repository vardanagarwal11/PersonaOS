"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { verify } from "../../lib/emp";
import Seal from "../seal";

function VerifyInner() {
  const params = useSearchParams();
  const [id, setId] = useState("");
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = params.get("id");
    if (q) { setId(q); run(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(target) {
    const attId = (target || id).trim();
    if (!attId) return;
    setError(""); setRes(null); setLoading(true);
    try {
      setRes(await verify(attId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const state = res ? (res.valid ? "valid" : "revoked") : "pending";

  return (
    <section className="page">
      <p className="eyebrow">Verifier console</p>
      <h1 className="title">Check a proof.</h1>
      <p className="lede">
        Paste an attestation id. EMP re-runs all three checks: the issuer signature, the on-chain
        hash match, and the revocation flag. You never see the raw data — only whether the proof holds.
      </p>

      <div className="panel" style={{ marginTop: 36 }}>
        <label className="field" htmlFor="att">Attestation id</label>
        <input
          id="att"
          value={id}
          placeholder="b35cb311f3119856…"
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <div className="btn-row">
          <button className="btn" onClick={() => run()} disabled={loading}>
            {loading ? <><span className="spin">◴</span>&nbsp; Checking…</> : "Verify proof"}
          </button>
        </div>
        {error && <p className="err">✕ {error}</p>}
      </div>

      {res && (
        <div className="panel">
          <div className="credential">
            <Seal
              confidence={res.profile.confidence}
              state={state}
              label={res.valid ? "verified" : "invalid"}
            />
            <div className="body">
              <h2 className="ptype">{res.profile.profileType} profile</h2>
              <span className={`pill ${res.valid ? "valid" : "revoked"}`}>
                {res.valid ? "Proof holds" : "Proof failed"}
              </span>

              <div style={{ marginTop: 18 }}>
                <CheckRow ok={res.checks.signature} label="Issuer signature (Ed25519)" />
                <CheckRow ok={res.checks.onChainHashMatch} label="On-chain hash match & not revoked" />
              </div>

              <div className="kv" style={{ marginTop: 18 }}>issuer · {res.issuerPub}</div>
              <div className="hashline">{res.canonical}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CheckRow({ ok, label }) {
  return (
    <div className={`check ${ok ? "ok" : "bad"}`}>
      <span className="dot" />
      <span className="desc">{label}</span>
      <span className="verdict">{ok ? "PASS" : "FAIL"}</span>
    </div>
  );
}

export default function Verify() {
  return (
    <Suspense fallback={<section className="page"><p className="lede">Loading…</p></section>}>
      <VerifyInner />
    </Suspense>
  );
}
