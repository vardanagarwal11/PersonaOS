"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./wallet";

const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

export default function Nav() {
  const path = usePathname();
  const { address, connect, error } = useWallet();
  const links = [
    ["/", "Issue"],
    ["/verify", "Verify"],
    ["/manage", "Manage"],
  ];
  return (
    <header className="topbar">
      <div className="wrap">
        <div className="brand">
          <span className="mark">§</span> EMP
        </div>
        <nav className="nav">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        {address ? (
          <span className="wallet" title={address}>
            {short(address)}
          </span>
        ) : (
          <button className="btn gold" style={{ padding: "8px 14px", fontSize: 13 }} onClick={connect}>
            Connect Freighter
          </button>
        )}
      </div>
    </header>
  );
}
