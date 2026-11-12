import Image from "next/image";
import Link from "next/link";

import { login } from "@/app/login/actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams;

  return (
    <main className="login-wrap">
      <section className="login-card">
        <Link aria-label="Positive Solutions Rehab Center sign in" className="login-brand" href="/login">
          <Image
            alt="Positive Solutions Rehab Center official logo"
            className="login-logo"
            height={190}
            priority
            src="/positive-solutions-logo.png"
            width={190}
          />
          <span className="login-brand-copy">
            <span className="brand-name">Positive Solutions Rehab Center</span>
            <span className="brand-caption">Wah Model Town, Wah Cantt</span>
          </span>
        </Link>
        <p className="eyebrow">SECURE ADMIN PORTAL</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in with your authorized clinic account.</p>
        {error ? (
          <div className="alert" role="alert">
            {error === "credentials"
              ? "The email or password was not accepted."
              : error === "inactive"
                ? "This account is inactive. Contact the Head Developer."
                : error === "throttled"
                  ? "Too many sign-in attempts. Wait 15 minutes before trying again."
                  : error === "invite"
                    ? "The invitation link is invalid or expired. Ask the Head Developer to send a new invitation."
                  : "Sign-in could not be completed. Try again or contact the Developer."}
          </div>
        ) : null}
        {message === "password-updated" ? (
          <div className="alert" role="status">Password updated. Please sign in.</div>
        ) : null}
        <form action={login}>
          <label className="field">
            Email
            <input autoComplete="username" name="email" required type="email" />
          </label>
          <label className="field">
            Password
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <input name="next" type="hidden" value="/dashboard" />
          <button className="button button-primary" style={{ width: "100%" }} type="submit">
            Sign in
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          Access is provisioned by the Head Developer.
        </p>
        <p className="muted">
          Need an account? <Link href="/request-access">Request access</Link>
        </p>
      </section>
    </main>
  );
}
