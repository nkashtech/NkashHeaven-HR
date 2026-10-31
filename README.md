# NkashHeaven-HR

A multi-company HR system modelled on Odoo: attendance, timesheets, time off, projects, contracts, payroll and appraisals, with calendar sync, chat, scannable employee cards and a Super Admin console. Built from the *NkashHeaven-HR FRD, User Stories & Use Cases* and the wireframes.

The Super Admin creates companies. Each company has its own link (`/c/<company>`), admin, staff, roles, workflows, colours, email designs and card design, and can't see any other company's data.

- **frontend/**: React 18, Vite, Tailwind CSS, React Router, Socket.IO client
- **backend/**: Node/Express, Prisma, MySQL, Socket.IO, Brevo for email

## Run locally

Prerequisites: Node 18+ and MySQL 8+. You have three options for the database:

- `npm run db:local` in `backend/` runs a private MySQL on port 3317 with its data in `backend/mysql-data`. It's the easiest, and it's what `backend/.env` points at now. Leave it running in its own terminal.
- `docker compose up -d` starts one on port 3307 with the password in `docker-compose.yml`.
- Point `DATABASE_URL` at your own server.

```bash
cd backend
cp .env.example .env        # set DATABASE_URL, JWT_SECRET and a 64-hex-char MASTER_KEY
npm install
npx prisma migrate deploy
npm run db:seed             # wipes the database, then loads two demo companies
npm run dev                 # API on http://localhost:3011
```

```bash
cd frontend
npm install
npm run dev                 # app on http://localhost:3010 (proxies /api and /socket.io to :3011)
```

Generate the two secrets with:

```bash
openssl rand -hex 48
```

```bash
openssl rand -hex 32
```

Losing `MASTER_KEY` makes ID numbers, bank details and calendar tokens unreadable, so back it up separately from the database.

## Demo accounts

Every demo account uses the password `Nkash@Demo2026!`. The seed loads two companies, with eight weeks of attendance and timesheets, leave, chat and notifications in NkashHeaven, all relative to today.

| Role | Email | Sign in at |
|---|---|---|
| Super Admin | superadmin@nkashheaven.co.za | `/login`, Company code empty |
| Company Admin | naledi@nkashheaven.co.za | `/c/nkashheaven` |
| HR | kea@nkashheaven.co.za, nonhle@nkashheaven.co.za | `/c/nkashheaven` |
| Manager | lerato@ (Operations), sipho@ (Finance), dineo@ (Sales), kgomotso@ (Technology), ayanda@ (Thabo's manager) — all @nkashheaven.co.za | `/c/nkashheaven` |
| Employee | thabo@nkashheaven.co.za, priya@nkashheaven.co.za, johan@nkashheaven.co.za | `/c/nkashheaven` |
| Employee, unpaid intern (no payslips) | lwazi@nkashheaven.co.za | `/c/nkashheaven` |
| Company Admin | amahle@bluewave.co.za | `/c/bluewave` |
| HR | zanele@bluewave.co.za | `/c/bluewave` |
| Manager | peter@bluewave.co.za | `/c/bluewave` |
| Employee | sarah@bluewave.co.za | `/c/bluewave` |

Every other seeded person signs in as `firstname.lastname@nkashheaven.co.za` or `firstname@bluewave.co.za`. NkashHeaven has 63 people in six departments; Bluewave has 9. Both have attendance, timesheets, leave, contracts and paid payroll runs.

The demo data has mandatory 2FA for admins switched off, because the seeded accounts have no authenticator app. A real install has it on, so your Super Admin and company admins set up an authenticator app at first sign-in.

Full manual test cases are in [docs/TEST-CASES.md](docs/TEST-CASES.md).

## Host it

You need a server with Docker, a domain, and HTTPS. HTTPS isn't optional: phone and tablet cameras won't open for the Card Kiosk without it.

The API serves the built app, so it's one container on port 3011. Point an HTTPS proxy (Caddy, Nginx, or your host's load balancer) at it, and make sure it forwards WebSocket traffic for chat and live updates.

```bash
cp .env.production.example .env.production   # fill in your domain, secrets and Brevo key
```

```bash
export MYSQL_ROOT_PASSWORD=choose-a-strong-password
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Seed the live database once. This creates only the platform and the Super Admin (`superadmin@nkashheaven.co.za`), with no demo data and no companies. The temporary password is printed once, so copy it:

```bash
docker compose -f docker-compose.prod.yml exec app npm run db:seed:prod
```

Running it again changes nothing. To use another address, add `-e SUPER_ADMIN_EMAIL=...`. To choose the first password yourself, add `-e SUPER_ADMIN_PASSWORD=...` (8 characters or more, with upper and lower case, a number and a symbol). It still has to be changed at first sign-in. Never commit a real password to this repo.

Then sign in at `https://your-domain/login` with Company code empty, choose a password, set up 2FA, and create your company under Companies. Your company's admin gets the welcome email. Give staff the link shown on the Companies screen.

Don't run `npm run db:seed` on your live server: it wipes the database.

Without Docker, on any host with Node 22 and MySQL 8: build `frontend/` with `npm ci && npm run build`, then in `backend/` run `npm ci --omit=dev`, `npx prisma migrate deploy`, `npm run db:seed:prod` and `node api/server.js` with `NODE_ENV=production`.

**Keep safe:** the `MASTER_KEY`, the MySQL volume, and the uploads volume. Copy backups off the server, because they sit on the same disk as the data.

## How the Odoo behaviour works

- **Check in/out** always uses the server clock. The live counter is worked out from the stored check-in, so it survives reloads and other devices. A unique column makes a second open record impossible, and an idempotency key makes retries safe.
- **Past attendance** can be edited but never created, except by HR with a reason. The API returns 403 even if someone calls it directly. Edits stay on the same day, can't overlap, and are logged with old and new values.
- **Forgotten check-outs** close automatically at the end of the schedule plus 4 hours and are flagged for review.
- **Extra hours** are worked hours minus scheduled hours. A gap between two check-in pairs counts as the lunch break; otherwise the schedule's break is taken off the sum.
- **Timesheets** have a Grid and an Entries list. Several entries can share a grid cell, a task is optional, and tagging a Person assisted sends them an in-app notification. Press a row's letter to start its timer; Shift + the letter adds 15 minutes.
- **Projects** have kanban, list and calendar views, task boards, a chatter, activities, and a risk, issue and change register.
- **Payroll** runs Draft → Verified → Published → Paid. Tax tables and salary rules are editable under Payroll → Rules and tax.
- **Lock date** defaults to the 3rd of the month (month end plus 3 days' grace). Admins can set it under Company Settings.

## How companies and access work

- **Separation** is enforced in `backend/lib/prisma.js`, not in each route. Every query on a company table gets the signed-in company's ID added, and a query with no company context throws instead of returning everything.
- **Roles** are created per company. A role is a list of permissions plus how far it can see (self, the people they manage, company). The permissions decide which screens appear. Company Admin, HR, Manager and Employee are only starter roles. HR sees the whole company like the admin, but only the Company Admin manages roles, makes someone HR, or changes HR and admin accounts. The Company Admin role can be renamed, e.g. to HR.
- **Individual access**: under Employees → a person → Access, HR or the admin can switch single screens or actions on or off for that person, on top of their role. The Company Admin role can't be tweaked.
- **Reporting lines** are separate from roles. Anyone can be another person's manager, and anyone with someone reporting to them, or named in a workflow, can approve for them. Their other access still comes from their role.
- **Leave approval** is set per leave type: the person's manager, then HR, or straight to HR. Workflows can build other chains from steps: manager, HR, a role, or a named person. Timesheets go to the manager unless a workflow says otherwise.
- **Cards** carry a QR code. The Card Kiosk reads it by camera or USB scanner and checks the person in or out, and reissuing a card stops the old one working.

## Going live: what you need to set up

The app runs without these, and tells you what's missing on System Health.

1. **Brevo:** add `BREVO_API_KEY` to `.env` or under Integrations, and verify the sender address in Brevo. Until then, emails print to the backend console (development only; in production they fail and are retried). For invite Opened and Bounced statuses, set `BREVO_WEBHOOK_SECRET` and point a Brevo webhook at `https://your-api/api/webhooks/brevo/<secret>`.
2. **Google Calendar:** create an OAuth client in Google Cloud with the Calendar API on, and add the redirect URL shown under Integrations.
3. **Microsoft 365:** register an app in Microsoft Entra with `Calendars.Read` and `offline_access`, and add the redirect URL shown under Integrations.
4. **Push sync:** Google and Microsoft only call back to a public HTTPS `API_URL`. On localhost the 5-minute sync and Sync now still work.
5. **Backups:** the server needs `mysqldump` on its path. Files go to `backend/backups/`, so copy them off the machine.
6. **Payroll tax tables** default to the 2025/26 SARS figures. Have your accountant confirm them each tax year under Payroll → Rules and tax.
7. **ClickUp:** paste a personal API token under Projects → Import from ClickUp, or upload a CSV export.
8. **Email logos** only load once `API_URL` is a public address.
9. **File uploads** go to the S3-compatible bucket in `AWS_BUCKET`, under the `STORAGE_PREFIX` folder. Without a bucket they stay in `backend/uploads/`, which `docker-compose.prod.yml` keeps on a volume.
10. **Email on a test machine:** real mail only goes to addresses in `EMAIL_TEST_ALLOW`, so demo people are never emailed. Production sends to everyone.

## Tests

```bash
mysql -e "CREATE DATABASE nkash_hr_test"
```

```bash
cd backend && npm test
```

The suite resets `nkash_hr_test` (the same server as `DATABASE_URL`, or `TEST_DATABASE_URL`) on every run. It covers onboarding, attendance, timesheets, leave, profiles, chat, projects, the ClickUp import, contracts, payroll, appraisals, branding, roles, workflows, cards and company separation.

To send a real test email through Brevo:

```bash
cd backend && npm run test:brevo -- you@example.com
```

## Project layout

- `backend/api/routes/`: one file per module
- `backend/lib/`: business rules (`attendance.js`, `leave.js`, `payroll.js`, `chat.js`, `calendar.js`, `clickup.js`), the email queue (`email.js`), background jobs (`jobs.js`), monitoring (`monitor.js`)
- `backend/prisma/`: schema, migrations, seed
- `frontend/src/pages/`: screens by area (`dashboards`, `projects`, `team`, `hr`, `system`, `auth`)
- `frontend/src/contexts/LiveContext.jsx`: attendance state, unread counts and the socket
