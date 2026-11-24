"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (error) throw error;

      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("role, is_suspended")
          .eq("id", data.user.id)
          .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error("Profile not found");
      }

      if (profile.is_suspended) {
        await supabase.auth.signOut();
        throw new Error("Your account is suspended");
      }

      if (profile.role === "admin") {
        router.replace("/admin/flagged-chargers");
      } else if (profile.role === "driver") {
        router.replace("/driver/search");
      } else {
        await supabase.auth.signOut();
        throw new Error("Invalid account role");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const { error } =
        await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/reset-password`,
          }
        );

      if (error) throw error;

      setSuccess(
        "If an account exists for this email, a password reset link will be sent."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setForgotPassword(!forgotPassword);
    setError("");
    setSuccess("");
    setPassword("");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <form
        onSubmit={
          forgotPassword ? handleResetPassword : handleLogin
        }
        className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-gray-900"
      >
        <h1 className="text-3xl font-bold text-green-600 text-center">
          ChargeSpot
        </h1>

        <h2 className="text-xl text-center my-4">
          {forgotPassword ? "Reset Password" : "Login"}
        </h2>

        {forgotPassword && (
          <p className="text-gray-600 text-sm mb-4">
            Enter your email to receive a password reset link.
          </p>
        )}

        <input
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border p-3 rounded mb-4"
          required
        />

        {!forgotPassword && (
          <>
            <input
              type="password"
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border p-3 rounded mb-3"
              required
            />

            <div className="text-right mb-4">
              <button
                type="button"
                onClick={switchMode}
                disabled={loading}
                className="text-green-700 text-sm hover:underline"
              >
                Forgot Password?
              </button>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-red-600 bg-red-50 p-3 rounded mb-4">
            {error}
          </p>
        )}

        {success && (
          <p role="status" className="text-green-700 bg-green-50 p-3 rounded mb-4">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 text-white p-3 rounded disabled:opacity-50"
        >
          {loading
            ? "Please wait..."
            : forgotPassword
            ? "Send Reset Link"
            : "Login"}
        </button>

        {forgotPassword ? (
          <button
            type="button"
            onClick={switchMode}
            disabled={loading}
            className="w-full text-green-700 mt-4 hover:underline"
          >
            Back to Login
          </button>
        ) : (
          <p className="text-center mt-5 text-sm">
            Don't have an account?{" "}
            <Link
              href="/register"
              className="text-green-700 font-semibold hover:underline"
            >
              Sign Up
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}