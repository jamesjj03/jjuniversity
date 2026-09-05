"use client";

import Link from "next/link";
import type { AtlasRuntimeCountrySummary } from "@/lib/atlas-world/runtime";
import styles from "./AtlasSurfaceSwitch.module.css";

function countryKey(country: AtlasRuntimeCountrySummary) {
  return (country.codes.iso3 ?? country.codes.naturalEarth ?? country.slug).toLocaleLowerCase("en-US");
}

export default function AtlasSurfaceSwitch({ country }: { country: AtlasRuntimeCountrySummary | null }) {
  const globeHref = country
    ? `/atlas/globe?country=${encodeURIComponent(countryKey(country))}`
    : "/atlas/globe";
  return (
    <nav className={styles.switcher} aria-label="Atlas map surface">
      <span aria-current="page">Map</span>
      <Link href={globeHref}>Globe</Link>
    </nav>
  );
}
