"use client";

import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      className="w-full"
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      Sign out
    </Button>
  );
}
