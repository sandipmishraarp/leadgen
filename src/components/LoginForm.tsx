"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password")
      })
    });
    setLoading(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Invalid email or password");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input
          name="email"
          type="email"
          required
          className="mt-1 h-11 w-full rounded-md border border-line px-3"
          placeholder="admin@aresourcepool.com"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input name="password" type="password" required className="mt-1 h-11 w-full rounded-md border border-line px-3" />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <Button disabled={loading} className="w-full">
        {loading ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
