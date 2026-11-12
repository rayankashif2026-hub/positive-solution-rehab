import Image from "next/image";
import Link from "next/link";

import { submitAccessRequest } from "@/app/request-access/actions";

type RequestAccessPageProps = {
  searchParams: Promise<{ error?: string; submitted?: string; delivery?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid: "Check each field and try again.",
  password: "Passwords must match and contain at least 12 characters.",
  "account-exists": "An account already exists for this email. Sign in or contact the Head Developer.",
  "account-create": "A login account could not be created for this email. Contact the Head Developer.",
  "rate-limited": "Too many requests have been submitted. Please try again later.",
  "already-pending": "A request for this email is already waiting for review.",
  "migration-required": "Access requests are not configured yet. Ask the Head Developer to apply the latest Supabase migrations, then try again.",
  "registration-failed": "Your registration could not be completed. Please try again; if it happens again, contact the Head Developer.",
  unavailable: "The Head Developer notification email is not configured. Contact the Head Developer.",
  failed: "Your request could not be submitted. Please try again later.",
};

export default async function RequestAccessPage({ searchParams }: RequestAccessPageProps) {
  const { error, submitted, delivery } = await searchParams;

  return (
    <main className="login-wrap">
      <section className="login-card">
        <Link aria-label="Positive Solutions Rehab Center sign in" className="login-brand" href="/login">
          <Image
            alt="Positive Solutions Rehab Center official logo"
            className="login-logo"
            height={160}
            priority
            src="/positive-solutions-logo.png"
            width={160}
          />
          <span className="login-brand-copy">
            <span className="brand-name">Positive Solutions Rehab Center</span>
            <span className="brand-caption">Wah Model Town, Wah Cantt</span>
          </span>
        </Link>
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>Request access</h1>
        <p className="muted">
          Create your login now and submit it for review. Your account stays inactive until the
          Head Developer approves your request.
        </p>
        {error ? (
          <div className="alert" role="alert">
            {errorMessages[error] ?? "Your request could not be submitted. Please try again."}
          </div>
        ) : null}
        {submitted ? (
          <div className="notice" role="status">
            Your request has been submitted. After approval, sign in with this email and the
            password you created.
          </div>
        ) : null}
        {submitted && delivery === "unavailable" ? (
          <div className="alert" role="status">
            Your request was saved, but the notification email could not be sent yet. The Head
            Developer can still review it in User administration.
          </div>
        ) : null}
        {!submitted && (
          <form action={submitAccessRequest}>
            <label className="field">
              Full name
              <input autoComplete="name" maxLength={120} name="fullName" required />
            </label>
            <label className="field">
              Email
              <input autoComplete="email" maxLength={254} name="email" required type="email" />
            </label>
            <label className="field">
              Password
              <input
                autoComplete="new-password"
                maxLength={1024}
                minLength={12}
                name="password"
                required
                type="password"
              />
              <span className="muted">Use at least 12 characters. This password is handled by Supabase Auth.</span>
            </label>
            <label className="field">
              Confirm password
              <input
                autoComplete="new-password"
                maxLength={1024}
                minLength={12}
                name="confirmPassword"
                required
                type="password"
              />
            </label>
            <label className="field">
              Branch
              <input
                autoComplete="organization"
                maxLength={120}
                name="branch"
                placeholder="Enter your clinic branch"
                required
              />
            </label>
            <label className="field">
              Requested role
              <input
                maxLength={80}
                name="requestedRole"
                placeholder="For example, Branch Administrator"
                required
              />
            </label>
            <label className="field">
              Reason for access
              <textarea maxLength={1000} minLength={10} name="reason" required rows={4} />
              <span className="muted">Do not include patient or other sensitive health information.</span>
            </label>
            <div aria-hidden="true" style={{ left: "-10000px", position: "absolute" }}>
              <label>
                Leave this field empty
                <input autoComplete="off" name="website" tabIndex={-1} />
              </label>
            </div>
            <button className="button button-primary" style={{ width: "100%" }} type="submit">
              Submit access request
            </button>
          </form>
        )}
        <p className="muted" style={{ marginTop: 16 }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
