import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-8 mt-2 text-muted">It takes about two minutes to set up your first property.</p>
      <AuthForm mode="signup" />
    </>
  );
}
