# AI Video Editor

Phase 0C adds a real project library, project creation, and project detail pages
to the Phase 0A/0B foundation. The worker verifies a
database connection at startup and closes its pool on graceful shutdown. It
does not claim or process jobs.

The five planning documents describe the broader MVP and remain preserved as-is.
Their full Phase 0 acceptance suite is not a claim about this foundation stage.
Phase 0D and later work require separate authorization.

## Workspaces

| Directory | Current contents |
|---|---|
| `apps/web` | Next.js App Router project library, creation form, detail pages |
| `apps/worker` | TypeScript worker startup and graceful shutdown |
| `packages/contracts` | One typed foundation export consumed by both applications |
| `packages/media` | Empty package reserved for later media integration |
| `packages/db` | Typed PostgreSQL access, SQL migrations, database integration tests |

All workspaces are private. Dependencies are pinned in manifests and the root
`package-lock.json`. Shared packages compile to ignored `dist` directories;
root development/check/build commands build these before their consumers.

## Local development

Use standalone Node.js 24 LTS and npm 11. Commands below run from the repository
root in PowerShell. Use `npm.cmd` to avoid execution-policy issues with `npm.ps1`.
Phase 0B requires local PostgreSQL and a private `DATABASE_URL`; no API keys or
media tools are used by this stage. Configure the database as described below
before starting the worker or checking web database connectivity.

If Codex has an older PATH snapshot, prepend standalone Node for that shell only:

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
node -v
npm.cmd -v
```

Do not rely on this process-local setting persisting into a new Codex shell call.
On macOS/Linux, use `npm` in place of `npm.cmd`.

Install dependencies:

```powershell
npm.cmd install
```

For subsequent reproducible installations, use `npm.cmd ci` with the lockfile.

Start the web app:

```powershell
npm.cmd run dev:web
```

Open <http://127.0.0.1:3000>. The server binds to loopback. Stop it with Ctrl+C.
Web source changes reload automatically; after changing shared package source,
run `npm.cmd run build:packages` or restart the root development command.

Start the worker in a separate terminal:

```powershell
npm.cmd run dev:worker
```

Expect `[worker] AI Video Editor | Phase 0B | Database connected.` followed by a
startup message. Press Ctrl+C or type `exit` and Enter for graceful shutdown.
The `exit` command is also usable in a piped Windows terminal. SIGINT/SIGTERM
handlers share the same cleanup path. Worker development compiles then starts;
restart this command after editing worker source (no watch runner dependency).

Run checks and production builds:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run start:web
```

`npm.cmd run check` combines type checking and linting. `build` builds the packages,
worker, and web app. After building, `npm.cmd run start:worker` runs the compiled
worker without rebuilding. Check the production homepage at the same loopback
URL; do not run dev and production web servers on port 3000 simultaneously.

## Environment and future media configuration

`.env.example` contains blank settings. Database access loads the ignored root
`.env` on first connection; existing process environment variables take precedence.
Do not commit or print a real environment file. Credentials remain server-side.

Later media integration will accept explicit `FFMPEG_PATH` and `FFPROBE_PATH`
through worker configuration, including Windows paths containing spaces. The
media package will receive these as configuration instead of assuming global
executables; resolution and subprocess execution are intentionally absent now.
`MEDIA_ROOT` will identify local storage, preferably inside ignored `.local/media`
with separate originals, working, temporary, and export directories.

Build output, dependencies, local environment files, logs, and local/generated
media are ignored. Planning Markdown and `references/reference-video.mp4` remain
trackable. No upload, media processing, AI calls, stories, EDLs, rendering,
authentication, or Supabase are implemented.

## Phase 0B database setup and verification

Use the existing PostgreSQL server at `localhost:5432`. Put `DATABASE_URL` in
the Git-ignored repository-root `.env`, in the form
`postgresql://USER:URL_ENCODED_PASSWORD@localhost:5432/ai_video_editor`.
Replace placeholders privately in your editor. Percent-encode reserved password
characters. The role needs permission to create this database (for initial setup)
and create its schema objects. No roles, global settings, or other databases are
modified. Configuration rejects remote hosts, other ports/databases, and URL
query parameters for this local-only phase.

