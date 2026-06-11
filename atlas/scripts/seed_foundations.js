const path = require("path");
const {
  atlasRoot,
  titleFromId,
  unique,
  writeJson
} = require("./atlas_utils");

const sources = {
  wikipedia: "",
  britannica: "",
  openstax: "",
  stanford_encyclopedia: ""
};

const groups = [
  {
    id: "core_primitives",
    prerequisites: [],
    summary: (title) => `${title} is a foundational connector for describing what exists, changes, relates, or becomes understandable.`,
    ids: [
      "energy",
      "matter",
      "information",
      "time",
      "space",
      "cause",
      "pattern",
      "system",
      "structure",
      "feedback",
      "measurement",
      "evidence",
      "model",
      "knowledge",
      "learning",
      "power",
      "value",
      "language",
      "change",
      "relation",
      "boundary",
      "identity",
      "difference",
      "quantity",
      "state"
    ]
  },
  {
    id: "systems_and_change",
    prerequisites: ["system", "change", "relation"],
    summary: (title) => `${title} is a foundational idea for tracking how parts of a system affect one another over time.`,
    ids: [
      "input",
      "output",
      "process",
      "interaction",
      "equilibrium",
      "stability",
      "instability",
      "emergence",
      "complexity",
      "network",
      "flow",
      "constraint",
      "adaptation",
      "regulation",
      "control",
      "signal",
      "noise",
      "threshold",
      "cycle",
      "recursion",
      "scale",
      "resilience",
      "self_organization"
    ]
  },
  {
    id: "models_and_reasoning",
    prerequisites: ["knowledge", "model", "language"],
    summary: (title) => `${title} is a foundational idea for forming, testing, or communicating an understanding of something.`,
    ids: [
      "abstraction",
      "representation",
      "assumption",
      "inference",
      "deduction",
      "induction",
      "abduction",
      "analogy",
      "category",
      "classification",
      "definition",
      "explanation",
      "prediction",
      "uncertainty",
      "probability",
      "correlation",
      "causation",
      "variable",
      "function",
      "algorithm",
      "computation",
      "proof",
      "paradox"
    ]
  },
  {
    id: "evidence_and_measurement",
    prerequisites: ["evidence", "measurement", "knowledge"],
    summary: (title) => `${title} is a foundational idea for judging how well a claim or model is supported by reality.`,
    ids: [
      "observation",
      "experiment",
      "data",
      "sample",
      "population",
      "error",
      "bias",
      "validity",
      "reliability",
      "replication",
      "precision",
      "accuracy",
      "hypothesis",
      "test",
      "falsifiability",
      "peer_review",
      "source",
      "citation",
      "authority",
      "expertise",
      "skepticism",
      "inference_to_best_explanation"
    ]
  },
  {
    id: "matter_and_energy",
    prerequisites: ["matter", "energy", "measurement"],
    summary: (title) => `${title} is a foundational idea for describing physical things, forces, and transformations.`,
    ids: [
      "mass",
      "force",
      "motion",
      "momentum",
      "charge",
      "field",
      "wave",
      "particle",
      "atom",
      "molecule",
      "temperature",
      "heat",
      "pressure",
      "entropy",
      "symmetry",
      "conservation",
      "transformation",
      "dimension",
      "magnitude",
      "density",
      "frequency",
      "radiation",
      "gradient"
    ]
  },
  {
    id: "life_and_mind",
    prerequisites: ["system", "information", "matter"],
    summary: (title) => `${title} is a foundational idea for understanding living systems, minds, and adaptive behavior.`,
    ids: [
      "organism",
      "cell",
      "metabolism",
      "homeostasis",
      "reproduction",
      "variation",
      "selection",
      "evolution",
      "heredity",
      "gene",
      "environment",
      "behavior",
      "stimulus",
      "response",
      "perception",
      "attention",
      "memory",
      "emotion",
      "consciousness",
      "agency",
      "intelligence",
      "cognition",
      "development"
    ]
  },
  {
    id: "society_and_culture",
    prerequisites: ["language", "value", "power"],
    summary: (title) => `${title} is a foundational idea for understanding social life, shared meaning, and organized action.`,
    ids: [
      "society",
      "culture",
      "norm",
      "role",
      "institution",
      "community",
      "group",
      "cooperation",
      "conflict",
      "status",
      "exchange",
      "economy",
      "labor",
      "property",
      "law",
      "governance",
      "legitimacy",
      "ideology",
      "ritual",
      "symbol",
      "narrative",
      "technology"
    ]
  },
  {
    id: "history_and_time",
    prerequisites: ["time", "cause", "evidence"],
    summary: (title) => `${title} is a foundational idea for locating change, continuity, and human action in time.`,
    ids: [
      "event",
      "chronology",
      "period",
      "origin",
      "continuity",
      "revolution",
      "migration",
      "diffusion",
      "empire",
      "civilization",
      "archive",
      "artifact",
      "primary_source",
      "secondary_source",
      "context",
      "trend",
      "modernization",
      "colonization",
      "industrialization",
      "urbanization",
      "globalization"
    ]
  },
  {
    id: "values_and_action",
    prerequisites: ["value", "power", "knowledge"],
    summary: (title) => `${title} is a foundational idea for deciding what matters and what should be done.`,
    ids: [
      "ethics",
      "morality",
      "justice",
      "freedom",
      "equality",
      "responsibility",
      "rights",
      "duty",
      "harm",
      "benefit",
      "preference",
      "choice",
      "decision",
      "tradeoff",
      "incentive",
      "risk",
      "trust",
      "consent",
      "autonomy",
      "dignity",
      "wellbeing",
      "fairness",
      "obligation"
    ]
  },
  {
    id: "communication_and_meaning",
    prerequisites: ["language", "information", "relation"],
    summary: (title) => `${title} is a foundational idea for making, carrying, interpreting, or contesting meaning.`,
    ids: [
      "sign",
      "meaning",
      "syntax",
      "semantics",
      "pragmatics",
      "grammar",
      "discourse",
      "metaphor",
      "translation",
      "interpretation",
      "medium",
      "message",
      "channel",
      "audience",
      "context_of_communication",
      "code",
      "convention",
      "literacy",
      "writing",
      "speech",
      "argument",
      "dialogue",
      "persuasion"
    ]
  },
  {
    id: "quantity_and_form",
    prerequisites: ["quantity", "pattern", "structure"],
    summary: (title) => `${title} is a foundational idea for reasoning about amount, form, order, and formal relationships.`,
    ids: [
      "number",
      "set",
      "operation",
      "ratio",
      "proportion",
      "rate",
      "distribution",
      "geometry",
      "algebra",
      "calculus",
      "limit",
      "derivative",
      "integral",
      "matrix",
      "vector",
      "graph",
      "topology",
      "logic",
      "sequence",
      "optimization",
      "randomness",
      "mapping"
    ]
  }
];

