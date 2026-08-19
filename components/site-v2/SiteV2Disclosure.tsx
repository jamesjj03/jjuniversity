"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export default function SiteV2Disclosure({
  className,
  label,
  labelAria,
  children,
}: {
  className: string;
  label: string;
  labelAria?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  return (
    <details className={className} ref={detailsRef}>
      <summary aria-label={labelAria}>{label}</summary>
      {children}
    </details>
  );
}
