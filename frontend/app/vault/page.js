"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "../wallet";
import { getVault, ingestBank, ingestGithub, ingestResume, API } from "../../lib/emp";
import { CategoryBand, Stat } from "../seal";
import { Shell, Card, Eyebrow, Title, Lede, PillButton, FlatButton, ErrorNote, ConnectGate } from "../ui";

export default function Vault() {
  const { address } = useWallet();
  const [vault, setVault] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [gh, setGh] = useState("");
  const [resume, setResume] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      setVault(await getVault(address));
    } catch (e) {
      setError(e.message);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file) {
    if (!file) return;
    setError("");
    setBusy("bank");
    try {
      await ingestBank(address, file);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function run(kind, fn) {
    setError("");
    setBusy(kind);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const f = vault?.facts;
  const hasData = vault && vault.transactionCount > 0;
  const pctClassified = vault?.transactionCount
    ? Math.round((vault.classified / vault.transactionCount) * 100)
    : 0;

  return (
    <Shell>
      <div className="max-w-3xl mb-14">
        <Eyebrow>Your economic memory</Eyebrow>
        <Title>
          Feed the <span className="italic font-light text-black/80">Twin</span>.
        </Title>
        <div className="mt-5">
          <Lede>
            Add a statement, a repository, a résumé. Your Twin reads each one, assigns meaning to every
            transaction, and keeps the raw file encrypted in a vault only you hold the key to.
          </Lede>
        </div>
      </div>

      <ConnectGate line="Your Stellar address is the key to your vault. Nothing is stored against you until you connect." />

      {address && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* ---- Sources ---- */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Bank statement */}
            <Card className="p-8">
              <h2 className="font-serif text-2xl text-black mb-1" style={{ letterSpacing: "-0.02em" }}>
                Bank statement
              </h2>
              <p className="font-sans font-light text-sm text-black/50 mb-6">
                A CSV export from your bank. Read once, then encrypted.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  upload(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileRef.current?.click()}
                className={`rounded-xl border border-dashed px-6 py-10 text-center cursor-pointer transition-colors duration-200 ${
                  dragging ? "border-[#2b2644] bg-[#2b2644]/5" : "border-black/15 hover:border-black/35 bg-white/40"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => upload(e.target.files?.[0])}
                />
                {busy === "bank" ? (
                  <span className="font-barlow text-xs font-semibold uppercase tracking-[0.15em] text-black/50">
                    <span className="spin inline-block mr-2">◴</span> Reading &amp; classifying…
                  </span>
                ) : (
                  <>
                    <p className="font-sans text-sm font-light text-black/70">Drop a CSV, or click to choose</p>
                    <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.15em] text-black/35 mt-2">
                      csv · max 8 mb
                    </p>
                  </>
                )}
              </div>
            </Card>

            {/* GitHub */}
            <Card className="p-8">
              <h2 className="font-serif text-2xl text-black mb-1" style={{ letterSpacing: "-0.02em" }}>
                GitHub
              </h2>
              <p className="font-sans font-light text-sm text-black/50 mb-5">
                Public repositories become verified contribution history.
              </p>
              <div className="flex gap-2">
                <input
                  value={gh}
                  onChange={(e) => setGh(e.target.value)}
                  placeholder="username"
                  className="flex-1 min-w-0 rounded-full border border-black/12 bg-white px-5 py-2.5 font-sans text-sm font-light text-black placeholder:text-black/30 focus:border-[#2b2644] focus:outline-none transition-colors"
                />
                <FlatButton
                  tone="ink"
                  disabled={!gh || busy === "gh"}
                  onClick={() => run("gh", () => ingestGithub(address, gh))}
                >
                  {busy === "gh" ? "Reading" : "Add"}
                </FlatButton>
              </div>
            </Card>

            {/* Résumé */}
            <Card className="p-8">
              <h2 className="font-serif text-2xl text-black mb-1" style={{ letterSpacing: "-0.02em" }}>
                Résumé
              </h2>
              <p className="font-sans font-light text-sm text-black/50 mb-5">
                Paste the text. Your Twin extracts roles and skills.
              </p>
              <textarea
                value={resume}
                onChange={(e) => setResume(e.target.value)}
                rows={4}
                placeholder="Paste your résumé…"
                className="w-full rounded-xl border border-black/12 bg-white px-5 py-3.5 font-sans text-sm font-light text-black placeholder:text-black/30 focus:border-[#2b2644] focus:outline-none transition-colors resize-none mb-4"
              />
              <FlatButton
                tone="ink"
                disabled={!resume.trim() || busy === "resume"}
                onClick={() => run("resume", () => ingestResume(address, resume))}
              >
                {busy === "resume" ? "Reading" : "Add résumé"}
              </FlatButton>
            </Card>

            <ErrorNote>{error}</ErrorNote>
          </div>

          {/* ---- What the Twin knows ---- */}
          <div className="lg:col-span-3">
            {!hasData ? (
              <Card className="p-10 h-full flex flex-col justify-center items-start min-h-[420px]">
                <h2 className="font-serif text-3xl text-black mb-3" style={{ letterSpacing: "-0.02em" }}>
                  Nothing to read yet.
                </h2>
                <p className="font-sans font-light text-black/55 text-sm leading-relaxed max-w-sm">
                  Add a source and your Twin starts building memory. Every transaction gets a meaning, not just an
                  amount — and that meaning is what your proofs are made from.
                </p>
              </Card>
            ) : (
              <Card className="p-10 rise">
                <div className="flex items-start justify-between gap-6 mb-10">
                  <div>
                    <Eyebrow>What your Twin knows</Eyebrow>
                    <h2 className="font-serif text-4xl text-black" style={{ letterSpacing: "-0.03em" }}>
                      {vault.classified} of {vault.transactionCount} events,
                      <br />
                      <span className="italic font-light">read and understood</span>.
                    </h2>
                  </div>
                  <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2b2644] bg-[#2b2644]/8 px-3 py-1.5 rounded-full shrink-0">
                    {pctClassified}% classified
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                  <Stat value={f.totalCredits.toLocaleString()} label="money in" tone="plum" />
                  <Stat value={f.totalDebits.toLocaleString()} label="money out" />
                  <Stat value={f.monthsOfHistory} label="months of history" />
                  <Stat value={f.avgSalary ? f.avgSalary.toLocaleString() : "—"} label="avg salary" />
                </div>

                <div className="mb-2">
                  <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-4">
                    Where the money moves
                  </p>
                  <CategoryBand byCategory={f.byCategory} />
                </div>

                {(vault.roles > 0 || vault.skills > 0) && (
                  <div className="mt-12 pt-8 border-t border-black/5 flex gap-12">
                    <Stat value={vault.roles} label="roles" />
                    <Stat value={vault.skills} label="skills" />
                  </div>
                )}

                <div className="mt-12 pt-8 border-t border-black/5">
                  <p className="font-sans font-light text-sm text-black/50 mb-6 max-w-md leading-relaxed">
                    This is everything the Twin holds. None of it leaves the vault — a proof carries only the
                    conclusion.
                  </p>
                  <PillButton href="/issue">Issue a proof</PillButton>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
