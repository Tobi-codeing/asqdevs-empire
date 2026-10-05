"use client";

import { useCallback, useEffect, useState } from "react";

import Navigation from "@/components/navigation/Navigation";
import Footer from "@/components/shared/Footer";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminConsole from "@/components/admin/AdminConsole";

type Session = {
  loading: boolean;
  authenticated: boolean;
  configured: boolean;
};

/**
 * The admin area.
 *
 * A single route decides between the login form and the console from the server
 * session, so there is no unprotected admin surface and no client-side secret.
 * The console itself is a normal client page; every mutation it makes goes
 * through an authenticated API route.
 */
export default function AdminPage() {
  const [session, setSession] = useState<Session>({
    loading: true,
    authenticated: false,
    configured: true,
  });

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { authenticated?: boolean; configured?: boolean }) => {
        if (!alive) return;
        setSession({
          loading: false,
          authenticated: Boolean(data.authenticated),
          configured: data.configured !== false,
        });
      })
      .catch(() => {
        if (alive) setSession({ loading: false, authenticated: false, configured: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setSession((current) => ({ ...current, authenticated: false }));
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0a0a]">
      <Navigation />

      {session.loading ? (
        <div className="shell flex min-h-[60vh] items-center justify-center">
          <p className="type-meta text-[#f5f3f0]/40">Checking access…</p>
        </div>
      ) : session.authenticated ? (
        <AdminConsole onLogout={logout} />
      ) : (
        <AdminLogin
          onSuccess={() => setSession((current) => ({ ...current, authenticated: true }))}
          notConfigured={!session.configured}
        />
      )}

      <Footer />
    </main>
  );
}