```powershell
npm.cmd run db:create
npm.cmd run db:migrate
npm.cmd run db:verify
npm.cmd run test:db
```

`db:create` creates only `ai_video_editor` if missing, using `postgres` as the
maintenance connection. Migrations are ordered SQL files in `packages/db/migrations`.
The transactional runner serializes migration execution with an advisory lock and
records SHA-256 checksums in the technical `schema_migrations` ledger. Running it
again is a no-op. Never edit an applied migration; add a new numbered migration.
Migrations run explicitly, never during web builds or worker startup.

The four domain tables are `projects`, `media_assets`, `jobs`, and `analysis_runs`.
`media_assets` is the initial physical form of the planning document's `assets`
entity, with the small metadata subset requested for Phase 0B inline. Full metadata,
artifacts, reservations, policies, and other future entities remain deferred.
The fixed local owner UUID is persisted without an authentication dependency.
It must be explicitly mapped before future multi-user deployment.

Storage identity consists of backend, namespace, and relative logical key;
`storage_path` is not an absolute Windows path or signed URL. `bigint` values
(file sizes and durations) are returned as strings to preserve integer precision.
Timestamps use `timestamptz`; node-postgres returns JavaScript Dates.
No product quota is encoded in the schema. Callers must provide `max_attempts`.

Foreign keys enforce same-project media references for jobs and analysis runs.
Referenced rows cannot be silently deleted. Jobs include approved pause/cancel
states, lease metadata, project-scoped idempotency, and eligible-queue indexes.
Future claiming must use transactional row locking/`SKIP LOCKED`, dependency and
capacity checks, and current lease tokens; none of that processing is implemented.
Analysis revisions carry pipeline/model/prompt/schema and future cache identifiers;
no actual analysis or cache engine exists yet.

Integration tests apply migrations twice, verify tables/indexes, round-trip all
four entities, reject cross-project references and invalid records, and roll back
all fixture records. They require the project database and do not delete existing
project data. Schema migrations themselves persist.

After building and starting the web app, `GET /api/health/database` performs a
server-only connection check and returns HTTP 200 with `{"status":"ok"}` or a
generic HTTP 503. It exposes no credentials or driver error details. To check the
worker once without leaving it running, build it and run:

```powershell
npm.cmd run build:worker
node apps/worker/dist/index.js --check-db
```

Pools have bounded connections and timeouts. No connection string or password is
logged. Phase 0B verifies connectivity and schema only; full Phase 0 acceptance
tests remain deferred to their corresponding implementation stages.

## Phase 0C project workflow

Apply pending migrations with `npm.cmd run db:migrate`, then start the web app.
The library at `/` reads PostgreSQL on each request. Choose **New Project**, enter
a name, and submit. Names are trimmed, required, single-line, and limited to 120
characters on both the server and the form. A native form posts to
`POST /api/projects`, which redirects to `/projects/[projectId]` after saving.
`/projects/new` provides the form. No client database code or new dependencies
are needed. The Route Handler was chosen for a simple progressively enhanced
HTML form and direct HTTP testing.

Migration `0002_project_status.sql` adds persisted status (`active` by default;
`archived` reserved for later). The Phase 0B migration is unchanged. Project cards
show status, created/updated timestamps (UTC), and media count. Detail pages show
project identity and a Footage placeholder; there are no upload controls.
All project queries use `packages/db` with the persisted local owner UUID.
Owner identity is selected server-side, never from form input. Local host checks
protect project pages, and creation requires a matching local HTTP Origin/Host.
Continue using the loopback-bound start commands; this is not a multi-user service.

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run test:db
npm.cmd run test:web
```

Web tests require a production build and migrated local database. They launch
their own loopback servers, test create/list/detail/refresh, validation, missing
IDs, cross-origin rejection, and database failure messages. Failure simulation
uses a separate process configuration, never stops PostgreSQL or alters `.env`.
Database tests verify committed persistence across connections and owner isolation.
Both suites remove only their own test records. No Phase 0D features are included.
