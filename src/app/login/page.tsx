"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/core/firebase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      router.replace("/dashboard");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Inloggen is mislukt. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <section className="auth-card">
        <p className="eyebrow">THE DOST MATRIX</p>
        <h1>{mode === "login" ? "Welkom terug, Elroy." : "Activeer je Matrix-account."}</h1>
        <p className="muted">
          Beveiligde toegang tot Matrix Core, missies en approvals.
        </p>

        <form onSubmit={submit} className="stack">
          <label>
            E-mailadres
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Wachtwoord
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="primary" disabled={busy}>
            {busy
              ? "Bezig..."
              : mode === "login"
                ? "Matrix openen"
                : "Account aanmaken"}
          </button>
        </form>

        <button
          className="text-button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "Eerste keer? Account aanmaken"
            : "Al een account? Inloggen"}
        </button>
      </section>
    </main>
  );
}
