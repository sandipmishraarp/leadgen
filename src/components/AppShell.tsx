import { AppChrome } from "@/components/AppChrome";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}
