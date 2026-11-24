"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { checkSlotConflict, friendlyReservationError } from "@/lib/reservations";

export default function MyReservationsPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  // Selected reservation for viewing details (UC-09)
  const [detailsRes, setDetailsRes] = useState(null);

  // Selected reservation for modifying (UC-07)
  const [editingRes, setEditingRes] = useState(null);
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Selected reservation for cancel confirmation (UC-07)
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  async function loadReservations(driverId) {
    const { data, error } = await supabase
      .from("reservations")
      .select(
        `
        *,
        chargers (
          label,
          connector_type,
          power_kw,
          charging_stations (
            name,
            city,
            price_per_kwh
          )
        ),
        payments (
          id,
          amount,
          card_last4,
          status,
          paid_at
        )
      `
      )
      .eq("driver_id", driverId)
      .order("start_time", { ascending: false });

    if (!error && data) {
      setReservations(data);
    }
  }

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/login");
        return;
      }

      setUser(session.user);
      await loadReservations(session.user.id);
      setLoading(false);
    }

    init();
  }, [router]);

  function isUpcoming(res) {
    return (
      (res.status === "confirmed" || res.status === "pending_payment") &&
      new Date(res.start_time) > new Date()
    );
  }

  function openModifyModal(res) {
    const startObj = new Date(res.start_time);
    const endObj = new Date(res.end_time);

    const pad = (n) => String(n).padStart(2, "0");
    const localDate = `${startObj.getFullYear()}-${pad(startObj.getMonth() + 1)}-${pad(
      startObj.getDate()
    )}`;
    const localStart = `${pad(startObj.getHours())}:${pad(startObj.getMinutes())}`;
    const localEnd = `${pad(endObj.getHours())}:${pad(endObj.getMinutes())}`;

    setEditingRes(res);
    setEditDate(localDate);
    setEditStart(localStart);
    setEditEnd(localEnd);
    setEditError("");
    setFeedback({ type: "", text: "" });
  }

  // UC-07: Modify Reservation (TC-07-01 & TC-07-02)
  async function handleSaveModify(e) {
    e.preventDefault();
    setEditError("");

    const newStart = new Date(`${editDate}T${editStart}`);
    const newEnd = new Date(`${editDate}T${editEnd}`);
    const now = new Date();

    if (newStart < now) {
      setEditError("You cannot move a reservation to a time in the past.");
      return;
    }
    if (newEnd <= newStart) {
      setEditError("The end time must be after the start time.");
      return;
    }

    setSavingEdit(true);

    // Check slot conflict while ignoring this reservation's own ID
    const { data: hasConflict, error: conflictErr } = await checkSlotConflict(
      editingRes.charger_id,
      newStart,
      newEnd,
      editingRes.id
    );

    if (conflictErr) {
      setSavingEdit(false);
      setEditError(conflictErr);
      return;
    }

    // TC-07-02: Replacement slot unavailable -> original remains unchanged
    if (hasConflict) {
      setSavingEdit(false);
      setEditError(
        "The selected time slot is already reserved. Your original reservation remains unchanged."
      );
      return;
    }

    // Recalculate total amount based on new duration
    const hours = (newEnd - newStart) / (1000 * 60 * 60);
    const pricePerKwh = Number(editingRes.chargers?.charging_stations?.price_per_kwh || 1.25);
    const newTotal = Number((hours * 10 * pricePerKwh).toFixed(2));

    const { error: updateErr } = await supabase
      .from("reservations")
      .update({
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
        total_amount: newTotal,
      })
      .eq("id", editingRes.id)
      .eq("driver_id", user.id);

    setSavingEdit(false);

    if (updateErr) {
      setEditError(friendlyReservationError(updateErr));
      return;
    }

    await loadReservations(user.id);
    setEditingRes(null);
    setFeedback({
      type: "success",
      text: "Reservation time updated successfully.",
    });
  }

  // UC-07: Cancel Reservation (TC-07-03)
  async function handleConfirmCancel(reservationId) {
    setCancelBusy(true);
    setFeedback({ type: "", text: "" });

    const { error } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", reservationId)
      .eq("driver_id", user.id);

    setCancelBusy(false);
    setCancellingId(null);

    if (error) {
      setFeedback({
        type: "error",
        text: "Could not cancel the reservation. Please try again.",
      });
      return;
    }

    await loadReservations(user.id);
    setFeedback({
      type: "success",
      text: "Reservation cancelled. The time slot is now available again.",
    });
  }

  function statusBadge(status) {
    const styles = {
      confirmed: "bg-emerald-100 text-emerald-800",
      pending_payment: "bg-amber-100 text-amber-800",
      cancelled: "bg-red-100 text-red-700",
      completed: "bg-blue-100 text-blue-800",
    };
    return (
      <span
        className={`text-xs px-2.5 py-0.5 rounded-full font-medium capitalize ${
          styles[status] || "bg-gray-100 text-gray-700"
        }`}
      >
        {status.replace("_", " ")}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-600">Loading your reservations...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              My Reservations &amp; History
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              View, modify, or cancel your upcoming bookings and review past receipts.
            </p>
          </div>
          <Link
            href="/driver/reserve"
            className="inline-block text-center bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
          >
            + New Reservation
          </Link>
        </div>

        {/* Feedback Banner */}
        {feedback.text && (
          <div
            className={`p-4 rounded-lg border text-sm ${
              feedback.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Empty State (TC-09-02) */}
        {reservations.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-3">
            <h2 className="text-lg font-semibold text-gray-800">
              No Reservations Yet
            </h2>
            <p className="text-sm text-gray-500">
              You have no upcoming or past charging reservations in your history.
            </p>
            <Link
              href="/driver/reserve"
              className="inline-block mt-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
            >
              Reserve a Charging Slot
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {reservations.map((res) => {
              const station = res.chargers?.charging_stations;
              const charger = res.chargers;
              const upcoming = isUpcoming(res);
              const latestPayment =
                res.payments && res.payments.length > 0 ? res.payments[0] : null;

              return (
                <div
                  key={res.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-gray-900 text-base">
                          {station?.name || "Charging Station"}
                        </h2>
                        {statusBadge(res.status)}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {station?.city} · {charger?.label} ({charger?.connector_type},{" "}
                        {charger?.power_kw} kW)
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-bold text-emerald-700">
                        {Number(res.total_amount).toFixed(2)} SAR
                      </p>
                      {latestPayment && (
                        <p className="text-xs text-gray-500">
                          Card •••• {latestPayment.card_last4} ({latestPayment.status})
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 flex flex-col sm:flex-row sm:justify-between gap-1">
                    <span>
                      <strong>Start:</strong>{" "}
                      {new Date(res.start_time).toLocaleString()}
                    </span>
                    <span>
                      <strong>End:</strong> {new Date(res.end_time).toLocaleString()}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDetailsRes(res)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                    >
                      View Details &amp; Receipt
                    </button>

                    {res.status === "pending_payment" && upcoming && (
                      <Link
                        href={`/driver/payment?reservationId=${res.id}`}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition"
                      >
                        Complete Payment
                      </Link>
                    )}

                    {upcoming && (
                      <>
                        <button
                          type="button"
                          onClick={() => openModifyModal(res)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                        >
                          Modify
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancellingId(res.id)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Details & Payment Records (UC-09) */}
      {detailsRes && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                Reservation Details
              </h2>
              <button
                type="button"
                onClick={() => setDetailsRes(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="space-y-2 text-sm border-t border-b border-gray-200 py-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Station:</span>
                <span className="font-medium text-gray-900">
                  {detailsRes.chargers?.charging_stations?.name} (
                  {detailsRes.chargers?.charging_stations?.city})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Charger:</span>
                <span className="font-medium text-gray-900">
                  {detailsRes.chargers?.label} ({detailsRes.chargers?.connector_type})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Start Time:</span>
                <span className="font-medium text-gray-900">
                  {new Date(detailsRes.start_time).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">End Time:</span>
                <span className="font-medium text-gray-900">
                  {new Date(detailsRes.end_time).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                {statusBadge(detailsRes.status)}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Amount:</span>
                <span className="font-bold text-emerald-700">
                  {Number(detailsRes.total_amount).toFixed(2)} SAR
                </span>
              </div>
            </div>

            {/* Payment Records */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Payment Records
              </h3>
              {!detailsRes.payments || detailsRes.payments.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No payment records for this reservation.
                </p>
              ) : (
                <div className="space-y-2">
                  {detailsRes.payments.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          Card •••• •••• •••• {p.card_last4}
                        </p>
                        <p className="text-gray-500">
                          {new Date(p.paid_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          {Number(p.amount).toFixed(2)} SAR
                        </p>
                        <span
                          className={`capitalize font-medium ${
                            p.status === "success"
                              ? "text-emerald-700"
                              : "text-red-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDetailsRes(null)}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium py-2 rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Modify Reservation (UC-07) */}
      {editingRes && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-lg">
            <h2 className="text-lg font-bold text-gray-900">
              Modify Reservation Time
            </h2>

            {editError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveModify} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Date
                </label>
                <input
                  type="date"
                  value={editDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRes(null)}
                  disabled={savingEdit}
                  className="w-1/2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="w-1/2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition"
                >
                  {savingEdit ? "Checking..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Cancel Confirmation (UC-07) */}
      {cancellingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 space-y-4 shadow-lg">
            <h2 className="text-lg font-bold text-gray-900">
              Cancel Reservation?
            </h2>
            <p className="text-sm text-gray-600">
              Are you sure you want to cancel this reservation? The time slot will
              become available for other drivers.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCancellingId(null)}
                disabled={cancelBusy}
                className="w-1/2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg transition"
              >
                Keep Booking
              </button>
              <button
                type="button"
                onClick={() => handleConfirmCancel(cancellingId)}
                disabled={cancelBusy}
                className="w-1/2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition"
              >
                {cancelBusy ? "Cancelling..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}