import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="publicShell publicNarrow">
      <nav className="publicNav" aria-label="Curioflow registration">
        <Link className="publicBrand" href="/">
          <span>Curioflow</span>
        </Link>
        <div>
          <a href="/docs">Docs</a>
          <a href="/login">Login</a>
        </div>
      </nav>

      <section className="publicPanel">
        <p className="publicKicker">Registration closed</p>
        <h1>New users are created through the backend only.</h1>
        <p>
          Public signup is intentionally disabled while Curioflow is dogfooded
          and the account boundary is hardened.
        </p>
        <a className="publicPrimaryAction" href="/login">Go to login</a>
      </section>
    </main>
  );
}
