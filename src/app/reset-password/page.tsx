import Link from "next/link";
import { resetPasswordAction } from "@/app/actions";
import { AuthShell } from "@/app/auth-shell";

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
    <AuthShell>
      <section className="authCard authCardCompact" aria-labelledby="reset-password-title">
        <Link className="authBackLink" href="/login">← Back to sign in</Link>
        <div className="authCardHeader">
          <p className="authCardEyebrow">Account recovery</p>
          <h2 id="reset-password-title">Choose a new password.</h2>
          <p>Use at least 8 characters. Changing your password signs out your other sessions.</p>
        </div>
        {token ? (
          <form action={resetPasswordAction} className="authForm">
            <input type="hidden" name="token" value={token} />
            <div className="authField">
              <label htmlFor="new-password">New password</label>
              <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required />
            </div>
            <div className="authField">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Repeat your password" required />
            </div>
            {error ? <p className="authNotice authNoticeError" role="alert">{error}</p> : null}
            <button className="authSubmit" type="submit"><span>Reset password</span><span aria-hidden="true">→</span></button>
          </form>
        ) : (
          <div className="authForm">
            <p className="authNotice authNoticeError" role="alert">This reset link is missing its token.</p>
            <Link className="authSubmit authSubmitLink" href="/forgot-password"><span>Request a new link</span><span aria-hidden="true">→</span></Link>
          </div>
        )}
      </section>
    </AuthShell>
  );
}
