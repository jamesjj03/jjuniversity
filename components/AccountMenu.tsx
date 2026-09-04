"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const ACCOUNT_KEY = "jju.account";

type Account = {
  name?: string;
};

function readAccount() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as Account | null;
  } catch {
    return null;
  }
}

export default function AccountMenu() {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(null);
  const [fiberVisible, setFiberVisible] = useState(false);

  const navItems = useMemo(() => [
    { href: "/", label: "Home" },
    { href: "/library", label: "Library" },
    { href: "/print", label: "Print" },
    { href: "/arena", label: "Arena" },
    { href: "/atlas", label: "Atlas" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
    { href: "/settings", label: "Settings" },
    ...(fiberVisible ? [{ href: "/fiber", label: "Fiber" }] : []),
  ], [fiberVisible]);

  useEffect(() => {
    fetch("/site.json", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        setFiberVisible(Boolean(data?.fiber?.visible));
      })
      .catch(() => {
        setFiberVisible(false);
      });

    const refresh = () => {
      setAccount(readAccount());
    };
    const closeOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };

    refresh();
    window.addEventListener("jju-account", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("click", closeOutside);
    return () => {
      window.removeEventListener("jju-account", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("click", closeOutside);
    };
  }, []);

  function closeMenu() {
    if (ref.current) ref.current.open = false;
  }

  return (
    <details className="accountMenu" ref={ref}>
      <summary aria-label="Open account and site menu">
        <span className="menuBars" aria-hidden="true"><i /><i /><i /></span>
      </summary>
      <div className="accountMenuPanel" aria-label="Account and site navigation">
        <div className="accountMenuTop">
          <Link className="menuSettingsButton" href="/settings" onClick={closeMenu} aria-label="Settings" title="Settings">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.25" /><path d="M19.4 15a8.1 8.1 0 0 0 .06-5.9l2.04-1.6-2-3.46-2.55 1a8.2 8.2 0 0 0-2.55-1.48L14 1h-4l-.4 2.56a8.2 8.2 0 0 0-2.55 1.48l-2.55-1-2 3.46 2.04 1.6a8.1 8.1 0 0 0 .06 5.9L2.5 16.5l2 3.46 2.55-1a8.2 8.2 0 0 0 2.55 1.48L10 23h4l.4-2.56a8.2 8.2 0 0 0 2.55-1.48l2.55 1 2-3.46L19.4 15Z" /></svg>
          </Link>
          <Link className="menuAccountButton" href="/account" onClick={closeMenu} aria-label="Account" title="Account">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.75 21a7.25 7.25 0 0 1 14.5 0" />
            </svg>
          </Link>
          {account?.name ? <span>{account.name}</span> : <span className="accountMenuSpacer" aria-hidden="true" />}
          <button type="button" onClick={closeMenu}>Close</button>
        </div>

        <section className="accountNavSection" aria-label="Site navigation">
          <strong>Navigate</strong>
          <div className="accountNavGrid">
            {navItems.map(item => (
              <Link
                className={pathname === item.href ? "active" : ""}
                href={item.href}
                key={item.href}
                onClick={closeMenu}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}
