import { readFile } from "fs/promises";
import path from "path";

export type RecallMode = "find" | "function" | "review";

export type RecallShape =
  | {
      type: "path";
      d: string;
    }
  | {
      type: "circle";
      cx: number;
      cy: number;
      r: number;
    }
  | {
      type: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    };

export type RecallTarget = {
  id: string;
  label: string;
  aliases: string[];
  kind: "polygon" | "dot" | "label";
  parentId?: string;
  reviewStatus: "ai-suggested" | "manual-seed" | "approved" | "needs-fix";
  difficulty: number;
  color: string;
  shape: RecallShape;
  functions: string[];
};

export type RecallDiagram = {
  sourceId: string;
  imageSrc: string;
  width: number;
  height: number;
  mime: string;
  overlayMode: "dots" | "polygons" | "mixed-dots-polygons";
  hitStyle?: {
    idleOpacity: number;
    hoverOpacity: number;
    revealOpacity: number;
    stroke: string;
  };
};

export type RecallApprovalState = "needs-review" | "approved" | "blocked";

export type RecallPack = {
  id: string;
  title: string;
  workingName: string;
  category?: string;
  domain: string;
  status: string;
  publishable?: boolean;
  blockReasons?: string[];
  version: number;
  summary: string;
  modes: RecallMode[];
  diagram?: RecallDiagram;
  approval?: {
    source: RecallApprovalState;
    license: RecallApprovalState;
    attribution: RecallApprovalState;
    targets: RecallApprovalState;
    facts: RecallApprovalState;
    publish: RecallApprovalState;
  };
  automation: {
    status: string;
    modelPlan: string;
    stages: Array<{
      id: string;
      label: string;
      status: "queued" | "active" | "blocked" | "complete";
      owner: string;
      detail: string;
    }>;
  };
  assetLedger: Array<{
    id: string;
    type: string;
    source: string;
    license: string;
    licenseUrl?: string;
    attribution?: string;
    status: string;
    notes: string;
  }>;
  targets: RecallTarget[];
  correctionQueue?: Array<{
    targetId?: string;
    field: "source" | "license" | "attribution" | "target" | "shape" | "fact" | "label";
    message: string;
    status: "open" | "resolved";
  }>;
};

const RECALL_PACK_ROOT = path.join(process.cwd(), "recall", "packs");

export async function getRecallPack(id: string): Promise<RecallPack> {
  const filePath = path.join(RECALL_PACK_ROOT, `${id}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as RecallPack;
}

export async function getRecallPacks(ids: string[]): Promise<RecallPack[]> {
  return Promise.all(ids.map(id => getRecallPack(id)));
}
