import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="publicShell publicNarrow">
      <nav className="publicNav" aria-label="Curioflow login">
        <Link className="publicBrand" href="/">
          <span>Curioflow</span>
        </Link>
        <div>
          <a href="/docs">Docs</a>
          <a href="/register">Registration</a>
        </div>
      </nav>

      <section className="publicPanel">
        <p className="publicKicker">Backend access</p>
        <h1>Login is reserved for provisioned users.</h1>
        <p>
          Application-level authentication is not open yet. For now, backend access
          is protected by the deployment boundary and accounts are created manually.
        </p>
        <div className="publicActions">
          <a className="publicPrimaryAction" href="/app">Continue to backend</a>
          <a href="/register">Registration status</a>
        </div>
      </section>
    </main>
  );
}
