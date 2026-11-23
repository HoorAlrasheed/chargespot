-- =====================================================================
-- ChargeSpot – File 2 of 2: Test data
--
-- Run this AFTER File 1, and AFTER creating these three users in
-- Supabase Dashboard → Authentication → Users → Add user → Create new user
-- (tick "Auto Confirm User"):
--
--   admin@chargespot.test    password: Admin@1234
--   driver1@chargespot.test  password: Driver@1234
--   driver2@chargespot.test  password: Driver@1234
--
-- Then: SQL Editor → New query → paste this whole file → Run.
-- =====================================================================

do $$
declare
  v_admin   uuid := (select id from auth.users where email = 'admin@chargespot.test');
  v_d1      uuid := (select id from auth.users where email = 'driver1@chargespot.test');
  v_d2      uuid := (select id from auth.users where email = 'driver2@chargespot.test');
  v_car1    uuid;
  v_car2    uuid;
  v_olaya1  uuid := (select c.id from public.chargers c join public.charging_stations s on s.id = c.station_id
                     where s.name = 'ChargeSpot Olaya' and c.label = 'Charger 1');
  v_olaya3  uuid := (select c.id from public.chargers c join public.charging_stations s on s.id = c.station_id
                     where s.name = 'ChargeSpot Olaya' and c.label = 'Charger 3');
  v_corn1   uuid := (select c.id from public.chargers c join public.charging_stations s on s.id = c.station_id
                     where s.name = 'ChargeSpot Corniche' and c.label = 'Charger 1');
  v_kfd2    uuid := (select c.id from public.chargers c join public.charging_stations s on s.id = c.station_id
                     where s.name = 'ChargeSpot King Fahd Rd' and c.label = 'Charger 2');
  v_res     uuid;
begin
  if v_admin is null or v_d1 is null or v_d2 is null then
    raise exception 'Create the three test users in Authentication first (see the top of this file).';
  end if;

  -- names and roles
  update public.profiles set full_name = 'System Admin', role = 'admin' where id = v_admin;
  update public.profiles set full_name = 'Sara Driver',  phone = '0500000001' where id = v_d1;
  update public.profiles set full_name = 'Lama Driver',  phone = '0500000002' where id = v_d2;

  -- vehicles
  insert into public.vehicles (driver_id, make, model, plate_number, connector_type)
  values (v_d1, 'Lucid', 'Air', 'ABC 1234', 'CCS2') returning id into v_car1;
  insert into public.vehicles (driver_id, make, model, plate_number, connector_type)
  values (v_d2, 'Hyundai', 'Ioniq 5', 'XYZ 5678', 'CCS2') returning id into v_car2;

  -- past (completed) reservations with successful payments -> history and reports
  insert into public.reservations (driver_id, charger_id, vehicle_id, start_time, end_time, status, total_amount)
  values (v_d1, v_olaya1, v_car1, now() - interval '5 days', now() - interval '5 days' + interval '1 hour', 'completed', 62.50)
  returning id into v_res;
  insert into public.payments (reservation_id, driver_id, amount, card_last4, status, paid_at)
  values (v_res, v_d1, 62.50, '4242', 'success', now() - interval '5 days');

  insert into public.reservations (driver_id, charger_id, vehicle_id, start_time, end_time, status, total_amount)
  values (v_d1, v_corn1, v_car1, now() - interval '2 days', now() - interval '2 days' + interval '45 minutes', 'completed', 54.00)
  returning id into v_res;
  insert into public.payments (reservation_id, driver_id, amount, card_last4, status, paid_at)
  values (v_res, v_d1, 54.00, '4242', 'success', now() - interval '2 days');

  insert into public.reservations (driver_id, charger_id, vehicle_id, start_time, end_time, status, total_amount)
  values (v_d2, v_olaya3, v_car2, now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 'completed', 41.25)
  returning id into v_res;
  insert into public.payments (reservation_id, driver_id, amount, card_last4, status, paid_at)
  values (v_res, v_d2, 41.25, '4242', 'success', now() - interval '1 day');

  -- a failed payment that was then cancelled -> shows a failed record
  insert into public.reservations (driver_id, charger_id, vehicle_id, start_time, end_time, status, total_amount)
  values (v_d2, v_corn1, v_car2, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'cancelled', 60.00)
  returning id into v_res;
  insert into public.payments (reservation_id, driver_id, amount, card_last4, status, paid_at)
  values (v_res, v_d2, 60.00, '0002', 'failed', now() - interval '3 days');

  -- upcoming confirmed reservation today -> "today's reservations" and modify/cancel tests
  insert into public.reservations (driver_id, charger_id, vehicle_id, start_time, end_time, status, total_amount)
  values (v_d1, v_olaya1, v_car1, now() + interval '3 hours', now() + interval '4 hours', 'confirmed', 62.50)
  returning id into v_res;
  insert into public.payments (reservation_id, driver_id, amount, card_last4, status)
  values (v_res, v_d1, 62.50, '4242', 'success');

  -- an open report on the out-of-service charger -> flagged chargers page (UC-14)
  insert into public.charger_reports (charger_id, driver_id, description)
  values (v_kfd2, v_d2, 'The charger screen is off and the cable does not lock.');
end $$;

-- Quick check: should list the three accounts with their roles
select email, full_name, role from public.profiles order by role, email;
