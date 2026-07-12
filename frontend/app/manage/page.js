"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "../wallet";
import { list, revoke } from "../../lib/emp";
import { Shell, Card, Eyebrow, Title, Lede, PillButton, FlatButton, ErrorNote, ConnectGate } from "../ui";

const short = (s) => `${s.slice(0, 10)}…${s.slice(-8)}`;

/**
 * Row seal — the Proof Seal reduced to a legible glance. Same arc, same colours,
 * small enough that a list of twenty still reads as a list.
 */
function RowSeal({ confidence = 0, revoked }) {
  const size = 44;
  const stroke = 2.5;
  const r = (size - stroke * 2) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, confidence));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-black/10" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={revoked ? "#b4483c" : "#2b2644"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={revoked ? "2 5" : `${circ * pct} ${circ}`}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-serif text-xs ${
          revoked ? "text-black/30" : "text-black"
        }`}
      >
        {Math.round(pct * 100)}
      </span>
    </div>
  );
}

export default function Manage() {
  const { address } = useWallet();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setError("");
    try {
      setRows(await list(address));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

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

  const live = rows.filter((r) => !r.revoked).length;

  return (
    <Shell>
      <div className="max-w-3xl mb-14">
        <Eyebrow>Consent</Eyebrow>
        <Title>
          What you have <span className="italic font-light text-black/80">given out</span>.
        </Title>
        <div className="mt-5">
          <Lede>
            Every proof issued in your name. Withdraw one and its flag flips on Stellar in the same breath — any
            verifier checking it from that moment sees it fail.
          </Lede>
        </div>
      </div>

      <ConnectGate line="Only you can see, and withdraw, the proofs issued against your address." />

      {address && loaded && (
        <>
          {rows.length > 0 && (
            <div className="flex items-baseline gap-8 mb-8">
              <div>
                <span className="font-serif text-4xl text-[#2b2644]" style={{ letterSpacing: "-0.03em" }}>
                  {live}
                </span>
                <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 ml-2">
                  standing
                </span>
              </div>
              <div>
                <span className="font-serif text-4xl text-black/25" style={{ letterSpacing: "-0.03em" }}>
                  {rows.length - live}
                </span>
                <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/30 ml-2">
                  withdrawn
                </span>
              </div>
            </div>
          )}

          <Card className="overflow-hidden max-w-4xl">
            {rows.length === 0 ? (
              <div className="p-12 text-center">
                <h2 className="font-serif text-3xl text-black mb-3" style={{ letterSpacing: "-0.02em" }}>
                  You haven&rsquo;t given anything out.
                </h2>
                <p className="font-sans font-light text-sm text-black/50 mb-8 max-w-sm mx-auto leading-relaxed">
                  When you issue a proof it appears here, and stays under your control.
                </p>
                <div className="flex justify-center">
                  <PillButton href="/issue">Issue your first proof</PillButton>
                </div>
              </div>
            ) : (
              rows.map((r, i) => (
                <div
                  key={r.attestationId}
                  className="flex items-center gap-5 px-8 py-6 border-b border-black/5 last:border-0 rise hover:bg-[#F5F5F5]/60 transition-colors duration-200"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <RowSeal confidence={r.confidence} revoked={r.revoked} />

                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-serif text-xl capitalize ${r.revoked ? "text-black/35" : "text-black"}`}
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      {r.profileType} profile
                    </div>
                    <Link
                      href={`/verify?id=${r.attestationId}`}
                      className="font-mono text-[11px] text-black/35 hover:text-black transition-colors"
                    >
                      {short(r.attestationId)}
                    </Link>
                  </div>

                  <span
                    className={`hidden sm:inline font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] px-3 py-1.5 rounded-full shrink-0 ${
                      r.revoked ? "bg-black/5 text-black/35" : "bg-[#2b2644]/8 text-[#2b2644]"
                    }`}
                  >
                    {r.revoked ? "withdrawn" : "standing"}
                  </span>

                  <div className="shrink-0 w-28 flex justify-end">
                    {r.revoked ? (
                      <span className="font-sans font-light text-xs text-black/25">—</span>
                    ) : (
                      <FlatButton
                        tone="rust"
                        size="sm"
                        disabled={busyId === r.attestationId}
                        onClick={() => onRevoke(r.attestationId)}
                      >
                        {busyId === r.attestationId ? "Withdrawing" : "Withdraw"}
                      </FlatButton>
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>
          <ErrorNote>{error}</ErrorNote>
        </>
      )}
    </Shell>
  );
}
