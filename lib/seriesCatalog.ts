/**
 * The authored Series structure for the public library.
 *
 * These are deliberately independent from Parts and future print volumes.
 * A Series is how a reader finds a connected body of books; any future
 * packaging can make its own decisions about what belongs in one volume.
 */
export type SeriesCatalogEntry = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  bookIds: string[];
  archive?: boolean;
};

export const MAIN_SERIES_GROUPS = [
  {
    id: "history-government",
    title: "History & Government",
    seriesIds: ["the-big-picture", "exe-power-as-code", "the-mapmakers", "breaking-point", "red-white-and-bruised", "commanders-in-chief", "eyes-everywhere"],
  },
  {
    id: "biography",
    title: "Biography",
    seriesIds: ["the-architects", "the-code-breakers", "the-philosophers", "god-struck", "the-disruptors", "the-rulers", "the-conquerors", "the-tyrants"],
  },
  {
    id: "how-things-work",
    title: "How Things Work",
    seriesIds: ["101-the-core-courses", "under-the-hood", "the-social-code", "high-society", "business-as-usual", "the-system"],
  },
  {
    id: "religion-spirituality",
    title: "Religion & Spirituality",
    seriesIds: ["world-religions", "what-the-book-actually-says", "after-the-cross", "closed-worlds", "the-fringe"],
  },
  {
    id: "arts-culture",
    title: "Arts & Culture",
    seriesIds: ["the-creatives", "the-noisemakers", "raised-by-screens", "calendar-chronicles"],
  },
] as const;

