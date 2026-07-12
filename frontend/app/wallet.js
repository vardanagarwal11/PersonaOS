"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import freighter from "@stellar/freighter-api";
import { signIn, getToken, clearToken } from "../lib/emp";

const { isConnected, requestAccess, getAddress } = freighter;

const Ctx = createContext(null);

/**
 * Wallet errors are typed, not stringly. Each one names what happened and what
 * the person can do about it, and the UI decides how to offer the way out —
 * a missing extension needs an install link, a declined prompt needs a retry.
 */
export const WalletError = {
  NOT_INSTALLED: "not_installed",
  DECLINED: "declined",
  LOCKED: "locked",
  UNKNOWN: "unknown",
};

const MESSAGES = {
  [WalletError.NOT_INSTALLED]: {
    title: "Freighter isn't installed",
    body: "PersonaOS signs with your own key, so it needs the Freighter wallet extension in this browser. Install it, then come back to this page.",
    action: { label: "Install Freighter", href: "https://www.freighter.app/" },
    retry: "I've installed it",
  },
  [WalletError.DECLINED]: {
    title: "Connection declined",
    body: "Freighter closed without granting access. Nothing was shared. Open the extension and approve the request to continue.",
    retry: "Try again",
  },
  [WalletError.LOCKED]: {
    title: "Freighter is locked",
    body: "Unlock the extension with your password, then connect again.",
    retry: "Try again",
  },
  [WalletError.UNKNOWN]: {
    title: "Couldn't reach Freighter",
    body: "The extension didn't respond. Reload the page and try once more.",
    retry: "Try again",
  },
};

export const walletMessage = (code) => MESSAGES[code] || MESSAGES[WalletError.UNKNOWN];

/** Map whatever Freighter throws into one of our four cases. */
function classify(raw) {
  const m = String(raw?.message || raw || "").toLowerCase();
  if (!m) return WalletError.UNKNOWN;
  if (m.includes("not detected") || m.includes("not installed") || m.includes("no wallet")) {
    return WalletError.NOT_INSTALLED;
  }
  if (m.includes("declin") || m.includes("denied") || m.includes("reject") || m.includes("cancel")) {
    return WalletError.DECLINED;
  }
  if (m.includes("lock")) return WalletError.LOCKED;
  return WalletError.UNKNOWN;
}

export function WalletProvider({ children }) {
  const [address, setAddress] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Dev-only: ?as=G… previews the connected screens without a browser wallet.
    // It cannot mint a session token (that needs a real signature), so the
    // screens render but data calls will 401 — which is the correct behaviour.
    if (process.env.NODE_ENV === "development") {
      const as = new URLSearchParams(window.location.search).get("as");
      if (as) {
        setAddress(as);
        return;
      }
    }
    // Only restore the session if we still hold a token — otherwise every
    // request would 401 and the screens would look connected but be empty.
    if (!getToken()) return;
    getAddress()
      .then((r) => r.address && setAddress(r.address))
      .catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    setErrorCode("");
    setConnecting(true);
    try {
      // isConnected() is false both when the extension is absent and when the
      // page can't see it, so treat it as "not installed" — the install link is
      // the useful next step either way.
      const installed = await isConnected().catch(() => false);
      const ok = typeof installed === "object" ? installed.isConnected : installed;
      if (!ok) {
        setErrorCode(WalletError.NOT_INSTALLED);
        return;
      }

      const access = await requestAccess();
      if (access?.error) throw new Error(access.error);

      const { address: addr, error } = await getAddress();
      if (error) throw new Error(typeof error === "string" ? error : error.message);
      if (!addr) throw new Error("declined");

      // Prove we hold the key before touching anything. One signature, then the
      // session token gates every vault and proof call.
      await signIn(addr);
      setAddress(addr);
    } catch (e) {
      clearToken();
      setErrorCode(classify(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearToken();
    setAddress("");
    setErrorCode("");
  }, []);

  return (
    <Ctx.Provider value={{ address, connect, disconnect, connecting, errorCode }}>
      {children}
    </Ctx.Provider>
  );
}

export const useWallet = () =>
  useContext(Ctx) || {
    address: "",
    connect: () => {},
    disconnect: () => {},
    connecting: false,
    errorCode: "",
  };
