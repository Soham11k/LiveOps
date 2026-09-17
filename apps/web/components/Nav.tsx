"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const path = usePathname();
  return (
    <header className="topnav">
      <Link href="/" className="brand">
        Snow<span>pitch</span>
      </Link>
      <nav className="navlinks">
        <Link href="/play" data-active={path === "/play"}>
          Play
        </Link>
        <Link href="/ops" data-active={path === "/ops"}>
          LiveOps
        </Link>
      </nav>
    </header>
  );
}
