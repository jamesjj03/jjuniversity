import type { Metadata } from "next";
import { AtlasLabExperience } from "@/components/atlas-lab/AtlasLabExperience";
import {
  atlasLabSnapshot,
  normalizeAtlasLabState,
} from "@/lib/atlas-lab/snapshot.v1";
import { assertAtlasLabSnapshot } from "@/lib/atlas-lab/validate";

assertAtlasLabSnapshot(atlasLabSnapshot);

export const metadata: Metadata = {
  title: "Atlas — Visual Map of Formation",
  description:
    "Explore one continuous visual map from the early universe to the networked present.",
  alternates: {
    canonical: "/atlas/lab",
  },
};

interface AtlasLabPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AtlasLabPage({ searchParams }: AtlasLabPageProps) {
  const params = await searchParams;
  const initialState = normalizeAtlasLabState(
    firstValue(params.stage),
    firstValue(params.node),
    firstValue(params.lens),
  );

  return <AtlasLabExperience snapshot={atlasLabSnapshot} initialState={initialState} />;
}
