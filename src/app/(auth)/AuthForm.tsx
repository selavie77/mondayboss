"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { login, signup, type AuthState } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "login" ? login : signup, undefined);
  const isLogin = mode === "login";

  return (
    <form action={action} className="space-y-5">
      {!isLogin && (
        <Field label="Your name">
          <Input name="name" autoComplete="name" placeholder="Francis" required />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </Field>
      <Field label="Password" hint={isLogin ? undefined : "At least 8 characters."}>
        <Input
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </Field>

      {state?.error && <Notice>{state.error}</Notice>}

      <Button type="submit" block disabled={pending}>
        {pending ? "One moment…" : isLogin ? "Sign in" : "Create my account"}
      </Button>

      <p className="text-center text-sm text-muted">
        {isLogin ? "New to Mondayboss? " : "Already have an account? "}
        <Link href={isLogin ? "/signup" : "/login"} className="font-medium text-brand-700 hover:underline">
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
