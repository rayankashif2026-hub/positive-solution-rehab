# Positive Solutions Clinic System

The approved replacement application is in `web/` and uses Next.js, TypeScript,
Supabase Auth/PostgreSQL, and row-level security. The earlier FastAPI app remains
available for local access to the existing Django/SQLite data, but it is a
separate interim application and is not connected to the new Supabase database.

The existing `clinic.sqlite3` database is preserved. The new app does not import
or modify it; a reviewed legacy-data importer still needs to be built before
moving existing records into Supabase.

## Run the Next.js application

Install Node.js 20.9 or later and npm. Use either a hosted Supabase project or a
local Supabase stack (the local stack requires Docker Desktop).

### Configure Supabase

For a local stack, from the repository root run:

```powershell
npx supabase start
```

For a hosted project, authenticate and link the project:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Apply the migrations in order:

```powershell
npx supabase db push
```

Keep the Supabase service-role key server-side. Never place it in a
`NEXT_PUBLIC_*` variable or commit it to source control.

Permanent record deletion is available only to users with `system.manage`
(granted to the Developer / Head Developer role, not Head Admin), requires an
explicit confirmation, and is recorded in the audit history.
Foreign-key relationships may block deletion; archive records when history
needs to be preserved.

### Configure and start the web app

In PowerShell:

```powershell
Copy-Item web\.env.example web\.env.local
Set-Location web
npm install
npm run bootstrap:developer
npm run dev
```

Fill `web\.env.local` with the Supabase URL, publishable key, service-role key, and
initial Developer account values before running the bootstrap script. The
bootstrap is protected by a database lock and refuses to create a second
Developer account; it assigns both Head Developer and Head Admin roles to that
initial account. Only Head Developers can access User administration, invite
staff, review access requests, and remove non-Developer portal accounts.
Removing an account deletes its login and access grants while preserving
clinical records and audit history. Developer accounts are managed through the
one-time bootstrap process. Head Admin-only and department-admin roles cannot
access this section.
For development access from the clinic LAN, `web/next.config.ts` allows the
current app host `192.168.1.65`; update `allowedDevOrigins` there if the machine's
LAN address changes, then restart the Next.js dev server.
For an existing deployment, run `npx supabase db push` before using the updated
roles so the migrations grant Head Admin to existing Head Developers and keep
User administration restricted to the Developer role.

To reset the existing Head Developer password, set a new
`INITIAL_DEVELOPER_PASSWORD` in `web\.env.local`, then run
`npm run reset:developer-password` from `web/`. The command verifies the account
has the Developer role and requires typing `RESET` before changing the password.

Open <http://localhost:3000>. Staff sign in through the application login page;
the browser no longer receives the interim FastAPI app's HTTP Basic Auth JSON
response. Supabase Auth email delivery must be configured for account
invitations.

### Email notifications

The login-alert outbox uses Gmail API OAuth credentials. Enable the Gmail API
for a Google Cloud project and configure a refresh token with the
`https://www.googleapis.com/auth/gmail.send` scope. Set `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER`, and
`CRON_SECRET` in the server environment. Set `OWNER_NOTIFICATION_EMAIL` to
choose the recipient; if omitted, the initial Developer email is used. Vercel
Cron uses `CRON_SECRET` to authorize the scheduled worker.
The same Gmail outbox sends owner alerts when someone submits a staff access
request.

The worker retries failed deliveries up to five times and claims jobs
transactionally. If Gmail is not configured, login still works and notification
delivery is reported as unavailable/failed in the outbox.

### Optional clinic assistant

The authenticated workspace includes an optional floating assistant. Manual
registration, appointments, payments, attendance, and department workflows
remain available independently. The assistant prepares the existing module
forms, searches records allowed by the signed-in user's permissions, checks
upcoming follow-ups, and links to the existing report exporter. Record changes
are shown for review and require explicit confirmation before using the same
authorized save path as manual forms.

