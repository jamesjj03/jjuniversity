export type AtlasMapStatus = "live" | "queued";

export type AtlasContributor = {
  name: string;
  role: string;
  reason: string;
  texts: string[];
};

export type AtlasTheoryGroup = {
  id: string;
  title: string;
  shortTitle: string;
  family: string;
  stance: string;
  centralClaim: string;
  whyItMatters: string;
  contributors: AtlasContributor[];
  objections: string[];
  relatedGroupIds: string[];
  keywords: string[];
};

export type AtlasRelation = {
  source: string;
  target: string;
  kind: "opposes" | "answers" | "reframes" | "borrows" | "neighbors";
  note: string;
};

export type AtlasMap = {
  id: string;
  title: string;
  subtitle: string;
  question: string;
  summary: string;
  status: AtlasMapStatus;
  buildMode: "seeded" | "pipeline-ready";
  groups: AtlasTheoryGroup[];
  relations: AtlasRelation[];
};

export type AtlasBranch = {
  id: string;
  title: string;
  summary: string;
  maps: AtlasMap[];
};

export type AtlasTerritory = {
  id: string;
  title: string;
  summary: string;
  branches: AtlasBranch[];
};

export type AtlasMapsData = {
  updatedAt: string;
  territories: AtlasTerritory[];
};

