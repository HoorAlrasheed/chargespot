-- =====================================================================
-- ChargeSpot – Smart EV Charging Station Locator and Booking System
-- File 1 of 2: Database schema, security rules and station data
--
-- How to run: Supabase Dashboard → SQL Editor → New query →
-- paste this whole file → Run. Run it ONCE on a new, empty project.
--
-- IMPORTANT (one setting): Authentication → Sign In / Providers → Email →
-- turn OFF "Confirm email" and Save. Otherwise new accounts made from the
-- app's Register page cannot log in until they click an email link.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES (match the Class Diagram)
--    Driver / SystemAdmin -> profiles (role = 'driver' or 'admin')
--    Vehicle -> vehicles · ChargingStation -> charging_stations
--    Charger -> chargers · Reservation -> reservations
--    Payment -> payments · flagged chargers (UC-14) -> charger_reports
-- ---------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '',
  email         text,
  phone         text,
  role          text not null default 'driver' check (role in ('driver', 'admin')),
  is_suspended  boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.profiles (id) on delete cascade,
  make            text not null,
  model           text not null,
  plate_number    text not null,
  connector_type  text not null check (connector_type in ('Type 2', 'CCS2', 'CHAdeMO')),
  created_at      timestamptz not null default now()
);

create table public.charging_stations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  city           text not null check (length(trim(city)) > 0),
  address        text,
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  price_per_kwh  numeric(6, 2) not null check (price_per_kwh >= 0),
  opening_hours  text not null default '24/7',
  created_at     timestamptz not null default now()
);

create table public.chargers (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid not null references public.charging_stations (id) on delete cascade,
  label           text not null,
  connector_type  text not null check (connector_type in ('Type 2', 'CCS2', 'CHAdeMO')),
  power_kw        numeric(6, 1) not null check (power_kw > 0),
  status          text not null default 'available'
                  check (status in ('available', 'occupied', 'out_of_service')),
  created_at      timestamptz not null default now()
);

create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.profiles (id) on delete cascade,
  charger_id    uuid not null references public.chargers (id) on delete cascade,
  vehicle_id    uuid references public.vehicles (id) on delete set null,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  status        text not null default 'pending_payment'
                check (status in ('pending_payment', 'confirmed', 'cancelled', 'completed')),
  total_amount  numeric(8, 2) not null default 0 check (total_amount >= 0),
  created_at    timestamptz not null default now(),
  check (end_time > start_time)
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations (id) on delete cascade,
  driver_id       uuid not null references public.profiles (id) on delete cascade,
  amount          numeric(8, 2) not null check (amount >= 0),
  card_last4      char(4) not null check (card_last4 ~ '^[0-9]{4}$'),  -- only the last 4 digits are ever stored
  status          text not null check (status in ('success', 'failed')),
  paid_at         timestamptz not null default now()
);

create table public.charger_reports (
  id           uuid primary key default gen_random_uuid(),
  charger_id   uuid not null references public.chargers (id) on delete cascade,
  driver_id    uuid references public.profiles (id) on delete set null,
  description  text not null check (length(trim(description)) > 0),
  status       text not null default 'open' check (status in ('open', 'resolved')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index on public.chargers (station_id);
create index on public.reservations (charger_id, start_time);
create index on public.reservations (driver_id);
create index on public.payments (reservation_id);
create index on public.charger_reports (status);


-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS AND TRIGGERS
-- ---------------------------------------------------------------------

-- Is the logged-in user an admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Create a profile automatically when someone registers.
-- The app sends full_name and phone in the sign-up "options.data".
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          new.email,
          new.raw_user_meta_data ->> 'phone');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A driver can edit her own profile but can never change her role or suspension.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role <> old.role or new.is_suspended <> old.is_suspended) then
    raise exception 'Only an admin can change role or suspension status';
  end if;
  return new;
end;
$$;

create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- checkSlotConflict: true if the charger already has an active booking
-- that overlaps the requested time window.
create or replace function public.check_slot_conflict(
  p_charger_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_ignore_reservation uuid default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.reservations r
    where r.charger_id = p_charger_id
      and r.status in ('pending_payment', 'confirmed')
      and (p_ignore_reservation is null or r.id <> p_ignore_reservation)
      and r.start_time < p_end
      and r.end_time > p_start
  );
$$;

-- Safety net: the database itself refuses an overlapping booking,
-- and refuses bookings on a charger that is out of service.
create or replace function public.prevent_double_booking()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and exists (select 1 from public.profiles
                                  where id = new.driver_id and is_suspended) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;
  if new.status in ('pending_payment', 'confirmed') then
    if public.check_slot_conflict(new.charger_id, new.start_time, new.end_time, new.id) then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    if (tg_op = 'INSERT' or new.charger_id <> old.charger_id)
       and exists (select 1 from public.chargers
                   where id = new.charger_id and status = 'out_of_service') then
      raise exception 'CHARGER_OUT_OF_SERVICE';
    end if;
  end if;
  return new;
end;
$$;

-- showAvailableSlots: drivers cannot read other drivers' reservations (RLS),
-- so this returns ONLY the busy time windows of a charger (no names, no ids).
-- App: supabase.rpc('get_booked_slots', { p_charger_id, p_from, p_to })
create or replace function public.get_booked_slots(
  p_charger_id uuid,
  p_from timestamptz,
  p_to timestamptz)
