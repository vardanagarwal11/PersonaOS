"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useWallet, walletMessage } from "./wallet";

const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Landing's pill button, with the trailing circular arrow. */
export function PillButton({ children, onClick, href, disabled, busy, tone = "ink", type = "button" }) {
  const base =
    "inline-flex items-center gap-3 text-base font-medium pl-8 pr-2 py-2 rounded-full font-barlow transition-colors duration-200 group cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const tones = {
    ink: "bg-black text-white hover:bg-gray-800",
    plum: "bg-[#2b2644] text-white hover:bg-[#3a3358]",
    rust: "bg-[#b4483c] text-white hover:bg-[#c25547]",
  };
  const inner = (
    <>
      <span>{children}</span>
      <span className="bg-white rounded-full p-2 group-hover:bg-gray-100 transition-colors duration-200">
        {busy ? (
          <span className="spin block w-5 h-5 rounded-full border-2 border-black/20 border-t-black" />
        ) : (
          <ArrowRight className="w-5 h-5 text-black" />
        )}
      </span>
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={`${base} ${tones[tone]}`}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={`${base} ${tones[tone]}`}>
      {inner}
    </button>
  );
}

/** Flat pill — no arrow. For secondary and destructive actions. */
export function FlatButton({ children, onClick, disabled, tone = "outline", size = "md" }) {
  const tones = {
    outline: "border border-black/15 text-black hover:border-black/40 hover:bg-white",
    ink: "bg-black text-white hover:bg-gray-800",
    rust: "border border-[#b4483c]/30 text-[#b4483c] hover:bg-[#b4483c] hover:text-white",
  };
  const sizes = { md: "px-6 py-2.5 text-sm", sm: "px-4 py-1.5 text-[11px]" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full font-barlow font-semibold uppercase tracking-[0.1em] transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

/** The white card. Landing uses rounded-2xl on its feature cards. */
export function Card({ children, className = "", tone = "white" }) {
  const tones = {
    white: "bg-white border border-black/5",
    plum: "bg-[#2b2644] text-white",
    ghost: "bg-white/50 border border-black/8",
  };
  return <div className={`rounded-2xl ${tones[tone]} ${className}`}>{children}</div>;
}

export function Eyebrow({ children }) {
  return (
    <p className="font-barlow text-sm font-semibold uppercase tracking-wider text-black/60 mb-2">
      {children}
    </p>
  );
}

export function Title({ children, className = "" }) {
  return (
    <h1
      className={`font-serif font-normal text-black text-5xl md:text-6xl leading-none ${className}`}
      style={{ letterSpacing: "-0.04em" }}
    >
      {children}
    </h1>
  );
}

export function Lede({ children }) {
  return (
    <p className="font-sans font-light text-black/60 text-base leading-relaxed max-w-lg">{children}</p>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="mt-4 font-sans text-sm font-light text-[#b4483c] flex items-start gap-2">
      <span aria-hidden="true">✕</span>
      <span>{children}</span>
    </p>
  );
}

const ROUTES = [
  ["/vault", "Vault"],
  ["/issue", "Issue"],
  ["/verify", "Verify"],
  ["/manage", "Manage"],
];

/**
 * Product chrome. Mirrors the landing navbar exactly — same logo lockup, same
 * Barlow uppercase links, same pill on the right — so crossing from the landing
 * page into the app feels like one continuous surface.
 */
export function ProductNav() {
  const path = usePathname();
  const { address, connect, connecting } = useWallet();

  return (
    <nav className="sticky top-0 z-30 bg-[#F5F5F5]/85 backdrop-blur-md border-b border-black/5">
      <div className="max-w-[88rem] mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-4 shrink-0">
          <Image src="/Logo.png" alt="" width={40} height={40} className="h-10 w-auto object-contain" />
          <span className="font-barlow text-2xl font-semibold tracking-tight text-black">PersonaOS</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {ROUTES.map(([href, label]) => {
            const active = path === href;
            return (
              <Link
                key={href}
                href={href}
                className={`font-barlow text-sm font-semibold uppercase tracking-wider transition-colors duration-200 ${
                  active ? "text-black" : "text-gray-500 hover:text-black"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {address ? (
          <span className="font-barlow text-xs font-semibold uppercase tracking-[0.12em] text-white bg-[#2b2644] px-5 py-3 rounded-full">
            {short(address)}
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="bg-black text-white font-barlow text-sm font-semibold uppercase tracking-wider px-8 py-3 rounded-full hover:bg-gray-800 transition-colors duration-200 cursor-pointer disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Twin"}
          </button>
        )}
      </div>
    </nav>
  );
}

/** Standard product page shell: chrome + a max-width column. */
export function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      <ProductNav />
      <main className="flex-1 max-w-[88rem] mx-auto w-full px-6 py-16 md:py-20">{children}</main>
      <footer className="border-t border-black/5 py-8 px-6">
        <div className="max-w-[88rem] mx-auto flex items-center justify-between gap-6">
          <span className="font-barlow text-sm font-semibold tracking-tight text-black/40">
            PersonaOS © {new Date().getFullYear()}
          </span>
          <Link
            href="/"
            className="font-barlow text-xs font-semibold uppercase tracking-[0.12em] text-black/40 hover:text-black transition-colors"
          >
            Back to site
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * Shown on every product screen when no wallet is connected.
 *
 * When something goes wrong the card becomes the recovery: a missing extension
 * gets an install link, a declined prompt gets a retry. The person is never left
 * holding an error with nothing to do about it.
 */
export function ConnectGate({ line }) {
  const { address, connect, connecting, errorCode } = useWallet();
  if (address) return null;

  const problem = errorCode ? walletMessage(errorCode) : null;

  return (
    <Card className="p-10 max-w-xl">
      {problem ? (
        <>
          <span className="inline-block font-barlow text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b4483c] bg-[#b4483c]/8 px-3 py-1 rounded-full mb-5">
            Can&rsquo;t connect
          </span>
          <h2 className="font-serif text-3xl text-black mb-3" style={{ letterSpacing: "-0.02em" }}>
            {problem.title}
          </h2>
          <p className="font-sans font-light text-black/60 text-sm leading-relaxed mb-8 max-w-md">
            {problem.body}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {problem.action && (
              <a
                href={problem.action.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-3 bg-black text-white text-base font-medium pl-8 pr-2 py-2 rounded-full hover:bg-gray-800 font-barlow transition-colors duration-200 group"
              >
                <span>{problem.action.label}</span>
                <span className="bg-white rounded-full p-2 group-hover:bg-gray-100 transition-colors duration-200">
                  <ArrowRight className="w-5 h-5 text-black" />
                </span>
              </a>
            )}
            <FlatButton onClick={connect} disabled={connecting}>
              {connecting ? "Connecting" : problem.retry}
            </FlatButton>
          </div>
        </>
      ) : (
        <>
          <h2 className="font-serif text-3xl text-black mb-3" style={{ letterSpacing: "-0.02em" }}>
            Connect your Twin.
          </h2>
          <p className="font-sans font-light text-black/60 text-sm leading-relaxed mb-7">{line}</p>
          <PillButton onClick={connect} busy={connecting}>
            {connecting ? "Connecting" : "Connect Freighter"}
          </PillButton>
        </>
      )}
    </Card>
  );
}
