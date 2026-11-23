
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SearchPage() {
  const [search, setSearch] = useState("");
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSearched(false);
    setStations([]);

    try {
      const { data: { user }, error: authError } =
        await supabase.auth.getUser();

      if (authError || !user) {
        setError("Please login first.");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("charging_stations")
        .select("*, chargers(*)")
        .order("name");

      if (fetchError) throw fetchError;

      const keyword = search.trim().toLowerCase();

      const results = (data || []).filter(
        (station) =>
          station.city.toLowerCase().includes(keyword) ||
          station.name.toLowerCase().includes(keyword)
      );

      setStations(results);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="max-w-5xl mx-auto">

        <h1 className="text-3xl font-bold text-green-700 mb-6">
          ChargeSpot
        </h1>

        <h2 className="text-xl mb-4">
          Find Charging Stations
        </h2>

        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            placeholder="Search by city or station name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-0 border rounded-lg p-3 bg-white"
          />

          <button
            type="submit"
            disabled={loading}
            className="bg-green-600 text-white px-5 rounded-lg"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {error && (
          <p className="text-red-600 mt-4">{error}</p>
        )}

        {searched && stations.length === 0 && (
          <p className="mt-5">No stations found.</p>
        )}

        <div className="grid md:grid-cols-2 gap-5 mt-8">

          {stations.map((station) => (
            <div
              key={station.id}
              className="bg-white rounded-xl shadow p-6"
            >
              <h3 className="text-xl font-bold text-green-700">
                {station.name}
              </h3>

              <p className="mt-2">{station.city}</p>
              <p className="text-gray-500">{station.address}</p>

              <p className="mt-3">
                Price: {station.price_per_kwh} SAR/kWh
              </p>

              <p>Opening Hours: {station.opening_hours}</p>

              <p className="text-green-600 font-semibold mt-3">
                Available Chargers:{" "}
                {station.chargers.filter(
                  (charger) => charger.status === "available"
                ).length}
              </p>

              <div className="mt-4 space-y-2">
                {station.chargers.map((charger) => (
                  <div
                    key={charger.id}
                    className="border rounded-lg p-3"
                  >
                    <p className="font-semibold">{charger.label}</p>

                    <p>
                      {charger.connector_type} | {charger.power_kw} kW
                    </p>

                    <p className={
                      charger.status === "available"
                        ? "text-green-600"
                        : charger.status === "occupied"
                        ? "text-orange-500"
                        : "text-red-600"
                    }>
                      {charger.status.replaceAll("_", " ")}
                    </p>
                  </div>
                ))}
              </div>

            </div>
          ))}

        </div>
      </div>
    </main>
  );
}