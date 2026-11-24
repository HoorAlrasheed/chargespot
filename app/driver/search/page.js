
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SearchPage() {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [connectorType, setConnectorType] = useState("All");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");

  const [reportCharger, setReportCharger] = useState(null);
  const [description, setDescription] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");

  const [reports, setReports] = useState([]);
  const [showReports, setShowReports] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");

  const activeFilters = useRef(null);
  const requestId = useRef(0);

  const fetchStations = useCallback(async (filters) => {
    const id = ++requestId.current;

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("Please login first.");
      }

      const { data, error: fetchError } = await supabase
        .from("charging_stations")
        .select("*, chargers(*)")
        .order("name");

      if (fetchError) throw fetchError;

      const keyword = filters.search.trim().toLowerCase();

      const results = (data || [])
        .filter(
          (station) =>
            station.city.toLowerCase().includes(keyword) ||
            station.name.toLowerCase().includes(keyword)
        )
        .filter(
          (station) =>
            filters.maxPrice === "" ||
            Number(station.price_per_kwh) <= Number(filters.maxPrice)
        )
        .map((station) => ({
          ...station,
          chargers: (station.chargers || []).filter(
            (charger) =>
              (filters.connectorType === "All" ||
                charger.connector_type === filters.connectorType) &&
              (!filters.availableOnly ||
                charger.status === "available")
          ),
        }))
        .filter(
          (station) =>
            (filters.connectorType === "All" &&
              !filters.availableOnly) ||
            station.chargers.length > 0
        );

      if (id === requestId.current) {
        setStations(results);
        setSearched(true);
      }
    } catch (err) {
      if (id === requestId.current) {
        setError(err.message);
      }
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, []);

  function handleSearch(e) {
    e.preventDefault();

    if (
      maxPrice !== "" &&
      (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) < 0)
    ) {
      setError("Please enter a valid maximum price.");
      return;
    }

    const filters = {
      search,
      connectorType,
      availableOnly,
      maxPrice,
    };

    activeFilters.current = filters;
    fetchStations(filters);
  }

  function resetFilters() {
    setSearch("");
    setConnectorType("All");
    setAvailableOnly(false);
    setMaxPrice("");

    const filters = {
      search: "",
      connectorType: "All",
      availableOnly: false,
      maxPrice: "",
    };

    activeFilters.current = filters;
    fetchStations(filters);
  }

  useEffect(() => {
    const channel = supabase
      .channel("driver-charger-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chargers",
        },
        () => {
          if (activeFilters.current) {
            fetchStations(activeFilters.current);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStations]);

  function openReport(charger, station) {
    setReportCharger({
      id: charger.id,
      label: charger.label,
      stationName: station.name,
    });

    setDescription("");
    setReportError("");
    setSuccess("");
  }

  async function submitReport(e) {
    e.preventDefault();

    if (!description.trim()) {
      setReportError("Please describe the problem.");
      return;
    }

    setReporting(true);
    setReportError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("Please login first.");
      }

      const { error: insertError } = await supabase
        .from("charger_reports")
        .insert({
          charger_id: reportCharger.id,
          driver_id: user.id,
          description: description.trim(),
        });

      if (insertError) throw insertError;

      setSuccess("Problem reported successfully.");
      setReportCharger(null);
      setDescription("");

      if (showReports) {
        await loadReports();
      }
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReporting(false);
    }
  }

  async function loadReports() {
    setReportsLoading(true);
    setReportsError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("Please login first.");
      }

      const { data, error: fetchError } = await supabase
        .from("charger_reports")
        .select("*, chargers(label, charging_stations(name))")
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      setReports(data || []);
    } catch (err) {
      setReportsError(err.message);
    } finally {
      setReportsLoading(false);
    }
  }

  function toggleReports() {
    if (showReports) {
      setShowReports(false);
    } else {
      setShowReports(true);
      loadReports();
    }
  }

  async function handleLogout() {
    const { error: logoutError } = await supabase.auth.signOut();

    if (logoutError) {
      setError(logoutError.message);
      return;
    }

    router.replace("/login");
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6 text-gray-900">
      <div className="max-w-5xl mx-auto">

        <h1 className="text-3xl font-bold text-green-700 mb-6">
          ChargeSpot
        </h1>

        <div className="flex flex-wrap gap-3 mb-6">
          <Link
            href="/driver/profile"
            className="bg-green-600 text-white px-4 py-2 rounded-lg"
          >
            My Profile
          </Link>

          <Link
            href="/driver/reservations"
            className="bg-green-600 text-white px-4 py-2 rounded-lg"
          >
            My Reservations
          </Link>

          <button
            type="button"
            onClick={toggleReports}
            className="bg-green-600 text-white px-4 py-2 rounded-lg"
          >
            {showReports ? "Hide Reports" : "My Reports"}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="bg-red-600 text-white px-4 py-2 rounded-lg"
          >
            Logout
          </button>
        </div>

        {success && (
          <p role="status" className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">
            {success}
          </p>
        )}

        {error && (
          <p role="alert" className="bg-red-100 text-red-700 p-3 rounded-lg mb-4">
            {error}
          </p>
        )}

        {showReports && (
          <section className="bg-white rounded-xl shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-green-700">
                My Reports
              </h2>

              <button
                onClick={loadReports}
                disabled={reportsLoading}
                className="text-green-700 underline"
              >
                Refresh
              </button>
            </div>

            {reportsLoading && <p>Loading reports...</p>}

            {reportsError && (
              <p className="text-red-600">{reportsError}</p>
            )}

            {!reportsLoading && !reportsError && reports.length === 0 && (
              <p>No reports submitted yet.</p>
            )}

            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="border rounded-lg p-4">
                  <p className="font-semibold">
                    {report.chargers?.charging_stations?.name || "Charging Station"}
                  </p>

                  <p>{report.chargers?.label || "Charger"}</p>

                  <p className="mt-2">{report.description}</p>

                  <p className={
                    report.status === "resolved"
                      ? "text-green-600 font-medium"
                      : "text-orange-600 font-medium"
                  }>
                    Status: {report.status}
                  </p>

                  <p className="text-sm text-gray-500 mt-2">
                    {new Date(report.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <h2 className="text-xl font-semibold mb-4">
          Find Charging Stations
        </h2>

        <form
          onSubmit={handleSearch}
          className="bg-white rounded-xl shadow p-5"
        >
          <div className="grid sm:grid-cols-3 gap-4 mb-4">

            <div>
              <label className="block mb-2 font-medium">
                Connector Type
              </label>

              <select
                value={connectorType}
                onChange={(e) => setConnectorType(e.target.value)}
                className="w-full border rounded-lg p-3 bg-white"
              >
                <option value="All">All Connectors</option>
                <option value="Type 2">Type 2</option>
                <option value="CCS2">CCS2</option>
                <option value="CHAdeMO">CHAdeMO</option>
              </select>
            </div>

            <div>
              <label className="block mb-2 font-medium">
                Maximum Price (SAR/kWh)
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Enter maximum price"
                className="w-full border rounded-lg p-3 bg-white"
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(e) => setAvailableOnly(e.target.checked)}
              />
              Available Only
            </label>

          </div>

          <div className="flex flex-wrap gap-3">
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
              className="bg-green-600 text-white px-5 py-3 rounded-lg"
            >
              {loading ? "Searching..." : "Search"}
            </button>

            <button
              type="button"
              onClick={resetFilters}
              className="bg-gray-200 px-4 py-3 rounded-lg"
            >
              Reset Filters
            </button>
          </div>
        </form>

        {searched && !loading && stations.length === 0 && (
          <p className="mt-5">No stations found.</p>
        )}

        {searched && (
          <p className="mt-5 text-gray-600">
            {stations.length} station(s) found
          </p>
        )}

        <div className="grid md:grid-cols-2 gap-5 mt-6">
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

              <div className="mt-4 space-y-3">
                {station.chargers.map((charger) => (
                  <div
                    key={charger.id}
                    className="border rounded-lg p-4"
                  >
                    <p className="font-semibold">
                      {charger.label}
                    </p>

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

                    <div className="flex flex-wrap gap-2 mt-3">

                      {charger.status === "available" && (
                        <Link
                          href={`/driver/reserve?stationId=${station.id}&chargerId=${charger.id}`}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
                        >
                          Book Now
                        </Link>
                      )}

                      <button
                        type="button"
                        onClick={() => openReport(charger, station)}
                        className="border border-red-500 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg"
                      >
                        Report a Problem
                      </button>

                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {reportCharger && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="report-title"
              className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md"
            >
              <h2 id="report-title" className="text-xl font-bold text-green-700 mb-3">
                Report a Problem
              </h2>

              <p className="font-semibold">
                {reportCharger.stationName}
              </p>

              <p className="text-gray-600 mb-4">
                {reportCharger.label}
              </p>

              <form onSubmit={submitReport}>
                <label className="block font-medium mb-2">
                  Problem Description
                </label>

                <textarea
                  required
                  maxLength={1000}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the charger problem..."
                  className="w-full border rounded-lg p-3"
                />

                {reportError && (
                  <p className="text-red-600 mt-2">{reportError}</p>
                )}

                <div className="flex justify-end gap-3 mt-4">
                  <button
                    type="button"
                    disabled={reporting}
                    onClick={() => setReportCharger(null)}
                    className="bg-gray-200 px-4 py-2 rounded-lg"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={reporting}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg"
                  >
                    {reporting ? "Submitting..." : "Submit Report"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}