const aliases = {
  cause: ["causality"],
  relation: ["relationship"],
  feedback: ["feedback loop"],
  measurement: ["measure"],
  evidence: ["supporting evidence"],
  model: ["mental model"],
  state: ["condition"],
  input: ["system input"],
  output: ["system output"],
  equilibrium: ["balance"],
  self_organization: ["self-organization"],
  abstraction: ["abstract thinking"],
  inference_to_best_explanation: ["IBE"],
  peer_review: ["peer review"],
  entropy: ["thermodynamic entropy"],
  charge: ["electric charge"],
  field: ["physical field"],
  evolution: ["biological evolution"],
  memory: ["remembering"],
  institution: ["social institution"],
  governance: ["governmentality"],
  collective_memory: ["social memory"],
  tradeoff: ["trade-off"],
  wellbeing: ["well-being"],
  context_of_communication: ["communicative context"]
};

function buildNodes() {
  const groupById = new Map();
  for (const group of groups) {
    for (const id of group.ids) {
      if (groupById.has(id)) {
        throw new Error(`Duplicate foundation id in seed list: ${id}`);
      }
      groupById.set(id, group);
    }
  }

  const nodes = [];

  for (const group of groups) {
    for (let index = 0; index < group.ids.length; index += 1) {
      const id = group.ids[index];
      const title = titleFromId(id);
      const neighbors = [
        group.ids[(index + group.ids.length - 1) % group.ids.length],
        group.ids[(index + 1) % group.ids.length]
      ].filter((relatedId) => relatedId !== id);

      const prerequisites = group.prerequisites.filter((prerequisiteId) => prerequisiteId !== id);

      nodes.push({
        id,
        title,
        type: "foundation",
        domains: ["foundations"],
        subdomains: [group.id],
        summary: group.summary(title),
        prerequisites,
        unlocks: [],
        related: unique([...neighbors, ...group.prerequisites]).filter((relatedId) => relatedId !== id),
        aliases: aliases[id] || [],
        tags: unique(["foundation", group.id, ...group.prerequisites]).filter((tag) => tag !== id),
        sources,
        status: "stub"
      });
    }
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const prerequisiteId of node.prerequisites) {
      nodesById.get(prerequisiteId).unlocks.push(node.id);
    }
  }

  for (const node of nodes) {
    node.unlocks = unique(node.unlocks).sort();
    node.related = unique(node.related).sort();
    node.tags = unique(node.tags).sort();
  }

  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const nodes = buildNodes();
  if (nodes.length !== 250) {
    throw new Error(`Expected 250 foundation nodes, got ${nodes.length}`);
  }

  const foundationDir = path.join(atlasRoot, "foundations");
  for (const node of nodes) {
    writeJson(path.join(foundationDir, `${node.id}.json`), node);
  }

  console.log(`Seeded ${nodes.length} foundation nodes in atlas/foundations`);
}

main();
