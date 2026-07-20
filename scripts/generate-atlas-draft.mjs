import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { validateAtlasMapSpec } from "../lib/atlasMaps.ts";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const territoryTitle = getOption("territory-name", "territory-title");
const branchTitle = getOption("branch-name", "branch-title");
const mapTitle = getOption("map-title", "title");
const topicPrompt = getOption("topic-prompt", "prompt");

if (!territoryTitle || !branchTitle || !mapTitle || !topicPrompt) {
  console.error("Missing required Atlas draft inputs.");
  printUsage();
  process.exit(1);
}

const territorySlug = getOption("territory-slug") || toSlug(territoryTitle);
const branchSlug = getOption("branch-slug") || toSlug(branchTitle);
const mapSlug = getOption("map-slug", "slug") || toSlug(mapTitle);
const mapSummary = getOption("map-summary", "summary") || topicPrompt;
const outputPath = resolveOutputPath(getOption("output", "out") || `${mapSlug}-atlas-map-spec.json`);

const groups = buildGroupsForTopic({ mapTitle, mapSlug, topicPrompt });
const spec = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  territories: [
    {
      id: territorySlug,
      slug: territorySlug,
      title: territoryTitle,
      summary: `${territoryTitle} maps for major fields, traditions, people, texts, and conceptual families.`,
      branches: [
        {
          id: branchSlug,
          slug: branchSlug,
          title: branchTitle,
          summary: `${branchTitle} maps for lineages, schools, methods, texts, and recurring problems.`,
          maps: [
            {
              id: mapSlug,
              slug: mapSlug,
              title: mapTitle,
              subtitle: `A review draft for ${mapTitle}.`,
              question: questionFor(mapTitle, topicPrompt),
              summary: mapSummary,
              status: "queued",
              buildMode: "pipeline-ready",
              groups,
              relations: buildRelations(groups),
            },
          ],
        },
      ],
    },
  ],
};

