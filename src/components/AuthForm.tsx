"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_COLORS, type AvatarColorId } from "@/lib/types";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

type AuthMode = "login" | "signup";

export function AuthForm({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [teamName, setTeamName] = useState("My Team");
  const [avatarColor, setAvatarColor] = useState<AvatarColorId>("blue");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null
  );

  const supabase = createClient();

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            team_name: teamName,
            avatar_color: avatarColor,
          },
        },
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
        setLoading(false);
        return;
      }

      setMessage({
        type: "success",
        text: "Account created! Check your email to confirm, then log in.",
      });
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage({ type: "error", text: error.message });
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <Logo size="lg" />
        <p className="text-muted mt-3 text-sm">
          {mode === "login" ? "Welcome back, trader." : "Build your fantasy portfolio."}
        </p>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-2xl p-6 sm:p-8">
        <div className="flex rounded-xl bg-dark p-1 mb-6">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setMessage(null);
            }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === "login"
                ? "bg-primary text-white"
                : "text-muted hover:text-white"
            }`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setMessage(null);
            }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === "signup"
                ? "bg-primary text-white"
                : "text-muted hover:text-white"
            }`}
          >
            Sign up
          </button>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-xl border border-dark-border bg-white text-gray-800 font-medium py-3 px-4 hover:bg-gray-50 transition-colors disabled:opacity-50 mb-6"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-dark-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-dark-card px-3 text-muted">or with email</span>
          </div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {mode === "signup" && (
            <>
              <Field label="Username" htmlFor="username">
                <input
                  id="username"
                  type="text"
                  required
                  minLength={3}
                  maxLength={24}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="wallstreet_wizard"
                  className={inputClass}
                />
              </Field>

              <Field label="Team name" htmlFor="teamName">
                <input
                  id="teamName"
                  type="text"
                  required
                  maxLength={40}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Bull Run Brigade"
                  className={inputClass}
                />
              </Field>

              <Field label="Avatar color">
                <div className="flex gap-2 flex-wrap">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      title={color.label}
                      onClick={() => setAvatarColor(color.id)}
                      className={`w-9 h-9 rounded-full transition-transform ${
                        avatarColor === color.id
                          ? "ring-2 ring-gold ring-offset-2 ring-offset-dark-card scale-110"
                          : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: color.hex }}
                    />
                  ))}
                </div>
              </Field>
            </>
          )}

          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
          </Field>

          {message && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ${
                message.type === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-green-500/10 text-green-400 border border-green-500/20"
              }`}
            >
              {message.text}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={loading} className="w-full">
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-300 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
