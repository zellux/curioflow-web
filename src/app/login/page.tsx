import Link from "next/link";
import { loginAction } from "@/app/actions";
import { AuthShell } from "@/app/auth-shell";
import { safeReturnTo } from "@/server/return-to";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    reset?: string;
    returnTo?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params?.returnTo);
  const hasError = params?.error === "invalid";
  const isThrottled = params?.error === "throttled";
  const resetSuccess = params?.reset === "success";

  return (
    <AuthShell>
      <section className="authCard" aria-labelledby="login-title">
        <nav className="authTabs" aria-label="Account access">
          <span className="authTabActive" aria-current="page">Sign in</span>
          <Link href="/register">
            Create account
            <small>Closed</small>
          </Link>
        </nav>

        <div className="authCardHeader">
          <p className="authCardEyebrow">Welcome back</p>
          <h2 id="login-title">Continue your reading.</h2>
          <p>Sign in to return to your library and pick up where you left off.</p>
        </div>

        <form action={loginAction} className="authForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="authField">
            <label htmlFor="identifier">Username or email</label>
            <input
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div className="authField">
            <div className="authLabelRow">
              <label htmlFor="password">Password</label>
              <Link href="/forgot-password">Forgot password?</Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
          </div>
          {resetSuccess ? (
            <p className="authNotice authNoticeSuccess" role="status">
              Password reset. You can now sign in.
            </p>
          ) : null}
          {hasError ? (
            <p className="authNotice authNoticeError" role="alert">
              That username or password doesn’t look right. Please try again.
            </p>
          ) : null}
          {isThrottled ? (
            <p className="authNotice authNoticeError" role="alert">
              Too many sign-in attempts. Please wait a moment and try again.
            </p>
          ) : null}
          <button className="authSubmit" type="submit">
            <span>Sign in to Curioflow</span>
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="authCardFooter">
          New to Curioflow? <Link href="/register">Registration is currently closed.</Link>
        </p>
      </section>
    </AuthShell>
  );
}
