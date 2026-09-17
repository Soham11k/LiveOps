import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Snowpitch — Weekend League integrity",
  description: "Play a winter league match, then audit whether the live game is fair.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${serif.variable} ${sans.variable}`}>
        <div className="shell">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