returns table (start_time timestamptz, end_time timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.start_time, r.end_time
  from public.reservations r
  where r.charger_id = p_charger_id
    and r.status in ('pending_payment', 'confirmed')
    and r.start_time < p_to
    and r.end_time > p_from
  order by r.start_time;
$$;

create trigger prevent_double_booking
  before insert or update on public.reservations
  for each row execute function public.prevent_double_booking();


-- ---------------------------------------------------------------------
-- 3. SECURITY RULES (Row Level Security)
--    Drivers see and change only their own data; admins manage everything.
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.vehicles          enable row level security;
alter table public.charging_stations enable row level security;
alter table public.chargers          enable row level security;
alter table public.reservations      enable row level security;
alter table public.payments          enable row level security;
alter table public.charger_reports   enable row level security;

-- profiles
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- vehicles
create policy "vehicles: driver manages own" on public.vehicles
  for all to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy "vehicles: admin reads all" on public.vehicles
  for select to authenticated using (public.is_admin());

-- stations and chargers: everyone logged in can read, only admins can change
create policy "stations: read" on public.charging_stations
  for select to authenticated using (true);
create policy "stations: admin writes" on public.charging_stations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "chargers: read" on public.chargers
  for select to authenticated using (true);
create policy "chargers: admin writes" on public.chargers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- reservations
create policy "reservations: driver reads own" on public.reservations
  for select to authenticated using (driver_id = auth.uid() or public.is_admin());
create policy "reservations: driver creates own" on public.reservations
  for insert to authenticated with check (driver_id = auth.uid());
create policy "reservations: driver updates own" on public.reservations
  for update to authenticated using (driver_id = auth.uid() or public.is_admin())
  with check (driver_id = auth.uid() or public.is_admin());

-- payments
create policy "payments: read own or admin" on public.payments
  for select to authenticated using (driver_id = auth.uid() or public.is_admin());
create policy "payments: driver creates own" on public.payments
  for insert to authenticated with check (driver_id = auth.uid());

-- charger reports (UC-14)
create policy "reports: driver creates own" on public.charger_reports
  for insert to authenticated with check (driver_id = auth.uid());
create policy "reports: read own or admin" on public.charger_reports
  for select to authenticated using (driver_id = auth.uid() or public.is_admin());
create policy "reports: admin updates" on public.charger_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Let the app call the conflict check directly: supabase.rpc('check_slot_conflict', {...})
grant execute on function public.check_slot_conflict(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.get_booked_slots(uuid, timestamptz, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 4. REALTIME: charger status changes appear instantly for drivers
--    (simulates the IoT charger sensors)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.chargers;


-- ---------------------------------------------------------------------
-- 5. SAMPLE STATIONS AND CHARGERS
-- ---------------------------------------------------------------------
insert into public.charging_stations (name, city, address, latitude, longitude, price_per_kwh, opening_hours) values
  ('ChargeSpot Olaya',        'Riyadh', 'Olaya St, Al Olaya',             24.690600, 46.685100, 1.25, '24/7'),
  ('ChargeSpot King Fahd Rd', 'Riyadh', 'King Fahd Rd, Al Muruj',         24.752500, 46.659800, 1.30, '24/7'),
  ('ChargeSpot Al Nakheel',   'Riyadh', 'Imam Saud Rd, Al Nakheel',       24.744200, 46.632900, 1.20, '6:00 AM - 12:00 AM'),
  ('ChargeSpot Corniche',     'Jeddah', 'Corniche Rd, Al Shati',          21.601700, 39.108300, 1.35, '24/7'),
  ('ChargeSpot Tahlia',       'Jeddah', 'Prince Mohammed bin Abdulaziz St', 21.552900, 39.164700, 1.30, '24/7'),
  ('ChargeSpot Dammam Corniche', 'Dammam', 'Corniche Rd, Al Shati Al Gharbi', 26.443600, 50.110200, 1.15, '24/7');

insert into public.chargers (station_id, label, connector_type, power_kw, status)
select s.id, c.label, c.connector_type, c.power_kw, c.status
from public.charging_stations s
join (values
  ('ChargeSpot Olaya',           'Charger 1', 'CCS2',    150.0, 'available'),
  ('ChargeSpot Olaya',           'Charger 2', 'CCS2',    150.0, 'occupied'),
  ('ChargeSpot Olaya',           'Charger 3', 'Type 2',   22.0, 'available'),
  ('ChargeSpot King Fahd Rd',    'Charger 1', 'CCS2',    120.0, 'available'),
  ('ChargeSpot King Fahd Rd',    'Charger 2', 'CHAdeMO',  50.0, 'out_of_service'),
  ('ChargeSpot Al Nakheel',      'Charger 1', 'Type 2',   22.0, 'available'),
  ('ChargeSpot Al Nakheel',      'Charger 2', 'Type 2',   11.0, 'available'),
  ('ChargeSpot Corniche',        'Charger 1', 'CCS2',    180.0, 'available'),
  ('ChargeSpot Corniche',        'Charger 2', 'CHAdeMO',  50.0, 'available'),
  ('ChargeSpot Tahlia',          'Charger 1', 'CCS2',    120.0, 'occupied'),
  ('ChargeSpot Tahlia',          'Charger 2', 'Type 2',   22.0, 'available'),
  ('ChargeSpot Dammam Corniche', 'Charger 1', 'CCS2',    150.0, 'available'),
  ('ChargeSpot Dammam Corniche', 'Charger 2', 'Type 2',   22.0, 'available')
) as c(station_name, label, connector_type, power_kw, status) on c.station_name = s.name;

-- Done. Next: create the three test accounts (see the instructions),
-- then run File 2: chargespot_test_data.sql
