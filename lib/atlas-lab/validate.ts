import {
  ATLAS_EDGE_TYPES,
  ATLAS_LENSES,
  ATLAS_NODE_KINDS,
  ATLAS_SCALES,
} from "@/lib/atlas-lab/types";
import type {
  AtlasEdge,
  AtlasEdgeType,
  AtlasLens,
  AtlasNode,
  AtlasSnapshot,
} from "@/lib/atlas-lab/types";

export type AtlasLabValidationIssue = {
  path: string;
  message: string;
};

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const FORMATION_BRANCH_TYPES = new Set<AtlasEdgeType>(["emerged_from", "enabled"]);
const STRUCTURE_BRANCH_TYPES = new Set<AtlasEdgeType>(["composed_of", "part_of"]);
const DISCOVERY_EVIDENCE_BRANCH_TYPES = new Set<AtlasEdgeType>(["discovered_by", "evidenced_by"]);
const REQUIRED_LENS_BY_EDGE_TYPE: Partial<Record<AtlasEdgeType, AtlasLens>> = {
  primary_emergence: "formation",
  emerged_from: "formation",
  enabled: "formation",
  composed_of: "structure",
  part_of: "structure",
  requires: "structure",
  influenced: "formation",
  discovered_by: "discovery",
  evidenced_by: "evidence",
};

function addIssue(issues: AtlasLabValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

function requireText(value: string, path: string, issues: AtlasLabValidationIssue[]) {
  if (!value.trim()) addIssue(issues, path, "Required text is blank.");
}

function validateId(value: string, path: string, issues: AtlasLabValidationIssue[]) {
  requireText(value, path, issues);
  if (value && !ID_PATTERN.test(value)) addIssue(issues, path, `"${value}" must be lowercase kebab-case.`);
}

function validateTime(node: AtlasNode, path: string, issues: AtlasLabValidationIssue[]) {
  if (!node.time) return;

  requireText(node.time.label, `${path}.time.label`, issues);
  const values = [
    ["startYearsAgo", node.time.startYearsAgo],
    ["endYearsAgo", node.time.endYearsAgo],
  ] as const;

  values.forEach(([key, value]) => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < 0) {
      addIssue(issues, `${path}.time.${key}`, `${key} must be a finite non-negative number.`);
    }
  });

  if (
    node.time.startYearsAgo !== undefined
    && node.time.endYearsAgo !== undefined
    && node.time.startYearsAgo < node.time.endYearsAgo
  ) {
    addIssue(
      issues,
      `${path}.time`,
      "startYearsAgo must be greater than or equal to endYearsAgo because time moves toward zero.",
    );
  }
}

