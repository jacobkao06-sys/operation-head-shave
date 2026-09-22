import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OPERATION HEAD SHAVE",
  description:
    "A public accountability system. If Jacob does not post a video for 7 days, a 72-hour countdown starts.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="crt">{children}</body>
    </html>
  );
}
