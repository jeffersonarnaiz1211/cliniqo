# Cliniqo — Campus Clinic Appointment Scheduling (v0.1.0)

One Node.js server that provides:

| URL | What | Who |
|---|---|---|
| `/app` | Student mobile app (installable PWA) | Students |
| `/admin` | Clinic console website | Admin, Clinic Staff, Provider |
| `/api` | REST API | Both front ends |

**Stack:** Node 22, Express, PostgreSQL on Supabase (`pg` driver), bcrypt password hashes, JWT in an HttpOnly cookie, plain HTML/CSS/JS front ends.

## Run it

```bash
npm install
npm start          # http://localhost:3000  (local database in data/, auto-seeds demo data on first run)
npm test           # 44 automated API tests
npm run seed       # create demo data in an empty database
```

Copy `.env.example` to `.env` for production settings. School email domain used in demo data: `ntc.edu.ph`.

## Demo accounts (dummy data only)

| Role | Login | Password |
|---|---|---|
| Student | 2024-00123 | Student@1 |
| Clinic Staff | villanueva@ntc.edu.ph | Staff@123 |
| Provider | reyes@ntc.edu.ph | Provider@1 |
| Admin | admin@ntc.edu.ph | Admin@123 |

Change or delete these before any real use.

## Features

- **Students (`/app`)**: register, sign in, book by department → date → time, confirm, view upcoming/past, reschedule, cancel, in-app notifications and reminders, profile with larger-text option and FAQ.
- **Clinic Staff (`/admin`)**: daily schedule, check-in, complete/no-show, book for a student, cancel/reschedule.
- **Provider**: own day view, own working hours and days off, mark visits complete/no-show.
- **Admin**: everything above plus dashboard, users (add, activate/deactivate, reset password), provider hours, reports with CSV export, audit log.

## Business rules

- No double booking: enforced by database unique indexes, not only by the UI.
- Cancel/reschedule closes 24 hours before the visit for students and staff (admin can override with a reason).
- Exception: a booking made inside that 24-hour window can still be cancelled (not rescheduled) for 2 hours after it was made, as long as the visit has not started.
- Book up to 30 days ahead; max 3 upcoming appointments per student.
- Role is checked on the server for every request.

## Install the student app on a phone

1. Phone and computer on the same Wi-Fi. Find the computer's IP (e.g. `192.168.1.20`) and run `npm start`.
2. Open `http://192.168.1.20:3000/app` on the phone, then "Add to Home Screen".
3. Full install and the offline shell need HTTPS, so deploy it (see "Deploy with Supabase and Render" below).

## Deploy with Supabase and Render

**Database (Supabase)**
1. Create a project at supabase.com and save the database password.
2. Click **Connect** at the top of the dashboard and copy the **Session pooler** connection string (Render needs the pooler because it cannot reach Supabase's direct address over IPv6).
3. Put your password in place of `[YOUR-PASSWORD]`. If it has special characters, URL-encode them.

The app creates its own tables on first start and turns on Row Level Security so the public Supabase API key cannot read them.

**Web service (Render)**
1. Push this repo to GitHub. Render > **New > Web Service** > pick the repo.
2. Build command `npm install`, start command `npm start`, instance type Free.
3. Environment variables: `NODE_ENV=production`, `DATABASE_URL` (the string from above), `JWT_SECRET` (long random text), `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `CLINIC_TZ=Asia/Manila`, and `SEED_DEMO=true` for the first deploy only.
4. After the first successful start, delete `SEED_DEMO` (or set it to `false`), sign in as admin, and change the demo passwords.

To seed from your own computer instead, put `DATABASE_URL` in `.env` and run `npm run seed` once.

## Known limitations (state these in your report)

- Registration does not verify the student number against a registrar list.
- Reminders are in-app only (no SMS/email/push).
- No password-reset email; an admin resets passwords.
- No Google sign-in.
- Free hosting tiers: Render's free web service sleeps when idle (the first request is slow), and a free Supabase project pauses after a week without activity.

## Layout

```
server/  API, database, business rules, seed data
mobile/  student PWA        admin/  clinic console website
tests/   automated API tests
```
