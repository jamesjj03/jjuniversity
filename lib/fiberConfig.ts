export type FiberPlan = {
  id: string;
  name: string;
  speed: string;
  price: number;
  badge: string;
  details: string;
};

export type FiberAddon = {
  id?: string;
  enabled: boolean;
  selectedByDefault: boolean;
  name: string;
  price: number;
  description: string;
  promoNote?: string;
  freeMonths?: number[];
  channels?: string[];
};

export type FiberReward = {
  enabled: boolean;
  selectedByDefault: boolean;
  name: string;
  amount: number;
  description: string;
};

export type FiberProviderAddon = FiberAddon & {
  id: string;
};

export type FiberPromo = {
  enabled: boolean;
  name: string;
  description: string;
  freeMonths: number[];
  planIds: string[];
  appliesToBaseOnly: boolean;
};

export type FiberProvider = {
  id: string;
  name: string;
  badge: string;
  serviceLabel: string;
  planHeading: string;
  summaryLabel: string;
  primaryPlanId: string;
  plans: FiberPlan[];
  addons: FiberProviderAddon[];
  reward: FiberReward;
  promo: FiberPromo;
};

export type FiberFaq = {
  question: string;
  answer: string;
};

export type FiberImageCard = {
  title: string;
  imageUrl: string;
  body: string;
};

export type FiberLink = {
  label: string;
  url: string;
  note: string;
};

export type FiberConfig = {
  theme: {
    accent: string;
    accent2: string;
    frontier: string;
    ink: string;
    font: string;
  };
  sections: {
    hero: boolean;
    quote: boolean;
    explanation: boolean;
    process: boolean;
    signup: boolean;
    speedTest: boolean;
    comparisonImages: boolean;
    faq: boolean;
    contact: boolean;
  };
  hero: {
    kicker: string;
    headline: string;
    body: string;
    jjuNote: string;
    photoUrl: string;
    photoAlt: string;
    cardNote: string;
  };
  contact: {
    phoneLabel: string;
    phoneHref: string;
    email: string;
    textBody: string;
  };
  quote: {
    eyebrow: string;
    title: string;
    currentBillDefault: number;
    currentBillPresets: number[];
    defaultProviderId: string;
    primaryPlanId: string;
    plans: FiberPlan[];
    modem: FiberAddon;
    youtubeTv: FiberAddon;
    mastercard: FiberReward;
    providers: FiberProvider[];
    disclaimer: string;
  };
  explanation: {
    title: string;
    bullets: string[];
  };
  process: {
    title: string;
    steps: string[];
  };
  signup: {
    title: string;
    body: string;
    requiredInfo: string[];
    verificationNote: string;
  };
  speedTest: {
    title: string;
    body: string;
    links: FiberLink[];
  };
  comparisonImages: {
    title: string;
    body: string;
    cards: FiberImageCard[];
  };
  faq: {
    title: string;
    items: FiberFaq[];
  };
};

