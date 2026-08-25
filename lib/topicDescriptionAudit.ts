export type TopicDescriptionBookInput = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  coverSrc: string;
  fallbackCoverSrc: string;
  topics: string[];
};

export type TopicHealth = "empty" | "single" | "tiny" | "broad" | "healthy";

export type TopicAuditItem = {
  name: string;
  bookIds: string[];
  count: number;
  health: TopicHealth;
};

export type SimilarTopicPair = {
  left: string;
  right: string;
  similarity: number;
};

export type DescriptionAuditFlag = "from-to" | "repeated-opening" | "how-opening" | "grammar";

export type DescriptionAuditBook = TopicDescriptionBookInput & {
  descriptionFlags: DescriptionAuditFlag[];
  opening: string;
  descriptionLength: number;
};

export type TopicDescriptionAudit = {
  books: DescriptionAuditBook[];
  topics: TopicAuditItem[];
  similarTopicPairs: SimilarTopicPair[];
  exactDuplicateTopicLabels: string[][];
  exactDuplicateDescriptions: Array<{ description: string; bookIds: string[] }>;
  repeatedOpenings: Array<{ opening: string; bookIds: string[] }>;
  stats: {
    bookCount: number;
    topicCount: number;
    emptyTopics: number;
    singleBookTopics: number;
    tinyTopics: number;
    broadTopics: number;
    healthyTopics: number;
    booksByTopicCount: Record<string, number>;
    fromToDescriptions: number;
    cannedOpeningDescriptions: number;
    grammarDescriptions: number;
    flaggedDescriptions: number;
    shortDescriptions: number;
    longDescriptions: number;
  };
};

const DESCRIPTION_FROM_TO = /\bfrom\b[\s\S]{1,160}?\bto\b/i;
const DESCRIPTION_HOW_OPENING = /^How\b/i;
const DESCRIPTION_GRAMMAR = /^A (?:irreverent|exploration)\b/i;

