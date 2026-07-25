import type {
  AtlasEdge,
  AtlasLens,
  AtlasNode,
  AtlasStage,
} from "@/lib/atlas-lab/types";
import styles from "./AtlasLab.module.css";

interface AtlasNodeDetailProps {
  edges: AtlasEdge[];
  lens: AtlasLens;
  node: AtlasNode;
  nodesById: Map<string, AtlasNode>;
  stage: AtlasStage;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function DetailList({
  empty,
  items,
}: {
  empty: string;
  items: string[] | undefined;
}) {
  if (!items?.length) return <p className={styles.detailEmpty}>{empty}</p>;

  return (
    <ul className={styles.detailList}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function AtlasNodeDetail({
  edges,
  lens,
  node,
  nodesById,
  stage,
  onClose,
  onSelectNode,
}: AtlasNodeDetailProps) {
  const formation = node.formation;
  const relationships = edges
    .filter(
      (edge) =>
        edge.lenses.includes(lens) &&
        (edge.sourceId === node.id || edge.targetId === node.id),
    )
    .slice(0, 6);

  return (
    <aside
      className={styles.detailField}
      id={`atlas-detail-${node.id}`}
      aria-labelledby={`atlas-detail-title-${node.id}`}
      data-lens={lens}
    >
      <div className={styles.detailTopline}>
        <p className={styles.detailCoordinates}>
          Stage {String(stage.order).padStart(2, "0")} · {humanize(node.kind)} ·{" "}
          {humanize(node.scale)}
        </p>
        <button className={styles.detailClose} type="button" onClick={onClose}>
          Close focus <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className={styles.detailIntroduction}>
        <div>
          <p className={styles.interfaceEyebrow}>{stage.title}</p>
          <h3 id={`atlas-detail-title-${node.id}`}>{node.title}</h3>
        </div>
        <p>{node.summary}</p>
      </div>

      {node.time && (
        <p className={styles.detailTime}>
          <span>Time field</span>
          {node.time.label}
          {node.time.precision && <em>{node.time.precision}</em>}
        </p>
      )}

      <div className={styles.formationSequence} aria-label="Formation sequence">
        <section>
          <span className={styles.sequenceNumber}>01</span>
          <p className={styles.sequenceLabel}>What preceded it</p>
          <DetailList
            items={formation?.prerequisites}
            empty="The prototype has not yet resolved this node’s prerequisites."
          />
        </section>
        <span className={styles.sequenceArrow} aria-hidden="true">
          →
        </span>
        <section>
          <span className={styles.sequenceNumber}>02</span>
          <p className={styles.sequenceLabel}>Transition</p>
          <p>{formation?.transition ?? "Formation detail remains to be authored."}</p>
        </section>
        <span className={styles.sequenceArrow} aria-hidden="true">
          →
        </span>
        <section>
          <span className={styles.sequenceNumber}>03</span>
          <p className={styles.sequenceLabel}>What became possible</p>
          <DetailList
            items={formation?.newlyPossible}
            empty="The prototype has not yet resolved this node’s consequences."
          />
        </section>
      </div>

      <div className={styles.lensField}>
        <div className={styles.lensFieldHeading}>
          <p className={styles.interfaceEyebrow}>Current lens</p>
          <h4>{lens}</h4>
        </div>

        {lens === "formation" && (
          <div className={styles.relationshipField}>
            <p>
              Primary emergence stays on the central spine. These nearby relationships preserve
              additional prerequisites, consequences, and cross-links.
            </p>
            {relationships.length ? (
              <div className={styles.relationshipList}>
                {relationships.map((edge) => {
                  const currentIsSource = edge.sourceId === node.id;
                  const relatedNode = nodesById.get(
                    currentIsSource ? edge.targetId : edge.sourceId,
                  );
                  if (!relatedNode) return null;

                  return (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => onSelectNode(relatedNode.id)}
                    >
                      <span>{currentIsSource ? "→" : "←"}</span>
                      <strong>{relatedNode.title}</strong>
                      <small>{edge.label ?? humanize(edge.type)}</small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={styles.detailEmpty}>No additional formation edge is shown here yet.</p>
            )}
          </div>
        )}

        {lens === "structure" && (
          <div className={styles.structureField}>
            <section>
              <p className={styles.sequenceLabel}>Composed of</p>
              <DetailList
                items={node.structure?.parts}
                empty="No component list is attached to this node yet."
              />
            </section>
            <section>
              <p className={styles.sequenceLabel}>Nested within / organized as</p>
              <DetailList
                items={node.structure?.systems}
                empty="No larger system is attached to this node yet."
              />
            </section>
          </div>
        )}

        {lens === "discovery" && (
          <div className={styles.discoveryField}>
            {node.discovery?.length ? (
              node.discovery.map((milestone) => (
                <article key={milestone.id}>
                  <p className={styles.discoveryDate}>{milestone.dateLabel ?? "Date open"}</p>
                  <h5>{milestone.label}</h5>
                  {milestone.people?.length && <p>{milestone.people.join(" · ")}</p>}
                  {milestone.summary && <p>{milestone.summary}</p>}
                </article>
              ))
            ) : (
              <p className={styles.detailEmpty}>
                This node has no discovery-history milestone in the V1 fixture.
              </p>
            )}
          </div>
        )}

        {lens === "evidence" && (
          <div className={styles.evidenceField}>
            <p className={styles.evidenceNote}>
              Source-ready prototype metadata. External citations are intentionally absent until
              a reviewed source is attached.
            </p>
            {node.evidence?.length ? (
              <div className={styles.evidenceList}>
                {node.evidence.map((item) => (
                  <article key={item.id}>
                    <div>
                      <span className={styles.evidenceMarker} aria-hidden="true" />
                      <h5>{item.label}</h5>
                    </div>
                    {item.summary && <p>{item.summary}</p>}
                    {item.sourceId && <code>{item.sourceId}</code>}
                    {item.href && (
                      <a href={item.href} target="_blank" rel="noreferrer">
                        Open reviewed source
                      </a>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.detailEmpty}>
                No evidence record is attached to this node in the V1 fixture.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
