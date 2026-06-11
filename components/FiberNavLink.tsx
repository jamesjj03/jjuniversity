"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const FIBER_VISITED_KEY = "jjuFiberVisited";

export default function FiberNavLink() {
  const pathname = usePathname();
  const visited = useSyncExternalStore(subscribeToFiberVisit, getFiberVisited, getServerFiberVisited);

  const active = pathname === "/fiber";

  if (!active && !visited) return null;

  return (
    <Link className={active ? "fiberNavPill active" : "fiberNavPill"} href="/fiber">
      Fiber
    </Link>
  );
}

function subscribeToFiberVisit(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("jju-fiber-visited", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("jju-fiber-visited", onStoreChange);
  };
}

function getFiberVisited() {
  try {
    return window.localStorage.getItem(FIBER_VISITED_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerFiberVisited() {
  return false;
}
