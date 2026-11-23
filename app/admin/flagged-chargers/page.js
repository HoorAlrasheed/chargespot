"use client";

// UC-14: Manage Flagged Chargers (admin only)
// Shows the charger problems reported by drivers. The admin can
//   - mark the charger out of service  (chargers.status = 'out_of_service')
//   - close the report after fixing it (charger_reports.status = 'resolved')

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const STATUS_STYLES = {
  available: "bg-green-100 text-green-800",
  occupied: "bg-yellow-100 text-yellow-800",
  out_of_service: "bg-red-100 text-red-800",
  open: "bg-orange-100 text-orange-800",
  resolved: "bg-gray-200 text-gray-700",
};

const STATUS_LABELS = {
  available: "Available",
  occupied: "Occupied",
  out_of_service: "Out of service",
  open: "Open",
  resolved: "Resolved",
};

function Badge({ value }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[value] || "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[value] || value}
    </span>
  );
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Reads the reports with their charger, station and reporter (driver).
function fetchReports(filter) {
  let query = supabase
    .from("charger_reports")
    .select(
      `id, description, status, created_at, resolved_at,
       charger:chargers ( id, label, status, connector_type,
                          station:charging_stations ( name, city ) ),
       reporter:profiles ( full_name, email )`
    )
    .order("created_at", { ascending: false });
  if (filter !== "all") query = query.eq("status", filter);
  return query;
}

export default function FlaggedChargersPage() {
  const router = useRouter();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [filter, setFilter] = useState("open"); // open | resolved | all
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // 1. Only admins can open this page.
  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profile?.role !== "admin") {
        router.replace("/driver/search");
        return;
      }
      setCheckingAccess(false);
    }
    checkAdmin();
  }, [router]);

  // 2. The system displays chargers with reported issues.
  const applyResult = useCallback(({ data, error }) => {
    if (error) {
      setError("Could not load the flagged chargers. Please refresh the page.");
      setReports([]);
    } else {
      setReports(data || []);
    }
    setLoading(false);
  }, []);

  const loadReports = useCallback(() => {
    return fetchReports(filter).then(applyResult);
  }, [filter, applyResult]);

  useEffect(() => {
    if (checkingAccess) return;
    let active = true;
    fetchReports(filter).then((result) => {
      if (active) applyResult(result);
    });
    return () => {
      active = false;
    };
  }, [checkingAccess, filter, applyResult]);

  // 3a. Mark the reported charger out of service.
  async function markOutOfService(report) {
    const charger = report.charger;
    if (!charger) {
      setError("This charger no longer exists.");
      return;
    }
    const ok = window.confirm(
      `Mark ${charger.label} at ${charger.station?.name ?? "this station"} as OUT OF SERVICE?\nDrivers will not be able to book it.`
    );
    if (!ok) return;

    setBusyId(report.id);
    setError("");
    setMessage("");
    const { data, error } = await supabase
      .from("chargers")
      .update({ status: "out_of_service" })
      .eq("id", charger.id)
      .select("id");
    setBusyId(null);

    if (error || !data?.length) {
      setError("Could not update the charger status. Please try again.");
      return;
    }
    setMessage(`${charger.label} at ${charger.station?.name ?? ""} is now out of service.`);
    loadReports();
  }

  // 3b. Close the report after the problem is fixed.
  async function closeReport(report) {
    const ok = window.confirm(
      "Close this report? Do this only after the problem has been fixed."
    );
    if (!ok) return;

    setBusyId(report.id);
    setError("");
    setMessage("");
    const { data, error } = await supabase
      .from("charger_reports")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", report.id)
      .select("id");
    setBusyId(null);

    if (error || !data?.length) {
      setError("Could not close the report. Please try again.");
      return;
    }
    setMessage("The report was closed.");
    loadReports();
  }

  if (checkingAccess) {
    return <p className="p-8 text-gray-500">Checking access...</p>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flagged Chargers</h1>
          <p className="text-sm text-gray-500">
            Charger problems reported by drivers. Mark a faulty charger out of service, then close the report once it is fixed.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
          {["open", "resolved", "all"].map((f) => (
            <button
              key={f}
              onClick={() => {
                if (f === filter) return;
                setLoading(true);
                setError("");
                setFilter(f);
              }}
              className={`rounded-md px-3 py-1.5 capitalize ${filter === f ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-4 py-3">Station</th>
              <th className="px-4 py-3">Charger</th>
              <th className="px-4 py-3">Charger status</th>
              <th className="px-4 py-3">Reported by</th>
              <th className="px-4 py-3">Problem</th>
              <th className="px-4 py-3">Reported on</th>
              <th className="px-4 py-3">Report</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                {filter === "open" ? "No open reports. All chargers are fine." : "No reports found."}
              </td></tr>
            ) : (
              reports.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.charger?.station?.name ?? "-"}</div>
                    <div className="text-xs text-gray-500">{r.charger?.station?.city}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.charger?.label ?? "Deleted charger"}</div>
                    <div className="text-xs text-gray-500">{r.charger?.connector_type}</div>
                  </td>
                  <td className="px-4 py-3">{r.charger ? <Badge value={r.charger.status} /> : "-"}</td>
                  <td className="px-4 py-3">
                    <div>{r.reporter?.full_name || "Unknown driver"}</div>
                    <div className="text-xs text-gray-500">{r.reporter?.email}</div>
                  </td>
                  <td className="max-w-xs px-4 py-3 whitespace-pre-wrap">{r.description}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <Badge value={r.status} />
                    {r.resolved_at && (
                      <div className="mt-1 text-xs text-gray-500 whitespace-nowrap">{formatDate(r.resolved_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "open" ? (
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => markOutOfService(r)}
                          disabled={busyId === r.id || !r.charger || r.charger.status === "out_of_service"}
                          className="w-48 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                        >
                          {r.charger?.status === "out_of_service" ? "Already out of service" : "Mark charger out of service"}
                        </button>
                        <button
                          onClick={() => closeReport(r)}
                          disabled={busyId === r.id}
                          className="w-48 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Close report
                        </button>
                      </div>
                    ) : (
                      <div className="text-right text-xs text-gray-400">No actions</div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Tip: after the charger is repaired, set it back to &quot;available&quot; from the Chargers page.
      </p>
    </main>
  );
}