function validateNodeContent(node: AtlasNode, path: string, rootNodeId: string, issues: AtlasLabValidationIssue[]) {
  validateId(node.id, `${path}.id`, issues);
  validateId(node.stageId, `${path}.stageId`, issues);
  requireText(node.title, `${path}.title`, issues);
  requireText(node.summary, `${path}.summary`, issues);

  if (!ATLAS_NODE_KINDS.includes(node.kind)) {
    addIssue(issues, `${path}.kind`, `"${node.kind}" is not a supported Atlas node kind.`);
  }
  if (!ATLAS_SCALES.includes(node.scale)) {
    addIssue(issues, `${path}.scale`, `"${node.scale}" is not a supported Atlas scale.`);
  }
  if (!Number.isInteger(node.displayOrder) || node.displayOrder < 0) {
    addIssue(issues, `${path}.displayOrder`, "displayOrder must be a non-negative integer.");
  }

  if (!node.formation) {
    addIssue(issues, `${path}.formation`, "Every Atlas Lab node needs formation content.");
  } else {
    if (node.id !== rootNodeId && !node.formation.prerequisites.length) {
      addIssue(issues, `${path}.formation.prerequisites`, "Every non-root node needs at least one prerequisite description.");
    }
    node.formation.prerequisites.forEach((item, index) => requireText(
      item,
      `${path}.formation.prerequisites[${index}]`,
      issues,
    ));
    requireText(node.formation.transition, `${path}.formation.transition`, issues);
    if (!node.formation.newlyPossible.length) {
      addIssue(issues, `${path}.formation.newlyPossible`, "Every node must name at least one newly possible outcome.");
    }
    node.formation.newlyPossible.forEach((item, index) => requireText(
      item,
      `${path}.formation.newlyPossible[${index}]`,
      issues,
    ));
  }

  validateTime(node, path, issues);

  const discoveryIds = new Set<string>();
  node.discovery?.forEach((milestone, index) => {
    const milestonePath = `${path}.discovery[${index}]`;
    validateId(milestone.id, `${milestonePath}.id`, issues);
    requireText(milestone.label, `${milestonePath}.label`, issues);
    if (discoveryIds.has(milestone.id)) {
      addIssue(issues, `${milestonePath}.id`, `Duplicate discovery id "${milestone.id}" within node "${node.id}".`);
    }
    discoveryIds.add(milestone.id);
  });

  const evidenceIds = new Set<string>();
  node.evidence?.forEach((item, index) => {
    const evidencePath = `${path}.evidence[${index}]`;
    validateId(item.id, `${evidencePath}.id`, issues);
    requireText(item.label, `${evidencePath}.label`, issues);
    if (evidenceIds.has(item.id)) {
      addIssue(issues, `${evidencePath}.id`, `Duplicate evidence id "${item.id}" within node "${node.id}".`);
    }
    evidenceIds.add(item.id);

    if (item.sourceId !== undefined && !item.sourceId.startsWith("atlas-lab:")) {
      addIssue(issues, `${evidencePath}.sourceId`, "Local fixture source IDs must start with atlas-lab:.");
    }
    if (item.href !== undefined) {
      try {
        const url = new URL(item.href);
        if (url.protocol !== "https:") addIssue(issues, `${evidencePath}.href`, "Evidence href must use https.");
      } catch {
        addIssue(issues, `${evidencePath}.href`, "Evidence href must be an absolute reviewed URL.");
      }
    }
  });
}

function validateEdgeContent(edge: AtlasEdge, path: string, issues: AtlasLabValidationIssue[]) {
  validateId(edge.id, `${path}.id`, issues);
  validateId(edge.sourceId, `${path}.sourceId`, issues);
  validateId(edge.targetId, `${path}.targetId`, issues);

  if (!ATLAS_EDGE_TYPES.includes(edge.type)) {
    addIssue(issues, `${path}.type`, `"${edge.type}" is not a supported Atlas edge type.`);
  }
  if (edge.sourceId === edge.targetId) {
    addIssue(issues, path, "Self-referential edges are not allowed.");
  }
  if (!edge.lenses.length) {
    addIssue(issues, `${path}.lenses`, "Every edge must appear in at least one lens.");
  }

  const seenLenses = new Set<AtlasLens>();
  edge.lenses.forEach((lens, index) => {
    if (!ATLAS_LENSES.includes(lens)) {
      addIssue(issues, `${path}.lenses[${index}]`, `"${lens}" is not a supported Atlas lens.`);
    }
    if (seenLenses.has(lens)) {
      addIssue(issues, `${path}.lenses[${index}]`, `Duplicate lens "${lens}".`);
    }
    seenLenses.add(lens);
  });

  const requiredLens = REQUIRED_LENS_BY_EDGE_TYPE[edge.type];
  if (requiredLens && !seenLenses.has(requiredLens)) {
    addIssue(issues, `${path}.lenses`, `${edge.type} edges must include the ${requiredLens} lens.`);
  }
}

