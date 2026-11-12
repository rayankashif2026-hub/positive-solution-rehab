"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function completeInvitation() {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        router.replace("/login?error=invite");
        return;
      }

      const supabase = createBrowserClient(url, key);
      const currentUrl = new URL(window.location.href);
      const hashParams = new URLSearchParams(currentUrl.hash.slice(1));
      const code = currentUrl.searchParams.get("code");
      const tokenHash =
        currentUrl.searchParams.get("token_hash") ?? hashParams.get("token_hash");
      const tokenType = currentUrl.searchParams.get("type") ?? hashParams.get("type");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      let authError: Error | null = null;

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        authError = error;
      } else if (tokenHash && tokenType === "invite") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "invite",
        });
        authError = error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        authError = error;
      } else {
        authError = new Error("The invitation link did not contain a valid session.");
      }

      if (cancelled) {
        return;
      }
      router.replace(authError ? "/login?error=invite" : "/set-password");
    }

    void completeInvitation();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="login-wrap">
      <section className="login-card">
        <p className="eyebrow">ACCOUNT INVITATION</p>
        <h1>Preparing your account</h1>
        <p className="muted">Please wait while we validate your invitation.</p>
      </section>
    </main>
  );
}
