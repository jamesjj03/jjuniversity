import type { CSSProperties } from "react";
import type {
  AtlasEdge,
  AtlasLens,
  AtlasNode,
  AtlasStage,
} from "@/lib/atlas-lab/types";
import { AtlasNodeDetail } from "./AtlasNodeDetail";
import styles from "./AtlasLab.module.css";

type AtlasStyle = CSSProperties & Record<`--${string}`, string | number>;

interface AtlasStageSceneProps {
  active: boolean;
  edges: AtlasEdge[];
  focusedNodeId?: string;
  lens: AtlasLens;
  nextStageTitle?: string;
  nodes: AtlasNode[];
  nodesById: Map<string, AtlasNode>;
  stage: AtlasStage;
  onCloseFocus: () => void;
  onSelectNode: (nodeId: string) => void;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function branchMatchesLens(
  node: AtlasNode,
  lens: AtlasLens,
  primaryEdge: AtlasEdge | undefined,
) {
  if (primaryEdge?.lenses.includes(lens)) return true;
  if (lens === "structure") return Boolean(node.structure?.parts?.length || node.structure?.systems?.length);
  if (lens === "discovery") return Boolean(node.discovery?.length);
  if (lens === "evidence") return Boolean(node.evidence?.length);
  return node.tags?.includes("formation") ?? false;
}

function relationshipLabel(edge: AtlasEdge | undefined, node: AtlasNode) {
  if (edge?.label) return edge.label;
  if (edge) return humanize(edge.type);
  if (node.tags?.includes("discovery")) return "discovery";
  if (node.tags?.includes("structure")) return "structure";
  return "formation";
}

export function AtlasStageScene({
  active,
  edges,
  focusedNodeId,
  lens,
  nextStageTitle,
  nodes,
  nodesById,
  stage,
  onCloseFocus,
  onSelectNode,
}: AtlasStageSceneProps) {
  const primaryNode = nodesById.get(stage.primaryNodeId);
  if (!primaryNode) return null;

  const branchNodes = nodes
    .filter((node) => node.id !== primaryNode.id)
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const focusedNode = focusedNodeId ? nodesById.get(focusedNodeId) : undefined;
  const stageFocusedNode = focusedNode?.stageId === stage.id ? focusedNode : undefined;
  const stageStyle = { "--stage-accent": stage.accent } as AtlasStyle;

  return (
    <section
      className={styles.stageScene}
      id={`atlas-stage-${stage.id}`}
      data-atlas-stage={stage.id}
      data-active={active}
      data-lens={lens}
      aria-labelledby={`atlas-stage-title-${stage.id}`}
      style={stageStyle}
    >
      <div className={styles.stageDepthField} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className={styles.stageOrdinal} aria-hidden="true">
        {String(stage.order).padStart(2, "0")}
      </div>

      <div className={styles.stageSceneBody}>
        <div className={styles.stageCore}>
          <p className={styles.stageTime}>{stage.timeLabel}</p>
          <h2 id={`atlas-stage-title-${stage.id}`}>
            <button
              className={styles.primaryNode}
              id={`atlas-node-${primaryNode.id}`}
              data-atlas-node={primaryNode.id}
              data-focused={focusedNodeId === primaryNode.id}
              type="button"
              aria-expanded={focusedNodeId === primaryNode.id}
              aria-controls={
                focusedNodeId === primaryNode.id
                  ? `atlas-detail-${primaryNode.id}`
                  : undefined
              }
              onClick={() => onSelectNode(primaryNode.id)}
            >
              {stage.title}
            </button>
          </h2>
          <p className={styles.stageSummary}>{stage.summary}</p>
          <span className={styles.primaryNodeMarker} aria-hidden="true">
            <span />
          </span>
        </div>

        <div className={styles.branchLayer}>
          {branchNodes.map((node, index) => {
            const primaryEdge = edges.find(
              (edge) =>
                edge.primary &&
                ((edge.sourceId === node.primaryParentId && edge.targetId === node.id) ||
                  (edge.sourceId === node.id && edge.targetId === node.primaryParentId)),
            );
            const relevant = branchMatchesLens(node, lens, primaryEdge);
            const focused = node.id === focusedNodeId;
            const side =
              node.visual?.side === "center"
                ? index % 2
                  ? "right"
                  : "left"
                : (node.visual?.side ?? (index % 2 ? "right" : "left"));
            const branchStyle = {
              "--branch-row": index + 1,
              "--branch-depth": node.visual?.depth ?? 1,
            } as AtlasStyle;

            return (
              <button
                className={`${styles.branchNode} ${
                  side === "left" ? styles.branchLeft : styles.branchRight
                }`}
                id={`atlas-node-${node.id}`}
                data-atlas-node={node.id}
                data-relevant={relevant}
                data-focused={focused}
                key={node.id}
                style={branchStyle}
                type="button"
                tabIndex={active || focused ? 0 : -1}
                aria-expanded={focused}
                aria-controls={focused ? `atlas-detail-${node.id}` : undefined}
                onClick={() => onSelectNode(node.id)}
              >
                <span className={styles.branchRelationship}>
                  {relationshipLabel(primaryEdge, node)}
                </span>
                <strong>{node.title}</strong>
                <small>{node.summary}</small>
                <span className={styles.branchOpen}>
                  Focus node <span aria-hidden="true">↗</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {stageFocusedNode && (
        <AtlasNodeDetail
          edges={edges}
          lens={lens}
          node={stageFocusedNode}
          nodesById={nodesById}
          stage={stage}
          onClose={onCloseFocus}
          onSelectNode={onSelectNode}
        />
      )}

      {nextStageTitle ? (
        <div className={styles.stageContinuation} aria-hidden="true">
          <span />
          <p>Formation continues toward {nextStageTitle}</p>
        </div>
      ) : (
        <div className={styles.stageContinuation} aria-hidden="true">
          <span />
          <p>The map remains open</p>
        </div>
      )}
    </section>
  );
}
