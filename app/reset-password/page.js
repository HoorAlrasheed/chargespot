"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session) {
          setReady(true);
          setChecking(false);
          setError("");
        }
      });

    const timer = setTimeout(() => {
      setChecking(false);
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleReset(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!ready) {
      setError("Please open a valid password reset link.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setSuccess("Password updated successfully.");
      setPassword("");
      setConfirmPassword("");
      setReady(false);

      await supabase.auth.signOut();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-gray-900">

        <h1 className="text-3xl font-bold text-green-600 text-center">
          ChargeSpot
        </h1>

        <h2 className="text-xl text-center my-4">
          Set New Password
        </h2>

        {checking && !ready && (
          <p className="text-gray-600 text-center mb-4">
            Checking reset link...
          </p>
        )}

        {!checking && !ready && !success && (
          <p className="text-red-600 bg-red-50 p-3 rounded mb-4">
            Reset link is invalid or expired.
            Please request a new link.
          </p>
        )}

        {ready && !success && (
          <form onSubmit={handleReset}>
            <input
              type="password"
              placeholder="New Password"
              aria-label="New Password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border p-3 rounded mb-4"
              minLength={6}
              required
            />

            <input
              type="password"
              placeholder="Confirm New Password"
              aria-label="Confirm New Password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) =>
                setConfirmPassword(e.target.value)
              }
              className="w-full border p-3 rounded mb-4"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 text-white p-3 rounded disabled:opacity-50"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-red-600 bg-red-50 p-3 rounded mt-4">
            {error}
          </p>
        )}

        {success && (
          <p role="status" className="text-green-700 bg-green-50 p-3 rounded mt-4">
            {success}
          </p>
        )}

        <Link
          href="/login"
          className="block text-center text-green-700 mt-5 hover:underline"
        >
          Back to Login
        </Link>

      </div>
    </main>
  );
}