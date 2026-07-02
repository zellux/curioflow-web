import Link from "next/link";

export default function MarketingHome() {
  return (
    <main className="publicShell">
      <nav className="publicNav" aria-label="Curioflow">
        <Link className="publicBrand" href="/">
          <span>Curioflow</span>
        </Link>
        <div>
          <a href="/docs">Docs</a>
          <a href="/login">Login</a>
          <a href="/register">Registration</a>
        </div>
      </nav>

      <section className="publicHero">
        <div className="publicHeroCopy">
          <p className="publicKicker">Private beta</p>
          <h1>Reading, feeds, and notes in one quiet workspace.</h1>
          <p>
            Curioflow is a personal knowledge flow for saved articles, RSS/Atom feeds,
            PDFs, podcast documents, summaries, annotations, and daily briefings.
          </p>
          <div className="publicActions">
            <a className="publicPrimaryAction" href="/login">Login</a>
            <a href="/docs">Read the docs</a>
          </div>
        </div>

        <div className="publicPreview" aria-label="Product status">
          <div>
            <span>Access</span>
            <strong>Invite-only</strong>
          </div>
          <div>
            <span>Registration</span>
            <strong>Closed</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>Provisioned users only</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