const consciousnessGroups: AtlasTheoryGroup[] = [
  {
    id: "physicalism",
    title: "Physicalism and materialism",
    shortTitle: "Physicalism",
    family: "Matter-first",
    stance: "Consciousness depends on physical processes. No separate mental substance is required.",
    centralClaim: "Mind is a feature, function, or description of organized physical systems, usually brains and bodies.",
    whyItMatters: "This is the default frame for much of neuroscience, cognitive science, and analytic philosophy of mind.",
    contributors: [
      {
        name: "Thomas Hobbes",
        role: "early mechanist",
        reason: "Treated sensation and thought as bodily motion, pushing mind into the same explanatory world as matter.",
        texts: ["Leviathan"],
      },
      {
        name: "Gilbert Ryle",
        role: "category critic",
        reason: "Attacked the Cartesian split and reframed mental language as patterns of action and disposition.",
        texts: ["The Concept of Mind"],
      },
      {
        name: "Daniel Dennett",
        role: "cognitive naturalist",
        reason: "Rejected a central inner theater and treated reports of experience as data to be explained naturalistically.",
        texts: ["Consciousness Explained", "Content and Consciousness"],
      },
      {
        name: "Patricia and Paul Churchland",
        role: "neurophilosophers",
        reason: "Argued that mature neuroscience may replace parts of folk psychology rather than merely translate it.",
        texts: ["Neurophilosophy", "Matter and Consciousness"],
      },
    ],
    objections: [
      "It can look like it explains function while leaving felt experience untouched.",
      "The hard problem and qualia arguments claim there is an explanatory gap.",
      "Strict reduction can underdescribe subjectivity, meaning, and first-person evidence.",
    ],
    relatedGroupIds: ["functionalism", "predictive-processing", "higher-order"],
    keywords: ["matter", "neuroscience", "reduction", "behavior", "brain"],
  },
  {
    id: "dualism",
    title: "Dualism",
    shortTitle: "Dualism",
    family: "Two-aspect",
    stance: "Mind and matter are not the same kind of thing, or mental properties are not reducible to physical ones.",
    centralClaim: "Consciousness is distinct enough from the physical that a complete account needs more than physics alone.",
    whyItMatters: "Dualism keeps the first-person problem visible and anchors many modern debates about the hard problem.",
    contributors: [
      {
        name: "Plato",
        role: "soul theorist",
        reason: "Gave the soul a reality and priority that outlives ordinary bodily change.",
        texts: ["Phaedo", "Republic"],
      },
      {
        name: "Rene Descartes",
        role: "substance dualist",
        reason: "Separated thinking substance from extended substance and made certainty begin from consciousness.",
        texts: ["Meditations on First Philosophy"],
      },
      {
        name: "David Chalmers",
        role: "property dualist",
        reason: "Formulated the hard problem and argued that consciousness may require fundamental psychophysical laws.",
        texts: ["The Conscious Mind"],
      },
    ],
    objections: [
      "Causal interaction between nonphysical mind and physical body is hard to specify.",
      "It can multiply entities without giving a better predictive theory.",
      "Neuroscience strongly links mental change to bodily and brain change.",
    ],
    relatedGroupIds: ["physicalism", "idealism", "panpsychism"],
    keywords: ["soul", "mind-body", "substance", "property", "hard problem"],
  },
  {
    id: "idealism",
    title: "Idealism",
    shortTitle: "Idealism",
    family: "Mind-first",
    stance: "Mind, experience, or appearance is basic; matter is derivative, structured within experience, or known through it.",
    centralClaim: "The world is not best understood as mind-independent stuff that later produces experience.",
    whyItMatters: "Idealism flips the usual direction of explanation and asks why experience should be treated as secondary.",
    contributors: [
      {
        name: "George Berkeley",
        role: "subjective idealist",
        reason: "Argued that being is bound to perception and that matter as unknowable substrate is unnecessary.",
        texts: ["A Treatise Concerning the Principles of Human Knowledge"],
      },
      {
        name: "Immanuel Kant",
        role: "transcendental idealist",
        reason: "Made experience depend on forms and categories supplied by cognition rather than passive reception alone.",
        texts: ["Critique of Pure Reason"],
      },
      {
        name: "Bernardo Kastrup",
        role: "analytic idealist",
        reason: "Builds a modern case that consciousness is ontologically primary and matter is appearance within it.",
        texts: ["The Idea of the World"],
      },
    ],
    objections: [
      "It must explain why shared public reality is stable and lawlike.",
      "It can be difficult to separate metaphysics from introspective preference.",
      "Critics argue it risks making science a description of appearances only.",
    ],
    relatedGroupIds: ["dualism", "panpsychism", "enactivism"],
    keywords: ["mind-first", "appearance", "experience", "ontology", "perception"],
  },
  {
    id: "panpsychism",
    title: "Panpsychism and cosmopsychism",
    shortTitle: "Panpsychism",
    family: "Mind-in-nature",
    stance: "Consciousness or proto-conscious properties are widespread in nature rather than appearing from nothing.",
    centralClaim: "The mental is a basic feature of reality, though not necessarily humanlike at small scales.",
    whyItMatters: "It tries to avoid both brute emergence and supernatural mind by making mentality continuous with nature.",
    contributors: [
      {
        name: "Baruch Spinoza",
        role: "attribute monist",
        reason: "Treated mind and body as expressions of one underlying reality, giving later panpsychists a deep template.",
        texts: ["Ethics"],
      },
      {
        name: "Gustav Fechner",
        role: "psychophysical pioneer",
        reason: "Extended mind-like qualities through nature while also shaping quantitative psychophysics.",
        texts: ["Elements of Psychophysics"],
      },
      {
        name: "William James",
        role: "radical empiricist",
        reason: "Took experience as a primary material and explored continuity across streams of consciousness.",
        texts: ["The Principles of Psychology", "Essays in Radical Empiricism"],
      },
      {
        name: "Galen Strawson",
        role: "real materialist",
        reason: "Argued that if experience is real and matter is real, experience must be part of what matter is.",
        texts: ["Realistic Monism"],
      },
      {
        name: "Philip Goff",
        role: "contemporary defender",
        reason: "Popularized panpsychism as a serious response to the hard problem for current philosophy audiences.",
        texts: ["Galileo's Error"],
      },
    ],
    objections: [
      "The combination problem asks how tiny experiences become unified human consciousness.",
      "It can be hard to test empirically.",
      "Some versions risk renaming mystery rather than explaining mechanism.",
    ],
    relatedGroupIds: ["idealism", "dualism", "integrated-information"],
    keywords: ["proto-consciousness", "combination problem", "monism", "nature", "experience"],
  },
  {
    id: "functionalism",
    title: "Functionalism and computationalism",
    shortTitle: "Functionalism",
    family: "Role-first",
    stance: "Mental states are defined by what they do: inputs, outputs, causal roles, and computational organization.",
    centralClaim: "The same mind-state could be realized in different materials if the functional structure is right.",
    whyItMatters: "This frame powers cognitive science, AI debates, and the idea that mind can be studied as information processing.",
    contributors: [
      {
        name: "Alan Turing",
        role: "computation founder",
        reason: "Gave a formal frame for machine computation and a behavioral test for machine intelligence.",
        texts: ["Computing Machinery and Intelligence"],
      },
      {
        name: "Hilary Putnam",
        role: "multiple realizability theorist",
        reason: "Argued that mental kinds are functional kinds, not simply brain-material kinds.",
        texts: ["Minds and Machines"],
      },
      {
        name: "Jerry Fodor",
        role: "representational theorist",
        reason: "Developed the language-of-thought picture that made cognition look computational and symbolic.",
        texts: ["The Language of Thought"],
      },
      {
        name: "David Marr",
        role: "levels-of-analysis architect",
        reason: "Separated computational, algorithmic, and implementational levels for studying cognition.",
        texts: ["Vision"],
      },
    ],
    objections: [
      "The Chinese room argument claims syntax alone does not produce understanding.",
      "Functional role may miss the felt character of experience.",
      "Embodied and enactive critics argue cognition is not just internal computation.",
    ],
    relatedGroupIds: ["physicalism", "global-workspace", "predictive-processing"],
    keywords: ["computation", "AI", "multiple realizability", "cognition", "representation"],
  },
  {
    id: "global-workspace",
    title: "Global Workspace Theory",
    shortTitle: "GWT",
    family: "Access-first",
    stance: "Information becomes conscious when it is globally available to many specialized systems.",
    centralClaim: "Consciousness is like a workspace or broadcast architecture that coordinates perception, memory, action, and report.",
    whyItMatters: "It connects consciousness to attention, reportability, brain networks, and experimentally tractable access.",
    contributors: [
      {
        name: "Bernard Baars",
        role: "theory founder",
        reason: "Introduced the theater/workspace model as a cognitive architecture for conscious access.",
        texts: ["A Cognitive Theory of Consciousness"],
      },
      {
        name: "Stanislas Dehaene",
        role: "neuroscience developer",
        reason: "Linked global workspace ideas to ignition, report, and frontoparietal network dynamics.",
        texts: ["Consciousness and the Brain"],
      },
      {
        name: "Jean-Pierre Changeux",
        role: "neuronal workspace contributor",
        reason: "Helped develop the global neuronal workspace model with long-range brain integration.",
        texts: ["Neuronal Man"],
      },
    ],
    objections: [
      "It may explain access consciousness better than phenomenal consciousness.",
      "No-report paradigms challenge whether reportability is essential.",
      "Some critics think it overweights frontoparietal activity.",
    ],
    relatedGroupIds: ["functionalism", "higher-order", "predictive-processing"],
    keywords: ["access", "broadcast", "attention", "report", "workspace"],
  },
  {
    id: "integrated-information",
    title: "Integrated Information Theory",
    shortTitle: "IIT",
    family: "Structure-first",
    stance: "Consciousness corresponds to integrated causal structure within a system.",
    centralClaim: "A system is conscious to the extent that it has irreducible integrated information.",
    whyItMatters: "IIT offers a mathematical ambition: identify consciousness by intrinsic causal organization, not just behavior.",
    contributors: [
      {
        name: "Giulio Tononi",
        role: "theory founder",
        reason: "Formulated IIT as an axiomatic and mathematical account of consciousness.",
        texts: ["An Information Integration Theory of Consciousness"],
      },
      {
        name: "Christof Koch",
        role: "neuroscience advocate",
        reason: "Advanced IIT in public and scientific contexts and tied it to neural complexity.",
        texts: ["The Feeling of Life Itself"],
      },
      {
        name: "Masafumi Oizumi",
        role: "formal developer",
        reason: "Contributed to the mathematical development and refinement of integrated information measures.",
        texts: ["From the Phenomenology to the Mechanisms of Consciousness"],
      },
    ],
    objections: [
      "Some versions imply consciousness in systems that seem intuitively non-conscious.",
      "Calculating the theory for real brains is difficult.",
      "Critics dispute whether the axioms uniquely support the formalism.",
    ],
    relatedGroupIds: ["panpsychism", "physicalism", "global-workspace"],
    keywords: ["information", "integration", "causal structure", "phi", "intrinsic"],
  },
  {
    id: "higher-order",
    title: "Higher-order theories",
    shortTitle: "Higher-order",
    family: "Reflection-first",
    stance: "A mental state is conscious when the system represents itself as being in that state.",
    centralClaim: "Consciousness involves a higher-order thought, perception, or representation about another mental state.",
    whyItMatters: "This makes consciousness depend on self-modeling and helps explain why some processing stays unconscious.",
    contributors: [
      {
        name: "David Rosenthal",
        role: "higher-order thought theorist",
        reason: "Developed the claim that conscious states require suitable thoughts about those states.",
        texts: ["Consciousness and Mind"],
      },
      {
        name: "Peter Carruthers",
        role: "cognitive architecture theorist",
        reason: "Connected higher-order representation to global broadcasting and mindreading systems.",
        texts: ["Phenomenal Consciousness"],
      },
      {
        name: "Uriah Kriegel",
        role: "self-representation theorist",
        reason: "Argued for inner awareness as part of the structure of conscious experience.",
        texts: ["Subjective Consciousness"],
      },
    ],
    objections: [
      "It can make animal or infant consciousness too demanding.",
      "It may explain awareness-of-experience more than experience itself.",
      "False higher-order states create difficult edge cases.",
    ],
    relatedGroupIds: ["global-workspace", "physicalism", "predictive-processing"],
    keywords: ["self-model", "reflection", "metacognition", "awareness", "representation"],
  },
  {
    id: "predictive-processing",
    title: "Predictive processing and active inference",
    shortTitle: "Prediction",
    family: "Model-first",
    stance: "The brain is a prediction and control system that continuously models the causes of its sensory input.",
    centralClaim: "Experience is shaped by top-down prediction, error correction, action, and embodied control.",
    whyItMatters: "This is one of the strongest bridges between perception, neuroscience, psychiatry, embodiment, and AI.",
    contributors: [
      {
        name: "Karl Friston",
        role: "free-energy architect",
        reason: "Developed active inference and the free energy principle as a broad account of self-organizing systems.",
        texts: ["The Free-Energy Principle"],
      },
      {
        name: "Andy Clark",
        role: "philosophical synthesizer",
        reason: "Made predictive processing a broad theory of mind, perception, and action.",
        texts: ["Surfing Uncertainty"],
      },
      {
        name: "Anil Seth",
        role: "consciousness researcher",
        reason: "Frames conscious experience as controlled hallucination constrained by body and world.",
        texts: ["Being You"],
      },
    ],
    objections: [
      "It can become too general if every phenomenon is described as prediction error.",
      "The relation between prediction and phenomenal feel needs more precision.",
      "Some accounts risk underplaying direct environmental coupling.",
    ],
    relatedGroupIds: ["functionalism", "global-workspace", "enactivism"],
    keywords: ["prediction", "free energy", "perception", "active inference", "model"],
  },
  {
    id: "enactivism",
    title: "Enactivism and embodied cognition",
    shortTitle: "Enactivism",
    family: "World-involving",
    stance: "Consciousness arises through embodied action, organism-environment coupling, and lived sense-making.",
    centralClaim: "Mind is not sealed inside the head; it is enacted through body, world, and practice.",
    whyItMatters: "This frame pushes against brain-only theories and makes perception, action, and world-structure central.",
    contributors: [
      {
        name: "Francisco Varela",
        role: "enactive founder",
        reason: "Co-developed enactivism and connected cognition to autopoiesis, embodiment, and lived experience.",
        texts: ["The Embodied Mind"],
      },
      {
        name: "Evan Thompson",
        role: "phenomenology bridge",
        reason: "Linked cognitive science with phenomenology, life, and embodied mind.",
        texts: ["Mind in Life"],
      },
      {
        name: "Alva Noe",
        role: "sensorimotor theorist",
        reason: "Argued that perception is something organisms do, not a picture built inside the brain.",
        texts: ["Action in Perception"],
      },
      {
        name: "Shaun Gallagher",
        role: "embodied self theorist",
        reason: "Developed embodied and interactional accounts of self, agency, and social cognition.",
        texts: ["How the Body Shapes the Mind"],
      },
    ],
    objections: [
      "It can be harder to formalize than computational theories.",
      "Critics ask what internal neural mechanisms are doing if mind is world-involving.",
      "Some versions blur explanation with phenomenological description.",
    ],
    relatedGroupIds: ["predictive-processing", "idealism", "functionalism"],
    keywords: ["embodiment", "action", "phenomenology", "world", "sense-making"],
  },
];

