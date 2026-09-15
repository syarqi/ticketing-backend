# Network Service Ticketing

A full-stack ticketing application for tracking network service disruptions,
used by a team of technicians and admins.

- **Backend:** Node.js + TypeScript + Express + PostgreSQL (raw SQL, `pg`)
- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Auth:** JWT + bcrypt password hashing, role-based (`ADMIN` / `TEKNISI`)

No XP, ranking, leaderboard, or gamification — just tickets.

## Ticket flow

```
Login → Buat Tiket → OPEN → AMBIL → IN PROGRESS → Update (timeline) → CLOSED → Closed Archive
```

Ticket IDs are generated as `DDMMYYNNNN` (e.g. `1209260001`), with a 4-digit
counter that resets daily and is generated with a single atomic SQL
statement, so concurrent ticket creation can never produce a duplicate ID.

---

## 1. Requirements

- Node.js 18+ and npm
- PostgreSQL 14+ (or Docker, see section 6)
- (Optional) Docker + Docker Compose for containerized deployment

---

## 2. Project structure

```
network-service-ticketing/
├── backend/          # Express + TypeScript API
├── frontend/          # React + TypeScript + Tailwind SPA
├── docker-compose.yml # Full stack (db + backend + frontend)
└── .env.example       # Env vars used by docker-compose
```

---

## 3. Local setup (without Docker)

### 3.1 Database

Create a PostgreSQL database and a user for the app, e.g.:

```sql
CREATE DATABASE network_service_ticketing;
CREATE USER ticketing_user WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE network_service_ticketing TO ticketing_user;
```

### 3.2 Backend

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD),
# JWT_SECRET (long random string), and SEED_ADMIN_PASSWORD.

npm install
npm run migrate   # creates all tables
npm run seed      # seeds master data + initial admin user
npm run dev        # starts the API on http://localhost:4000
```

Health check: `GET http://localhost:4000/api/health`

### 3.3 Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev        # starts the SPA on http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to `http://localhost:4000`
(see `frontend/vite.config.ts`). Open `http://localhost:5173` and log in with
the admin username/password you set in `backend/.env`.

---

## 4. Configuration reference (`backend/.env`)

| Variable | Description |
|---|---|
| `PORT` | API port (default `4000`) |
| `DATABASE_URL` | Full Postgres connection string (takes precedence over the DB_* vars below) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Discrete DB connection settings, used if `DATABASE_URL` is not set |
| `JWT_SECRET` | Secret used to sign auth tokens — use a long random string, never commit it |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `CORS_ORIGIN` | Public URL of the frontend, for CORS |
| `UPLOAD_DIR` | Folder for uploaded ticket photos (default `uploads`) |
| `MAX_UPLOAD_MB` | Max photo size in MB |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_FULLNAME` | Used only by `npm run seed`, to create the first admin account |

`.env` files (with real secrets) are gitignored — never commit them. Only
`.env.example` files, which contain placeholders, are checked in.

---

## 5. Database migrations & seed

- Migrations live in `backend/src/db/migrations/*.sql` and are applied in
  filename order by `npm run migrate`, tracked in a `schema_migrations`
  table so each file only ever runs once.
- `npm run seed` is idempotent: it inserts default locations
  (`Server A`–`Server G`), the four priorities (`Critical/High/Normal/Low`
  with their colors), the default update types, and one initial admin user
  — safe to re-run.
- To add a new migration, add a new numbered file (e.g. `002_*.sql`) and
  run `npm run migrate` again.

---

## 6. Running with Docker (recommended for deployment)

```bash
cp .env.example .env
# edit .env: set DB_PASSWORD, JWT_SECRET, SEED_ADMIN_PASSWORD, CORS_ORIGIN

docker compose build
docker compose up -d db
# wait a few seconds for Postgres to become healthy, then run migrate/seed
# against the containerized database:
docker compose run --rm backend npm run migrate
docker compose run --rm backend npm run seed

docker compose up -d
```

This starts:

- `db` — PostgreSQL 16, with a persistent `db_data` volume
- `backend` — the API on port `4000`, with a persistent `uploads_data` volume
- `frontend` — Nginx serving the built SPA on port `8080`, proxying
  `/api` and `/uploads` to the backend container

Visit `http://localhost:8080` and log in with your seeded admin account.

To view logs: `docker compose logs -f backend` (or `frontend`, `db`).
To stop: `docker compose down` (add `-v` to also remove the database volume).

---

## 7. Production build (without Docker)

### Backend

```bash
cd backend
npm run build   # compiles TypeScript to dist/ and copies migration SQL files
npm start        # runs dist/index.js
```

Run behind a process manager (pm2, systemd) and a reverse proxy (nginx) that
terminates TLS and forwards to the Node process. Make sure `NODE_ENV=production`
is set and `.env` holds real secrets on the server (never commit it).

### Frontend

```bash
cd frontend
npm run build    # outputs static files to dist/
```

Serve `frontend/dist` with any static file server / CDN, and configure your
reverse proxy to forward `/api/*` and `/uploads/*` to the backend (see
`frontend/nginx.conf` for a working example).

---

## 8. Security notes

- Passwords are hashed with bcrypt (12 salt rounds) — never stored in plain text.
- All ticket/master-data mutation routes require a valid JWT and, where
  relevant, the `ADMIN` role or ticket ownership (only the technician who
  took a ticket, or an Admin, can add updates or close it).
- Uploaded photos are renamed to random filenames on disk and restricted to
  image MIME types/extensions; only `/uploads/<random-name>` is ever exposed.
- No secrets are hardcoded — everything sensitive comes from environment
  variables, and only `.env.example` (placeholders) is committed.

## 9. What's intentionally out of scope for V1

- No Telegram integration (planned for a future version).
- No dashboards/charts — the Tickets, My Tickets, and Closed pages are
  intentionally simple, fast, list-based views for mobile use in the field.
