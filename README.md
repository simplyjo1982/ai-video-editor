# AI Video Editor

Phase 0D adds local, resumable video uploads and persisted Footage lists to the
Phase 0A–0C foundation. The worker verifies a
database connection at startup and closes its pool on graceful shutdown. It
does not claim or process jobs.

The five planning documents describe the broader MVP and remain preserved as-is.
Their full Phase 0 acceptance suite is not a claim about this foundation stage.
Phase 0E and later work require separate authorization.

## Workspaces

| Directory | Current contents |
|---|---|
| `apps/web` | Next.js App Router project library, creation form, detail pages |
| `apps/worker` | TypeScript worker startup and graceful shutdown |
| `packages/contracts` | One typed foundation export consumed by both applications |
| `packages/media` | Local storage adapter, bounded streaming, upload validation/configuration |
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

Later processing integration will accept explicit `FFMPEG_PATH` and `FFPROBE_PATH`
through worker configuration, including Windows paths containing spaces. The
media package will receive these as configuration instead of assuming global
executables; resolution and subprocess execution are intentionally absent now.
`MEDIA_ROOT` now identifies local storage outside the source tree where practical,
with separate `originals`, `working`, `temp`, and `exports` directories.

Build output, dependencies, local environment files, logs, and local/generated
media are ignored. Planning Markdown and `references/reference-video.mp4` remain
trackable. No media processing, AI calls, stories, EDLs, rendering,
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
artifacts, policy tables, and other future entities remain deferred. Phase 0D adds
the upload reservation ledger described below.
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
project identity. Phase 0D replaces the Footage placeholder with local uploads.
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
Both suites remove only their own test records.

## Phase 0D local uploads

Set `MEDIA_ROOT` privately in the ignored root `.env` to an absolute path, such as
`D:/Projects/AI-Video-Editor-media`. Restart the web process after changing settings.
Do not change this root for an existing database without migrating its originals.
The local adapter creates these classes under the root:

```text
originals/<project UUID>/<server-generated asset UUID>.<mp4|mov|m4v>
working/       # reserved for later processing
temp/<project UUID>/<upload UUID>.part
exports/       # reserved for later rendering
```

Only logical keys are stored in PostgreSQL. Original user filenames are display
metadata, never disk paths. Runtime media is not served from `public/` or bundled
into the application. The local filesystem must support hard links (NTFS works);
publication uses a same-volume, no-overwrite link, then removes the temporary link.
The storage interface separates these local operations from future cloud adapters.

Environment-configurable defaults (decimal bytes):

| Variable | Default |
|---|---:|
| `MAX_FILES_PER_PROJECT` | 20 |
| `MAX_FILE_SIZE_BYTES` | 1000000000 |
| `MAX_PROJECT_STORAGE_BYTES` | 5000000000 |
| `UPLOAD_RESERVATION_TTL_SECONDS` | 86400 |

These are validated positive safe integers, not architectural database limits.
Migration `0003_upload_reservations.sql` records effective policy snapshots and
hashes. Project-row locking reserves declared bytes and file slots atomically
against registered assets plus incomplete uploads. Actual received length is
bounded and must match the reservation before registration. No duration admission
or codec validation is claimed until probing is implemented in Phase 0E.

From a project, choose **Upload Footage**, select one or more videos, then upload.
Each file receives its own result. Files transfer sequentially in the browser,
with server chunks bounded to 4 MiB and 30-second chunk timeouts; they are not
loaded as whole videos into application memory. MP4/MOV/M4V extensions and known
MIME types are checked. Empty/generic browser MIME values still require the
actual file's supported ISO BMFF `ftyp` container header. Legacy MOV files without
this header are currently rejected. This check does not prove decodability or
codec support. No external media executable is invoked.

Routes:

- `POST /api/projects/[projectId]/uploads`: validate and reserve one file with a
  project-scoped idempotency key, or return its existing received offset.
- `PUT /api/projects/[projectId]/uploads/[uploadId]`: stream a bounded chunk with
  an `Upload-Offset` header.
- `POST /api/projects/[projectId]/uploads/[uploadId]`: validate length/container,
  hash the content, publish the original, and register the media asset once.

Interrupted chunks do not advance the persisted offset. Retry/reselect the same
file in the same browser tab to resume; the tab stores its upload key. Retrying a
completed finalization reuses its asset. A normal new upload after success gets
a new server UUID, so equal original filenames cannot overwrite each other.

An uploaded asset is marked `uploaded`, not `ready`; duration, dimensions, and
codec remain null. The Footage list reads PostgreSQL and survives refresh.
Upload success does not create processing jobs, metadata, previews, or analysis.

The database row remains uncommitted until file publication succeeds. Known
post-publication database failures remove only the upload's own published link;
resumable data remains pinned by the reservation. Ambiguous commit failures retain
files and the ledger for idempotent reconciliation on retry. Unacknowledged disk
bytes are truncated back to the committed offset when the transfer resumes.
Rejected headers are cleaned up and release their reservation. Expired incomplete
uploads are cleaned opportunistically before the next upload admission for that
project, then release quota. Completed uploads also retry temporary-link cleanup.
There is no scheduled sweeper or user-facing permanent deletion in Phase 0D.
Unexpected file collisions or storage cleanup failures fail closed and keep their
reservation accounted, rather than removing unrelated files.

Run `npm.cmd run db:migrate`, `npm.cmd run check`, `npm.cmd run build`,
`npm.cmd run test:db`, `npm.cmd run test:web`, and `npm.cmd run test:upload`.
Upload tests use isolated ignored `.local/` roots, tiny generated header fixtures,
and the existing small reference video for HTTP transport checks only (not AI or
decoder-quality evaluation). They clean their own fixtures, cover quota races,
retries, rollback, unsafe paths, same-name uploads, filesystem persistence, and
safe HTTP errors. No large new media fixture or runtime upload belongs in Git.
