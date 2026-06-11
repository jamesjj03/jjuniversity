"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AtlasHomeLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    fetch("/site.json", { cache: "no-store" })
      .then(response => response.json())
      .then(data => setVisible(Boolean(data?.atlas?.visible)))
      .catch(() => setVisible(false));
  }, []);

  if (!visible) return null;

  return <Link className="btn secondary" href="/atlas">Open Atlas</Link>;
}