export function buildTopicDescriptionAudit(
  books: TopicDescriptionBookInput[],
  approvedTopicLabels: readonly string[],
): TopicDescriptionAudit {
  const orderedBooks = [...books]
    .filter(book => book.id)
    .sort((left, right) => sortText(left.title, right.title) || sortText(left.id, right.id));
  const approvedTopics = [...new Set(approvedTopicLabels.map(label => label.trim()).filter(Boolean))]
    .sort(sortText);
  const topicAssignments = new Map(approvedTopics.map(topic => [topic, [] as string[]]));

  for (const book of orderedBooks) {
    for (const topic of new Set(book.topics)) {
      topicAssignments.get(topic)?.push(book.id);
    }
  }

  const broadThreshold = Math.max(40, Math.ceil(orderedBooks.length * 0.25));
  const topics = approvedTopics.map(name => {
    const bookIds = topicAssignments.get(name) || [];
    return {
      name,
      bookIds,
      count: bookIds.length,
      health: topicHealth(bookIds.length, broadThreshold),
    } satisfies TopicAuditItem;
  });

  const openingAssignments = new Map<string, string[]>();
  const exactDescriptionAssignments = new Map<string, string[]>();
  for (const book of orderedBooks) {
    const opening = firstWords(book.description, 3);
    if (opening) openingAssignments.set(opening, [...(openingAssignments.get(opening) || []), book.id]);
    const descriptionKey = normalizeDescription(book.description);
    if (descriptionKey) {
      exactDescriptionAssignments.set(descriptionKey, [...(exactDescriptionAssignments.get(descriptionKey) || []), book.id]);
    }
  }

  const repeatedOpenings = [...openingAssignments.entries()]
    .filter(([, bookIds]) => bookIds.length >= 3)
    .map(([opening, bookIds]) => ({ opening, bookIds }))
    .sort((left, right) => right.bookIds.length - left.bookIds.length || sortText(left.opening, right.opening));
  const repeatedOpeningSet = new Set(repeatedOpenings.map(item => item.opening));

  const auditedBooks = orderedBooks.map(book => {
    const opening = firstWords(book.description, 3);
    const descriptionFlags: DescriptionAuditFlag[] = [];
    if (DESCRIPTION_FROM_TO.test(book.description)) descriptionFlags.push("from-to");
    if (repeatedOpeningSet.has(opening)) descriptionFlags.push("repeated-opening");
    if (DESCRIPTION_HOW_OPENING.test(book.description)) descriptionFlags.push("how-opening");
    if (DESCRIPTION_GRAMMAR.test(book.description)) descriptionFlags.push("grammar");
    return {
      ...book,
      topics: [...new Set(book.topics)].sort(sortText),
      descriptionFlags,
      opening,
      descriptionLength: book.description.length,
    };
  });

  const exactDuplicateDescriptions = [...exactDescriptionAssignments.entries()]
    .filter(([, bookIds]) => bookIds.length > 1)
    .map(([description, bookIds]) => ({ description, bookIds }))
    .sort((left, right) => right.bookIds.length - left.bookIds.length || sortText(left.description, right.description));
  const exactDuplicateTopicLabels = normalizedDuplicateGroups(approvedTopics);
  const similarTopicPairs = lexicalTopicPairs(approvedTopics);
  const booksByTopicCount = auditedBooks.reduce<Record<string, number>>((counts, book) => {
    const key = String(book.topics.length);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  return {
    books: auditedBooks,
    topics,
    similarTopicPairs,
    exactDuplicateTopicLabels,
    exactDuplicateDescriptions,
    repeatedOpenings,
    stats: {
      bookCount: auditedBooks.length,
      topicCount: topics.length,
      emptyTopics: topics.filter(topic => topic.health === "empty").length,
      singleBookTopics: topics.filter(topic => topic.health === "single").length,
      tinyTopics: topics.filter(topic => topic.health === "tiny").length,
      broadTopics: topics.filter(topic => topic.health === "broad").length,
      healthyTopics: topics.filter(topic => topic.health === "healthy").length,
      booksByTopicCount,
      fromToDescriptions: auditedBooks.filter(book => book.descriptionFlags.includes("from-to")).length,
      cannedOpeningDescriptions: auditedBooks.filter(book => (
        book.descriptionFlags.includes("repeated-opening") || book.descriptionFlags.includes("how-opening")
      )).length,
      grammarDescriptions: auditedBooks.filter(book => book.descriptionFlags.includes("grammar")).length,
      flaggedDescriptions: auditedBooks.filter(book => book.descriptionFlags.length > 0).length,
      shortDescriptions: auditedBooks.filter(book => book.descriptionLength < 100).length,
      longDescriptions: auditedBooks.filter(book => book.descriptionLength > 220).length,
    },
  };
}

function topicHealth(count: number, broadThreshold: number): TopicHealth {
  if (count === 0) return "empty";
  if (count === 1) return "single";
  if (count <= 4) return "tiny";
  if (count > broadThreshold) return "broad";
  return "healthy";
}

function normalizedDuplicateGroups(labels: string[]) {
  const groups = new Map<string, string[]>();
  for (const label of labels) {
    const key = normalizeLabel(label);
    groups.set(key, [...(groups.get(key) || []), label]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

function lexicalTopicPairs(labels: string[]) {
  const pairs: SimilarTopicPair[] = [];
  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
      const left = labels[leftIndex];
      const right = labels[rightIndex];
      const normalizedLeft = normalizeLabel(left);
      const normalizedRight = normalizeLabel(right);
      const similarity = 1 - levenshtein(normalizedLeft, normalizedRight) / Math.max(normalizedLeft.length, normalizedRight.length, 1);
      if (similarity >= 0.8 && normalizedLeft !== normalizedRight) {
        pairs.push({ left, right, similarity: Number(similarity.toFixed(3)) });
      }
    }
  }
  return pairs.sort((left, right) => right.similarity - left.similarity || sortText(left.left, right.left));
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function normalizeDescription(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstWords(value: string, count: number) {
  return (value.toLocaleLowerCase("en").match(/[a-z0-9]+(?:['’][a-z0-9]+)?/g) || [])
    .slice(0, count)
    .join(" ");
}

function sortText(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}
