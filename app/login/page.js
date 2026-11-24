"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email,
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

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleLogin}
        className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-gray-900"
      >
        <h1 className="text-3xl font-bold text-green-600 text-center">
          ChargeSpot
        </h1>

        <h2 className="text-xl text-center my-4">
          Login
        </h2>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border p-3 rounded mb-4"
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border p-3 rounded mb-4"
          required
        />

        {error && (
          <p className="text-red-600 mb-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 text-white p-3 rounded"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </main>
  );
}