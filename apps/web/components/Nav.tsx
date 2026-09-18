"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const path = usePathname();
  return (
    <header className="topnav">
      <div className="brand-wrap">
        <Link href="/" className="brand">
          snow<span>pitch</span>
        </Link>
        <span className="brand-meta">SP-1.12 · INTERNAL</span>
      </div>
      <nav className="navlinks">
        <Link href="/" data-active={!path || path === "/" ? "true" : "false"}>
          Ops
        </Link>
        <Link href="/play" data-active={path === "/play" ? "true" : "false"}>
          Match
        </Link>
        <Link href="/ops/replay" data-active={path?.startsWith("/ops/replay") ? "true" : "false"}>
          Replay
        </Link>
      </nav>
    </header>
  );
}
