import "./globals.css";
import Nav from "./nav";
import { WalletProvider } from "./wallet";

export const metadata = {
  title: "EMP — Economic Memory Protocol",
  description: "AI-native economic identity, anchored on Stellar.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <main className="wrap">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
