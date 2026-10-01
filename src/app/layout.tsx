import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OPERATION HEAD SHAVE",
  description:
    "A public accountability system. If Jacob does not post a video for 2 weeks, a 72-hour countdown starts.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  // Full-bleed to the edges of a notched phone. Every screen then keeps its own
  // content clear of the cutouts via the .screen class in globals.css.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="crt">{children}</body>
    </html>
  );
}
