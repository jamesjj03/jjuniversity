export const ATLAS_LENSES = ["formation", "structure", "discovery", "evidence"] as const;

export type AtlasLens = (typeof ATLAS_LENSES)[number];

export const ATLAS_NODE_KINDS = [
  "stage",
  "process",
  "entity",
  "concept",
  "event",
  "person",
  "technology",
  "institution",
] as const;

export type AtlasNodeKind = (typeof ATLAS_NODE_KINDS)[number];

export const ATLAS_SCALES = [
  "cosmic",
  "stellar",
  "planetary",
  "geological",
  "molecular",
  "biological",
  "organismal",
  "cognitive",
  "social",
  "civilizational",
  "technological",
] as const;

export type AtlasScale = (typeof ATLAS_SCALES)[number];

export const ATLAS_EDGE_TYPES = [
  "primary_emergence",
  "emerged_from",
  "enabled",
  "composed_of",
  "part_of",
  "requires",
  "influenced",
  "discovered_by",
  "evidenced_by",
  "cross_link",
] as const;

export type AtlasEdgeType = (typeof ATLAS_EDGE_TYPES)[number];

export type AtlasTimeRange = {
  label: string;
  startYearsAgo?: number;
  endYearsAgo?: number;
  precision?: "exact" | "approximate" | "symbolic";
};

export type AtlasFormationContent = {
  prerequisites: string[];
  transition: string;
  newlyPossible: string[];
};

export type AtlasDiscoveryMilestone = {
  id: string;
  label: string;
  dateLabel?: string;
  people?: string[];
  summary?: string;
};

export type AtlasEvidenceItem = {
  id: string;
  label: string;
  summary?: string;
  sourceId?: string;
  href?: string;
};

export type AtlasNode = {
  id: string;
  title: string;
  aliases?: string[];
  kind: AtlasNodeKind;
  scale: AtlasScale;
  stageId: string;
  primaryParentId?: string;
  displayOrder: number;
  time?: AtlasTimeRange;
  summary: string;
  tags?: string[];
  formation: AtlasFormationContent;
  structure?: {
    parts?: string[];
    systems?: string[];
  };
  discovery?: AtlasDiscoveryMilestone[];
  evidence?: AtlasEvidenceItem[];
  visual?: {
    side?: "left" | "center" | "right";
    depth?: number;
    emphasis?: "primary" | "secondary" | "context";
  };
};

export type AtlasEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: AtlasEdgeType;
  label?: string;
  primary?: boolean;
  lenses: AtlasLens[];
};

export type AtlasStage = {
  id: string;
  title: string;
  order: number;
  timeLabel: string;
  summary: string;
  accent: string;
  primaryNodeId: string;
};

export type AtlasSnapshot = {
  schemaVersion: 1;
  id: string;
  title: string;
  rootNodeId: string;
  stages: AtlasStage[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
};

export type AtlasLabUrlState = {
  stageId: string;
  nodeId?: string;
  lens: AtlasLens;
};
