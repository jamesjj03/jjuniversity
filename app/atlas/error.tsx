"use client";

import { useEffect } from "react";
import { recordAtlasEvent } from "@/lib/atlas-world/telemetry";

export default function AtlasError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    recordAtlasEvent("Atlas route error", { surface: "atlas" }, "atlas-route-error");
  }, []);

  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 24, background: "#102634", color: "#f2ead7" }}>
      <section style={{ maxWidth: 460 }}>
        <p style={{ letterSpacing: ".12em", textTransform: "uppercase", color: "#d4b979" }}>JJ University Atlas</p>
        <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>The map could not finish loading.</h1>
        <p style={{ color: "#bfd0d6", lineHeight: 1.6 }}>Your link is still safe. Try the map again; if an Atlas asset failed, the event has been recorded without your search text.</p>
        <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 18px", border: "1px solid #d4b979", borderRadius: 5, color: "#102634", background: "#e1c989", fontWeight: 700 }}>Try Atlas again</button>
      </section>
    </main>
  );
}