export const SERIES_CATALOG: SeriesCatalogEntry[] = [
  { id: "the-architects", title: "The Architects", tagline: "The people behind modern tech’s biggest companies.", description: "Gates, Jobs, Bezos, Page and Brin, Thiel, Zuckerberg, and Musk. The books cover what they built, how they built it, and how much power came with it.", bookIds: ["gates", "jobs", "bezos", "google", "thiel", "zuck", "musk"] },
  { id: "the-code-breakers", title: "The Code Breakers", tagline: "The people who changed what we know.", description: "The Thinkers opens the Series. The rest are biographies of scientists, inventors, and psychologists, running from Galileo and Newton through Einstein, Sagan, and Hawking.", bookIds: ["thinkers", "galileo", "isaac", "franklin", "darwin", "edison", "tesla", "freud", "planck", "marie", "jung", "einstein", "feynman", "sagan", "hawking"] },
  { id: "the-conquerors", title: "The Conquerors", tagline: "The people who built empires by force.", description: "The books are arranged chronologically. Ramses comes first, Napoleon comes last, and Alexander, Caesar, Genghis Khan, Tamerlane, and the rest sit between them.", bookIds: ["ramses", "alexander", "caesar", "august", "charlemagne", "genghis", "tamerlane", "napoleon"] },
  { id: "the-tyrants", title: "The Tyrants", tagline: "Rulers who made control the point of government.", description: "Tyrants gives the overview. The biographies show how control worked under Nero, Leopold II, Mussolini, Stalin, Hitler, Putin, and Kim Jong Un.", bookIds: ["tyrants", "nero", "congo", "mussolini", "stalin", "adolf", "putin", "kim"] },
  { id: "the-rulers", title: "The Rulers", tagline: "Monarchs, national leaders, and the power they held.", description: "Echoes of Power gives the wider view. The rest follows individual monarchs and national leaders, along with the British Crown itself.", bookIds: ["echoes", "wu", "mansu", "vic", "kaiser", "haile", "churchill", "crown"] },
  { id: "god-struck", title: "The Awakened", tagline: "Religious founders and spiritual teachers, ancient and modern.", description: "Buddha, Jesus, and Muhammad open the Series. L. Ron Hubbard, Alan Watts, and Terence McKenna bring it into the modern era, and The Ones Who Woke Up closes it.", bookIds: ["buddha", "messiah", "muhammad", "lron", "watts", "tmk", "woke"] },
  { id: "the-disruptors", title: "The Disruptors", tagline: "People who challenged the order around them.", description: "Biographies of people who challenged a religious, political, or social order. Their methods and outcomes differ; the common thread is the pressure they put on whatever was already established.", bookIds: ["joan", "luther", "harriet", "rasputin", "gandhi", "lenin", "helen", "malcolm", "king", "soros"] },
  { id: "world-religions", title: "The Divine Archive", tagline: "How religions begin, change, and last.", description: "A broad history of religion and belief across several traditions. It explains where the ideas came from, how they changed, and how people understand them now—without asking the reader to pick a side.", bookIds: ["pantheon", "gods", "zoro", "jewish", "buddhism", "islam", "kabbalah", "sikhism", "bahai", "believe", "materialism", "believers"] },
  { id: "after-the-cross", title: "After the Cross", tagline: "Christianity after Jesus.", description: "Christianity after Jesus: how its texts, churches, institutions, conflicts, and critics developed. This is where the lost gospels, crusades, inquisitions, witch trials, and modern doubt belong.", bookIds: ["howbible", "branches", "nagham", "popes", "crusades", "inquis", "witches", "doubt", "christianity"] },
  { id: "the-fringe", title: "The Fringe", tagline: "Ideas that sit outside ordinary religion and science.", description: "Chakras, sacred geometry, reincarnation, astral projection, ghosts, aliens, and the veil. The books take the claims seriously enough to ask where they came from and what the evidence can actually support.", bookIds: ["chakras", "sacredgeo", "reincarnation", "astral", "myths", "warrens", "aliens", "veil"] },
  { id: "closed-worlds", title: "Closed Worlds", tagline: "Groups that build a world of their own.", description: "Communities and institutions that set strong boundaries around belief, membership, or power. The lineup mixes religious communities, high-control groups, conspiracy stories, and The Cult Playbook as the overview.", bookIds: ["amish", "mormon", "jw", "tribes", "scientology", "illuminati", "hiddenhand", "cult"] },
  { id: "the-philosophers", title: "The Questioners", tagline: "The lives and ideas of major philosophers.", description: "Philosopher biographies in chronological order. They’re about the lives, the arguments, and the questions each person left behind.", bookIds: ["confucius", "socrates", "plato", "aristotle", "aquinas", "machi", "descartes", "spinoza", "voltaire", "niet"] },
  { id: "red-white-and-bruised", title: "Red, White, and Bruised", tagline: "American history without the clean version.", description: "The founding story, race, elections, lobbying, campus money, the dollar, and Georgism. The books focus on power and the parts of American history that usually get softened or skipped.", bookIds: ["columbus", "1776", "burr", "rewrite", "race", "rvb", "jesse", "electoral", "elections", "lobbied", "campus", "dollar", "georgism"] },
  { id: "breaking-point", title: "Breaking Point", tagline: "Revolutions, wars, partitions, and famines.", description: "The French Revolution, the guillotine, World War I, communism, Israel and Palestine, and the Irish Potato Famine. They’re grouped by the political rupture at the center of each story.", bookIds: ["revolution", "heads", "ww1", "communism", "isrpal", "famine"] },
  { id: "eyes-everywhere", title: "Eyes Everywhere", tagline: "The agencies that watch, infiltrate, and operate in secret.", description: "The FBI, CIA, Mossad, NSA, MKUltra, and American regime-change operations. The books focus on the institutions, their methods, their major operations, and the public consequences.", bookIds: ["fbi", "cia", "mossad", "nsa", "mkultra", "coups"] },
  { id: "the-mapmakers", title: "The Mapmakers", tagline: "How countries, borders, and political maps got made.", description: "Country histories, border histories, and books about how political maps get made. The Borders Book gives the overview; the rest focuses on particular places and institutions.", bookIds: ["borders", "egypt", "rome", "germany", "japan", "insidechina", "northkorea", "cuba", "saudi", "syria", "antarctica", "control", "unitednations"] },
  { id: "the-system", title: "The System", tagline: "Systems people depend on but rarely control.", description: "Bureaucracy, corporations, offshore money, credit, insurance, gig work, plastics, climate, and more. The common question is who benefits from the way the system works.", bookIds: ["bure", "corps", "web", "pyramid", "off", "jeff", "schooled", "credit", "insurance", "gig", "lunchtime", "plastic", "warming"] },
  { id: "the-big-picture", title: "The Big Picture", tagline: "The overview books from across the library.", description: "These books introduce a whole subject before the individual stories begin. Every title also belongs to its own Series.", bookIds: ["humans", "condition", "drugs", "pantheon", "believers", "cult", "thinkers", "money", "crust", "borders", "echoes", "crown", "presidents", "tyrants"] },
  { id: "the-noisemakers", title: "Louder Than Life", tagline: "Musicians, performers, and the culture around fame.", description: "Biographies of Mozart, Lennon, Liberace, Michael Jackson, Kanye West, and Taylor Swift. Vibe Check covers the culture around fame itself.", bookIds: ["mozart", "lennon", "liberated", "mike", "kanye", "taylor", "vibes"] },
  { id: "the-creatives", title: "The Creatives", tagline: "The people behind paintings, books, comics, films, and stage acts.", description: "Biographies of artists, writers, filmmakers, performers, and comic creators. The focus is the person, the work, and the choices that made it recognizable.", bookIds: ["theboys", "leonardo", "shake", "van", "houdini", "orwell", "hat", "lee", "burton"] },
  { id: "business-as-usual", title: "Business as Usual", tagline: "How familiar companies and products got so big.", description: "Company histories and product histories. The books look at how familiar brands grew, how they made money, and what changed once they got big.", bookIds: ["ford", "nestle", "kfc", "nike", "disney", "nintendo", "purdue", "steam", "tiktok", "crust"] },
  { id: "under-the-hood", title: "Under the Hood", tagline: "Science explained without assuming a science background.", description: "Physics, probability, plants, bodies, brains, disease, and the universe all belong here. The books explain the idea before piling on the terminology.", bookIds: ["scisim", "hardest", "odds", "bang", "relativity", "nuclear", "color", "ai", "fields", "goo", "plants", "bees", "burgers", "brain", "sleep", "pregnancy", "cancer"] },
  { id: "the-social-code", title: "The Social Code", tagline: "The rules people learn without anyone writing them down.", description: "Love, imagination, heroes, intelligence, censorship, antisemitism, and circumcision. They don’t look related at first; the common thread is what a culture teaches people to treat as normal.", bookIds: ["rock", "love", "imagination", "heroes", "banned", "antisem", "foreskin", "intelligence"] },
  { id: "raised-by-screens", title: "Raised by Screens", tagline: "Television, movies, and games that shaped everyday culture.", description: "Soap operas, Cartoon Network, Pixar, sitcoms, video games, shopping channels, and Jackass—the screens people grew up with.", bookIds: ["soaps", "cn", "pixar", "sitcoms", "games", "looped", "jackass"] },
  { id: "high-society", title: "Hits and Hooks", tagline: "Why certain things feel impossible to quit.", description: "Addiction beyond drugs and alcohol. The books also examine food, screens, gambling, porn, work, and the reward systems designed to keep people coming back.", bookIds: ["addiction", "drugs", "alcohol", "weed", "nicotine", "caffeine", "dietpop", "biochemical", "bluecollar", "dopamine", "fantasy", "aitakeover", "casinos"] },
  { id: "memoirs", title: "First Person", tagline: "Books drawn from James’s own life.", description: "Personal books about James, his family, his work, and Dayton. Some are memoirs; others use real life as the starting point for fiction.", bookIds: ["lr", "hr", "foodie", "jungle", "tmts", "nictrap", "tns", "dayton", "alta"], archive: true },
  { id: "experiments", title: "Off Script", tagline: "Experiments, commissions, stories, and one-offs.", description: "Books written outside the library’s usual nonfiction format, including commissioned work, fiction, jokes, and one-off experiments.", bookIds: ["stoney", "unsinkable", "tft", "tnd", "idk", "idwt", "evil", "unsinkable2", "fortitude", "d2d", "tom", "poker"], archive: true },
  { id: "kids-books", title: "Kids' Books", tagline: "Stories for younger readers, with the jokes left in.", description: "Weird, funny books for younger readers. They don’t talk down to kids, and the jokes stay in.", bookIds: ["pip", "bluster", "jesus", "tacos", "kal", "tommy"], archive: true },
  { id: "101-the-core-courses", title: "101: How We Figured It Out", tagline: "The core subjects, explained from the beginning.", description: "Introductions to history, science, math, philosophy, religion, government, economics, psychology, and more. Each book explains how the field developed and how people figured it out.", bookIds: ["history", "philosophy", "science", "math", "calculus", "physics", "electricity", "quantum", "chemistry", "biology", "anatomy", "psychology", "sociology", "religion", "ethics", "government", "economics"] },
  { id: "what-the-book-actually-says", title: "What the Scripture Actually Says", tagline: "Religious texts read directly and put in context.", description: "The Bible, Quran, Talmud, Gita, Tao Te Ching, Guru Granth Sahib, Kojiki, Book of Mormon, Dianetics, and Watchtower. The focus is the text itself and the history needed to understand it.", bookIds: ["bible", "quran", "talmud", "gita", "tao", "guru", "kojiki", "bom", "dianetics", "watchtower"] },
  { id: "exe-power-as-code", title: ".exe: Power as Code", tagline: "History’s power systems, read like code.", description: "Ancient empires, Marx, communist revolutions, and humanity.exe. Each book treats power like code: written by people, copied by institutions, changed by circumstance, and kept running after its author is gone.", bookIds: ["sargon", "ham", "nebu", "cyrus", "marx", "mao", "hochi", "tsar", "humans"] },
  { id: "commanders-in-chief", title: "Commanders-in-Chief", tagline: "The presidency through the people who held it.", description: "The Presidents gives the overview. The individual biographies begin with Washington and currently run through Obama.", bookIds: ["presidents", "george", "jefferson", "jackson", "lincoln", "teddy", "fdr", "jfk", "nixon", "reagan", "gwb", "obama"] },
  { id: "calendar-chronicles", title: "Calendar Chronicles", tagline: "Where familiar holidays came from.", description: "Halloween, Thanksgiving, Christmas, New Year’s, and the holiday business. The books look at how the rituals started and how they changed.", bookIds: ["halloween", "thanksgiving", "xmas", "time", "holidays"] },
];
