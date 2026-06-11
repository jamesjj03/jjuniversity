export type PrimaryCategory = {
  name: string;
  description: string;
  tags: string[];
};

export const PRIMARY_CATEGORIES: PrimaryCategory[] = [
  {
    name: "History",
    description: "Empires, revolutions, eras, and the long memory of civilization.",
    tags: [
      "American History",
      "European History",
      "British History",
      "French History",
      "Russian History",
      "Chinese History",
      "Middle Eastern History",
      "African History",
      "Asian History",
      "Ancient Civilizations",
      "Ancient Egypt",
      "Ancient Greece",
      "Ancient Rome",
      "Medieval History",
      "Renaissance",
      "Victorian Era",
      "19th Century",
      "20th Century",
      "Cold War",
      "Vietnam War",
      "World War I",
      "World War II",
      "Slavery & Abolition",
      "Biography",
    ],
  },
  {
    name: "Religion",
    description: "Scripture, belief, mysticism, mythology, and spiritual systems.",
    tags: [
      "Christianity",
      "Islam",
      "Buddhism",
      "World Religions",
      "Eastern Philosophy & Religion",
      "Religion & Spirituality",
      "Spirituality & Mysticism",
      "Mythology & Ancient Beliefs",
      "Cults & Extremism",
    ],
  },
  {
    name: "Science",
    description: "Physics, bodies, brains, space, medicine, and discovery.",
    tags: [
      "Physics & Cosmology",
      "Biology & Medicine",
      "Science & Mathematics",
      "Science History",
      "Cognitive Science & Neuroscience",
      "Environmental Issues",
      "Space Exploration",
      "Technology & Innovation",
      "Public Health",
    ],
  },
  {
    name: "Power",
    description: "States, control, intelligence, empire, propaganda, and systems.",
    tags: [
      "Government & Politics",
      "American Politics",
      "American Presidents",
      "Political Theory",
      "Political Economy",
      "Espionage & Intelligence",
      "Authoritarianism & Dictatorship",
      "Propaganda & Social Control",
      "Colonialism & Empire",
      "Capitalism & Corporations",
      "Revolution & Social Change",
      "Conspiracy & Cover-ups",
      "Cults & Extremism",
    ],
  },
  {
    name: "Culture",
    description: "Art, music, food, media, identity, movements, and everyday life.",
    tags: [
      "Cultural History",
      "Consumer Culture",
      "Art & Music History",
      "Food & Culture",
      "Digital Culture & Technology",
      "Social Movements",
      "Civil Rights & Social Justice",
    ],
  },
  {
    name: "Human Nature",
    description: "Behavior, addiction, belief, status, trauma, and the self.",
    tags: [
      "Psychology & Human Behavior",
      "Addiction & Substance Use",
      "Cognitive Science & Neuroscience",
      "Philosophy",
      "Sociology",
      "Biography",
    ],
  },
  {
    name: "Technology",
    description: "Innovation, platforms, machines, media, and engineered futures.",
    tags: [
      "Technology & Innovation",
      "Digital Culture & Technology",
      "Science History",
      "Capitalism & Corporations",
      "Consumer Culture",
      "Cognitive Science & Neuroscience",
      "Space Exploration",
    ],
  },
  {
    name: "Philosophy",
    description: "Ideas, ethics, consciousness, meaning, and the big arguments.",
    tags: [
      "Philosophy",
      "Political Theory",
      "Eastern Philosophy & Religion",
      "Spirituality & Mysticism",
      "Psychology & Human Behavior",
    ],
  },
  {
    name: "Economics",
    description: "Money, markets, corporations, incentives, and consumer life.",
    tags: [
      "Business & Economics",
      "Political Economy",
      "Capitalism & Corporations",
      "Consumer Culture",
      "Government & Politics",
    ],
  },
  {
    name: "War",
    description: "Conflict, militaries, revolutions, world wars, and aftermath.",
    tags: [
      "War & Conflict",
      "Military History",
      "World War I",
      "World War II",
      "Cold War",
      "Vietnam War",
      "Revolution & Social Change",
    ],
  },
];

export const TAG_TO_PRIMARY = PRIMARY_CATEGORIES.reduce<Record<string, string[]>>((acc, category) => {
  category.tags.forEach(tag => {
    acc[tag] = [...(acc[tag] || []), category.name];
  });
  return acc;
}, {});