const consciousnessRelations: AtlasRelation[] = [
  {
    source: "physicalism",
    target: "dualism",
    kind: "opposes",
    note: "They disagree on whether consciousness requires a nonphysical or irreducible ingredient.",
  },
  {
    source: "dualism",
    target: "idealism",
    kind: "neighbors",
    note: "Both resist simple matter-first reduction, but idealism makes mind more primary.",
  },
  {
    source: "idealism",
    target: "panpsychism",
    kind: "neighbors",
    note: "Both make mentality basic, but panpsychism distributes it through nature.",
  },
  {
    source: "panpsychism",
    target: "integrated-information",
    kind: "borrows",
    note: "IIT can look panpsychist when integrated causal structure appears in many systems.",
  },
  {
    source: "physicalism",
    target: "functionalism",
    kind: "answers",
    note: "Functionalism gives physicalists a way to describe mental states without tying them to one material.",
  },
  {
    source: "functionalism",
    target: "global-workspace",
    kind: "answers",
    note: "Global workspace is a concrete cognitive architecture for conscious access.",
  },
  {
    source: "global-workspace",
    target: "higher-order",
    kind: "neighbors",
    note: "Both connect consciousness to access, report, and representation of mental states.",
  },
  {
    source: "global-workspace",
    target: "predictive-processing",
    kind: "reframes",
    note: "Predictive models can supply the contents that a workspace broadcasts.",
  },
  {
    source: "predictive-processing",
    target: "enactivism",
    kind: "neighbors",
    note: "Both emphasize action and organism-world coupling, with different formalisms.",
  },
  {
    source: "higher-order",
    target: "physicalism",
    kind: "answers",
    note: "Higher-order theories offer physicalists a mechanism for why some states become conscious.",
  },
];

