"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

/**
 * Admin entry screen. There is no separate login page: `/admin` decides between
 * this and the console based on the session cookie, so a signed-in admin never
 * sees a redundant form.
 */
export default function AdminLogin({
  onSuccess,
  notConfigured,
}: {
  onSuccess: () => void;
  notConfigured?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          data.error === "admin_not_configured"
            ? "Admin access is not configured on this deployment. Set ADMIN_PASSWORD."
            : "That password isn't right. Please try again.",
        );
        setPending(false);
        return;
      }
      onSuccess();
    } catch {
      setError("Couldn't sign in right now. Please try again.");
      setPending(false);
    }
  };

  return (
    <div className="shell flex min-h-[70vh] items-center justify-center py-24">
      <form
        onSubmit={submit}
        className="w-full max-w-md border border-[#1f1f1f] bg-[#0c0c0c] p-8 sm:p-10"
      >
        <span className="mb-6 flex h-12 w-12 items-center justify-center border border-[#2a2a2a] text-[#c6ad78]">
          <Lock className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <p className="eyebrow mb-3 text-[#c6ad78]">ASQDEVS · Admin</p>
        <h1 className="type-title mb-3">Property Console</h1>
        <p className="type-meta mb-8 text-[#f5f3f0]/50">
          Enter the admin password to manage the shared inventory used by the
          WhatsApp and phone assistants.
        </p>

        <label className="eyebrow mb-2 block text-[#f5f3f0]/40" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3 text-[#f5f3f0] outline-none transition-colors focus:border-[#c6ad78]"
          disabled={notConfigured}
        />

        {error && (
          <p role="alert" className="type-meta mb-4 text-[#e08d6b]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || notConfigured || !password}
          className="w-full bg-[#c6ad78] py-3.5 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Enter console"}
        </button>
      </form>
    </div>
  );
}