const issues = validateAtlasMapSpec(spec);
if (issues.length) {
  console.error("Generated AtlasMapSpec is invalid:");
  issues.forEach(issue => console.error(`- ${issue.path}: ${issue.message}`));
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

console.log("Generated AtlasMapSpec draft.");
console.log(`- file: ${outputPath}`);
console.log(`- map: ${mapTitle} (${mapSlug})`);
console.log(`- groups: ${groups.length}`);
console.log(`- relations: ${spec.territories[0].branches[0].maps[0].relations.length}`);
console.log("Validation passed.");
console.log("Not imported. Not published.");

function buildGroupsForTopic(input) {
  if (isMetaphysicsTopic(input)) return metaphysicsFamiliesGroups();
  return genericStarterGroups(input);
}

function isMetaphysicsTopic({ mapTitle, mapSlug, topicPrompt }) {
  return [mapTitle, mapSlug, topicPrompt].join(" ").toLowerCase().includes("metaphysic");
}

function metaphysicsFamiliesGroups() {
  return [
    group({
      id: "physicalism-and-materialism",
      title: "Physicalism and materialism",
      shortTitle: "Physicalism",
      family: "Naturalist metaphysics",
      stance: "Reality is ultimately physical, and minds, values, causes, and social facts must fit inside the natural order.",
      centralClaim: "Everything real is either physical or depends on physical reality in a disciplined way.",
      whyItMatters: "This is the default pressure behind much current science, philosophy of mind, and secular metaphysics.",
      contributors: [
        contributor("Thomas Hobbes", "early modern materialist", "Treats thought, sensation, and politics through bodies in motion rather than immaterial substances.", [["Leviathan", "book"]]),
        contributor("J. J. C. Smart", "identity theorist", "Gives a clean modern argument that sensations can be identical with brain processes.", [["Sensations and Brain Processes", "essay"]]),
        contributor("David Armstrong", "analytic materialist", "Builds a systematic materialist account of mind, properties, and laws.", [["A Materialist Theory of the Mind", "book"], ["A World of States of Affairs", "book"]]),
      ],
      objections: [
        "Conscious experience can look underexplained if physical description leaves out what it is like.",
        "Norms, meanings, numbers, and possibilities may not reduce neatly to physical facts.",
      ],
      relatedGroupIds: ["dualism", "idealism", "neutral-monism-and-panpsychism"],
      keywords: ["matter", "science", "reduction", "mind"],
    }),
    group({
      id: "idealism",
      title: "Idealism",
      shortTitle: "Idealism",
      family: "Mind-first metaphysics",
      stance: "Mind, experience, concepts, or spirit are not late accidents inside reality; they are basic to how reality is intelligible.",
      centralClaim: "Reality is dependent on, structured by, or inseparable from mind-like activity.",
      whyItMatters: "Idealism keeps forcing the question of whether a world without experience is even thinkable as a world.",
      contributors: [
        contributor("George Berkeley", "subjective idealist", "Argues that ordinary objects are collections of ideas sustained by perception.", [["A Treatise Concerning the Principles of Human Knowledge", "book"], ["Three Dialogues between Hylas and Philonous", "dialogue"]]),
        contributor("Immanuel Kant", "transcendental idealist", "Moves the debate toward the conditions that make experience and objecthood possible.", [["Critique of Pure Reason", "book"]]),
        contributor("G. W. F. Hegel", "absolute idealist", "Treats reality as historically and logically articulated through self-developing reason.", [["Phenomenology of Spirit", "book"], ["Science of Logic", "book"]]),
      ],
      objections: [
        "It can seem to dissolve independent reality into the conditions of knowing.",
        "It risks becoming too large and elastic to test against ordinary experience.",
      ],
      relatedGroupIds: ["physicalism-and-materialism", "dualism", "pragmatism-and-metaphysical-critique"],
      keywords: ["mind", "experience", "reason", "appearance"],
    }),
    group({
      id: "dualism",
      title: "Dualism",
      shortTitle: "Dualism",
      family: "Two-principle metaphysics",
      stance: "Reality contains a deep distinction between mind and matter, form and body, or soul and world.",
      centralClaim: "Mental reality cannot be fully captured by physical substance alone.",
      whyItMatters: "Dualism makes the mind-body problem explicit instead of hiding it inside a single substance vocabulary.",
      contributors: [
        contributor("Plato", "classical dualist source", "Separates changing sensible things from more stable intelligible forms and soul.", [["Phaedo", "dialogue"], ["Republic", "dialogue"]]),
        contributor("Rene Descartes", "substance dualist", "Frames the modern mind-body problem with thinking substance and extended substance.", [["Meditations on First Philosophy", "book"]]),
        contributor("Elisabeth of Bohemia", "interaction critic", "Presses Descartes on how an immaterial mind could move a material body.", [["Correspondence with Descartes", "other"]]),
      ],
      objections: [
        "Explaining interaction between unlike substances is notoriously difficult.",
        "Modern neuroscience pressures any account that treats mind as cleanly separable from body.",
      ],
      relatedGroupIds: ["physicalism-and-materialism", "neutral-monism-and-panpsychism", "substance-and-hylomorphism"],
      keywords: ["mind", "body", "soul", "interaction"],
    }),
    group({
      id: "substance-and-hylomorphism",
      title: "Substance metaphysics and hylomorphism",
      shortTitle: "Substance",
      family: "Form-and-substance metaphysics",
      stance: "Things are structured substances: matter is organized by form, powers, purposes, categories, and persistence conditions.",
      centralClaim: "To understand reality, ask what kinds of things exist, what makes them one thing, and what lets them persist through change.",
      whyItMatters: "This tradition supplies the grammar behind categories, essences, organisms, artifacts, and personhood.",
      contributors: [
        contributor("Aristotle", "hylomorphic founder", "Explains beings through substance, form, matter, potentiality, and actuality.", [["Metaphysics", "book"], ["Physics", "book"]]),
        contributor("Thomas Aquinas", "scholastic synthesizer", "Connects Aristotelian substance and form with theology, causation, and being.", [["Summa Theologiae", "book"], ["On Being and Essence", "essay"]]),
        contributor("E. J. Lowe", "neo-Aristotelian metaphysician", "Revives categories, substances, and dependence in contemporary analytic metaphysics.", [["The Four-Category Ontology", "book"]]),
      ],
      objections: [
        "Essences can look too rigid for evolution, history, and social construction.",
        "The language of form and substance can seem outdated next to field, process, and system models.",
      ],
      relatedGroupIds: ["process-metaphysics", "dualism", "physicalism-and-materialism"],
      keywords: ["substance", "form", "essence", "category"],
    }),
    group({
      id: "process-metaphysics",
      title: "Process metaphysics",
      shortTitle: "Process",
      family: "Becoming-first metaphysics",
      stance: "Reality is better understood as activity, event, relation, change, and becoming than as static things with fixed essences.",
      centralClaim: "Processes are primary, and stable objects are patterns inside ongoing activity.",
      whyItMatters: "Process thought fits naturally with evolution, ecology, systems theory, and time-centered accounts of reality.",
      contributors: [
        contributor("Heraclitus", "ancient process source", "Makes change, tension, and logos central to understanding reality.", [["Fragments", "other"]]),
        contributor("Alfred North Whitehead", "process philosopher", "Rebuilds metaphysics around events, occasions, relations, and creativity.", [["Process and Reality", "book"]]),
        contributor("Henri Bergson", "philosopher of duration", "Treats lived time and creative evolution as basic rather than derivative.", [["Creative Evolution", "book"], ["Time and Free Will", "book"]]),
      ],
      objections: [
        "If everything is process, it can be hard to explain identity and stable reference.",
        "Technical process systems can become obscure without clear examples.",
      ],
      relatedGroupIds: ["substance-and-hylomorphism", "neutral-monism-and-panpsychism", "pragmatism-and-metaphysical-critique"],
      keywords: ["process", "becoming", "event", "time"],
    }),
    group({
      id: "neutral-monism-and-panpsychism",
      title: "Neutral monism and panpsychism",
      shortTitle: "Neutral monism",
      family: "Mind-matter bridge metaphysics",
      stance: "The mental and physical may be two aspects, organizations, or expressions of something more basic.",
      centralClaim: "Mind and matter do not have to be rival substances if both arise from a deeper neutral or experiential ground.",
      whyItMatters: "This family is a recurring escape route from both reductionist physicalism and interactionist dualism.",
      contributors: [
        contributor("Baruch Spinoza", "dual-aspect monist", "Treats mind and body as attributes of one underlying substance.", [["Ethics", "book"]]),
        contributor("Bertrand Russell", "neutral monist", "Opens a route where physics describes structure while intrinsic nature may be experience-like.", [["The Analysis of Matter", "book"]]),
        contributor("William James", "radical empiricist", "Treats pure experience as more basic than the later split between subject and object.", [["Essays in Radical Empiricism", "essay"]]),
        contributor("Galen Strawson", "realistic panpsychist", "Argues that experience is a real feature of the physical rather than an alien addition.", [["Realistic Monism", "essay"]]),
      ],
      objections: [
        "The combination problem asks how tiny experiential units compose unified minds.",
        "Neutral stuff can become mysterious if it is neither clearly mental nor clearly physical.",
      ],
      relatedGroupIds: ["physicalism-and-materialism", "dualism", "process-metaphysics"],
      keywords: ["monism", "experience", "mind", "matter"],
    }),
    group({
      id: "pragmatism-and-metaphysical-critique",
      title: "Pragmatism and metaphysical critique",
      shortTitle: "Pragmatism",
      family: "Use-and-critique metaphysics",
      stance: "Metaphysical claims should be judged by the work they do in inquiry, life, language, and practice.",
      centralClaim: "Some metaphysical debates are clarified, redirected, or dissolved when we ask what difference they make.",
      whyItMatters: "This family keeps Atlas maps honest by asking when a grand theory actually improves understanding.",
      contributors: [
        contributor("Charles Sanders Peirce", "pragmatic realist", "Links meaning to conceivable practical effects while keeping truth tied to inquiry.", [["How to Make Our Ideas Clear", "essay"]]),
        contributor("William James", "pragmatist", "Turns metaphysical disagreement toward lived consequences and temperaments.", [["Pragmatism", "book"]]),
        contributor("John Dewey", "naturalist pragmatist", "Treats experience, nature, and inquiry as continuous rather than split into metaphysical compartments.", [["Experience and Nature", "book"]]),
        contributor("Rudolf Carnap", "logical empiricist critic", "Challenges metaphysics when its sentences lack clear empirical or logical role.", [["The Elimination of Metaphysics Through Logical Analysis of Language", "essay"]]),
      ],
      objections: [
        "Critique can become too deflationary and miss real ontological disagreement.",
        "Practical consequences may not decide what reality is like.",
      ],
      relatedGroupIds: ["idealism", "process-metaphysics", "physicalism-and-materialism"],
      keywords: ["practice", "meaning", "inquiry", "critique"],
    }),
  ];
}

function genericStarterGroups({ mapTitle, topicPrompt }) {
  const label = mapTitle.toLowerCase();
  const promptSeed = topicPrompt.trim().replace(/\s+/g, " ");
  const base = [
    ["foundational-frame", "Foundational frame", "The starting vocabulary, basic assumptions, and oldest organizing questions in the topic."],
    ["system-builders", "System builders", "The people and schools that turn the topic into a reusable architecture."],
    ["empirical-or-practical-turn", "Empirical or practical turn", "The branch that tests the topic against observation, practice, use, or institutions."],
    ["critical-revision", "Critical revision", "The family that challenges inherited assumptions and rebuilds the topic under pressure."],
    ["synthetic-bridges", "Synthetic bridges", "The bridge positions that connect rival camps without fully collapsing them."],
    ["contemporary-frontier", "Contemporary frontier", "The current open problems, hybrids, and debates still moving."],
  ];

  return base.map(([id, title, stance], index) => group({
    id,
    title,
    shortTitle: title,
    family: `${mapTitle} starter family`,
    stance,
    centralClaim: `${title} asks what has to be true for ${label} to make sense as a field of study.`,
    whyItMatters: `This placeholder family keeps the generated ${label} draft reviewable until a model or human replaces it with researched content.`,
    contributors: [
      contributor(`${title} source cluster`, "research placeholder", `Collect primary and secondary sources that define ${title.toLowerCase()} for this topic. Prompt seed: ${promptSeed}`, [[`${title} primary texts to identify`, "other"]]),
      contributor(`${title} review cluster`, "research placeholder", `Add people who clarify objections, methods, and influence paths for ${title.toLowerCase()}.`, [[`${title} secondary map notes`, "other"]]),
    ],
    objections: [
      "This generated starter group needs human or model review before publication.",
      "The group boundary may be too broad and should be split if the evidence demands it.",
    ],
    relatedGroupIds: relatedIds(base, index),
    keywords: [toSlug(mapTitle), id, "draft", "review"],
  }));
}

function buildRelations(groups) {
  const relationPairs = [
    [0, 1, "opposes", "These families often begin from opposite intuitions, so their contrast is useful for review."],
    [0, 2, "answers", "The second position answers a pressure point exposed by the first."],
    [2, 5, "reframes", "The later bridge reframes the earlier conflict instead of simply choosing a side."],
    [3, 4, "reframes", "The process or revisionary view shifts attention from stable categories to change and use."],
    [4, 6, "neighbors", "Both positions treat practice, time, or inquiry as central to metaphysical judgment."],
    [5, 1, "borrows", "The bridge position borrows from the mind-first family while resisting a full idealist collapse."],
  ];

  return relationPairs
    .filter(([sourceIndex, targetIndex]) => groups[sourceIndex] && groups[targetIndex])
    .map(([sourceIndex, targetIndex, kind, note]) => {
      const source = groups[sourceIndex].id;
      const target = groups[targetIndex].id;
      return {
        id: `${source}-to-${target}`,
        source,
        target,
        kind,
        note,
      };
    });
}

function relatedIds(groups, index) {
  return [
    groups[(index + groups.length - 1) % groups.length]?.[0],
    groups[(index + 1) % groups.length]?.[0],
  ].filter(Boolean);
}

function group(input) {
  return {
    id: input.id,
    slug: input.id,
    title: input.title,
    shortTitle: input.shortTitle,
    family: input.family,
    stance: input.stance,
    centralClaim: input.centralClaim,
    whyItMatters: input.whyItMatters,
    contributors: input.contributors,
    objections: input.objections,
    relatedGroupIds: input.relatedGroupIds,
    keywords: input.keywords,
  };
}

function contributor(name, role, reason, texts) {
  return {
    id: toSlug(name),
    name,
    role,
    reason,
    texts: texts.map(([title, kind]) => ({
      id: toSlug(title),
      title,
      kind,
    })),
  };
}

function questionFor(mapTitle, topicPrompt) {
  const cleanedPrompt = topicPrompt.trim().replace(/\s+/g, " ");
  if (cleanedPrompt.endsWith("?")) return cleanedPrompt;
  return `What are the major families inside ${mapTitle.toLowerCase()}, and what problem does each one solve?`;
}

function resolveOutputPath(value) {
  const normalized = value.replace(/\\/g, "/");
  const hasDirectory = normalized.includes("/");
  const path = hasDirectory ? value : join("atlas", "drafts", value);
  return isAbsolute(path) ? path : join(root, path);
}

function getOption(...names) {
  for (const name of names) {
    const value = options[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("--")) continue;

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];
    if (inlineValue !== undefined) {
      parsed[rawName] = inlineValue;
    } else if (nextValue && !nextValue.startsWith("--")) {
      parsed[rawName] = nextValue;
      index += 1;
    } else {
      parsed[rawName] = "true";
    }
  }
  return parsed;
}

function toSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function printUsage() {
  console.log(`
Usage:
  npm run atlas:generate-draft -- \\
    --territory-name "Humanities" \\
    --territory-slug humanities \\
    --branch-name "Philosophy" \\
    --branch-slug philosophy \\
    --map-title "Metaphysics families" \\
    --map-slug metaphysics-families-generated-v0 \\
    --map-summary "A draft map of major metaphysical families." \\
    --topic-prompt "Map major metaphysical families, contributors, key texts, objections, and relations."

Optional:
  --output atlas/drafts/custom-file.json
`);
}
