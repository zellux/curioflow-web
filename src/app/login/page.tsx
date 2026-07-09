import Link from "next/link";
import { loginAction } from "@/app/actions";
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
    <main className="publicShell publicNarrow">
      <nav className="publicNav" aria-label="Curioflow login">
        <Link className="publicBrand" href="/">
          <span>Curioflow</span>
        </Link>
        <div>
          <a href="/register">Registration</a>
        </div>
      </nav>

      <section className="publicPanel">
        <p className="publicKicker">Backend access</p>
        <h1>Login to Curioflow.</h1>
        <p>
          Access is limited to provisioned users. Public registration is closed while
          the account boundary is hardened.
        </p>
        <form action={loginAction} className="loginForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            <span>Username or email</span>
            <input name="identifier" autoComplete="username" required />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {resetSuccess ? <p className="loginSuccess">Password reset. You can now log in.</p> : null}
          {hasError ? <p className="loginError">The username/email or password is incorrect.</p> : null}
          {isThrottled ? <p className="loginError">Too many login attempts. Try again later.</p> : null}
          <button type="submit">Login</button>
        </form>
        <div className="publicActions publicActionsTight">
          <a href="/forgot-password">Forgot password?</a>
          <a href="/register">Registration status</a>
        </div>
      </section>
    </main>
  );
}
