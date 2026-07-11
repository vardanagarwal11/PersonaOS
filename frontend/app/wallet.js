"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { connectWallet } from "../lib/emp";
import { getAddress } from "@stellar/freighter-api";

const Ctx = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // restore if already authorized
    getAddress()
      .then((r) => r.address && setAddress(r.address))
      .catch(() => {});
  }, []);

  async function connect() {
    setError("");
    try {
      setAddress(await connectWallet());
    } catch (e) {
      setError(e.message);
    }
  }

  return <Ctx.Provider value={{ address, connect, error }}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx) || { address: "", connect: () => {}, error: "" };
