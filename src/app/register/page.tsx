import Link from "next/link";
import { AuthShell } from "@/app/auth-shell";

export default function RegisterPage() {
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
          <p className="authCardEyebrow">Private beta</p>
          <h2 id="registration-title">Registrations are paused.</h2>
          <p>
            Curioflow is currently available to provisioned accounts while the
            experience is being refined. New account creation is disabled for now.
          </p>
        </div>

        <div className="authClosedDetails">
          <div>
            <span aria-hidden="true">✓</span>
            <p><strong>Already have an account?</strong> Your access is unchanged.</p>
          </div>
          <div>
            <span aria-hidden="true">✓</span>
            <p><strong>Invited by an administrator?</strong> Use the credentials they provided.</p>
          </div>
        </div>

        <Link className="authSubmit authSubmitLink" href="/login">
          <span>Return to sign in</span>
          <span aria-hidden="true">→</span>
        </Link>

        <p className="authCardFooter authCardFooterCentered">
          Account creation will return in a future release.
        </p>
      </section>
    </AuthShell>
  );
}
