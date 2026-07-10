import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import curioflowMark from "@/app/_assets/curioflow-logo-c13a-title.png";

type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="authShell">
      <div className="authGlow authGlowTop" aria-hidden="true" />
      <div className="authGlow authGlowBottom" aria-hidden="true" />

      <header className="authHeader">
        <Link className="authBrand" href="/" aria-label="Curioflow home">
          <span className="authBrandMark">
            <Image src={curioflowMark} alt="" priority sizes="34px" />
          </span>
          <span>Curioflow</span>
        </Link>
        <Link className="authRegistrationStatus" href="/register">
          <span className="authStatusDot" aria-hidden="true" />
          Registration closed
        </Link>
      </header>

      <div className="authLayout">
        <section className="authStory" aria-labelledby="auth-story-title">
          <p className="authEyebrow">Your reading, remembered</p>
          <h1 id="auth-story-title">
            Come back to what <em>caught your attention.</em>
          </h1>
          <p className="authStoryCopy">
            Curioflow keeps the articles, ideas, and questions worth returning to in
            one calm, searchable place.
          </p>
          <div className="authStorySteps" aria-label="Curioflow workflow">
            <span><strong>01</strong> Save anything</span>
            <span><strong>02</strong> Read deeply</span>
            <span><strong>03</strong> Find it again</span>
          </div>
        </section>

        {children}
      </div>

      <footer className="authFooter">
        <span>Private by design.</span>
        <span aria-hidden="true">·</span>
        <span>Your library belongs to you.</span>
      </footer>
    </main>
  );
}
