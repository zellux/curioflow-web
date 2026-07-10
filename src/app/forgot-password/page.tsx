import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions";
import { AuthShell } from "@/app/auth-shell";

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
    <AuthShell>
      <section className="authCard authCardCompact" aria-labelledby="forgot-password-title">
        <Link className="authBackLink" href="/login">← Back to sign in</Link>
        <div className="authCardHeader">
          <p className="authCardEyebrow">Account recovery</p>
          <h2 id="forgot-password-title">Reset your password.</h2>
          <p>
          Enter your username or email. If a matching Curioflow account exists,
            we’ll send a reset link to its email address.
          </p>
        </div>
        <form action={requestPasswordResetAction} className="authForm">
          <div className="authField">
            <label htmlFor="identifier">Username or email</label>
            <input id="identifier" name="identifier" autoComplete="username" placeholder="you@example.com" required autoFocus />
          </div>
          {isSent ? <p className="authNotice authNoticeSuccess" role="status">If that account exists, a reset link has been sent.</p> : null}
          {isNotConfigured ? <p className="authNotice authNoticeError" role="alert">Password reset email is not configured on this server.</p> : null}
          {isEmailError ? <p className="authNotice authNoticeError" role="alert">Unable to send the reset email. Check SES settings and try again.</p> : null}
          <button className="authSubmit" type="submit"><span>Send reset link</span><span aria-hidden="true">→</span></button>
        </form>
      </section>
    </AuthShell>
  );
}
