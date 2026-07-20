import "server-only";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import type { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { AtlasMapRecipe, AtlasPlannedMapItem } from "@/lib/atlasAdmin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type AtlasCorpusCoverageLevel = "not_applicable" | "weak" | "partial" | "usable" | "strong";
export type AtlasCorpusConfidence = "insufficient" | "weak" | "usable" | "strong";

export type AtlasCorpusSearchLane = {
  id: string;
  title: string;
  query: string;
  terms: string[];
  required: boolean;
  reason: string;
};

export type AtlasCorpusSearchPlan = {
  originalQuery: string;
  originalTerms: string[];
  expandedTerms: string[];
  humanKeywords: string[];
  includedLaneIds: string[];
  excludedLaneIds: string[];
  lanes: AtlasCorpusSearchLane[];
};

export type AtlasCorpusRetrievalDiagnostics = {
  originalTerms: string[];
  expandedTerms: string[];
  matchedSourceTitles: string[];
  matchedChunkCount: number;
  selectedSourceTitles: string[];
  selectedChunkCount: number;
  duplicateWarnings: string[];
  overrepresentationWarnings: string[];
  laneChunkCounts: Record<string, number>;
  sourceChunkCounts: Record<string, number>;
};

export type AtlasCorpusCandidateChunk = {
  sourceChunkId: string;
  sourceId: string;
  chunkIndex: number;
  heading: string;
  text: string;
  snippet: string;
  wordCount: number;
  score: number;
  matchedTerms: string[];
  laneIds: string[];
  coverageTags: string[];
  nearDuplicateKey: string;
};

export type AtlasCorpusCandidateSource = {
  sourceId: string;
  title: string;
  sourcePath: string;
  sourceType: string;
  reliabilityTier: string;
  license: string;
  status: string;
  origin: string;
  relevanceScore: number;
  relevanceReason: string;
  existingMetadata: string;
  laneIds: string[];
  coverageTags: string[];
  laneChunkCounts: Record<string, number>;
  duplicateGroupKey: string;
  matchingChunks: AtlasCorpusCandidateChunk[];
};

export type AtlasSourceLaneCoverage = {
  laneId: string;
  title: string;
  required: boolean;
  sourceCount: number;
  chunkCount: number;
  covered: boolean;
};

export type AtlasSourceSufficiency = {
  sourceCount: number;
  chunkCount: number;
  sourceDiversity: number;
  sourceTypes: string[];
  reliabilityTiers: string[];
  categoryCoverage: number;
  chronologyCoverage: AtlasCorpusCoverageLevel;
  contributorTextCoverage: AtlasCorpusCoverageLevel;
  contributorPersonCoverage: AtlasCorpusCoverageLevel;
  conceptTheoryCoverage: AtlasCorpusCoverageLevel;
  relationEvidenceCoverage: AtlasCorpusCoverageLevel;
  laneCoverage: AtlasSourceLaneCoverage[];
  confidence: AtlasCorpusConfidence;
  obviousGaps: string[];
  warnings: string[];
  missingLaneWarnings: string[];
  overrepresentationWarnings: string[];
};

export type AtlasCorpusCandidateSet = {
  plannedMapId: string;
  query: string;
  searchPlan: AtlasCorpusSearchPlan;
  diagnostics: AtlasCorpusRetrievalDiagnostics;
  candidates: AtlasCorpusCandidateSource[];
  sufficiency: AtlasSourceSufficiency;
  error?: string;
};

export type AtlasCorpusBridgeState = {
  available: boolean;
  dbPath: string;
  sourceName: string;
  sourceCount: number;
  chunkCount: number;
  ftsEnabled: boolean;
  candidatesByPlannedMapId: Record<string, AtlasCorpusCandidateSet>;
  error?: string;
};

export type AtlasCorpusBridgeOptions = {
  focusPlannedMapId?: string;
  humanKeywords?: string[];
  includeLaneIds?: string[];
  excludeLaneIds?: string[];
};

type RawCorpusCandidate = {
  plannedMapId: string;
  query: string;
  candidates: AtlasCorpusCandidateSource[];
  diagnostics: AtlasCorpusRetrievalDiagnostics;
};

type RawCorpusChunk = AtlasCorpusCandidateChunk & {
  title: string;
  sourcePath: string;
  sourceType: string;
  reliabilityTier: string;
  license: string;
  status: string;
};

const DEFAULT_PIPELINE_KB_PATH = "C:\\Users\\james\\Documents\\The Pipeline\\sources\\jju_sources.sqlite";
const DEFAULT_TOTAL_CHUNK_BUDGET = 32;
const DEFAULT_MAX_CHUNKS_PER_SOURCE = 4;
const DEFAULT_MAX_SOURCES_PER_LANE = 2;

const MAP_SPECIFIC_SEARCH_LANES: Record<string, Array<Omit<AtlasCorpusSearchLane, "required"> & { required?: boolean }>> = {
  "systems-design": [
    lane("systems-engineering", "Systems Engineering", "systems engineering requirements verification validation architecture lifecycle systems analysis", ["systems engineering", "requirements", "verification", "validation", "architecture"], "Core systems-engineering material should anchor the map."),
    lane("control-feedback", "Control And Feedback", "control systems feedback loops regulation cybernetics controller stability", ["control systems", "feedback", "cybernetics", "stability", "regulation"], "Systems design needs feedback/control as a separate conceptual lane."),
    lane("failure-resilience", "Failure Analysis And Resilience", "failure mode effects analysis resilience reliability fault tolerance risk mitigation", ["failure modes", "resilience", "reliability", "fault tolerance", "risk"], "The v1 source packet needed stronger failure/resilience evidence."),
    lane("software-architecture", "Software Architecture And Patterns", "software architecture design patterns modularity interfaces coupling cohesion distributed systems", ["software architecture", "design patterns", "modularity", "interfaces", "coupling"], "Architecture/pattern language prevents the packet from becoming only engineering-process material."),
    lane("socio-technical", "Socio-Technical Systems", "socio technical systems human organization workflow stakeholders information systems enterprise systems", ["socio technical", "stakeholders", "workflow", "enterprise systems", "information systems"], "Systems are also human/organizational, not only technical artifacts."),
    lane("tradeoffs-constraints", "Tradeoffs And Constraints", "tradeoffs constraints cost complexity performance maintainability scalability safety usability", ["tradeoffs", "constraints", "complexity", "scalability", "maintainability"], "System-comparison maps need explicit tradeoff evidence."),
    lane("design-process", "Design Process And Requirements", "engineering design process requirements problem definition prototyping iteration design review", ["design process", "requirements", "prototyping", "iteration", "problem definition"], "Keep design-process evidence, but cap it so it cannot dominate."),
    lane("complex-systems", "Complex Systems", "complex systems emergence adaptive systems network effects load sharing nonlinear behavior", ["complex systems", "emergence", "adaptive systems", "network effects", "nonlinear"], "Complex-system behavior gives the map a broader conceptual layer."),
  ],
  "mathematical-styles": [
    lane("proof-abstraction", "Proof And Abstraction", "mathematical proof abstraction rigor axioms theorem formalism", ["proof", "abstraction", "rigor", "axiom", "theorem"], "Mathematical styles need evidence about proof culture and abstraction."),
    lane("algebra-structures", "Algebra And Structures", "algebra structure group ring field category abstract algebra", ["algebra", "structure", "group", "ring", "field", "category"], "Structural mathematics should not disappear into generic proof talk."),
    lane("geometry-topology", "Geometry And Topology", "geometry topology space manifold shape continuity dimension", ["geometry", "topology", "space", "manifold", "dimension"], "Spatial and topological styles are a major mathematical orientation."),
    lane("analysis-calculus", "Analysis And Continuity", "analysis calculus limit continuity differential equation function", ["analysis", "calculus", "limit", "continuity", "differential"], "Analysis gives the map a continuous/change-oriented lane."),
    lane("computation-discrete", "Computation And Discrete Methods", "computation algorithm discrete combinatorics graph finite proof", ["computation", "algorithm", "discrete", "combinatorics", "graph"], "Computational and discrete methods need separate coverage."),
    lane("applied-modeling", "Applied Modeling", "applied mathematics model probability statistics optimization numerical", ["applied mathematics", "model", "probability", "statistics", "optimization"], "Discipline landscapes need practical modeling and applied methods."),
  ],
  "literary-movements": [
    lane("classical-medieval", "Classical And Medieval Traditions", "classical medieval epic drama lyric romance oral tradition", ["classical", "medieval", "epic", "drama", "lyric"], "Literary movement maps need older inheritance, not only modern schools."),
    lane("renaissance-enlightenment", "Renaissance And Enlightenment", "renaissance enlightenment humanism neoclassicism satire reason", ["renaissance", "enlightenment", "humanism", "neoclassicism", "satire"], "Early modern and Enlightenment context anchors later reactions."),
    lane("romanticism-realism", "Romanticism And Realism", "romanticism realism naturalism emotion individual society novel", ["romanticism", "realism", "naturalism", "novel", "society"], "Major nineteenth-century reactions should be distinguished."),
    lane("modernism-avant-garde", "Modernism And Avant-Garde", "modernism avant garde stream consciousness fragmentation experiment symbolist", ["modernism", "avant-garde", "fragmentation", "experiment", "symbolism"], "Modernist rupture and experimentation need their own evidence."),
    lane("postmodern-contemporary", "Postmodern And Contemporary", "postmodern contemporary metafiction postcolonial digital global literature", ["postmodern", "contemporary", "metafiction", "postcolonial", "global"], "The map needs contemporary and non-single-canon coverage."),
    lane("authors-texts", "Authors And Texts", "author poet novelist playwright canonical text manifesto journal", ["author", "poet", "novelist", "playwright", "text"], "Contributor and key-text placement needs direct evidence."),
  ],
  "visual-art-movements": [
    lane("renaissance-academic", "Renaissance And Academic Traditions", "renaissance academic art perspective humanism realism salon", ["renaissance", "academic", "perspective", "humanism", "realism"], "Visual art needs pre-modern and academic reference points."),
    lane("impressionism-postimpressionism", "Impressionism And Post-Impressionism", "impressionism post-impressionism light color brushwork plein air", ["impressionism", "post-impressionism", "light", "color", "brushwork"], "Late nineteenth-century style shifts anchor modern art."),
    lane("modernism-avant-garde", "Modernism And Avant-Garde", "modernism cubism futurism dada surrealism abstraction expressionism", ["modernism", "cubism", "futurism", "dada", "surrealism", "abstraction"], "Modern movements and reactions need balanced coverage."),
    lane("postwar-contemporary", "Postwar And Contemporary", "abstract expressionism pop art minimalism conceptual art contemporary", ["abstract expressionism", "pop art", "minimalism", "conceptual", "contemporary"], "Postwar and contemporary movements should not collapse into one bucket."),
    lane("global-institutions", "Global And Institutional Context", "global art museum gallery institution colonial postcolonial market", ["global art", "museum", "gallery", "institution", "postcolonial"], "Avoid a single linear Western-only movement story."),
    lane("artists-manifestos", "Artists And Manifestos", "artist manifesto exhibition critic curator school movement", ["artist", "manifesto", "exhibition", "critic", "curator"], "Contributor and text anchors need direct source support."),
  ],
  "political-orders": [
    lane("authority-legitimacy", "Authority And Legitimacy", "political authority legitimacy sovereignty consent tradition charisma", ["authority", "legitimacy", "sovereignty", "consent", "tradition"], "Political systems need their legitimacy logic made explicit."),
    lane("democracy-republic", "Democratic And Republican Orders", "democracy republic representation constitutional liberal electoral participation", ["democracy", "republic", "representation", "constitutional", "electoral"], "Democratic and republican systems need separate grounding."),
    lane("authoritarian-totalitarian", "Authoritarian And Totalitarian Orders", "authoritarian totalitarian dictatorship party state coercion surveillance", ["authoritarian", "totalitarian", "dictatorship", "party state", "coercion"], "Coercive and centralized order types must not be flattened."),
    lane("monarchy-oligarchy", "Monarchy And Oligarchy", "monarchy aristocracy oligarchy elite rule dynasty patrimonial", ["monarchy", "aristocracy", "oligarchy", "elite", "dynasty"], "Older and elite-rule forms matter for comparison."),
    lane("anarchism-federalism", "Anarchism And Distributed Order", "anarchism federalism decentralization confederation self governance mutual aid", ["anarchism", "federalism", "decentralization", "confederation", "self governance"], "Distributed and anti-state orders need their own lane."),
    lane("failure-tradeoffs", "Failure Modes And Tradeoffs", "political failure stability liberty equality accountability corruption violence", ["failure", "stability", "liberty", "equality", "accountability", "corruption"], "System-comparison maps need concrete tradeoff evidence."),
  ],
  "consciousness-theories-v2-corpus-test": [
    lane("materialist-neurobiological", "Materialist And Neurobiological", "consciousness materialism physicalism neurobiological neural correlate brain", ["materialism", "physicalism", "neurobiological", "neural correlate", "brain"], "Consciousness theory-family maps need physicalist anchors."),
    lane("functional-computational", "Functional And Computational", "functionalism computational consciousness global workspace information processing representation", ["functionalism", "computational", "global workspace", "information processing", "representation"], "Computational and functional theories form a major family."),
    lane("higher-order-representational", "Higher-Order And Representational", "higher order theory representational consciousness perception awareness access", ["higher-order", "representational", "perception", "awareness", "access"], "Representational and higher-order families need separate evidence."),
    lane("phenomenology-enactive", "Phenomenology And Enactive", "phenomenology embodied enactive experience intentionality first person", ["phenomenology", "embodied", "enactive", "experience", "intentionality"], "First-person and embodied approaches should not be lost."),
    lane("panpsychism-monism", "Panpsychism And Monism", "panpsychism monism neutral monism fundamental consciousness mind matter", ["panpsychism", "monism", "neutral monism", "fundamental consciousness"], "Non-reductive and fundamental-consciousness theories need a lane."),
    lane("dualism-idealism", "Dualism And Idealism", "dualism idealism mind body problem consciousness fundamental reality", ["dualism", "idealism", "mind body", "fundamental reality"], "Nonphysical families need explicit coverage."),
    lane("empirical-objections", "Empirical Tests And Objections", "consciousness objection critique empirical test hard problem explanatory gap", ["objection", "critique", "empirical", "hard problem", "explanatory gap"], "Theory-family review needs pressure points and testability evidence."),
  ],
};

const RECIPE_SEARCH_LANES: Record<string, Array<Omit<AtlasCorpusSearchLane, "required"> & { required?: boolean }>> = {
  system_comparison: [
    lane("operating-logic", "Operating Logic", "operating model architecture governance constraints system logic mechanisms", ["operating model", "architecture", "governance", "mechanisms"], "Compare systems by how they operate."),
    lane("tradeoffs", "Tradeoffs", "tradeoffs constraints costs risks benefits failure modes advantages disadvantages", ["tradeoffs", "constraints", "costs", "risks", "benefits"], "System-comparison recipes need tradeoff evidence."),
    lane("failure-modes", "Failure Modes", "failure modes fragility resilience robustness reliability fault tolerance", ["failure modes", "resilience", "robustness", "reliability"], "Failure behavior separates systems in practice."),
  ],
  theory_family: [
    lane("families", "Theory Families", "school theory family position central claim assumptions", ["school", "theory", "family", "position", "claim"], "Theory-family maps need distinct families."),
    lane("objections", "Objections", "objection critique pressure point counterargument debate", ["objection", "critique", "pressure", "debate"], "Pressure points are part of the Atlas contract."),
    lane("contributors", "Contributors", "contributor founder proponent critic author text", ["contributor", "founder", "proponent", "critic", "author"], "Contributor placement needs source evidence."),
  ],
  intellectual_lineage: [
    lane("chronology", "Chronology", "chronology history lineage precursor successor development revolution tradition", ["chronology", "lineage", "precursor", "successor", "tradition"], "Lineages need time/order evidence."),
    lane("influence", "Influence", "influence inherited developed responded transformed school tradition", ["influence", "inherited", "responded", "transformed"], "Lineage relations should show influence."),
  ],
  historical_movement: [
    lane("movement-context", "Movement Context", "movement scene period context reaction school style", ["movement", "scene", "period", "reaction", "style"], "Historical maps need context and movement boundaries."),
    lane("chronology", "Chronology", "chronology early late period before after emergence development", ["chronology", "period", "emergence", "development"], "Chronology prevents flat category lists."),
  ],
};

const PYTHON_BRIDGE = String.raw`
import json
import re
import sqlite3
import sys
from collections import defaultdict
from urllib.parse import urlparse

payload = json.load(sys.stdin)
db_path = payload.get("dbPath")
mode = payload.get("mode")

STOP = {
    "the", "and", "for", "that", "this", "with", "from", "into", "were", "was",
    "are", "what", "does", "how", "map", "maps", "major", "families", "inside",
    "branch", "territory", "recipe", "queued", "source", "sources", "claims",
    "comparison", "atlas", "draft", "review", "status"
}

COVERAGE_PATTERNS = {
    "systems_engineering": ["systems engineering", "system requirements", "verification", "validation", "systems analysis"],
    "control_feedback": ["control system", "feedback", "controller", "cybernetic", "stability"],
    "failure_resilience": ["failure mode", "resilience", "reliability", "fault", "risk", "mitigation", "robust"],
    "software_architecture": ["software architecture", "design pattern", "modular", "interface", "coupling", "distributed"],
    "socio_technical": ["socio-technical", "socio technical", "stakeholder", "workflow", "enterprise", "organization"],
    "tradeoffs_constraints": ["tradeoff", "trade-off", "constraint", "cost", "complexity", "performance", "maintainability", "scalability"],
    "design_process": ["design process", "requirement", "prototype", "iteration", "problem definition", "design review"],
    "complex_systems": ["complex system", "emergence", "adaptive", "nonlinear", "network effect", "load sharing"],
    "people_contributors": ["author", "founder", "researcher", "engineer", "proponent", "critic"],
    "texts_citations": ["book", "paper", "article", "published", "doi", "arxiv", "journal"],
    "relations_evidence": ["influence", "contrast", "depends", "tradeoff", "because", "therefore", "compared"],
}

def plain_terms(text):
    return [term.lower() for term in re.findall(r"\b[a-zA-Z0-9][a-zA-Z0-9_-]{2,}\b", text or "") if term.lower() not in STOP]

def fts_query(query):
    terms = list(dict.fromkeys(plain_terms(query)))
    return " OR ".join(f'"{term}"' for term in terms[:18])

def normalize_key(text, limit=140):
    text = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
    return " ".join(text.split())[:limit]

def snippet(text, terms, width=420):
    if len(text) <= width:
        return text
    lower = text.lower()
    hits = [lower.find(term) for term in terms if len(term) >= 3 and lower.find(term) >= 0]
    if not hits:
        return text[:width].strip() + "..."
    start = max(0, min(hits) - 140)
    end = min(len(text), start + width)
    if end - start < width:
        start = max(0, end - width)
    out = text[start:end].strip()
    if start:
        out = "..." + out
    if end < len(text):
        out += "..."
    return out

def origin(path):
    parsed = urlparse(path or "")
    if parsed.netloc:
        return parsed.netloc
    return path or "Pipeline KB"

def has_fts(conn):
    row = conn.execute("select name from sqlite_master where type='table' and name='source_chunks_fts'").fetchone()
    return row is not None

def stats(conn):
    return {
        "sourceCount": conn.execute("select count(*) from sources").fetchone()[0],
        "chunkCount": conn.execute("select count(*) from source_chunks").fetchone()[0],
        "ftsEnabled": has_fts(conn),
    }

def coverage_tags(text):
    lower = (text or "").lower()
    tags = []
    for tag, patterns in COVERAGE_PATTERNS.items():
        if any(pattern in lower for pattern in patterns):
            tags.append(tag)
    return tags

def row_to_chunk(row, terms, lane_id):
    text = row["text"] or ""
    title = row["title"] or ""
    haystack = f"{title} {text}".lower()
    matched = sorted({term for term in terms if term in haystack})
    score = row["score"]
    rank_score = 0 if score is None else float(score)
    tags = coverage_tags(f"{title} {text}")
    return {
        "sourceChunkId": row["source_chunk_id"],
        "sourceId": row["source_id"],
        "chunkIndex": int(row["chunk_index"]),
        "heading": title,
        "text": text,
        "snippet": snippet(text, terms),
        "wordCount": int(row["word_count"] or 0),
        "score": rank_score,
        "matchedTerms": matched,
        "laneIds": [lane_id] if lane_id else [],
        "coverageTags": tags,
        "nearDuplicateKey": normalize_key(text),
        "title": row["source_title"],
        "sourcePath": row["source_path"] or "",
        "sourceType": row["source_type"] or "unknown",
        "reliabilityTier": row["reliability_tier"] or "unknown",
        "license": row["license"] or "unknown",
        "status": row["status"] or "active",
    }

def search_lane(conn, req, lane, fts):
    query = " ".join([lane.get("query") or "", " ".join(lane.get("terms") or [])])
    terms = plain_terms(query)
    rows = []
    if fts:
        match = fts_query(query)
        if match:
            rows = conn.execute(
                """
                select c.source_chunk_id, c.source_id, c.title, c.source_path, c.chunk_index,
                       c.text, c.word_count, s.title as source_title, s.source_type,
                       s.reliability_tier, s.license, s.status, bm25(source_chunks_fts) as score
                from source_chunks_fts
                join source_chunks c on c.source_chunk_id = source_chunks_fts.source_chunk_id
                join sources s on s.source_id = c.source_id
                where source_chunks_fts match ?
                order by score
                limit ?
                """,
                (match, int(req.get("laneChunkLimit") or 36)),
            ).fetchall()
    if not rows and terms:
        where = " or ".join(["lower(c.text) like ? or lower(c.title) like ?" for _ in terms[:8]])
        params = []
        for term in terms[:8]:
            params.extend([f"%{term}%", f"%{term}%"])
        rows = conn.execute(
            f"""
            select c.source_chunk_id, c.source_id, c.title, c.source_path, c.chunk_index,
                   c.text, c.word_count, s.title as source_title, s.source_type,
                   s.reliability_tier, s.license, s.status, 0.0 as score
            from source_chunks c
            join sources s on s.source_id = c.source_id
            where {where}
            limit ?
            """,
            params + [int(req.get("laneChunkLimit") or 36)],
        ).fetchall()
    return [row_to_chunk(row, terms, lane.get("id") or "general") for row in rows]

def merge_chunk(existing, incoming):
    existing["matchedTerms"] = sorted(set(existing.get("matchedTerms", [])) | set(incoming.get("matchedTerms", [])))
    existing["laneIds"] = sorted(set(existing.get("laneIds", [])) | set(incoming.get("laneIds", [])))
    existing["coverageTags"] = sorted(set(existing.get("coverageTags", [])) | set(incoming.get("coverageTags", [])))
    existing["score"] = min(existing.get("score", 0), incoming.get("score", 0))
    return existing

def reliability_bonus(source):
    tier = source.get("reliabilityTier")
    if tier in {"primary", "scholarly", "reference"}:
        return 2.5
    if tier in {"high", "medium"}:
        return 1.25
    return 0

def source_reason(source):
    chunks = source["matchingChunks"]
    lanes = source.get("laneIds", [])
    tags = source.get("coverageTags", [])
    matched = sorted({term for chunk in chunks for term in chunk.get("matchedTerms", [])})
    bits = []
    if lanes:
        bits.append("lanes " + ", ".join(lanes[:6]))
    if tags:
        bits.append("coverage " + ", ".join(tags[:6]))
    if matched:
        bits.append("matched " + ", ".join(matched[:8]))
    bits.append(f"{len(chunks)} selected chunk" + ("" if len(chunks) == 1 else "s"))
    bits.append(f"{source['sourceType']} / {source['reliabilityTier']} / {source['status']}")
    return "; ".join(bits)

def score_source(source):
    chunks = source.get("matchingChunks", [])
    matched_count = len({term for chunk in chunks for term in chunk.get("matchedTerms", [])})
    lane_count = len(source.get("laneIds", []))
    tag_count = len(source.get("coverageTags", []))
    return round(matched_count * 0.7 + lane_count * 3 + tag_count * 0.6 + reliability_bonus(source) + min(len(chunks), 4) * 0.35, 3)

def select_chunks_for_source(source, req):
    max_chunks = int(req.get("maxChunksPerSource") or 4)
    seen_keys = set()
    chunks = sorted(
        source["matchingChunks"],
        key=lambda chunk: (
            -len(chunk.get("laneIds", [])),
            -len(chunk.get("coverageTags", [])),
            -len(chunk.get("matchedTerms", [])),
            chunk.get("score", 0),
            chunk.get("chunkIndex", 0),
        ),
    )
    selected = []
    for chunk in chunks:
        key = chunk.get("nearDuplicateKey") or ""
        if key and key in seen_keys:
            continue
        seen_keys.add(key)
        selected.append(chunk)
        if len(selected) >= max_chunks:
            break
    return selected

def select_diverse_sources(all_sources, req, lanes):
    max_sources = int(req.get("sourceLimit") or 12)
    max_sources_per_lane = int(req.get("maxSourcesPerLane") or 2)
    total_chunk_budget = int(req.get("totalChunkBudget") or 32)
    selected = {}
    lane_source_counts = defaultdict(int)

    lane_ids = [lane.get("id") for lane in lanes]
    scored = sorted(all_sources, key=lambda source: (-source["relevanceScore"], source["title"]))

    for lane_id in lane_ids:
        lane_sources = [source for source in scored if lane_id in source.get("laneIds", [])]
        for source in lane_sources:
            if lane_source_counts[lane_id] >= max_sources_per_lane:
                break
            if source["sourceId"] not in selected and len(selected) >= max_sources:
                continue
            selected[source["sourceId"]] = source
            lane_source_counts[lane_id] += 1
            break

    for source in scored:
        if len(selected) >= max_sources:
            break
        if source["sourceId"] in selected:
            continue
        if any(lane_source_counts[lane] < max_sources_per_lane for lane in source.get("laneIds", [])):
            selected[source["sourceId"]] = source
            for lane_id in source.get("laneIds", []):
                lane_source_counts[lane_id] += 1

    output = []
    selected_chunk_total = 0
    seen_chunk_keys = set()
    for source in sorted(selected.values(), key=lambda item: (-item["relevanceScore"], item["title"])):
        chunks = []
        for chunk in select_chunks_for_source(source, req):
            if selected_chunk_total >= total_chunk_budget:
                break
            key = chunk.get("nearDuplicateKey") or chunk.get("sourceChunkId")
            if key in seen_chunk_keys:
                continue
            seen_chunk_keys.add(key)
            chunks.append(chunk)
            selected_chunk_total += 1
        if chunks:
            lane_counts = defaultdict(int)
            for chunk in chunks:
                for lane_id in chunk.get("laneIds", []):
                    lane_counts[lane_id] += 1
            source["matchingChunks"] = chunks
            source["laneChunkCounts"] = dict(lane_counts)
            source["relevanceReason"] = source_reason(source)
            output.append(source)
    return output

def diagnostics_for(req, lanes, all_sources, selected):
    lane_counts = defaultdict(int)
    source_counts = {}
    dup_warnings = []
    over_warnings = []
    duplicate_titles = defaultdict(list)
    duplicate_chunks = defaultdict(list)

    for source in all_sources:
        duplicate_titles[source.get("duplicateGroupKey") or source["title"].lower()].append(source["title"])
        for chunk in source.get("matchingChunks", []):
            duplicate_chunks[chunk.get("nearDuplicateKey") or chunk["sourceChunkId"]].append(chunk["sourceChunkId"])

    for names in duplicate_titles.values():
        if len(set(names)) > 1:
            dup_warnings.append("Near-duplicate source titles: " + ", ".join(sorted(set(names))[:4]))
    for ids in duplicate_chunks.values():
        if len(ids) > 1:
            dup_warnings.append(f"{len(ids)} near-duplicate chunks detected.")
            break

    selected_chunk_total = sum(len(source.get("matchingChunks", [])) for source in selected)
    for source in selected:
        count = len(source.get("matchingChunks", []))
        source_counts[source["sourceId"]] = count
        if selected_chunk_total and count / selected_chunk_total > 0.35:
            over_warnings.append(f"{source['title']} supplies {count}/{selected_chunk_total} selected chunks.")
        for chunk in source.get("matchingChunks", []):
            for lane_id in chunk.get("laneIds", []):
                lane_counts[lane_id] += 1

    for lane in lanes:
        lane_id = lane.get("id")
        count = lane_counts[lane_id]
        if selected_chunk_total and count / selected_chunk_total > 0.42:
            over_warnings.append(f"Lane {lane.get('title') or lane_id} supplies {count}/{selected_chunk_total} selected chunks.")

    return {
        "originalTerms": req.get("originalTerms") or [],
        "expandedTerms": req.get("expandedTerms") or [],
        "matchedSourceTitles": [source["title"] for source in all_sources],
        "matchedChunkCount": sum(len(source.get("matchingChunks", [])) for source in all_sources),
        "selectedSourceTitles": [source["title"] for source in selected],
        "selectedChunkCount": selected_chunk_total,
        "duplicateWarnings": dup_warnings[:8],
        "overrepresentationWarnings": over_warnings[:8],
        "laneChunkCounts": dict(lane_counts),
        "sourceChunkCounts": source_counts,
    }

def discover(conn):
    out = []
    fts = has_fts(conn)
    for req in payload.get("requests", []):
        query = req.get("query") or ""
        lanes = req.get("lanes") or [{"id": "general", "title": "General", "query": query, "terms": plain_terms(query), "required": True}]
        grouped = {}
        for lane in lanes:
            for chunk in search_lane(conn, req, lane, fts):
                source_id = chunk["sourceId"]
                source = grouped.setdefault(source_id, {
                    "sourceId": source_id,
                    "title": chunk["title"],
                    "sourcePath": chunk["sourcePath"],
                    "sourceType": chunk["sourceType"],
                    "reliabilityTier": chunk["reliabilityTier"],
                    "license": chunk["license"],
                    "status": chunk["status"],
                    "origin": origin(chunk["sourcePath"]),
                    "relevanceScore": 0,
                    "relevanceReason": "",
                    "existingMetadata": "Pipeline KB metadata only; no native territory/branch/topic tables found.",
                    "laneIds": [],
                    "coverageTags": [],
                    "laneChunkCounts": {},
                    "duplicateGroupKey": normalize_key(chunk["title"] or chunk["sourcePath"]),
                    "matchingChunks": [],
                    "_chunksById": {},
                })
                existing = source["_chunksById"].get(chunk["sourceChunkId"])
                source["_chunksById"][chunk["sourceChunkId"]] = merge_chunk(existing, chunk) if existing else chunk

        all_sources = []
        for source in grouped.values():
            source["matchingChunks"] = list(source["_chunksById"].values())
            del source["_chunksById"]
            source["laneIds"] = sorted({lane for chunk in source["matchingChunks"] for lane in chunk.get("laneIds", [])})
            source["coverageTags"] = sorted({tag for chunk in source["matchingChunks"] for tag in chunk.get("coverageTags", [])})
            source["relevanceScore"] = score_source(source)
            source["relevanceReason"] = source_reason(source)
            all_sources.append(source)

        all_sources.sort(key=lambda item: (-item["relevanceScore"], item["title"]))
        selected = select_diverse_sources(all_sources, req, lanes)
        diagnostics = diagnostics_for(req, lanes, all_sources, selected)
        out.append({
            "plannedMapId": req.get("plannedMapId"),
            "query": query,
            "candidates": selected,
            "diagnostics": diagnostics,
        })
    return out

def selected_chunks(conn):
    ids = list(dict.fromkeys(payload.get("chunkIds") or []))
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        select c.source_chunk_id, c.source_id, c.title, c.source_path, c.chunk_index,
               c.text, c.word_count, s.title as source_title, s.source_type,
               s.reliability_tier, s.license, s.status, 0.0 as score
        from source_chunks c
        join sources s on s.source_id = c.source_id
        where c.source_chunk_id in ({placeholders})
        order by s.title, c.chunk_index
        """,
        ids,
    ).fetchall()
    return [row_to_chunk(row, [], "") for row in rows]

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
try:
    result = stats(conn)
    if mode == "discover":
        result["requests"] = discover(conn)
    elif mode == "chunks":
        result["chunks"] = selected_chunks(conn)
    else:
        result["error"] = f"unsupported mode {mode}"
    print(json.dumps(result))
finally:
    conn.close()
`;

export async function readAtlasCorpusBridgeState(
  plannedMaps: AtlasPlannedMapItem[],
  recipes: AtlasMapRecipe[],
  options: AtlasCorpusBridgeOptions = {},
): Promise<AtlasCorpusBridgeState> {
  const dbPath = atlasCorpusDbPath();
  const base: AtlasCorpusBridgeState = {
    available: false,
    dbPath,
    sourceName: "Pipeline SQLite KB",
    sourceCount: 0,
    chunkCount: 0,
    ftsEnabled: false,
    candidatesByPlannedMapId: {},
  };

  if (!existsSync(/* turbopackIgnore: true */ dbPath)) {
    return {
      ...base,
      error: `Pipeline KB not found at ${dbPath}.`,
    };
  }

  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const planByPlannedMapId = new Map<string, AtlasCorpusSearchPlan>();
  const requests = plannedMaps
    .filter(map => map.status !== "published")
    .slice(0, 12)
    .map(map => {
      const recipe = recipeById.get(map.recipeId);
      const plan = buildAtlasCorpusSearchPlan(map, recipe, optionsForPlannedMap(options, map.id));
      planByPlannedMapId.set(map.id, plan);
      return requestFromPlan(map.id, plan);
    });

  try {
    const result = runCorpusPython<{
      sourceCount: number;
      chunkCount: number;
      ftsEnabled: boolean;
      requests: RawCorpusCandidate[];
    }>({ mode: "discover", dbPath, requests });

    const candidatesByPlannedMapId: Record<string, AtlasCorpusCandidateSet> = {};
    for (const request of result.requests || []) {
      const plannedMap = plannedMaps.find(map => map.id === request.plannedMapId);
      const plan = planByPlannedMapId.get(String(request.plannedMapId || ""));
      if (!plannedMap || !plan) continue;
      const recipe = recipeById.get(plannedMap.recipeId);
      const diagnostics = request.diagnostics || emptyDiagnostics(plan);
      const sufficiency = evaluateCandidateSufficiency(plannedMap, recipe, request.candidates, plan, diagnostics);
      candidatesByPlannedMapId[plannedMap.id] = {
        plannedMapId: plannedMap.id,
        query: request.query,
        searchPlan: plan,
        diagnostics,
        candidates: request.candidates,
        sufficiency,
      };
    }

    return {
      ...base,
      available: true,
      sourceCount: Number(result.sourceCount || 0),
      chunkCount: Number(result.chunkCount || 0),
      ftsEnabled: Boolean(result.ftsEnabled),
      candidatesByPlannedMapId,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "Could not query Pipeline KB.",
    };
  }
}

export async function attachAtlasCorpusCandidatesToPlannedMap(input: {
  supabase: SupabaseAdminClient;
  plannedMap: AtlasPlannedMapItem;
  recipe?: AtlasMapRecipe;
  corpusSourceIds: string[];
  options?: AtlasCorpusBridgeOptions;
}) {
  const dbPath = atlasCorpusDbPath();
  if (!existsSync(/* turbopackIgnore: true */ dbPath)) throw new Error(`Pipeline KB not found at ${dbPath}.`);

  const searchPlan = buildAtlasCorpusSearchPlan(input.plannedMap, input.recipe, optionsForPlannedMap(input.options || {}, input.plannedMap.id));
  const candidateSet = runCorpusPython<{
    requests: RawCorpusCandidate[];
  }>({
    mode: "discover",
    dbPath,
    requests: [{
      ...requestFromPlan(input.plannedMap.id, searchPlan),
      sourceLimit: 18,
      laneChunkLimit: 48,
      maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE,
      maxSourcesPerLane: DEFAULT_MAX_SOURCES_PER_LANE,
      totalChunkBudget: DEFAULT_TOTAL_CHUNK_BUDGET,
    }],
  }).requests?.[0];

  if (!candidateSet) throw new Error("No corpus candidates were returned for this planned map.");
  const selected = new Set(input.corpusSourceIds);
  const selectedCandidates = candidateSet.candidates.filter(candidate => selected.has(candidate.sourceId));
  const selectedChunkIds = selectedCandidates.flatMap(candidate => candidate.matchingChunks.map(chunk => chunk.sourceChunkId));

  if (!selectedChunkIds.length) throw new Error("Select at least one corpus source candidate before attaching.");

  const chunkResult = runCorpusPython<{
    chunks: RawCorpusChunk[];
  }>({ mode: "chunks", dbPath, chunkIds: selectedChunkIds });
  const rawChunks = chunkResult.chunks || [];
  if (!rawChunks.length) throw new Error("Selected corpus chunks could not be loaded from the Pipeline KB.");

  const candidateChunkById = new Map(
    selectedCandidates.flatMap(candidate => candidate.matchingChunks.map(chunk => [chunk.sourceChunkId, chunk] as const)),
  );
  const chunks = rawChunks.map(chunk => ({
    ...chunk,
    laneIds: candidateChunkById.get(chunk.sourceChunkId)?.laneIds || [],
    coverageTags: candidateChunkById.get(chunk.sourceChunkId)?.coverageTags || [],
    nearDuplicateKey: candidateChunkById.get(chunk.sourceChunkId)?.nearDuplicateKey || chunk.nearDuplicateKey || "",
    matchedTerms: candidateChunkById.get(chunk.sourceChunkId)?.matchedTerms || [],
  }));

  const chunksBySource = groupBy(chunks, chunk => chunk.sourceId);
  const candidateBySource = new Map(selectedCandidates.map(candidate => [candidate.sourceId, candidate]));
  const diagnostics = candidateSet.diagnostics || emptyDiagnostics(searchPlan);
  const now = new Date().toISOString();
  const sourceRows = [];
  const chunkRows = [];
  const mapSourceRows = [];

  for (const [sourceId, sourceChunks] of chunksBySource) {
    const first = sourceChunks[0];
    const candidate = candidateBySource.get(sourceId);
    const atlasSourceId = `corpus-${input.plannedMap.mapSlug}-${safeId(sourceId)}`.slice(0, 120);
    const sourcePath = first.sourcePath || "";
    const sourceMetadata = {
      corpusBridge: {
        provider: "pipeline-sqlite-kb",
        dbPath,
        bridgeVersion: "v2",
        originalSourceId: sourceId,
        originalSourceType: first.sourceType,
        originalReliabilityTier: first.reliabilityTier,
        originalLicense: first.license,
        attachedAt: now,
        plannedMapId: input.plannedMap.id,
        searchPlan,
        candidateReason: candidate?.relevanceReason || "",
        laneIds: candidate?.laneIds || [],
        coverageTags: candidate?.coverageTags || [],
        laneChunkCounts: candidate?.laneChunkCounts || {},
        selectedChunkIds: sourceChunks.map(chunk => chunk.sourceChunkId),
        retrievalDiagnostics: diagnostics,
      },
    };

    sourceRows.push({
      id: atlasSourceId,
      title: `[Corpus] ${first.title}`,
      creator: "Pipeline KB",
      source_type: "other",
      territory_slug: input.plannedMap.territorySlug,
      branch_slug: input.plannedMap.branchSlug,
      map_slug: input.plannedMap.mapSlug,
      file_path: sourcePath.startsWith("http") ? null : sourcePath,
      canonical_url: sourcePath.startsWith("http") ? sourcePath : null,
      metadata: sourceMetadata,
    });

    mapSourceRows.push({
      source_id: atlasSourceId,
      map_slug: input.plannedMap.mapSlug,
      territory_slug: input.plannedMap.territorySlug,
      branch_slug: input.plannedMap.branchSlug,
      metadata: sourceMetadata,
    });

    for (const chunk of sourceChunks) {
      const metadata = {
        corpusBridge: {
          provider: "pipeline-sqlite-kb",
          dbPath,
          bridgeVersion: "v2",
          originalSourceId: chunk.sourceId,
          originalSourceChunkId: chunk.sourceChunkId,
          originalChunkIndex: chunk.chunkIndex,
          originalSourcePath: chunk.sourcePath,
          originalSourceType: chunk.sourceType,
          originalReliabilityTier: chunk.reliabilityTier,
          originalLicense: chunk.license,
          laneIds: chunk.laneIds || [],
          coverageTags: chunk.coverageTags || [],
          matchedTerms: chunk.matchedTerms || [],
          nearDuplicateKey: chunk.nearDuplicateKey || "",
          attachedAt: now,
        },
      };

      chunkRows.push({
        source_id: atlasSourceId,
        chunk_index: chunk.chunkIndex,
        heading: `${chunk.heading || first.title} #${chunk.chunkIndex}`,
        chunk_text: chunk.text,
        char_count: chunk.text.length,
        token_estimate: Math.ceil(chunk.text.length / 4),
        metadata,
      });
    }
  }

  const sourceResult = await input.supabase.from("atlas_sources").upsert(sourceRows, { onConflict: "id" });
  if (sourceResult.error) throw new Error(sourceResult.error.message);

  const chunkResultUpsert = await input.supabase.from("atlas_source_chunks").upsert(chunkRows, { onConflict: "source_id,chunk_index" });
  if (chunkResultUpsert.error) throw new Error(chunkResultUpsert.error.message);

  const mapSourceResult = await input.supabase.from("atlas_map_sources").upsert(mapSourceRows, { onConflict: "source_id,map_slug" });
  if (mapSourceResult.error) throw new Error(mapSourceResult.error.message);

  return {
    attachedSourceIds: sourceRows.map(row => row.id),
    attachedSourceCount: sourceRows.length,
    attachedChunkCount: chunkRows.length,
    diagnostics,
  };
}

export async function readSelectedAtlasSourceSufficiency(input: {
  supabase: SupabaseAdminClient;
  plannedMap: AtlasPlannedMapItem;
  recipe?: AtlasMapRecipe;
  sourceIds: string[];
}): Promise<AtlasSourceSufficiency> {
  if (!input.sourceIds.length) return emptySufficiency(["No sources selected."]);

  const [sourceResult, chunkResult] = await Promise.all([
    input.supabase
      .from("atlas_sources")
      .select("id,title,source_type,territory_slug,branch_slug,map_slug,metadata")
      .in("id", input.sourceIds),
    input.supabase
      .from("atlas_source_chunks")
      .select("source_id,heading,char_count,token_estimate,metadata")
      .in("source_id", input.sourceIds),
  ]);

  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (chunkResult.error) throw new Error(chunkResult.error.message);

  const sourceRows = (sourceResult.data || []).map(row => {
    const metadata = recordObject(row.metadata);
    const bridge = recordObject(metadata.corpusBridge);
    return {
      id: String(row.id || ""),
      title: String(row.title || ""),
      sourceType: String(row.source_type || "other"),
      metadata,
      bridge,
      laneIds: stringArray(bridge.laneIds),
      coverageTags: stringArray(bridge.coverageTags),
      reliabilityTier: String(bridge.originalReliabilityTier || "atlas"),
    };
  });
  const chunkRows = (chunkResult.data || []).map(row => {
    const metadata = recordObject(row.metadata);
    const bridge = recordObject(metadata.corpusBridge);
    return {
      sourceId: String(row.source_id || ""),
      heading: String(row.heading || ""),
      charCount: Number(row.char_count || 0),
      laneIds: stringArray(bridge.laneIds),
      coverageTags: stringArray(bridge.coverageTags),
    };
  });
  const searchPlan = sourceRows
    .map(row => row.bridge.searchPlan)
    .find(value => recordObject(value).lanes) as AtlasCorpusSearchPlan | undefined;
  const diagnostics = sourceRows
    .map(row => row.bridge.retrievalDiagnostics)
    .find(value => recordObject(value).selectedChunkCount) as AtlasCorpusRetrievalDiagnostics | undefined;

  return evaluateSufficiencyFromEvidence({
    plannedMap: input.plannedMap,
    recipe: input.recipe,
    sourceCount: sourceRows.length,
    chunkCount: chunkRows.length,
    sourceTypes: dedupe(sourceRows.map(row => row.sourceType)),
    reliabilityTiers: dedupe(sourceRows.map(row => row.reliabilityTier)),
    searchPlan: searchPlan || buildAtlasCorpusSearchPlan(input.plannedMap, input.recipe),
    diagnostics,
    laneIdsBySource: sourceRows.map(row => ({ sourceId: row.id, laneIds: row.laneIds })),
    laneIdsByChunk: chunkRows.map(row => ({ sourceId: row.sourceId, laneIds: row.laneIds })),
    coverageTags: dedupe([
      ...sourceRows.flatMap(row => row.coverageTags),
      ...chunkRows.flatMap(row => row.coverageTags),
    ]),
    corpusText: [
      ...sourceRows.map(row => `${row.title} ${row.sourceType} ${row.laneIds.join(" ")} ${row.coverageTags.join(" ")}`),
      ...chunkRows.map(row => `${row.heading} ${row.laneIds.join(" ")} ${row.coverageTags.join(" ")}`),
    ].join(" "),
  });
}

export function buildAtlasCorpusSearchPlan(
  plannedMap: AtlasPlannedMapItem,
  recipe?: AtlasMapRecipe,
  options: AtlasCorpusBridgeOptions = {},
): AtlasCorpusSearchPlan {
  const originalQuery = corpusQueryForPlannedMap(plannedMap, recipe);
  const originalTerms = importantTerms(originalQuery);
  const humanKeywords = dedupe(options.humanKeywords || []);
  const mapLanes = MAP_SPECIFIC_SEARCH_LANES[plannedMap.mapSlug] || [];
  const recipeLanes = RECIPE_SEARCH_LANES[recipe?.id || ""] || [];
  const baseLane = lane(
    "core-prompt",
    "Core Prompt",
    originalQuery,
    originalTerms,
    "Baseline query from territory, branch, map, recipe, and notes.",
  );
  const humanLane = humanKeywords.length
    ? [lane("human-keywords", "Human Keywords", humanKeywords.join(" "), humanKeywords, "Reviewer-supplied search terms.")]
    : [];
  const allLanes = [baseLane, ...recipeLanes, ...mapLanes, ...humanLane]
    .map(item => ({
      id: item.id,
      title: item.title,
      query: item.query,
      terms: dedupe([...item.terms, ...importantTerms(item.query)]).slice(0, 18),
      required: item.required !== false,
      reason: item.reason,
    }));
  const include = new Set(options.includeLaneIds || []);
  const exclude = new Set(options.excludeLaneIds || []);
  const lanes = dedupeById(allLanes)
    .filter(item => !include.size || include.has(item.id))
    .filter(item => !exclude.has(item.id));
  const expandedTerms = dedupe([
    ...originalTerms,
    ...lanes.flatMap(item => item.terms),
    ...humanKeywords,
  ]).slice(0, 80);

  return {
    originalQuery,
    originalTerms,
    expandedTerms,
    humanKeywords,
    includedLaneIds: [...include],
    excludedLaneIds: [...exclude],
    lanes: lanes.length ? lanes : [baseLane],
  };
}

function evaluateCandidateSufficiency(
  plannedMap: AtlasPlannedMapItem,
  recipe: AtlasMapRecipe | undefined,
  candidates: AtlasCorpusCandidateSource[],
  searchPlan: AtlasCorpusSearchPlan,
  diagnostics: AtlasCorpusRetrievalDiagnostics,
): AtlasSourceSufficiency {
  return evaluateSufficiencyFromEvidence({
    plannedMap,
    recipe,
    sourceCount: candidates.length,
    chunkCount: candidates.reduce((total, candidate) => total + candidate.matchingChunks.length, 0),
    sourceTypes: dedupe(candidates.map(candidate => candidate.sourceType)),
    reliabilityTiers: dedupe(candidates.map(candidate => candidate.reliabilityTier)),
    searchPlan,
    diagnostics,
    laneIdsBySource: candidates.map(candidate => ({ sourceId: candidate.sourceId, laneIds: candidate.laneIds })),
    laneIdsByChunk: candidates.flatMap(candidate => candidate.matchingChunks.map(chunk => ({ sourceId: candidate.sourceId, laneIds: chunk.laneIds }))),
    coverageTags: dedupe(candidates.flatMap(candidate => [
      ...candidate.coverageTags,
      ...candidate.matchingChunks.flatMap(chunk => chunk.coverageTags),
    ])),
    corpusText: candidates.map(candidate => [
      candidate.title,
      candidate.sourceType,
      candidate.reliabilityTier,
      candidate.laneIds.join(" "),
      candidate.coverageTags.join(" "),
      ...candidate.matchingChunks.map(chunk => `${chunk.heading} ${chunk.snippet} ${chunk.laneIds.join(" ")} ${chunk.coverageTags.join(" ")}`),
    ].join(" ")).join(" "),
  });
}

function evaluateSufficiencyFromEvidence(input: {
  plannedMap: AtlasPlannedMapItem;
  recipe?: AtlasMapRecipe;
  sourceCount: number;
  chunkCount: number;
  sourceTypes: string[];
  reliabilityTiers: string[];
  searchPlan: AtlasCorpusSearchPlan;
  diagnostics?: AtlasCorpusRetrievalDiagnostics;
  laneIdsBySource: Array<{ sourceId: string; laneIds: string[] }>;
  laneIdsByChunk: Array<{ sourceId: string; laneIds: string[] }>;
  coverageTags: string[];
  corpusText: string;
}): AtlasSourceSufficiency {
  const text = input.corpusText.toLowerCase();
  const coveredTerms = input.searchPlan.expandedTerms.filter(term => text.includes(term.toLowerCase()));
  const categoryCoverage = input.searchPlan.expandedTerms.length
    ? Math.round((coveredTerms.length / input.searchPlan.expandedTerms.length) * 100)
    : 0;
  const laneCoverage = input.searchPlan.lanes.map(laneItem => {
    const sourceIds = new Set(input.laneIdsBySource.filter(row => row.laneIds.includes(laneItem.id)).map(row => row.sourceId));
    const chunkCount = input.laneIdsByChunk.filter(row => row.laneIds.includes(laneItem.id)).length;
    return {
      laneId: laneItem.id,
      title: laneItem.title,
      required: laneItem.required,
      sourceCount: sourceIds.size,
      chunkCount,
      covered: sourceIds.size > 0 && chunkCount > 0,
    };
  });
  const requiredLanes = laneCoverage.filter(item => item.required);
  const coveredRequiredLanes = requiredLanes.filter(item => item.covered);
  const laneCoverageRatio = requiredLanes.length ? coveredRequiredLanes.length / requiredLanes.length : 1;
  const tags = new Set(input.coverageTags);
  const chronologyRelevant = /lineage|historical|movement|chronolog|history/i.test(`${input.recipe?.id || ""} ${input.recipe?.title || ""} ${input.plannedMap.mapTitle}`);
  const chronologyCoverage = chronologyRelevant
    ? coverageLevel(input.chunkCount, laneCoverageRatio, tags.has("historical_chronology"))
    : "not_applicable";
  const contributorPersonCoverage = coverageLevel(input.chunkCount, laneCoverageRatio, tags.has("people_contributors"));
  const contributorTextCoverage = coverageLevel(input.chunkCount, laneCoverageRatio, tags.has("texts_citations"));
  const conceptTheoryCoverage = coverageLevel(input.chunkCount, laneCoverageRatio, tags.size >= 4);
  const relationEvidenceCoverage = coverageLevel(input.chunkCount, laneCoverageRatio, tags.has("relations_evidence") || tags.has("tradeoffs_constraints") || tags.has("failure_resilience"));
  const missingLaneWarnings = laneCoverage
    .filter(item => item.required && !item.covered)
    .map(item => `Missing source coverage for lane: ${item.title}.`);
  const warnings = [
    ...missingLaneWarnings,
    ...(input.diagnostics?.overrepresentationWarnings || []),
  ];
  const obviousGaps: string[] = [];
  if (input.sourceCount < 3) obviousGaps.push("source diversity");
  if (input.chunkCount < 10) obviousGaps.push("chunk depth");
  if (laneCoverageRatio < 0.6) obviousGaps.push("lane coverage");
  if (conceptTheoryCoverage === "weak") obviousGaps.push("concept/theory coverage");
  if (relationEvidenceCoverage === "weak") obviousGaps.push("relation evidence");
  if (input.sourceCount < 2) warnings.push("Only one source selected; source diversity is weak.");
  if (input.chunkCount < 8) warnings.push("Fewer than 8 chunks selected; generation may miss categories or relation evidence.");
  if (categoryCoverage < 45) warnings.push("Low expanded keyword coverage against the planned map search plan.");
  if (input.diagnostics?.duplicateWarnings.length) warnings.push(...input.diagnostics.duplicateWarnings);

  const confidence = confidenceFor({
    sourceCount: input.sourceCount,
    chunkCount: input.chunkCount,
    laneCoverageRatio,
    warningCount: warnings.length,
    categoryCoverage,
  });

  return {
    sourceCount: input.sourceCount,
    chunkCount: input.chunkCount,
    sourceDiversity: input.sourceTypes.length,
    sourceTypes: input.sourceTypes,
    reliabilityTiers: input.reliabilityTiers,
    categoryCoverage,
    chronologyCoverage,
    contributorTextCoverage,
    contributorPersonCoverage,
    conceptTheoryCoverage,
    relationEvidenceCoverage,
    laneCoverage,
    confidence,
    obviousGaps: dedupe(obviousGaps),
    warnings: dedupe(warnings),
    missingLaneWarnings,
    overrepresentationWarnings: input.diagnostics?.overrepresentationWarnings || [],
  };
}

function emptySufficiency(warnings: string[]): AtlasSourceSufficiency {
  return {
    sourceCount: 0,
    chunkCount: 0,
    sourceDiversity: 0,
    sourceTypes: [],
    reliabilityTiers: [],
    categoryCoverage: 0,
    chronologyCoverage: "not_applicable",
    contributorTextCoverage: "weak",
    contributorPersonCoverage: "weak",
    conceptTheoryCoverage: "weak",
    relationEvidenceCoverage: "weak",
    laneCoverage: [],
    confidence: "insufficient",
    obviousGaps: warnings,
    warnings,
    missingLaneWarnings: warnings,
    overrepresentationWarnings: [],
  };
}

function requestFromPlan(plannedMapId: string, plan: AtlasCorpusSearchPlan) {
  return {
    plannedMapId,
    query: plan.originalQuery,
    originalTerms: plan.originalTerms,
    expandedTerms: plan.expandedTerms,
    lanes: plan.lanes,
    sourceLimit: 12,
    laneChunkLimit: 36,
    maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE,
    maxSourcesPerLane: DEFAULT_MAX_SOURCES_PER_LANE,
    totalChunkBudget: DEFAULT_TOTAL_CHUNK_BUDGET,
  };
}

function emptyDiagnostics(plan: AtlasCorpusSearchPlan): AtlasCorpusRetrievalDiagnostics {
  return {
    originalTerms: plan.originalTerms,
    expandedTerms: plan.expandedTerms,
    matchedSourceTitles: [],
    matchedChunkCount: 0,
    selectedSourceTitles: [],
    selectedChunkCount: 0,
    duplicateWarnings: [],
    overrepresentationWarnings: [],
    laneChunkCounts: {},
    sourceChunkCounts: {},
  };
}

function corpusQueryForPlannedMap(plannedMap: AtlasPlannedMapItem, recipe?: AtlasMapRecipe) {
  return [
    plannedMap.territoryTitle,
    plannedMap.branchTitle,
    plannedMap.mapTitle,
    plannedMap.summary,
    plannedMap.sourceRequirements,
    plannedMap.notes,
    recipe?.title || "",
    recipe?.purpose || "",
    recipe?.groupingLogic || "",
    recipe?.generationInstructions || "",
  ].filter(Boolean).join(" ");
}

function lane(id: string, title: string, query: string, terms: string[], reason: string) {
  return {
    id,
    title,
    query,
    terms,
    required: true,
    reason,
  };
}

function coverageLevel(chunkCount: number, laneCoverageRatio: number, hasDirectTag: boolean): AtlasCorpusCoverageLevel {
  if (hasDirectTag && chunkCount >= 18 && laneCoverageRatio >= 0.75) return "strong";
  if ((hasDirectTag && chunkCount >= 10) || (chunkCount >= 16 && laneCoverageRatio >= 0.7)) return "usable";
  if (chunkCount >= 6 && laneCoverageRatio >= 0.45) return "partial";
  return "weak";
}

function confidenceFor(input: {
  sourceCount: number;
  chunkCount: number;
  laneCoverageRatio: number;
  warningCount: number;
  categoryCoverage: number;
}): AtlasCorpusConfidence {
  if (input.sourceCount >= 6 && input.chunkCount >= 20 && input.laneCoverageRatio >= 0.8 && input.categoryCoverage >= 55 && input.warningCount <= 2) return "strong";
  if (input.sourceCount >= 4 && input.chunkCount >= 12 && input.laneCoverageRatio >= 0.65 && input.categoryCoverage >= 40) return "usable";
  if (input.sourceCount >= 2 && input.chunkCount >= 6 && input.laneCoverageRatio >= 0.35) return "weak";
  return "insufficient";
}

function optionsForPlannedMap(options: AtlasCorpusBridgeOptions, plannedMapId: string): AtlasCorpusBridgeOptions {
  if (options.focusPlannedMapId && options.focusPlannedMapId !== plannedMapId) return {};
  return options;
}

function runCorpusPython<T>(payload: Record<string, unknown>): T {
  const child = spawnSync("python", ["-c", PYTHON_BRIDGE], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 18 * 1024 * 1024,
  });

  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error((child.stderr || child.stdout || "Pipeline KB query failed.").trim());
  }

  try {
    return JSON.parse(child.stdout) as T;
  } catch (error) {
    throw new Error(`Pipeline KB returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function atlasCorpusDbPath() {
  return process.env.ATLAS_CORPUS_DB_PATH
    || process.env.PIPELINE_KB_PATH
    || DEFAULT_PIPELINE_KB_PATH;
}

function importantTerms(value: string) {
  const stop = new Set(["the", "and", "for", "that", "this", "with", "from", "into", "what", "does", "major", "families", "inside", "map", "maps"]);
  return dedupe((value.match(/\b[a-zA-Z0-9][a-zA-Z0-9_-]{2,}\b/g) || [])
    .map(term => term.toLowerCase())
    .filter(term => !stop.has(term)))
    .slice(0, 24);
}

function dedupe(values: string[]) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
}

function dedupeById<T extends { id: string }>(values: T[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function groupBy<Row>(rows: Row[], keyFor: (row: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return groups;
}

function safeId(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean);
}

export function sourceOriginLabel(sourcePath: string) {
  try {
    const url = new URL(sourcePath);
    return url.hostname;
  } catch {
    return sourcePath || "Pipeline KB";
  }
}
