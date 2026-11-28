import Link from "next/link";
import { setupOwnerAccountAction } from "@/app/actions";
import { AuthShell } from "@/app/auth-shell";
import { isFirstRunSetupOpen } from "@/server/first-run-setup";
import { safeReturnTo } from "@/server/return-to";

export const dynamic = "force-dynamic";

type RegisterPageProps = {
  searchParams?: Promise<{
    error?: string;
    returnTo?: string;
  }>;
};

const SETUP_ERROR_MESSAGES: Record<string, string> = {
  "invalid-username": "Choose a username using letters, numbers, dots, underscores, or hyphens.",
  "invalid-email": "Enter a valid email address.",
  "weak-password": "Password must be at least 8 characters long.",
  mismatch: "Passwords do not match. Please try again.",
  closed: "An owner account already exists on this instance. Sign in instead."
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params?.returnTo);
  const setupOpen = await isFirstRunSetupOpen();
  const errorMessage = params?.error ? SETUP_ERROR_MESSAGES[params.error] ?? null : null;

  if (setupOpen) {
    return (
      <AuthShell setupOpen>
        <section className="authCard" aria-labelledby="setup-title">
          <nav className="authTabs" aria-label="Account access">
            <Link href="/login">Sign in</Link>
            <span className="authTabActive" aria-current="page">
              Create account
              <small>Setup</small>
            </span>
          </nav>

          <div className="authCardHeader">
            <p className="authCardEyebrow">Initial setup</p>
            <h2 id="setup-title">Create your owner account.</h2>
            <p>
              This instance has no accounts yet. Create the first account to open
              your library—public registration closes automatically afterward.
            </p>
          </div>

          <form action={setupOwnerAccountAction} className="authForm">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="authField">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="reader"
                required
                autoFocus
              />
            </div>
            <div className="authField">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="authField">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>
            <div className="authField">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                minLength={8}
                required
              />
            </div>
            {errorMessage ? (
              <p className="authNotice authNoticeError" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <button className="authSubmit" type="submit">
              <span>Create owner account</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="authCardFooter">
            Prefer the CLI? Run <code>npm run user:create</code> inside the <code>app</code> container.
          </p>
        </section>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <section className="authCard" aria-labelledby="registration-title">
        <nav className="authTabs" aria-label="Account access">
          <Link href="/login">Sign in</Link>
          <span className="authTabActive" aria-current="page">
            Create account
            <small>Closed</small>
          </span>
        </nav>

        <div className="authClosedState">
          <span className="authClosedIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="10" width="14" height="11" rx="3" />
              <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v3" />
            </svg>
          </span>
          <p className="authCardEyebrow">Private instance</p>
          <h2 id="registration-title">Registrations are closed.</h2>
          <p>
            Curioflow is available to provisioned accounts on this server. New
            self-service account creation is disabled.
          </p>
        </div>

        <div className="authClosedDetails">
          <div>
            <span aria-hidden="true">✓</span>
            <p><strong>Already have an account?</strong> Sign in with your existing credentials.</p>
          </div>
          <div>
            <span aria-hidden="true">✓</span>
            <p><strong>Need another account?</strong> Create it on the server with <code>npm run user:create</code>.</p>
          </div>
        </div>

        {errorMessage ? (
          <p className="authNotice authNoticeError" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Link className="authSubmit authSubmitLink" href="/login">
          <span>Return to sign in</span>
          <span aria-hidden="true">→</span>
        </Link>

        <p className="authCardFooter authCardFooterCentered">
          Manage accounts from your Curioflow server.
        </p>
      </section>
    </AuthShell>
  );
}
