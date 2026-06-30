import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Admin Login</h1>
          <p className="mt-1 text-sm text-slate-500">Approval-based email replies for Abhay at AResourcePool.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
