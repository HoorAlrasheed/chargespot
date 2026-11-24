"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdminDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  // Dashboard KPIs (TC-13-01)
  const [stats, setStats] = useState({
    totalStations: 0,
    totalChargers: 0,
    availableChargers: 0,
    todayReservations: 0,
    totalRevenue: 0,
  });

  // Reports data & date range filter (TC-13-02)
  const [allReservations, setAllReservations] = useState([]);
  const [allPayments, setAllPayments] = useState([]);

  const todayStr = new Date().toISOString().split("T")[0];
  const firstOfMonthStr = `${todayStr.slice(0, 7)}-01`;

  const [fromDate, setFromDate] = useState(firstOfMonthStr);
  const [toDate, setToDate] = useState(todayStr);

  useEffect(() => {
    async function init() {
      // 1. Check authentication (TC-NF-02)
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/login");
        return;
      }

      // 2. Check role-based access (TC-NF-01: Admin only)
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (!profile || profile.role !== "admin") {
        router.replace("/driver/reserve");
        return;
      }

      setAuthorized(true);

      // 3. Fetch dashboard & report data from Supabase
      const [stationsRes, chargersRes, reservationsRes, paymentsRes] =
        await Promise.all([
          supabase.from("charging_stations").select("id, name, city"),
          supabase.from("chargers").select("id, status, station_id"),
          supabase
            .from("reservations")
            .select(
              `
              id,
              start_time,
              end_time,
              status,
              total_amount,
              created_at,
              chargers (
                label,
                charging_stations (
                  name,
                  city
                )
              )
            `
            )
            .order("start_time", { ascending: false }),
          supabase.from("payments").select("id, reservation_id, amount, status, paid_at"),
        ]);

      const stations = stationsRes.data || [];
      const chargers = chargersRes.data || [];
      const reservations = reservationsRes.data || [];
      const payments = paymentsRes.data || [];

      // Calculate Today's Reservations
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const todayCount = reservations.filter((r) => {
        const t = new Date(r.start_time);
        return t >= startOfToday && t <= endOfToday;
      }).length;

      // Calculate Total Revenue (successful payments only)
      const revenue = payments
        .filter((p) => p.status === "success")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      setStats({
        totalStations: stations.length,
        totalChargers: chargers.length,
        availableChargers: chargers.filter((c) => c.status === "available").length,
        todayReservations: todayCount,
        totalRevenue: revenue,
      });

      setAllReservations(reservations);
      setAllPayments(payments);
      setLoading(false);
    }

    init();
  }, [router]);

  // Filter reservations for the selected reporting period
  const filteredReservations = allReservations.filter((r) => {
    if (!fromDate || !toDate) return true;
    const resDate = new Date(r.start_time);
    const start = new Date(`${fromDate}T00:00:00`);
    const end = new Date(`${toDate}T23:59:59`);
    return resDate >= start && resDate <= end;
  });

  // Calculate period metrics
  const periodConfirmed = filteredReservations.filter(
    (r) => r.status === "confirmed" || r.status === "completed"
  ).length;
  const periodCancelled = filteredReservations.filter(
    (r) => r.status === "cancelled"
  ).length;

  const filteredReservationIds = new Set(filteredReservations.map((r) => r.id));
  const periodRevenue = allPayments
    .filter((p) => p.status === "success" && filteredReservationIds.has(p.reservation_id))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Export CSV report
  function handleExportCSV() {
    if (filteredReservations.length === 0) return;

    const headers = ["Reservation ID", "Station", "City", "Charger", "Start Time", "Status", "Amount (SAR)"];
    const rows = filteredReservations.map((r) => [
      r.id,
      r.chargers?.charging_stations?.name || "",
      r.chargers?.charging_stations?.city || "",
      r.chargers?.label || "",
      new Date(r.start_time).toLocaleString(),
      r.status,
      Number(r.total_amount).toFixed(2),
    ]);

    const csvContent =
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chargespot-report-${fromDate}-to-${toDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-600">Loading admin dashboard...</p>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Admin Dashboard &amp; Reports
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Overview of charging stations, live reservations, and platform revenue.
          </p>
        </div>

        {/* KPI Cards (TC-13-01) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase">
              Total Stations
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {stats.totalStations}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase">
              Total Chargers
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {stats.totalChargers}
            </p>
            <p className="text-xs text-emerald-700 mt-1">
              {stats.availableChargers} currently available
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase">
              Today&apos;s Reservations
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {stats.todayReservations}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase">
              Total Revenue
            </p>
            <p className="text-3xl font-bold text-emerald-700 mt-2">
              {stats.totalRevenue.toFixed(2)}{" "}
              <span className="text-base font-medium">SAR</span>
            </p>
          </div>
        </div>

        {/* Reports Section (TC-13-02) */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Usage &amp; Revenue Report
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Select a reporting period to view reservations and revenue.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  To Date
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
                />
              </div>
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={filteredReservations.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Export CSV
              </button>
            </div>
          </div>

          {/* Empty Report State (TC-13-02) */}
          {filteredReservations.length === 0 ? (
            <div className="p-8 rounded-lg bg-gray-50 border border-dashed border-gray-300 text-center">
              <p className="text-sm font-medium text-gray-700">
                No reservations found for the selected reporting period.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Try choosing a different date range to view usage and revenue data.
              </p>
            </div>
          ) : (
            <>
              {/* Period Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-500">Period Reservations</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">
                    {filteredReservations.length}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {periodConfirmed} confirmed · {periodCancelled} cancelled
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-500">Period Revenue</p>
                  <p className="text-xl font-bold text-emerald-700 mt-1">
                    {periodRevenue.toFixed(2)} SAR
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-500">Reporting Window</p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">
                    {fromDate} &rarr; {toDate}
                  </p>
                </div>
              </div>

              {/* Reservations Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                      <th className="py-2.5 pr-4">Station</th>
                      <th className="py-2.5 pr-4">Charger</th>
                      <th className="py-2.5 pr-4">Start Time</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredReservations.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-3 pr-4 font-medium text-gray-900">
                          {r.chargers?.charging_stations?.name || "—"}
                          <span className="block text-xs text-gray-500 font-normal">
                            {r.chargers?.charging_stations?.city || ""}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-gray-700">
                          {r.chargers?.label || "—"}
                        </td>
                        <td className="py-3 pr-4 text-gray-700">
                          {new Date(r.start_time).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 capitalize">
                            {r.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-3 text-right font-semibold text-gray-900">
                          {Number(r.total_amount).toFixed(2)} SAR
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}