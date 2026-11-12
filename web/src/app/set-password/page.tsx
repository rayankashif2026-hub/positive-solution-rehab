import Image from "next/image";
import Link from "next/link";

import { setInitialPassword } from "@/app/set-password/actions";
import { requireUser } from "@/lib/auth";

type SetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  await requireUser();
  const { error } = await searchParams;

  return (
    <main className="login-wrap">
      <section className="login-card">
        <Link aria-label="Positive Solutions Rehab Center" className="login-brand" href="/login">
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
        <p className="eyebrow">ACCOUNT SETUP</p>
        <h1>Create your password</h1>
        <p className="muted">
          Choose a password for your approved clinic account. You will use your email and this
          password for future sign-ins.
        </p>
        {error ? (
          <div className="alert" role="alert">
            {error === "password"
              ? "Passwords must match and contain at least 12 characters."
              : "The password could not be saved. Check the invitation link and try again."}
          </div>
        ) : null}
        <form action={setInitialPassword}>
          <label className="field">
            Password
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              name="password"
              required
              type="password"
            />
          </label>
          <label className="field">
            Confirm password
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              name="confirmPassword"
              required
              type="password"
            />
          </label>
          <button className="button button-primary" style={{ width: "100%" }} type="submit">
            Save password and continue
          </button>
        </form>
      </section>
    </main>
  );
}
