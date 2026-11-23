// Booking logic (Sequence Diagram: checkSlotConflict -> saveReservation).
// Used by the reserve, modify and cancel pages.
//
//   import { checkSlotConflict, saveReservation } from "@/lib/reservations";
//
// Both functions return { data, error }. "error" is always a friendly
// English message that can be shown to the driver directly (or null).

import { supabase } from "@/lib/supabase";

// Database error codes (raised by the prevent_double_booking trigger)
// mapped to messages for the driver.
const FRIENDLY_ERRORS = {
  SLOT_UNAVAILABLE:
    "This time slot is already booked on this charger. Please choose another time.",
  CHARGER_OUT_OF_SERVICE:
    "This charger is out of service right now. Please choose another charger.",
  ACCOUNT_SUSPENDED:
    "Your account is suspended, so you cannot make reservations. Please contact support.",
};

export function friendlyReservationError(error) {
  if (!error) return null;
  const text = `${error.message || ""} ${error.details || ""}`;
  for (const code of Object.keys(FRIENDLY_ERRORS)) {
    if (text.includes(code)) return FRIENDLY_ERRORS[code];
  }
  if (text.includes("end_time") || text.includes("check constraint")) {
    return "The end time must be after the start time.";
  }
  if (error.code === "42501" || text.includes("row-level security")) {
    return "You are not allowed to make this reservation. Please log in again.";
  }
  return "Something went wrong while saving the reservation. Please try again.";
}

// Accepts a Date object or a date string and returns an ISO string.
function toIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * checkSlotConflict: is there already an active booking (pending_payment or
 * confirmed) on this charger that overlaps [start, end)?
 *
 * @param {string} chargerId
 * @param {Date|string} start
 * @param {Date|string} end
 * @param {string} [ignoreReservationId] pass the reservation's own id when MODIFYING it
 * @returns {Promise<{ data: boolean|null, error: string|null }>}
 *          data = true means CONFLICT (slot taken), false means free.
 */
export async function checkSlotConflict(chargerId, start, end, ignoreReservationId = null) {
  const pStart = toIso(start);
  const pEnd = toIso(end);
  if (!chargerId || !pStart || !pEnd) {
    return { data: null, error: "Please choose a charger, a start time and an end time." };
  }
  if (new Date(pEnd) <= new Date(pStart)) {
    return { data: null, error: "The end time must be after the start time." };
  }

  const { data, error } = await supabase.rpc("check_slot_conflict", {
    p_charger_id: chargerId,
    p_start: pStart,
    p_end: pEnd,
    p_ignore_reservation: ignoreReservationId,
  });

  if (error) {
    return { data: null, error: "Could not check availability. Please try again." };
  }
  return { data: data === true, error: null };
}

/**
 * saveReservation: create a new reservation with status 'pending_payment'.
 * The payment page then confirms it (or it gets cancelled if payment fails).
 *
 * @param {{ driverId: string, chargerId: string, vehicleId?: string|null,
 *           start: Date|string, end: Date|string, totalAmount: number }} params
 * @returns {Promise<{ data: object|null, error: string|null }>}
 *          data = the inserted reservations row.
 */
export async function saveReservation({ driverId, chargerId, vehicleId = null, start, end, totalAmount }) {
  if (!driverId) {
    return { data: null, error: "Please log in before making a reservation." };
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { data: null, error: "The total amount is not valid." };
  }

  // 1. checkSlotConflict (friendly early check)
  const check = await checkSlotConflict(chargerId, start, end);
  if (check.error) return { data: null, error: check.error };
  if (check.data) return { data: null, error: FRIENDLY_ERRORS.SLOT_UNAVAILABLE };

  // 2. save. The database trigger checks again, so two drivers booking
  //    the same slot at the same second still cannot both succeed.
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      driver_id: driverId,
      charger_id: chargerId,
      vehicle_id: vehicleId || null,
      start_time: toIso(start),
      end_time: toIso(end),
      status: "pending_payment",
      total_amount: amount,
    })
    .select()
    .single();

  if (error) return { data: null, error: friendlyReservationError(error) };
  return { data, error: null };
}
