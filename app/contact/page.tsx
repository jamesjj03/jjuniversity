import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Contact",
  description: "Send JJ University corrections, book issues, audiobook questions, and general messages.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <main className="page contactPage">
      <section className="hero">
        <p className="kicker">JJ University</p>
        <h1>Get In Touch</h1>
        <div className="heroCopy">
          <p className="gold">Questions, errors, book issues, narrator stuff, weird ideas, or general “yo, wtf?” messages go here.</p>
        </div>
      </section>

      <section className="contactPlain contactLayout">
        <article className="mainStack contactComposer">
          <section className="card goldCard contactFormPanel">
            <h2>Send a message</h2>
            <form className="formGrid" action="https://formsubmit.co/ajax/jamesjj0381@gmail.com" method="POST">
              <input type="hidden" name="_subject" value="New JJ University contact message" />
              <input type="hidden" name="_captcha" value="false" />
              <label>Name<input className="input" type="text" name="name" placeholder="Your name" required /></label>
              <label>Email<input className="input" type="email" name="email" placeholder="your@email.com" required /></label>
              <label>Subject<select className="select" name="subject" defaultValue="General message" required><option>General message</option><option>Book issue</option><option>Correction</option><option>Audiobook question</option><option>Other</option></select></label>
              <label>Message<textarea name="message" rows={7} placeholder="What’s up?" required /></label>
              <button className="formBtn" type="submit">Send message</button>
            </form>
            <section className="contactSupportGrid" aria-label="Helpful contact notes">
              <div>
                <h2>Helpful details</h2>
                <p>If something is broken, include the book title, page/link, and what device or browser you were using.</p>
              </div>
              <div>
                <h2>Corrections</h2>
                <p>Be specific. “This line is wrong because...” is way more useful than “this book is cooked.”</p>
              </div>
            </section>
          </section>
        </article>
      </section>
    </main>
  );
}
