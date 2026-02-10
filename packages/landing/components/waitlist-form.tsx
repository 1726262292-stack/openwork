"use client";

import { useCallback, useRef, useState } from "react";

const FORM_ACTION =
  "https://app.loops.so/api/newsletter-form/cmkhtp90l03np0i1z8iy6kccz";

type FormState = "idle" | "loading" | "success" | "error" | "rate-limited";

export function WaitlistForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setState("idle");
    setErrorMsg("");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const email = inputRef.current?.value?.trim();
      if (!email) return;

      // Rate limit: one signup per 60 s
      const now = Date.now();
      const prev = localStorage.getItem("loops-form-timestamp");
      if (prev && Number(prev) + 60_000 > now) {
        setState("rate-limited");
        setErrorMsg("Too many signups, please try again in a little while");
        return;
      }
      localStorage.setItem("loops-form-timestamp", String(now));

      setState("loading");

      try {
        const body =
          "userGroup=&mailingLists=&email=" + encodeURIComponent(email);
        const res = await fetch(FORM_ACTION, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        if (res.ok) {
          setState("success");
          if (inputRef.current) inputRef.current.value = "";
        } else {
          const data = await res.json().catch(() => null);
          setState("error");
          setErrorMsg(
            data?.message ?? res.statusText ?? "Something went wrong"
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "Failed to fetch") {
          setState("rate-limited");
          setErrorMsg("Too many signups, please try again in a little while");
          return;
        }
        setState("error");
        setErrorMsg(
          err instanceof Error ? err.message : "Something went wrong"
        );
        localStorage.setItem("loops-form-timestamp", "");
      }
    },
    []
  );

  return (
    <div className="waitlist-form-wrapper">
      {(state === "idle" || state === "loading") && (
        <form onSubmit={handleSubmit} className="waitlist-form">
          <input
            ref={inputRef}
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            className="waitlist-input"
            disabled={state === "loading"}
          />
          <button
            type="submit"
            className="waitlist-button"
            disabled={state === "loading"}
          >
            {state === "loading" ? "Please wait..." : "Join Waitlist"}
          </button>
        </form>
      )}

      {state === "success" && (
        <div className="waitlist-message waitlist-success-msg">
          <p>Thanks! We'll be in touch.</p>
          <button onClick={reset} className="waitlist-back">
            &larr; Back
          </button>
        </div>
      )}

      {(state === "error" || state === "rate-limited") && (
        <div className="waitlist-message waitlist-error-msg">
          <p>{errorMsg || "Oops! Something went wrong, please try again"}</p>
          <button onClick={reset} className="waitlist-back">
            &larr; Back
          </button>
        </div>
      )}
    </div>
  );
}