Search results can also be edited, archived, or permanently deleted from the
assistant when the signed-in user has the corresponding permissions. Archive
and deletion actions require an explicit confirmation; permanent deletion is
restricted to `system.manage`, obeys row-level security and foreign-key
constraints, and is written to the database audit trail. Manual module controls
remain available independently.

The assistant uses a local Ollama model for request interpretation and form
value extraction. It sends prompts only to the loopback Ollama service; it does
not use an external AI API. If Ollama or the configured model is unavailable,
the assistant explicitly reports that and falls back to guided rules for
common requests. The local model cannot save records itself: authorized server
actions, review, and explicit confirmation are still required.

Install Ollama, start its local server, and download the default model:

```powershell
ollama serve
ollama pull qwen2.5:1.5b
```

Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in the server environment if using a
different local endpoint or model. The default local URL and model are listed in
`web/.env.example`. The model is not bundled with the application and must be
installed separately.

Apply the Supabase migrations with `npx supabase db push` before using assistant
record changes. Assistant writes require the assistant audit migration and
fail closed if its audit operation is unavailable. Assistant permanent deletion
also requires the system-managed record deletion migration; it remains restricted
to `system.manage` and respects foreign-key constraints.

### Staff access requests

The login page links to a public request form for a person's name, email,
password, branch, requested role, and reason. Branch is free text because the
current database has departments, not a configured list of physical branches.
Apply the Supabase migrations with `npx supabase db push` to create the
pending-request table and registration functions. The Head Developer can review
requests on the Admin page, choose the actual role and department, and approve
or reject each request. Submitting the form creates a provisional Supabase Auth
account, but does not grant access. The account stays inactive and unconfirmed
until the Head Developer approves the request and assigns its role. The
requester can then sign in with that email and password and is redirected to the
dashboard.
Supabase Auth stores and validates the password; the clinic database does not
store it. Requests remain available for review if notification email delivery
is not configured; email alerts require the owner notification address and
Gmail/cron environment variables above. The scheduled worker runs on Vercel
every five minutes. Direct staff invitations still use the invitation email
and password setup flow.

### Checks and deployment

From `web/`:

```powershell
npm run typecheck
npm run lint
npm run build
```

Deploy `web/` as the Vercel project root and configure the same environment
variables there. `web/vercel.json` schedules the email worker every five
minutes. Vercel Hobby supports only daily cron schedules and is limited to
personal, non-commercial use; do not use Hobby for real clinic operations.
Keep the Supabase Auth redirect URLs and `NEXT_PUBLIC_SITE_URL` aligned with
the deployed domain. Add both the local and deployed
`/auth/callback` URLs to the Supabase Auth redirect URL allowlist so invited
staff can open their invitation, create a password, and continue to the dashboard.

## Access and data safeguards

- Database row-level security applies department and role permissions.
- Only users with the Developer role can open or operate User administration;
  Head Admin-only and department-admin roles cannot manage other accounts.
- Psychology clinical notes use a separate table and permission, not inherited
  by Developer or Head Admin by default.
- Login attempts are limited to five failures per email or IP hash in a
  15-minute window. IP hashes use `LOGIN_IP_HASH_SECRET` when configured, or
  the server-only Supabase service-role key as the HMAC secret.
- Inventory quantity changes are recorded as append-only stock transactions;
  ordinary clients cannot directly edit the on-hand quantity.
- Audit events omit clinical field values. Passwords are managed by Supabase
  Auth and are never migrated from Django.
- Reports export only datasets for which the signed-in user has both report
  export and dataset permissions. Psychology notes are not included.

## Legacy FastAPI app

The original Django-backed FastAPI app remains available for local use with
`clinic.sqlite3`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:DJANGO_SECRET_KEY = python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
$env:DJANGO_DEBUG = "true"
python manage.py migrate
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8001
```

Open <http://127.0.0.1:8001>. This is not the Next.js/Supabase application and
should be used only for local testing.

## Database backups

Back up `clinic.sqlite3` before any legacy work. Supabase backups and recovery
should be configured separately in the Supabase project.
