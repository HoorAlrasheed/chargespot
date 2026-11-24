"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reservationId = searchParams.get("reservationId");

  const [user, setUser] = useState(null);
  const [reservation, setReservation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  // "form" | "confirmed" | "failed"
  const [paymentView, setPaymentView] = useState("form");
  const [paymentRecord, setPaymentRecord] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // 1. Check auth & load reservation
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

      if (!reservationId) {
        setErrorMsg("No reservation selected for payment.");
        setLoading(false);
        return;
      }

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
              city
            )
          )
        `
        )
        .eq("id", reservationId)
        .eq("driver_id", session.user.id)
        .single();

      if (error || !data) {
        setErrorMsg("Reservation not found or you do not have access to it.");
        setLoading(false);
        return;
      }

      setReservation(data);

      // If already confirmed, show confirmation directly
      if (data.status === "confirmed") {
        setPaymentView("confirmed");
      }

      setLoading(false);
    }

    init();
  }, [router, reservationId]);

  // Sequence Diagram: PaymentGateway.returnPaymentResult()
  function returnPaymentResult(cleanDigits) {
    // Test Plan cards:
    // 4242 4242 4242 4242 -> Success
    // 4000 0000 0000 0002 -> Failed
    if (cleanDigits === "4000000000000002") {
      return { success: false, message: "Payment was declined by the card issuer." };
    }
    if (cleanDigits === "4242424242424242") {
      return { success: true, message: "Payment approved." };
    }
    // Any other 16-digit card succeeds by default
    return { success: true, message: "Payment approved." };
  }

  // Sequence Diagram: startPayment()
  async function startPayment(e) {
    e.preventDefault();
    setErrorMsg("");

    const cleanDigits = cardNumber.replace(/\s+/g, "");
    if (!/^\d{16}$/.test(cleanDigits)) {
      setErrorMsg("Please enter a valid 16-digit card number.");
      return;
    }

    if (!cardName.trim() || !expiry.trim() || !/^\d{3,4}$/.test(cvv.trim())) {
      setErrorMsg("Please complete all card details correctly.");
      return;
    }

    setProcessing(true);

    // Only store the last 4 digits (TC-NF-04)
    const cardLast4 = cleanDigits.slice(-4);
    const result = returnPaymentResult(cleanDigits);

    // Record payment attempt in database (success or failed)
    const { data: savedPayment, error: payError } = await supabase
      .from("payments")
      .insert({
        reservation_id: reservation.id,
        driver_id: user.id,
        amount: reservation.total_amount,
        card_last4: cardLast4,
        status: result.success ? "success" : "failed",
      })
      .select()
      .single();

    if (payError) {
      setProcessing(false);
      setErrorMsg("Could not record payment. Please try again.");
      return;
    }

    setPaymentRecord(savedPayment);

    if (result.success) {
      // Confirm reservation in database
      const { data: updatedRes, error: resError } = await supabase
        .from("reservations")
        .update({ status: "confirmed" })
        .eq("id", reservation.id)
        .select(
          `
          *,
          chargers (
            label,
            connector_type,
            power_kw,
            charging_stations (
              name,
              city
            )
          )
        `
        )
        .single();

      setProcessing(false);

      if (resError) {
        setErrorMsg("Payment succeeded, but confirming the reservation failed.");
        return;
      }

      setReservation(updatedRes);
      // Sequence Diagram: showConfirmation()
      setPaymentView("confirmed");
    } else {
      setProcessing(false);
      // Sequence Diagram: askToRetryPayment()
      setPaymentView("failed");
    }
  }

  function handleRetry() {
    setErrorMsg("");
    setCardNumber("");
    setCvv("");
    setPaymentView("form");
  }

  function formatCardInput(value) {
    const digits = value.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-600">Loading payment details...</p>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-xl border border-gray-200 text-center space-y-4">
          <p className="text-red-600 font-medium">{errorMsg || "Reservation not found."}</p>
          <Link
            href="/driver/reserve"
            className="inline-block bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            Back to Reserve
          </Link>
        </div>
      </div>
    );
  }

  const station = reservation.chargers?.charging_stations;
  const charger = reservation.chargers;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {/* VIEW 1: Booking Confirmed (showConfirmation) */}
        {paymentView === "confirmed" && (
          <div className="space-y-5">
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
              <h1 className="text-xl font-bold text-emerald-800">
                Booking Confirmed!
              </h1>
              <p className="text-sm text-emerald-700 mt-1">
                Your payment was successful and your charging slot is now reserved.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Station:</span>
                <span className="font-medium text-gray-900">
                  {station?.name} ({station?.city})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Charger:</span>
                <span className="font-medium text-gray-900">
                  {charger?.label} ({charger?.connector_type})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Start:</span>
                <span className="font-medium text-gray-900">
                  {new Date(reservation.start_time).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">End:</span>
                <span className="font-medium text-gray-900">
                  {new Date(reservation.end_time).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                <span className="font-semibold text-emerald-700 capitalize">
                  {reservation.status}
                </span>
              </div>
              {paymentRecord && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Card Used:</span>
                  <span className="font-medium text-gray-900">
                    •••• •••• •••• {paymentRecord.card_last4}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                <span className="font-semibold text-gray-900">Amount Paid:</span>
                <span className="font-bold text-emerald-700">
                  {Number(reservation.total_amount).toFixed(2)} SAR
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/driver/reservations"
                className="w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                View My Reservations
              </Link>
              <Link
                href="/driver/reserve"
                className="w-full text-center border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium py-2.5 px-4 rounded-lg transition"
              >
                Book Another Slot
              </Link>
            </div>
          </div>
        )}

        {/* VIEW 2: Payment Failed (askToRetryPayment) */}
        {paymentView === "failed" && (
          <div className="space-y-5 text-center">
            <div className="p-4 rounded-lg bg-red-50 border border-red-200">
              <h1 className="text-xl font-bold text-red-800">Payment Failed</h1>
              <p className="text-sm text-red-700 mt-1">
                Your payment was declined and your reservation has not been confirmed.
                Please retry or use another payment method.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleRetry}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                Retry Payment
              </button>
              <Link
                href="/driver/reservations"
                className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium py-2.5 px-4 rounded-lg transition"
              >
                Go to My Reservations
              </Link>
            </div>
          </div>
        )}

        {/* VIEW 3: Payment Form */}
        {paymentView === "form" && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Complete Payment</h1>
              <p className="text-sm text-gray-500 mt-1">
                Review your booking and enter your card details securely.
              </p>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Station:</span>
                <span className="font-medium text-gray-900">
                  {station?.name} ({station?.city})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Charger:</span>
                <span className="font-medium text-gray-900">
                  {charger?.label} ({charger?.connector_type})
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                <span className="font-semibold text-gray-900">Total Payable:</span>
                <span className="font-bold text-emerald-700 text-base">
                  {Number(reservation.total_amount).toFixed(2)} SAR
                </span>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {errorMsg}
              </div>
            )}

            <form onSubmit={startPayment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cardholder Name
                </label>
                <input
                  type="text"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="e.g., Sara Ahmed"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Card Number
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardInput(e.target.value))}
                  placeholder="4242 4242 4242 4242"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Only the last 4 digits are stored. Full card details are never saved.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expiry Date
                  </label>
                  <input
                    type="text"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    placeholder="MM/YY"
                    maxLength={5}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CVV
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="123"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={processing}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                {processing
                  ? "Processing payment..."
                  : `Pay ${Number(reservation.total_amount).toFixed(2)} SAR`}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-600">Loading...</p>
        </div>
      }
    >
      <PaymentContent />
    </Suspense>
  );
}