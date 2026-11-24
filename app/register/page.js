"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister(e) {
    e.preventDefault();
    setError("");

    if (!fullName.trim() || !phone.trim()) {
      setError("Please complete all fields.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
          },
        },
      });

      if (error) throw error;

      await supabase.auth.signOut();
      router.replace("/login");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle =
    "w-full border border-gray-300 p-3 rounded-lg mb-4 text-gray-900";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <form
        onSubmit={handleRegister}
        className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-gray-900"
      >
        <h1 className="text-3xl font-bold text-green-600 text-center">
          ChargeSpot
        </h1>

        <h2 className="text-xl text-center mt-4 mb-6">
          Create an Account
        </h2>

        <input
          type="text"
          placeholder="Full Name"
          aria-label="Full Name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputStyle}
          required
        />

        <input
          type="email"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputStyle}
          required
        />

        <input
          type="tel"
          placeholder="Phone Number"
          aria-label="Phone Number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputStyle}
          required
        />

        <input
          type="password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputStyle}
          required
        />

        <input
          type="password"
          placeholder="Confirm Password"
          aria-label="Confirm Password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputStyle}
          required
        />

        {error && (
          <p role="alert" className="text-red-600 mb-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 text-white p-3 rounded-lg disabled:opacity-50"
        >
          {loading ? "Creating Account..." : "Create Account"}
        </button>

        <p className="text-center mt-5 text-sm text-gray-600">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-green-600 font-semibold"
          >
            Login
          </Link>
        </p>
      </form>
    </main>
  );
}