export const DEFAULT_FIBER_CONFIG: FiberConfig = {
  theme: {
    accent: "#1aa260",
    accent2: "#f4f7f2",
    frontier: "#d9272e",
    ink: "#07120f",
    font: "Segoe UI Variable Text, Segoe UI, Inter, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  sections: {
    hero: true,
    quote: true,
    explanation: true,
    process: true,
    signup: true,
    speedTest: true,
    comparisonImages: false,
    faq: true,
    contact: true,
  },
  hero: {
    kicker: "JJ University",
    headline: "Hey, I'm JJ",
    body: "I'm a local fiber rep helping people compare their current internet bill with Kinetic and Frontier fiber.",
    jjuNote: "Also, yes. This little thing lives inside JJ University, my book site.",
    photoUrl: "/fiber/jj.JPG",
    photoAlt: "JJ, local fiber rep",
    cardNote: "",
  },
  contact: {
    phoneLabel: "937-397-7710",
    phoneHref: "19373977710",
    email: "jamesjj0381@gmail.com",
    textBody: "Hey JJ, can you help me compare my current internet with fiber?",
  },
  quote: {
    eyebrow: "Fiber quote builder",
    title: "Compare your bill in 30 seconds.",
    currentBillDefault: 100,
    currentBillPresets: [80, 100, 120],
    defaultProviderId: "frontier",
    primaryPlanId: "fiber-1g",
    plans: [
      {
        id: "fiber-300",
        name: "Fiber 300",
        speed: "300 Mbps",
        price: 34.99,
        badge: "Starter",
        details: "Good internet everyday for browsing, streaming, email, and smaller homes.",
      },
      {
        id: "fiber-1g",
        name: "Fiber 1 Gig",
        speed: "1 Gig",
        price: 39.99,
        badge: "Best value",
        details: "The usual best fit for streaming, gaming, work, and homes with multiple devices.",
      },
      {
        id: "fiber-2g",
        name: "Fiber 2 Gig",
        speed: "2 Gig",
        price: 59.99,
        badge: "Ultra fast",
        details: "Built for heavier households with a lot of devices running at once.",
      },
      {
        id: "fiber-2g-max",
        name: "Fiber 2 Gig Max",
        speed: "2 Gig Max",
        price: 79.99,
        badge: "Whole-home setup",
        details: "Includes two extenders and an upgraded Wi-Fi setup.",
      },
    ],
    modem: {
      enabled: true,
      selectedByDefault: true,
      name: "Standard modem rental",
      price: 10.99,
      description: "Defaulted on so the quote reflects the real monthly.",
    },
    youtubeTv: {
      enabled: true,
      selectedByDefault: false,
      name: "YouTube TV",
      price: 82.99,
      description: "Live TV without the cable box.",
      channels: ["ABC", "CBS", "NBC", "FOX", "ESPN", "NFL", "TNT", "TBS", "FX", "CNN", "HGTV", "Food"],
    },
    mastercard: {
      enabled: true,
      selectedByDefault: true,
      name: "$100 Mastercard",
      amount: 100,
      description: "Received after 90 days. Tap this to use the promo on months four and five.",
    },
    providers: [
      {
        id: "frontier",
        name: "Frontier",
        badge: "",
        serviceLabel: "Frontier fiber",
        planHeading: "Frontier plan",
        summaryLabel: "Frontier",
        primaryPlanId: "frontier-1g",
        plans: [
          {
            id: "frontier-500",
            name: "Frontier Fiber 500",
            speed: "500 Mbps",
            price: 34.99,
            badge: "Starter",
            details: "Plenty for everyday streaming, browsing, school, work calls, and normal home Wi-Fi.",
          },
          {
            id: "frontier-1g",
            name: "Frontier Fiber 1 Gig",
            speed: "1 Gig",
            price: 49.99,
            badge: "Best fit",
            details: "The default recommendation for homes with streaming, gaming, work, and a lot of devices.",
          },
          {
            id: "frontier-2g",
            name: "Frontier Fiber 2 Gig",
            speed: "2 Gig",
            price: 64.99,
            badge: "Heavy home",
            details: "Extra headroom for larger households, heavier gaming, and more devices running at once.",
          },
          {
            id: "frontier-5g",
            name: "Frontier Fiber 5 Gig",
            speed: "5 Gig",
            price: 89.99,
            badge: "Power user",
            details: "A high-capacity plan for serious speed needs, advanced setups, or very busy homes.",
          },
          {
            id: "frontier-7g",
            name: "Frontier Fiber 7 Gig",
            speed: "7 Gig",
            price: 109.99,
            badge: "Max speed",
            details: "The top-end Frontier option for homes that want the fastest available tier.",
          },
        ],
        addons: [
          {
            id: "extender",
            enabled: true,
            selectedByDefault: false,
            name: "Wi-Fi extender",
            price: 10,
            description: "Optional Frontier extender for homes that need stronger coverage farther from the router.",
            promoNote: "one month free",
            freeMonths: [1],
          },
          {
            id: "landline",
            enabled: true,
            selectedByDefault: false,
            name: "Landline phone",
            price: 25,
            description: "Optional home phone line added to the monthly bill.",
          },
          {
            id: "youtube-tv",
            enabled: true,
            selectedByDefault: false,
            name: "YouTube TV",
            price: 82.99,
            description: "Live TV without the cable box.",
            channels: ["ABC", "CBS", "NBC", "FOX", "ESPN", "NFL", "TNT", "TBS", "FX", "CNN", "HGTV", "Food"],
          },
        ],
        reward: {
          enabled: true,
          selectedByDefault: true,
          name: "$100 Visa reward card",
          amount: 100,
          description: "Received after 90 days. The quote applies it across months four and five.",
        },
        promo: {
          enabled: true,
          name: "Two free internet months",
          description: "Frontier 500 Mbps and 1 Gig show months one and two with the base internet charge waived. Add-ons still show as monthly charges.",
          freeMonths: [1, 2],
          planIds: ["frontier-500", "frontier-1g"],
          appliesToBaseOnly: true,
        },
      },
      {
        id: "kinetic",
        name: "Kinetic",
        badge: "",
        serviceLabel: "Kinetic fiber",
        planHeading: "Kinetic plan",
        summaryLabel: "Kinetic",
        primaryPlanId: "fiber-1g",
        plans: [
          {
            id: "fiber-300",
            name: "Fiber 300",
            speed: "300 Mbps",
            price: 34.99,
            badge: "Starter",
            details: "Good internet everyday for browsing, streaming, email, and smaller homes.",
          },
          {
            id: "fiber-1g",
            name: "Fiber 1 Gig",
            speed: "1 Gig",
            price: 39.99,
            badge: "Best value",
            details: "The usual best fit for streaming, gaming, work, and homes with multiple devices.",
          },
          {
            id: "fiber-2g",
            name: "Fiber 2 Gig",
            speed: "2 Gig",
            price: 59.99,
            badge: "Ultra fast",
            details: "Built for heavier households with a lot of devices running at once.",
          },
          {
            id: "fiber-2g-max",
            name: "Fiber 2 Gig Max",
            speed: "2 Gig Max",
            price: 79.99,
            badge: "Whole-home setup",
            details: "Includes two extenders and an upgraded Wi-Fi setup.",
          },
        ],
        addons: [
          {
            id: "modem",
            enabled: true,
            selectedByDefault: true,
            name: "Standard modem rental",
            price: 10.99,
            description: "Defaulted on so the quote reflects the real monthly.",
          },
          {
            id: "landline",
            enabled: true,
            selectedByDefault: false,
            name: "Landline phone",
            price: 25,
            description: "Optional home phone line added to the monthly bill.",
          },
          {
            id: "youtube-tv",
            enabled: true,
            selectedByDefault: false,
            name: "YouTube TV",
            price: 82.99,
            description: "Live TV without the cable box.",
            channels: ["ABC", "CBS", "NBC", "FOX", "ESPN", "NFL", "TNT", "TBS", "FX", "CNN", "HGTV", "Food"],
          },
        ],
        reward: {
          enabled: true,
          selectedByDefault: true,
          name: "$100 Mastercard",
          amount: 100,
          description: "Received after 90 days. The quote applies it across months four and five.",
        },
        promo: {
          enabled: false,
          name: "",
          description: "",
          freeMonths: [],
          planIds: [],
          appliesToBaseOnly: true,
        },
      },
    ],
    disclaimer: "Estimate only. Final details will still need to be confirmed.",
  },
  explanation: {
    title: "Why Fiber Feels Different",
    bullets: [
      "Your uploads get stronger for photos, files, camera feeds, and work calls.",
      "Your connection is usually more reliable than older coax/cable lines.",
      "Your phones, TVs, tablets, consoles, and laptops can all breathe more.",
      "Your gaming, video calls, and streaming should feel smoother.",
      "Your speed is less likely to sag during busy neighborhood hours.",
    ],
  },
  process: {
    title: "How your switch usually works",
    steps: [
      "You pick an install day.",
      "A technician installs your fiber line.",
      "You try it out for the first month.",
      "You keep it if you like it.",
      "You cancel the old service after fiber works.",
      "You text JJ if anything gets confusing.",
    ],
  },
  signup: {
    title: "What I need if you want to sign up",
    body: "Nothing weird. You give me the basics, then we do the verification steps and pick an install date before finalizing the order. ",
    requiredInfo: ["First name", "Last name", "Phone number", "Email", "Date of birth"],
    verificationNote: "At sign up, I send a code to both your phone and email for verification. You can set up autopay through the link you receive or later in the app.",
  },
  speedTest: {
    title: "Want to check the current speed first?",
    body: "Run a speed test from where you normally use Wi-Fi.",
    links: [
      { label: "Ookla Speedtest", url: "https://www.speedtest.net/", note: "Good quick screenshot for download, upload, and ping." },
      { label: "Fast.com", url: "https://fast.com/", note: "Simple streaming-focused check." },
    ],
  },
  comparisonImages: {
    title: "Coax vs fiber examples",
    body: "Optional visual proof area for screenshots or diagrams. Keep hidden until the images are ready.",
    cards: [
      { title: "Cable speed test", imageUrl: "", body: "Upload a current cable/coax speed-test screenshot." },
      { title: "Fiber speed test", imageUrl: "", body: "Upload a fiber speed-test screenshot or install result." },
    ],
  },
  faq: {
    title: "Normal questions before switching",
    items: [
      {
        question: "Do I need to cancel Spectrum/Xfinity first?",
        answer: "Not at all. The cleanest move is to get fiber installed, make sure it works in you, then cancel the old service after that.",
      },
      {
        question: "What happens to my TV or phone bundle?",
        answer: "We should look at the bundle before changing anything. Some people keep TV separate, some move to YouTube TV, and some only switch internet.",
      },
      {
        question: "Is there a contract?",
        answer: "It's unlikely to have a contract, especially if you're coming from Spectrum, but we can confirm the current terms first.",
      },
      {
        question: "Do I pay anything today?",
        answer: "There's no money due at sign-up. Your first bill doesn't come until at least 30 days after installation, depending on your plan.",
      },
      {
        question: "What if I don't like it?",
        answer: "Try it for the first month, test your normal Wi-Fi spots, and keep the old service until you know fiber works for your home.",
      },
      {
        question: "How long does installation take?",
        answer: "Most installs are handled in ~1-3 hours, but timing depends on the home, the fiber drop, and technician availability.",
      },
      {
        question: "Can I talk it over with my spouse first?",
        answer: "Of course. Check out your current bill or run a speed test, compare the numbers, and come back to it when you're both ready.",
      },
      {
        question: "What info is needed to sign up?",
        answer: "First name, last name, phone number, email, and date of birth. Phone and email both need verification codes during sign up.",
      },
      {
        question: "Can I text JJ later?",
        answer: "Absolutely. Text your current bill, a speed test, or any questions you have and JJ can help you compare it without standing at the door.",
      },
      {
        question: "What's the difference between fiber and cable?",
        answer: "Fiber uses a newer direct fiber line with stronger upload speeds and less shared-neighborhood slowdown than traditional coax cable.",
      },
    ],
  },
};

