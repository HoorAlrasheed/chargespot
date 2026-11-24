"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { checkSlotConflict, saveReservation } from "@/lib/reservations";

function ReserveContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStationId = searchParams.get("stationId") || "";
  const initialChargerId = searchParams.get("chargerId") || "";

  const [user, setUser] = useState(null);
  const [stations, setStations] = useState([]);
  const [chargers, setChargers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [selectedStationId, setSelectedStationId] = useState(initialStationId);
  const [selectedChargerId, setSelectedChargerId] = useState(initialChargerId);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");

  const [bookedSlots, setBookedSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [step, setStep] = useState("select"); // "select" | "review"

  // 1. Check authentication & load initial data (TC-NF-02)
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

      const [stationsRes, vehiclesRes] = await Promise.all([
        supabase.from("charging_stations").select("*").order("name"),
        supabase
          .from("vehicles")
          .select("*")
          .eq("driver_id", session.user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (stationsRes.data) {
        setStations(stationsRes.data);
        if (!initialStationId && stationsRes.data.length > 0) {
          setSelectedStationId(stationsRes.data[0].id);
        }
      }
      if (vehiclesRes.data) {
        setVehicles(vehiclesRes.data);
        if (vehiclesRes.data.length > 0) {
          setSelectedVehicleId(vehiclesRes.data[0].id);
        }
      }
      setLoading(false);
    }

    init();
  }, [router, initialStationId]);

  // 2. Load chargers when station changes
  useEffect(() => {
    if (!selectedStationId) {
      setChargers([]);
      return;
    }

    async function loadChargers() {
      const { data } = await supabase
        .from("chargers")
        .select("*")
        .eq("station_id", selectedStationId)
        .order("label");

      const list = data || [];
      setChargers(list);

      // Keep pre-selected charger if it belongs to this station
      const exists = list.some((c) => c.id === selectedChargerId);
      if (!exists) {
        const firstAvailable = list.find((c) => c.status !== "out_of_service");
        setSelectedChargerId(firstAvailable ? firstAvailable.id : "");
      }
    }

    loadChargers();
  }, [selectedStationId]);

  // 3. showAvailableSlots: load booked time windows for the selected charger & date
  useEffect(() => {
    if (!selectedChargerId || !date) {
      setBookedSlots([]);
      return;
    }

    async function showAvailableSlots() {
      const dayStart = new Date(`${date}T00:00:00`).toISOString();
      const dayEnd = new Date(`${date}T23:59:59`).toISOString();

      const { data } = await supabase.rpc("get_booked_slots", {
        p_charger_id: selectedChargerId,
        p_from: dayStart,
        p_to: dayEnd,
      });

      setBookedSlots(data || []);
    }

    showAvailableSlots();
  }, [selectedChargerId, date]);

  const selectedStation = stations.find((s) => s.id === selectedStationId);
  const selectedCharger = chargers.find((c) => c.id === selectedChargerId);

  // Calculate estimated cost
  function calculateTotalAmount() {
    if (!selectedStation || !date || !startTime || !endTime) return 0;
    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    const hours = (end - start) / (1000 * 60 * 60);
    if (hours <= 0) return 0;
    // Estimated 10 kWh per hour * station price_per_kwh
    const estimatedKwh = hours * 10;
    return Number((estimatedKwh * Number(selectedStation.price_per_kwh)).toFixed(2));
  }

  // Sequence Diagram: selectChargerAndTime() -> checkSlotConflict()
  async function selectChargerAndTime(e) {
    e.preventDefault();
    setErrorMsg("");

    if (!selectedStationId || !selectedChargerId) {
      setErrorMsg("Please select a charging station and an available charger.");
      return;
    }

    if (selectedCharger?.status === "out_of_service") {
      setErrorMsg("This charger is out of service. Please choose another charger.");
      return;
    }

    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    const now = new Date();

    // TC-06-04: Reject past times or end time earlier than start time
    if (start < now) {
      setErrorMsg("You cannot book a time slot in the past. Please choose a future time.");
      return;
    }
    if (end <= start) {
      setErrorMsg("The end time must be after the start time.");
      return;
    }

    setSubmitting(true);
    const { data: hasConflict, error } = await checkSlotConflict(
      selectedChargerId,
      start,
      end
    );
    setSubmitting(false);

    if (error) {
      setErrorMsg(error);
      return;
    }

    // TC-06-02: Slot Unavailable -> chooseAnotherTime()
    if (hasConflict) {
      setErrorMsg(
        "This time slot is already reserved on this charger. Please choose another time."
      );
      return;
    }

    // Slot Available -> Move to review step
    setStep("review");
  }

  // Sequence Diagram: confirmReservation() -> saveReservation() -> startPayment()
  async function confirmReservation() {
    setErrorMsg("");
    setSubmitting(true);

    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    const totalAmount = calculateTotalAmount();

    const { data, error } = await saveReservation({
      driverId: user.id,
      chargerId: selectedChargerId,
      vehicleId: selectedVehicleId || null,
      start,
      end,
      totalAmount,
    });

    setSubmitting(false);

    if (error) {
      setErrorMsg(error);
      setStep("select");
      return;
    }

    // Redirect to payment page (UC-08)
    router.push(`/driver/payment?reservationId=${data.id}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-600">Loading reservation page...</p>
      </div>
    );
  }

  const totalAmount = calculateTotalAmount();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Reserve a Charging Slot</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select your station, charger, and preferred time window.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-5 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}

        {step === "select" ? (
          <form onSubmit={selectChargerAndTime} className="space-y-5">
            {/* Station */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Charging Station
              </label>
              <select
                value={selectedStationId}
                onChange={(e) => setSelectedStationId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              >
                <option value="">-- Select Station --</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.city}) — {s.price_per_kwh} SAR/kWh
                  </option>
                ))}
              </select>
            </div>

            {/* Charger */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Charger
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {chargers.map((c) => {
                  const isDisabled = c.status === "out_of_service";
                  const isSelected = c.id === selectedChargerId;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      disabled={isDisabled}
                      onClick={() => setSelectedChargerId(c.id)}
                      className={`text-left p-3 rounded-lg border transition ${
                        isDisabled
                          ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                          : isSelected
                          ? "bg-emerald-50 border-emerald-600 ring-1 ring-emerald-600"
                          : "bg-white border-gray-300 hover:border-emerald-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{c.label}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            c.status === "available"
                              ? "bg-emerald-100 text-emerald-800"
                              : c.status === "occupied"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {c.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        {c.connector_type} · {c.power_kw} kW
                      </p>
                    </button>
                  );
                })}
              </div>
              {chargers.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  No chargers found for this station.
                </p>
              )}
            </div>

            {/* Vehicle (Optional) */}
            {vehicles.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vehicle (Optional)
                </label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- No vehicle selected --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.make} {v.model} ({v.plate_number}) — {v.connector_type}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
            </div>

            {/* Already Booked Slots */}
            {selectedChargerId && (
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <p className="text-xs font-semibold text-gray-700 mb-1">
                  Booked slots on {date}:
                </p>
                {bookedSlots.length === 0 ? (
                  <p className="text-xs text-emerald-700">
                    All time slots are currently available on this date.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-2 mt-1">
                    {bookedSlots.map((slot, idx) => {
                      const s = new Date(slot.start_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      const e = new Date(slot.end_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <li
                          key={idx}
                          className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded"
                        >
                          {s} - {e}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Estimated Cost */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <span className="text-sm font-medium text-emerald-900">
                Estimated Total
              </span>
              <span className="text-lg font-bold text-emerald-700">
                {totalAmount.toFixed(2)} SAR
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {submitting ? "Checking availability..." : "Check Availability & Review"}
            </button>
          </form>
        ) : (
          /* Step 2: Review & Confirm */
          <div className="space-y-5">
            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-2 text-sm">
              <h2 className="font-semibold text-gray-900 text-base mb-2">
                Review Booking Details
              </h2>
              <div className="flex justify-between">
                <span className="text-gray-600">Station:</span>
                <span className="font-medium text-gray-900">
                  {selectedStation?.name} ({selectedStation?.city})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Charger:</span>
                <span className="font-medium text-gray-900">
                  {selectedCharger?.label} ({selectedCharger?.connector_type})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Date:</span>
                <span className="font-medium text-gray-900">{date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Time Window:</span>
                <span className="font-medium text-gray-900">
                  {startTime} – {endTime}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                <span className="font-semibold text-gray-900">Total Amount:</span>
                <span className="font-bold text-emerald-700">
                  {totalAmount.toFixed(2)} SAR
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setStep("select")}
                disabled={submitting}
                className="w-full sm:w-1/2 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium py-2.5 px-4 rounded-lg transition"
              >
                Edit Selection
              </button>
              <button
                type="button"
                onClick={confirmReservation}
                disabled={submitting}
                className="w-full sm:w-1/2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                {submitting ? "Saving..." : "Confirm & Proceed to Payment"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReservePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-600">Loading...</p>
        </div>
      }
    >
      <ReserveContent />
    </Suspense>
  );
}