function validatePrimaryTree(
  snapshot: AtlasSnapshot,
  nodeById: Map<string, AtlasNode>,
  stageOrderById: Map<string, number>,
  edgeById: Map<string, AtlasEdge>,
  issues: AtlasLabValidationIssue[],
) {
  const roots = snapshot.nodes.filter(node => !node.primaryParentId);
  if (roots.length !== 1) {
    addIssue(issues, "nodes", `Expected exactly one primary root, found ${roots.length}.`);
  }
  if (roots[0]?.id !== snapshot.rootNodeId) {
    addIssue(issues, "rootNodeId", "rootNodeId must identify the only node without a primaryParentId.");
  }

  const primaryEdges = snapshot.edges.filter(edge => edge.primary);
  if (primaryEdges.length !== snapshot.nodes.length - 1) {
    addIssue(
      issues,
      "edges",
      `Expected ${snapshot.nodes.length - 1} primary edges for ${snapshot.nodes.length} nodes, found ${primaryEdges.length}.`,
    );
  }

  const incomingPrimaryByTarget = new Map<string, AtlasEdge[]>();
  primaryEdges.forEach(edge => {
    const current = incomingPrimaryByTarget.get(edge.targetId) || [];
    current.push(edge);
    incomingPrimaryByTarget.set(edge.targetId, current);
  });

  snapshot.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (node.id === snapshot.rootNodeId) {
      if (incomingPrimaryByTarget.get(node.id)?.length) {
        addIssue(issues, path, "The root node cannot have an incoming primary edge.");
      }
      return;
    }

    if (!node.primaryParentId) {
      addIssue(issues, `${path}.primaryParentId`, "Every non-root node needs one primaryParentId.");
      return;
    }

    const parent = nodeById.get(node.primaryParentId);
    if (!parent) {
      addIssue(issues, `${path}.primaryParentId`, `Primary parent "${node.primaryParentId}" does not resolve.`);
      return;
    }
    if (parent.id === node.id) {
      addIssue(issues, `${path}.primaryParentId`, "A node cannot be its own primary parent.");
    }

    const parentOrder = stageOrderById.get(parent.stageId);
    const childOrder = stageOrderById.get(node.stageId);
    if (parentOrder !== undefined && childOrder !== undefined && parentOrder > childOrder) {
      addIssue(issues, `${path}.primaryParentId`, "A display parent cannot belong to a later stage.");
    }

    const incoming = incomingPrimaryByTarget.get(node.id) || [];
    if (incoming.length !== 1) {
      addIssue(issues, path, `Expected exactly one incoming primary edge, found ${incoming.length}.`);
      return;
    }
    if (incoming[0].sourceId !== node.primaryParentId) {
      addIssue(
        issues,
        `edges.${incoming[0].id}`,
        `Primary edge source "${incoming[0].sourceId}" must match primaryParentId "${node.primaryParentId}".`,
      );
    }
  });

  const childrenByParent = new Map<string, string[]>();
  snapshot.nodes.forEach(node => {
    if (!node.primaryParentId) return;
    const current = childrenByParent.get(node.primaryParentId) || [];
    current.push(node.id);
    childrenByParent.set(node.primaryParentId, current);
  });

  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId)) {
      addIssue(issues, "nodes", `Primary-parent cycle reaches "${nodeId}".`);
      return;
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    (childrenByParent.get(nodeId) || []).forEach(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  visit(snapshot.rootNodeId);

  if (visited.size !== snapshot.nodes.length) {
    const missing = snapshot.nodes.filter(node => !visited.has(node.id)).map(node => node.id);
    addIssue(issues, "nodes", `Primary tree does not reach: ${missing.join(", ")}.`);
  }

  primaryEdges.forEach(edge => {
    if (!edgeById.has(edge.id)) addIssue(issues, `edges.${edge.id}`, "Primary edge is missing from the edge index.");
  });
}

function validateStageShape(
  snapshot: AtlasSnapshot,
  nodeById: Map<string, AtlasNode>,
  issues: AtlasLabValidationIssue[],
) {
  if (snapshot.stages.length !== 14) {
    addIssue(issues, "stages", `Atlas Lab v1 requires exactly 14 stages, found ${snapshot.stages.length}.`);
  }

  const sortedStages = [...snapshot.stages].sort((a, b) => a.order - b.order);
  sortedStages.forEach((stage, index) => {
    const stageIndex = snapshot.stages.indexOf(stage);
    const path = `stages[${stageIndex}]`;
    const expectedOrder = index + 1;

    if (stage.order !== expectedOrder) {
      addIssue(issues, `${path}.order`, `Stage order must be contiguous; expected ${expectedOrder}.`);
    }
    if (stageIndex !== index) {
      addIssue(issues, path, "Stages must be stored in ascending narrative order.");
    }
    if (!ACCENT_PATTERN.test(stage.accent)) {
      addIssue(issues, `${path}.accent`, "Stage accent must be a six-digit hexadecimal color.");
    }

    const primaryNode = nodeById.get(stage.primaryNodeId);
    if (!primaryNode) {
      addIssue(issues, `${path}.primaryNodeId`, `Primary node "${stage.primaryNodeId}" does not resolve.`);
      return;
    }
    if (primaryNode.stageId !== stage.id) {
      addIssue(issues, `${path}.primaryNodeId`, "The primary node must belong to its stage.");
    }
    if (primaryNode.kind !== "stage") {
      addIssue(issues, `${path}.primaryNodeId`, "The primary stage node must use kind stage.");
    }
    if (!primaryNode.structure?.parts?.length || !primaryNode.structure.systems?.length) {
      addIssue(issues, `${path}.primaryNodeId`, "Primary stage nodes need robust parts and systems structure data.");
    }
    if (!primaryNode.discovery?.length) {
      addIssue(issues, `${path}.primaryNodeId`, "Primary stage nodes need discovery milestones.");
    }
    if (!primaryNode.evidence?.length) {
      addIssue(issues, `${path}.primaryNodeId`, "Primary stage nodes need evidence data.");
    }

    const stageNodes = snapshot.nodes.filter(node => node.stageId === stage.id);
    if (stageNodes.length !== 4) {
      addIssue(issues, path, `Each stage needs one primary node and exactly three branches; found ${stageNodes.length} nodes.`);
    }

    const displayOrders = new Set<number>();
    stageNodes.forEach(node => {
      if (displayOrders.has(node.displayOrder)) {
        addIssue(issues, path, `Duplicate displayOrder ${node.displayOrder} in stage "${stage.id}".`);
      }
      displayOrders.add(node.displayOrder);
    });

    const branchNodes = stageNodes.filter(node => node.id !== stage.primaryNodeId);
    const primaryEdgeFor = (node: AtlasNode) => snapshot.edges.find(edge => edge.primary && edge.targetId === node.id);
    const branchEdges = branchNodes.map(primaryEdgeFor).filter(Boolean) as AtlasEdge[];
    const formationCount = branchEdges.filter(edge => FORMATION_BRANCH_TYPES.has(edge.type)).length;
    const structureCount = branchEdges.filter(edge => STRUCTURE_BRANCH_TYPES.has(edge.type)).length;
    const discoveryEvidenceCount = branchEdges.filter(edge => DISCOVERY_EVIDENCE_BRANCH_TYPES.has(edge.type)).length;

    if (formationCount !== 1 || structureCount !== 1 || discoveryEvidenceCount !== 1) {
      addIssue(
        issues,
        path,
        `Branch roles must be one formation, one structure, and one discovery/evidence; found ${formationCount}/${structureCount}/${discoveryEvidenceCount}.`,
      );
    }
  });

  sortedStages.slice(1).forEach((stage, index) => {
    const previousStage = sortedStages[index];
    const matches = snapshot.edges.filter(edge => (
      edge.primary
      && edge.type === "primary_emergence"
      && edge.sourceId === previousStage.primaryNodeId
      && edge.targetId === stage.primaryNodeId
    ));
    if (matches.length !== 1) {
      addIssue(
        issues,
        `stages.${stage.id}`,
        `Expected one primary_emergence spine edge from "${previousStage.id}" to "${stage.id}", found ${matches.length}.`,
      );
    }
  });

  snapshot.edges
    .filter(edge => edge.primary && edge.type === "primary_emergence")
    .forEach(edge => {
      const sourceStage = sortedStages.find(stage => stage.primaryNodeId === edge.sourceId);
      const targetStage = sortedStages.find(stage => stage.primaryNodeId === edge.targetId);
      if (!sourceStage || !targetStage || targetStage.order !== sourceStage.order + 1) {
        addIssue(issues, `edges.${edge.id}`, "Primary emergence edges are reserved for adjacent nodes on the 14-stage spine.");
      }
    });
}

export function validateAtlasLabSnapshot(snapshot: AtlasSnapshot): AtlasLabValidationIssue[] {
  const issues: AtlasLabValidationIssue[] = [];
  if (snapshot.schemaVersion !== 1) addIssue(issues, "schemaVersion", "Unsupported Atlas Lab schema version.");
  validateId(snapshot.id, "id", issues);
  requireText(snapshot.title, "title", issues);
  validateId(snapshot.rootNodeId, "rootNodeId", issues);

  const stageIds = new Set<string>();
  snapshot.stages.forEach((stage, index) => {
    const path = `stages[${index}]`;
    validateId(stage.id, `${path}.id`, issues);
    validateId(stage.primaryNodeId, `${path}.primaryNodeId`, issues);
    requireText(stage.title, `${path}.title`, issues);
    requireText(stage.timeLabel, `${path}.timeLabel`, issues);
    requireText(stage.summary, `${path}.summary`, issues);
    if (stageIds.has(stage.id)) addIssue(issues, `${path}.id`, `Duplicate stage id "${stage.id}".`);
    stageIds.add(stage.id);
  });

  const nodeById = new Map<string, AtlasNode>();
  snapshot.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    validateNodeContent(node, path, snapshot.rootNodeId, issues);
    if (nodeById.has(node.id)) addIssue(issues, `${path}.id`, `Duplicate node id "${node.id}".`);
    nodeById.set(node.id, node);
    if (!stageIds.has(node.stageId)) {
      addIssue(issues, `${path}.stageId`, `Stage "${node.stageId}" does not resolve.`);
    }
  });

  const edgeById = new Map<string, AtlasEdge>();
  snapshot.edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    validateEdgeContent(edge, path, issues);
    if (edgeById.has(edge.id)) addIssue(issues, `${path}.id`, `Duplicate edge id "${edge.id}".`);
    edgeById.set(edge.id, edge);
    if (!nodeById.has(edge.sourceId)) addIssue(issues, `${path}.sourceId`, `Source node "${edge.sourceId}" does not resolve.`);
    if (!nodeById.has(edge.targetId)) addIssue(issues, `${path}.targetId`, `Target node "${edge.targetId}" does not resolve.`);
  });

  if (!nodeById.has(snapshot.rootNodeId)) {
    addIssue(issues, "rootNodeId", `Root node "${snapshot.rootNodeId}" does not resolve.`);
  }

  const stageOrderById = new Map(snapshot.stages.map(stage => [stage.id, stage.order]));
  validateStageShape(snapshot, nodeById, issues);
  validatePrimaryTree(snapshot, nodeById, stageOrderById, edgeById, issues);
  return issues;
}

export function assertAtlasLabSnapshot(snapshot: AtlasSnapshot) {
  const issues = validateAtlasLabSnapshot(snapshot);
  if (!issues.length) return;

  throw new Error(
    `Invalid Atlas Lab snapshot:\n${issues.map(issue => `- ${issue.path}: ${issue.message}`).join("\n")}`,
  );
}
