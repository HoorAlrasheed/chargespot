## How to run ChargeSpot locally

**Requirements:** Node.js (LTS), Git, VS Code.

1. Clone the repository and open the folder:
   ```bash
   git clone https://github.com/HoorAlrasheed/chargespot.git
   cd chargespot
   ```
2. Create a file named `.env.local` in the project root (same folder as `package.json`) with the two Supabase keys shared in the team group:
   ```
   NEXT_PUBLIC_SUPABASE_URL=<Supabase project URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon / publishable key>
   ```
   `.env.example` shows the format. **Never commit `.env.local`** (it is already in `.gitignore`).
3. Install and start:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000

### Test accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@chargespot.test | Admin@1234 |
| Driver | driver1@chargespot.test | Driver@1234 |
| Driver | driver2@chargespot.test | Driver@1234 |

### Database

The Supabase database is already set up online. The SQL used to build it is kept in the repo:

- `supabase/schema.sql`: tables (matching the Class Diagram), Row Level Security, triggers, Realtime, and the sample stations and chargers.
- `supabase/seed.sql`: test data (vehicles, reservations, payments, one open charger report). Run only after creating the 3 test users in Supabase Auth.

To rebuild on a new Supabase project: run `schema.sql` in the SQL Editor, turn off **Confirm email** (Authentication → Sign In / Providers → Email), create the 3 users (Authentication → Users → Add user, tick Auto Confirm User), then run `seed.sql`.
