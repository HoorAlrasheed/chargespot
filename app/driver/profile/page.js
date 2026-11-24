"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const emptyVehicle = {
  make: "",
  model: "",
  plate_number: "",
  connector_type: "Type 2",
};

export default function ProfilePage() {
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState({
    full_name: "",
    email: "",
    phone: "",
  });

  const [vehicles, setVehicles] = useState([]);
  const [vehicle, setVehicle] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadVehicles(id) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("driver_id", id);

    if (error) {
      setError(error.message);
    } else {
      setVehicles(data || []);
    }
  }

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase.auth.getUser();

      if (!data.user) {
        window.location.href = "/login";
        return;
      }

      const id = data.user.id;
      setUserId(id);

      const { data: info, error } = await supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", id)
        .single();

      if (error) {
        setError(error.message);
      } else {
        setProfile({
          full_name: info.full_name || "",
          email: info.email || data.user.email || "",
          phone: info.phone || "",
        });
      }

      await loadVehicles(id);
      setLoading(false);
    }

    loadProfile();
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: profile.full_name,
        phone: profile.phone,
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      setError(error.message);
    } else {
      setMessage("Profile updated successfully.");
    }
  }

  async function saveVehicle(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    const query = editingId
      ? supabase
          .from("vehicles")
          .update(vehicle)
          .eq("id", editingId)
          .eq("driver_id", userId)
      : supabase
          .from("vehicles")
          .insert({
            ...vehicle,
            driver_id: userId,
          });

    const { error } = await query.select().single();

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(
      editingId
        ? "Vehicle updated successfully."
        : "Vehicle added successfully."
    );

    setVehicle(emptyVehicle);
    setEditingId(null);
    await loadVehicles(userId);
  }

  function editVehicle(item) {
    setEditingId(item.id);
    setVehicle({
      make: item.make,
      model: item.model,
      plate_number: item.plate_number,
      connector_type: item.connector_type,
    });
  }

  async function deleteVehicle(id) {
    if (!window.confirm("Delete this vehicle?")) return;

    setError("");
    setMessage("");

    const { error } = await supabase
      .from("vehicles")
      .delete()
      .eq("id", id)
      .eq("driver_id", userId)
      .select()
      .single();

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Vehicle deleted successfully.");
    setEditingId(null);
    setVehicle(emptyVehicle);
    await loadVehicles(userId);
  }

  const inputClass =
    "w-full border rounded-lg p-3 mb-4";

  const buttonClass =
    "bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-lg";

  if (loading) {
    return <p className="p-8">Loading...</p>;
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">
          My Profile & Vehicles
        </h1>

        <Link
          href="/driver/search"
          className="text-green-700"
        >
          Back to Search
        </Link>
      </div>

      {message && (
        <p className="text-green-700 mb-4">{message}</p>
      )}

      {error && (
        <p className="text-red-600 mb-4">{error}</p>
      )}

      <section className="border rounded-xl p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">
          Personal Information
        </h2>

        <form onSubmit={saveProfile}>
          <label>Full Name</label>
          <input
            className={inputClass}
            value={profile.full_name}
            onChange={(e) =>
              setProfile({
                ...profile,
                full_name: e.target.value,
              })
            }
            required
          />

          <label>Email</label>
          <input
            className={inputClass}
            value={profile.email}
            readOnly
          />

          <label>Phone Number</label>
          <input
            className={inputClass}
            type="tel"
            value={profile.phone}
            onChange={(e) =>
              setProfile({
                ...profile,
                phone: e.target.value,
              })
            }
          />

          <button className={buttonClass}>
            Save Profile
          </button>
        </form>
      </section>

      <section className="border rounded-xl p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">
          {editingId ? "Edit Vehicle" : "Add Vehicle"}
        </h2>

        <form onSubmit={saveVehicle}>
          <label>Car Make</label>
          <input
            className={inputClass}
            placeholder="e.g. Tesla"
            value={vehicle.make}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                make: e.target.value,
              })
            }
            required
          />

          <label>Car Model</label>
          <input
            className={inputClass}
            placeholder="e.g. Model 3"
            value={vehicle.model}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                model: e.target.value,
              })
            }
            required
          />

          <label>Plate Number</label>
          <input
            className={inputClass}
            value={vehicle.plate_number}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                plate_number: e.target.value,
              })
            }
            required
          />

          <label>Connector Type</label>
          <select
            className={inputClass}
            value={vehicle.connector_type}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                connector_type: e.target.value,
              })
            }
          >
            <option>Type 2</option>
            <option>CCS2</option>
            <option>CHAdeMO</option>
          </select>

          <button className={buttonClass}>
            {editingId ? "Save Changes" : "Add Vehicle"}
          </button>

          {editingId && (
            <button
              type="button"
              className="ml-4 text-gray-600"
              onClick={() => {
                setEditingId(null);
                setVehicle(emptyVehicle);
              }}
            >
              Cancel
            </button>
          )}
        </form>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">
          My Vehicles
        </h2>

        {vehicles.length === 0 && (
          <p>No vehicles added yet.</p>
        )}

        {vehicles.map((item) => (
          <div
            key={item.id}
            className="border rounded-xl p-5 mb-4"
          >
            <h3 className="font-bold text-lg">
              {item.make} {item.model}
            </h3>

            <p>Plate: {item.plate_number}</p>
            <p>Connector: {item.connector_type}</p>

            <div className="flex gap-4 mt-4">
              <button
                className="text-green-700"
                onClick={() => editVehicle(item)}
              >
                Edit
              </button>

              <button
                className="text-red-600"
                onClick={() => deleteVehicle(item.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}