export function normalizeFiberConfig(value: Partial<FiberConfig> | null | undefined): FiberConfig {
  const source = (value && typeof value === "object" ? value : {}) as Partial<FiberConfig>;
  const quote = (source.quote || {}) as Partial<FiberConfig["quote"]>;
  const contact = (source.contact || {}) as Partial<FiberConfig["contact"]>;

  return {
    theme: {
      ...DEFAULT_FIBER_CONFIG.theme,
      ...(source.theme || {}),
    },
    sections: {
      ...DEFAULT_FIBER_CONFIG.sections,
      ...(source.sections || {}),
    },
    hero: {
      ...DEFAULT_FIBER_CONFIG.hero,
      ...(source.hero || {}),
    },
    contact: {
      ...DEFAULT_FIBER_CONFIG.contact,
      ...contact,
      phoneHref: normalizePhoneHref(contact.phoneHref || contact.phoneLabel || DEFAULT_FIBER_CONFIG.contact.phoneHref),
    },
    quote: {
      ...DEFAULT_FIBER_CONFIG.quote,
      ...quote,
      currentBillDefault: numberOrDefault(quote.currentBillDefault, DEFAULT_FIBER_CONFIG.quote.currentBillDefault),
      currentBillPresets: normalizeNumberList(quote.currentBillPresets, DEFAULT_FIBER_CONFIG.quote.currentBillPresets),
      defaultProviderId: String(quote.defaultProviderId || DEFAULT_FIBER_CONFIG.quote.defaultProviderId).trim(),
      plans: normalizePlans(quote.plans),
      modem: normalizeAddon(quote.modem, DEFAULT_FIBER_CONFIG.quote.modem),
      youtubeTv: normalizeAddon(quote.youtubeTv, DEFAULT_FIBER_CONFIG.quote.youtubeTv),
      mastercard: normalizeReward(quote.mastercard, DEFAULT_FIBER_CONFIG.quote.mastercard),
      providers: normalizeProviders(quote.providers),
    },
    explanation: {
      ...DEFAULT_FIBER_CONFIG.explanation,
      ...(source.explanation || {}),
      bullets: normalizeStringList(source.explanation?.bullets, DEFAULT_FIBER_CONFIG.explanation.bullets),
    },
    process: {
      ...DEFAULT_FIBER_CONFIG.process,
      ...(source.process || {}),
      steps: normalizeStringList(source.process?.steps, DEFAULT_FIBER_CONFIG.process.steps),
    },
    signup: {
      ...DEFAULT_FIBER_CONFIG.signup,
      ...(source.signup || {}),
      requiredInfo: normalizeStringList(source.signup?.requiredInfo, DEFAULT_FIBER_CONFIG.signup.requiredInfo),
    },
    speedTest: {
      ...DEFAULT_FIBER_CONFIG.speedTest,
      ...(source.speedTest || {}),
      links: normalizeLinks(source.speedTest?.links),
    },
    comparisonImages: {
      ...DEFAULT_FIBER_CONFIG.comparisonImages,
      ...(source.comparisonImages || {}),
      cards: normalizeImageCards(source.comparisonImages?.cards),
    },
    faq: {
      ...DEFAULT_FIBER_CONFIG.faq,
      ...(source.faq || {}),
      items: normalizeFaqs(source.faq?.items),
    },
  };
}

