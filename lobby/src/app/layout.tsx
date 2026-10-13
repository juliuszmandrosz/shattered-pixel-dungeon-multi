import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shattered Pixel Dungeon Multi",
  description: "Co-op Shattered Pixel Dungeon in the browser. Up to 4 heroes, one dungeon, turn based.",
  icons: { icon: "/game/assets/icons/icon_32.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