const queuedMap = (id: string, title: string, subtitle: string, question: string): AtlasMap => ({
  id,
  title,
  subtitle,
  question,
  summary: "Queued for the model-assisted pipeline. The public shell is ready; the actual map needs source ingest, clustering, review, and publish.",
  status: "queued",
  buildMode: "pipeline-ready",
  groups: [],
  relations: [],
});

export const atlasMapsData: AtlasMapsData = {
  updatedAt: "2026-07-03",
  territories: [
    {
      id: "stem",
      title: "STEM",
      summary: "Science, mathematics, engineering, cognition, computation, and the structures used to explain the world.",
      branches: [
        {
          id: "mind-consciousness",
          title: "Mind and consciousness",
          summary: "Maps for consciousness theories, cognitive architectures, perception, selfhood, and mind-body debates.",
          maps: [
            {
              id: "consciousness-theories",
              title: "Consciousness theories",
              subtitle: "A first full map: families of theories, what each claims, who built them, and where they fight.",
              question: "What kind of thing is consciousness, and what has to be explained?",
              summary: "This map organizes the major consciousness theory families by explanatory stance instead of by chronology. It is built to be expanded from pipeline sources later.",
              status: "live",
              buildMode: "seeded",
              groups: consciousnessGroups,
              relations: consciousnessRelations,
            },
          ],
        },
        {
          id: "scientists",
          title: "Scientists",
          summary: "Lineages of scientific contribution: fields, problems, methods, instruments, and influence chains.",
          maps: [
            queuedMap(
              "scientific-lineages",
              "Scientific lineages",
              "A branching map of scientists by field, problem, method, and intellectual descendants.",
              "Who changed what humans can measure, explain, or build?"
            ),
          ],
        },
        {
          id: "mathematics",
          title: "Mathematics",
          summary: "Mathematicians, schools, proof styles, objects, and transfers into science and computation.",
          maps: [
            queuedMap(
              "mathematical-styles",
              "Mathematical styles",
              "Geometry, algebra, analysis, probability, computation, and the people who made each style usable.",
              "What kinds of mathematical seeing exist?"
            ),
          ],
        },
        {
          id: "systems-engineering",
          title: "Systems and engineering",
          summary: "Machines, protocols, design principles, infrastructure, cybernetics, and applied systems thinking.",
          maps: [
            queuedMap(
              "systems-design",
              "Systems design",
              "Control, feedback, networks, reliability, interfaces, and the engineers who shaped the patterns.",
              "How do humans make complex things keep working?"
            ),
          ],
        },
      ],
    },
    {
      id: "humanities",
      title: "Humanities",
      summary: "Philosophy, history, language, religion, literature, criticism, and interpretation across eras.",
      branches: [
        {
          id: "philosophy",
          title: "Philosophy",
          summary: "Metaphysics, ethics, epistemology, aesthetics, political philosophy, and schools of thought.",
          maps: [
            queuedMap(
              "metaphysics-families",
              "Metaphysics families",
              "Materialism, idealism, dualism, process thought, pragmatism, existentialism, and adjacent lineages.",
              "What does each tradition think reality is made of?"
            ),
          ],
        },
        {
          id: "literature",
          title: "Literature",
          summary: "Movements, forms, genres, authors, periods, and transmission across cultures.",
          maps: [
            queuedMap(
              "literary-movements",
              "Literary movements",
              "A map of forms, schools, authors, and the problems each movement tried to solve.",
              "How do literary forms evolve?"
            ),
          ],
        },
      ],
    },
    {
      id: "arts",
      title: "Arts",
      summary: "Music, visual art, film, performance, design, craft, genres, scenes, and influence networks.",
      branches: [
        {
          id: "music",
          title: "Music",
          summary: "Scenes, genres, producers, players, technology, theory, and cultural transfer.",
          maps: [
            queuedMap(
              "music-lineages",
              "Music lineages",
              "Genres as branching families: instruments, scenes, recording technology, and cross-pollination.",
              "How does sound become a tradition?"
            ),
          ],
        },
        {
          id: "visual-art",
          title: "Visual art",
          summary: "Movements, schools, media, patrons, image technologies, and formal problems.",
          maps: [
            queuedMap(
              "visual-art-movements",
              "Visual art movements",
              "A route through image-making by period, method, material, and philosophical pressure.",
              "What changes when artists change how seeing works?"
            ),
          ],
        },
      ],
    },
    {
      id: "society",
      title: "Society",
      summary: "Politics, economics, institutions, law, technology adoption, media, and social organization.",
      branches: [
        {
          id: "political-forms",
          title: "Political forms",
          summary: "States, regimes, legal systems, institutions, movements, and theories of power.",
          maps: [
            queuedMap(
              "political-orders",
              "Political orders",
              "Democracy, monarchy, republics, empire, bureaucracy, markets, and movements as institutional families.",
              "How do groups stabilize power?"
            ),
          ],
        },
        {
          id: "economics",
          title: "Economics",
          summary: "Schools, models, crises, institutions, measures, policy regimes, and tradeoffs.",
          maps: [
            queuedMap(
              "economic-schools",
              "Economic schools",
              "Classical, neoclassical, Keynesian, Austrian, Marxian, institutional, behavioral, and complexity economics.",
              "What does each school think economies are?"
            ),
          ],
        },
      ],
    },
  ],
};

export function getAtlasMaps() {
  return atlasMapsData;
}