function normalizePlans(plans: unknown): FiberPlan[] {
  const list = Array.isArray(plans) ? plans : DEFAULT_FIBER_CONFIG.quote.plans;
  const normalized = list.map((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<FiberPlan> : {};
    const fallback = DEFAULT_FIBER_CONFIG.quote.plans[index] || DEFAULT_FIBER_CONFIG.quote.plans[0];
    return {
      id: String(record.id || fallback.id).trim() || fallback.id,
      name: String(record.name || fallback.name).trim(),
      speed: String(record.speed || fallback.speed).trim(),
      price: numberOrDefault(record.price, fallback.price),
      badge: String(record.badge || fallback.badge).trim(),
      details: String(record.details || fallback.details).trim(),
    };
  }).filter(plan => plan.id && plan.name);

  return normalized.length ? normalized : DEFAULT_FIBER_CONFIG.quote.plans;
}

function normalizeAddon(addon: unknown, fallback: FiberAddon): FiberAddon {
  const record = addon && typeof addon === "object" ? addon as Partial<FiberAddon> : {};
  return {
    id: record.id ? String(record.id).trim() : fallback.id,
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    selectedByDefault: typeof record.selectedByDefault === "boolean" ? record.selectedByDefault : fallback.selectedByDefault,
    name: String(record.name || fallback.name).trim(),
    price: numberOrDefault(record.price, fallback.price),
    description: String(record.description || fallback.description).trim(),
    promoNote: record.promoNote === undefined ? fallback.promoNote : String(record.promoNote || "").trim(),
    freeMonths: normalizeNumberList(record.freeMonths, fallback.freeMonths || []),
    channels: Array.isArray(record.channels) ? record.channels.map(String).filter(Boolean) : fallback.channels,
  };
}

