import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { PipelineStrip } from "@/components/PipelineStrip";

export const metadata: Metadata = {
  title: "Snowpitch — SP-1.12 LiveOps",
  description: "Internal Whiteout client: arcade match + warehouse integrity desk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Nav />
          {children}
          <PipelineStrip />
        </div>
      </body>
    </html>
  );
}
