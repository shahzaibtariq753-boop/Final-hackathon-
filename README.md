# HCM Lite

HCM Lite is a responsive, role-based human capital management app built for the Saylani Hackathon brief. It uses a Next.js/JavaScript frontend, an Express/JavaScript API and MongoDB Atlas through Mongoose. The app starts without demo employees or seeded accounts: the company Admin initializes it, adds HR teammates, and HR registers employees.

## Requirements

- Node.js 20 or later
- npm
- A MongoDB Atlas cluster and database user
- An optional OpenAI-compatible API key for AI chat, summaries and smart leave

## Run locally

### 1. Start the backend

In a terminal:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edit `backend/.env` on your computer. Set:

- `MONGO_URI`: your MongoDB Atlas connection string. URL-encode special characters in the database username or password. In Atlas, allow connections from your backend host.
- `JWT_SECRET`: a private random secret of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- `FRONTEND_URL`: `http://localhost:3000` for local development. In production, use your deployed frontend URL instead.
- `AI_API_KEY`: optional. Leave it empty to use the non-AI parts of the app; AI endpoints explain that a key is needed.

Never commit `.env` or paste real credentials into source files. `.env.example` contains placeholders only.

Start the API:

```powershell
npm run dev
```

The API listens on port `5000` by default. Check `http://localhost:5000/health` for the server health response.

### 2. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

`NEXT_PUBLIC_API_URL` in `frontend/.env.local` must point to the API base URL and end in `/api`. For local development the default is `http://localhost:5000/api`. Restart Next.js after changing it.

Open `http://localhost:3000`. The first-run setup asks for your company name and a strong Admin password. There is no preconfigured demo account or demo data.

## First-run demo flow

1. Initialize the company and create the first Admin.
2. Sign in as Admin and create an HR login under **People**. Share the one-time temporary password privately.
3. Sign in as HR and register an employee. The employee account and a one-time temporary password are created together.
4. Employees change their temporary password on first sign-in; then they can check in, request leave, and update their own contact details.
5. HR reviews leave and attendance-correction requests and prepares a payroll draft.
6. Admin reviews the draft and finalizes it. Employees can download their own PDF payslips.
7. Admin reviews the audit trail; Admin and HR can post announcements.

Temporary passwords are displayed only in the account-creation response and are stored hashed. Keep them private and have employees change them at first sign-in.

## Deploy

### Backend service

Deploy `backend` as a long-running Node.js web service on your chosen Node hosting provider. Configure its working/root directory as `backend` when supported; otherwise install and start from that directory. Use:

- Start command: `npm start`
- Health-check path: `/health`
- Environment variables: `MONGO_URI`, a new private `JWT_SECRET`, `FRONTEND_URL` or comma-separated `FRONTEND_URLS`, `NODE_ENV=production`, and optionally `AI_API_KEY`, `AI_MODEL` and `AI_BASE_URL`.

Add the exact HTTPS Vercel application origin to `FRONTEND_URL`. For more than one allowed origin, use `FRONTEND_URLS` with comma-separated origin URLs. Do not add a trailing slash or use `*`. Keep the API service publicly reachable by the browser, configure HTTPS, and allow its outbound connection to Atlas. The database and JWT secrets belong only in the hosting provider’s secret/environment settings.

### Frontend on Vercel

Import this repository into Vercel and set the project root to `frontend`. Use the standard Next.js build/start settings. Set `NEXT_PUBLIC_API_URL` to your live backend API URL, including `/api` (for example `https://your-api.example.com/api`), then deploy. `NEXT_PUBLIC_` values are public browser configuration and must never contain credentials.

Redeploy the frontend when `NEXT_PUBLIC_API_URL` changes. Use the final Vercel origin in the backend’s CORS setting.

## Implemented areas

- First-run company setup; Admin, HR and Employee sign-in; role-checked API access; hashed passwords; required temporary-password changes; account disable/reset; and session invalidation after password changes.
- Organization settings for time zone, office hours, grace period, weekend, office geofence, departments, designations, leave quotas and public holidays.
- Employee registration with login provisioning, searchable/filterable/paginated directory, contact/profile updates, dry-run CSV validation, CSV import and export.
- Server-stamped web attendance, daily board, attendance history, half-day/late rules, correction requests and approval.
- Leave requests, working-day/weekend/holiday counting, annual quotas, overlap checks, employee cancellation, manager decisions and notifications.
- Monthly payroll drafts, attendance and leave deductions, joiner/leaver proration, configured holidays/weekends, illustrative annual tax slabs, Admin finalization and PDF payslips.
- Database-backed Admin/HR/Employee dashboards, AI summaries/chat tools and smart-leave prefill. AI uses the configured backend API key only; it never writes a request without user confirmation.
- Role-visible company announcements, private in-app notifications and a read-only Admin audit log.
- Mobile-responsive dashboard navigation, tables and forms.

Camera/face detection, a mobile app and email delivery of temporary passwords are not included in this web release. Camera attendance is an optional brief bonus, not a web attendance requirement. AI features require a valid provider key and are intentionally disabled without one. Payroll uses the illustrative tax rules from the hackathon brief and is not a substitute for professional payroll or tax advice.

## Verification

From `backend`:

```powershell
npm test
```

From `frontend`:

```powershell
npm run build
```

Backend unit tests cover tax brackets, public-holiday/weekend working days, company time-zone rules and geofence distance. External integrations still require your own Atlas credentials and optional AI key.
