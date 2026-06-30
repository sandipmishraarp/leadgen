import type { Metadata } from "next";
import "./globals.css";
import { startScheduledEmailWorker } from "@/lib/services/scheduler-worker";

if (typeof window === "undefined" && process.env.npm_lifecycle_event !== "build") {
  startScheduledEmailWorker();
}

export const metadata: Metadata = {
  title: "AResourcePool AI Sales Email Agent",
  description: "Approval-based AI sales email dashboard for AResourcePool"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