function normalizeProviderAddon(addon: unknown, fallback: FiberProviderAddon, index: number): FiberProviderAddon {
  const normalized = normalizeAddon(addon, fallback);
  return {
    ...normalized,
    id: String(normalized.id || fallback.id || `addon-${index + 1}`).trim(),
  };
}

function normalizeReward(reward: unknown, fallback: FiberReward): FiberReward {
  const record = reward && typeof reward === "object" ? reward as Partial<FiberReward> : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    selectedByDefault: typeof record.selectedByDefault === "boolean" ? record.selectedByDefault : fallback.selectedByDefault,
    name: String(record.name || fallback.name).trim(),
    amount: numberOrDefault(record.amount, fallback.amount),
    description: String(record.description || fallback.description).trim(),
  };
}

function normalizeFaqs(items: unknown): FiberFaq[] {
  const list = Array.isArray(items) ? items : DEFAULT_FIBER_CONFIG.faq.items;
  return list.map((item) => {
    const record = item && typeof item === "object" ? item as Partial<FiberFaq> : {};
    return {
      question: String(record.question || "").trim(),
      answer: String(record.answer || "").trim(),
    };
  }).filter(item => item.question && item.answer);
}

function normalizeLinks(items: unknown): FiberLink[] {
  const list = Array.isArray(items) ? items : DEFAULT_FIBER_CONFIG.speedTest.links;
  return list.map((item) => {
    const record = item && typeof item === "object" ? item as Partial<FiberLink> : {};
    return {
      label: String(record.label || "").trim(),
      url: String(record.url || "").trim(),
      note: String(record.note || "").trim(),
    };
  }).filter(item => item.label && item.url);
}

