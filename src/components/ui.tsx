import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Logo({ size = "md", invert = false }: { size?: "md" | "lg"; invert?: boolean }) {
  const box = size === "lg" ? "h-10 w-10 text-lg" : "h-8 w-8 text-base";
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cx(
          "grid place-items-center rounded-xl font-semibold",
          box,
          invert ? "bg-white/15 text-white ring-1 ring-white/30" : "bg-brand-600 text-white",
        )}
        aria-hidden
      >
        M
      </span>
      <span className={cx("font-semibold tracking-tight", size === "lg" ? "text-xl" : "text-[17px]", invert && "text-white")}>
        Mondayboss
      </span>
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  block?: boolean;
};

export function Button({ variant = "primary", size = "md", block, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition",
        size === "md" ? "h-11 px-5 text-[15px]" : "h-9 px-3.5 text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        variant === "secondary" && "border border-border-strong bg-surface text-foreground hover:bg-brand-50",
        variant === "ghost" && "text-muted hover:bg-brand-50 hover:text-foreground",
        block && "w-full",
        className,
      )}
    />
  );
}

const fieldClass =
  "w-full rounded-xl border border-border-strong bg-surface text-foreground " +
  "placeholder:text-subtle transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

const sizeClass = (compact?: boolean) => (compact ? "h-9 px-3 text-sm" : "h-11 px-3.5 text-[15px]");

export function Input({ compact, ...props }: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }) {
  return <input {...props} className={cx(fieldClass, sizeClass(compact), props.className)} />;
}

export function Select({ compact, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select
      {...props}
      className={cx(fieldClass, sizeClass(compact), "appearance-none bg-no-repeat", compact ? "pr-8" : "pr-9", props.className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235d706e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: "right 0.85rem center",
        ...props.style,
      }}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]", className)}>
      {children}
    </div>
  );
}

export function Notice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  return (
    <p
      role="alert"
      className={cx(
        "rounded-xl px-3.5 py-2.5 text-sm",
        tone === "error" ? "bg-red-50 text-red-800" : "bg-brand-50 text-brand-900",
      )}
    >
      {children}
    </p>
  );
}
