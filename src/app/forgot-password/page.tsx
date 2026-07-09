import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const status = params?.status;
  const isSent = status === "sent";
  const isNotConfigured = status === "not-configured";
  const isEmailError = status === "email-error";

  return (
    <main className="publicShell publicNarrow">
      <nav className="publicNav" aria-label="Curioflow password reset">
        <Link className="publicBrand" href="/">
          <span>Curioflow</span>
        </Link>
        <div>
          <a href="/login">Login</a>
        </div>
      </nav>

      <section className="publicPanel">
        <p className="publicKicker">Account recovery</p>
        <h1>Reset your password.</h1>
        <p>
          Enter your username or email. If a matching Curioflow account exists,
          we will send a password reset link to its email address.
        </p>
        <form action={requestPasswordResetAction} className="loginForm">
          <label>
            <span>Username or email</span>
            <input name="identifier" autoComplete="username" required />
          </label>
          {isSent ? <p className="loginSuccess">If that account exists, a reset link has been sent.</p> : null}
          {isNotConfigured ? <p className="loginError">Password reset email is not configured on this server.</p> : null}
          {isEmailError ? <p className="loginError">Unable to send the reset email. Check SES settings and try again.</p> : null}
          <button type="submit">Send reset link</button>
        </form>
        <div className="publicActions publicActionsTight">
          <a href="/login">Return to login</a>
        </div>
      </section>
    </main>
  );
}