function normalizeProviders(providers: unknown): FiberProvider[] {
  const list = Array.isArray(providers) ? providers : DEFAULT_FIBER_CONFIG.quote.providers;
  const normalized = list.map((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<FiberProvider> : {};
    const fallback = DEFAULT_FIBER_CONFIG.quote.providers[index] || DEFAULT_FIBER_CONFIG.quote.providers[0];
    const plans = normalizePlanList(record.plans, fallback.plans);
    const addons = normalizeProviderAddons(record.addons, fallback.addons);

    return {
      id: String(record.id || fallback.id).trim() || fallback.id,
      name: String(record.name || fallback.name).trim(),
      badge: String(record.badge || fallback.badge).trim(),
      serviceLabel: String(record.serviceLabel || fallback.serviceLabel).trim(),
      planHeading: String(record.planHeading || fallback.planHeading).trim(),
      summaryLabel: String(record.summaryLabel || fallback.summaryLabel).trim(),
      primaryPlanId: String(record.primaryPlanId || fallback.primaryPlanId || plans[0]?.id || "").trim(),
      plans,
      addons,
      reward: normalizeReward(record.reward, fallback.reward),
      promo: normalizePromo(record.promo, fallback.promo),
    };
  }).filter(provider => provider.id && provider.name && provider.plans.length);

  return normalized.length ? normalized : DEFAULT_FIBER_CONFIG.quote.providers;
}

function normalizePlanList(plans: unknown, fallbackPlans: FiberPlan[]): FiberPlan[] {
  const list = Array.isArray(plans) ? plans : fallbackPlans;
  const normalized = list.map((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<FiberPlan> : {};
    const fallback = fallbackPlans[index] || fallbackPlans[0] || DEFAULT_FIBER_CONFIG.quote.plans[0];
    return {
      id: String(record.id || fallback.id).trim() || fallback.id,
      name: String(record.name || fallback.name).trim(),
      speed: String(record.speed || fallback.speed).trim(),
      price: numberOrDefault(record.price, fallback.price),
      badge: String(record.badge || fallback.badge).trim(),
      details: String(record.details || fallback.details).trim(),
    };
  }).filter(plan => plan.id && plan.name);

  return normalized.length ? normalized : fallbackPlans;
}

function normalizeProviderAddons(addons: unknown, fallbackAddons: FiberProviderAddon[]): FiberProviderAddon[] {
  const list = Array.isArray(addons) ? addons : fallbackAddons;
  const normalized = list.map((item, index) => {
    const fallback = fallbackAddons[index] || fallbackAddons[0] || {
      id: `addon-${index + 1}`,
      enabled: false,
      selectedByDefault: false,
      name: "Add-on",
      price: 0,
      description: "",
    };
    return normalizeProviderAddon(item, fallback, index);
  }).filter(addon => addon.id && addon.name);

  return normalized.length ? normalized : fallbackAddons;
}

function normalizePromo(promo: unknown, fallback: FiberPromo): FiberPromo {
  const record = promo && typeof promo === "object" ? promo as Partial<FiberPromo> : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    name: String(record.name || fallback.name || "").trim(),
    description: String(record.description || fallback.description || "").trim(),
    freeMonths: normalizeNumberList(record.freeMonths, fallback.freeMonths),
    planIds: normalizeStringList(record.planIds, fallback.planIds),
    appliesToBaseOnly: typeof record.appliesToBaseOnly === "boolean" ? record.appliesToBaseOnly : fallback.appliesToBaseOnly,
  };
}

function normalizeImageCards(items: unknown): FiberImageCard[] {
  const list = Array.isArray(items) ? items : DEFAULT_FIBER_CONFIG.comparisonImages.cards;
  return list.map((item) => {
    const record = item && typeof item === "object" ? item as Partial<FiberImageCard> : {};
    return {
      title: String(record.title || "").trim(),
      imageUrl: String(record.imageUrl || "").trim(),
      body: String(record.body || "").trim(),
    };
  }).filter(item => item.title || item.imageUrl || item.body);
}

function normalizeStringList(items: unknown, fallback: string[]) {
  const list = Array.isArray(items) ? items.map(String).map(item => item.trim()).filter(Boolean) : fallback;
  return list.length ? list : fallback;
}

function normalizeNumberList(items: unknown, fallback: number[]) {
  const list = Array.isArray(items) ? items.map(Number).filter(Number.isFinite) : fallback;
  return list.length ? list : fallback;
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePhoneHref(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits || DEFAULT_FIBER_CONFIG.contact.phoneHref;
}
