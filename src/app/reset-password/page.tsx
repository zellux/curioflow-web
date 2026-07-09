import Link from "next/link";
import { resetPasswordAction } from "@/app/actions";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
    token?: string;
  }>;
};

function errorText(error?: string) {
  if (error === "mismatch") return "The passwords do not match.";
  if (error === "weak-password") return "Use a password with at least 8 characters.";
  if (error === "invalid-token") return "This reset link is invalid or expired.";
  return null;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params?.token ?? "";
  const error = errorText(params?.error);

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
        <h1>Choose a new password.</h1>
        <p>
          Reset links expire quickly and work once. After the password changes,
          existing sessions for this account are signed out.
        </p>
        {token ? (
          <form action={resetPasswordAction} className="loginForm">
            <input type="hidden" name="token" value={token} />
            <label>
              <span>New password</span>
              <input name="password" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <label>
              <span>Confirm new password</span>
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            {error ? <p className="loginError">{error}</p> : null}
            <button type="submit">Reset password</button>
          </form>
        ) : (
          <div className="loginForm">
            <p className="loginError">This reset link is missing its token.</p>
          </div>
        )}
        <div className="publicActions publicActionsTight">
          <a href="/forgot-password">Request a new link</a>
        </div>
      </section>
    </main>
  );
}
