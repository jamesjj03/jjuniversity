/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="page aboutPage">
      <section className="aboutHero">
        <p className="kicker">JJ University</p>
        <h1>Information Desk</h1>
      </section>

      <section className="aboutPlain aboutDesk">
        <article className="aboutStory aboutEssay">
          <section className="aboutIntroBlock">
            <p className="kicker">What This Is</p>
            <h2>The Basic Idea</h2>
            <p>JJ University is a collection of books written over the past year with one goal: to figure out how things actually work.</p>
            <p>I'm not just talking one subject here. I'm talking everything. Science, history, religion, psychology, culture, systems, people, ideas, and anything that helps explain reality in a clear, structured way.</p>
          </section>

          <section className="aboutIntroBlock">
            <h2>How The Books Work</h2>
            <p>Each book takes a topic and breaks it down into something you can actually understand. I don't do it the way textbooks do and drag it out forever. I give you the full picture without wasting your time.</p>
            <p>You can open any book and start there. There is no required order. However, if you read enough of them, they start to connect and you begin to see how everything fits together.</p>
          </section>

          <section className="aboutIntroBlock">
            <h2>The Process</h2>
            <p>This is less like a traditional author project and more like a personal knowledge system turned into a library.</p>
            <p>The books are made using a combo of AI and human editing. I start with a topic and build out a chapter structure relative to the depth of the topic. AI helps gather information and lay out a first version fast. After that, I go through everything and mess with it until it actually sounds like me.</p>
          </section>

          <section className="aboutIntroBlock">
            <h2>The Point</h2>
            <p>The motivation changed over time, but the core idea stayed the same: sometimes the fastest way to understand something is to hear the right version of it, told the right way.</p>
            <p>I'm not trying to be Wikipedia or write AI textbooks. Everything here is curated, structured, and built for speed and clarity.</p>
          </section>

          <section className="aboutTimelineBlock">
            <p className="kicker">Who I Am</p>
            <h2>Background</h2>
            <p>My name is JJ. I'm 22, and I'm from Dayton, Ohio.</p>
            <p>I never actually wanted to be an author. For a while, I was just trying to figure out what I was supposed to do.</p>
          </section>

          <section className="aboutTimelineBlock">
            <h2>How It Started</h2>
            <p>At some point, I started writing. It began with random ideas. Then I started writing about bigger topics like science, religion, history, and how things work. Once I realized I could actually break those things down and make sense of them, I didn't stop.</p>
          </section>

          <section className="aboutTimelineBlock">
            <h2>The Run</h2>
            <p>For a stretch, I was writing constantly. I was writing multiple books a day sometimes. I'd be delivering pizzas, thinking about chapters and book ideas, then going home and building them out.</p>
            <p>I threw away a lot of them. I restarted a lot. I spent hours on individual books, sometimes just on covers alone. I was losing my mind over color palettes.</p>
          </section>

          <section className="aboutTimelineBlock">
            <h2>What It Became</h2>
            <p>Over time, I also worked with a large number of narrators to turn many of the books into audiobooks. There are a lot of those as well.</p>
            <p>At one point, I started going back through everything to clean it up, fact-check it, and improve the structure. That's still in progress now.</p>
          </section>

          <section className="aboutTimelineBlock">
            <h2>Where I'm At Now</h2>
            <p>Recently, I've stepped back from writing nonstop and focused more on refining what's already been built and thinking about how to take it further.</p>
            <p>This whole project came from trying to understand things better. It just turned into something a little bigger along the way. And it's still going.</p>
          </section>

          <section className="aboutDisclaimer">
            <h2>Disclaimer</h2>
            <strong>Independent educational project</strong>
            <p>JJ University is an independent educational project, not an accredited institution. The content is intended to help explain ideas, systems, and topics in a clear and accessible way.</p>
            <p>Use this as a tool to learn, think, and explore, not as the last word on anything. Also, to be clear, this is not a real, literal university. You will not be receiving a degree. You will, however, understand things better if you stick around.</p>
          </section>

          <Link className="btn primary" href="/library">Browse the Library</Link>
        </article>
      </section>
    </main>
  );
}
