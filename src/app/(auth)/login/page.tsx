import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-8 mt-2 text-muted">Sign in to see what needs you this week.</p>
      <AuthForm mode="login" />
    </>
  );
}
