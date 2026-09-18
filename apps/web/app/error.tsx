"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-error">
      <p className="kicker">SP-1 · ERROR</p>
      <h1>Something broke</h1>
      <p className="error">{error.message || "Unexpected client error"}</p>
      <button type="button" className="btn" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
