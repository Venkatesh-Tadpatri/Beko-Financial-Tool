# Financial Visualization Tool

Windows desktop application for SAP sales and financial reporting.
Electron + React (renderer) with a local Python/FastAPI data service and SQLite.

> Status: in development. Phases 1–3 are complete (database, data safety, authentication)
> plus the app window with sign-in screens. Installer steps are added in the packaging phase.

## Prerequisites (Windows 10 or 11, developer machine)

| Tool | Version | Install |
|---|---|---|
| Python | 3.11.x | `winget install --id Python.Python.3.11 -e --source winget` |
| Node.js | 22.x LTS | https://nodejs.org or `nvm install 22` |
| Git | any recent | `winget install --id Git.Git -e --source winget` |

End users do **not** need Python or Node; the installer bundles everything.

## First-time setup

```powershell
cd C:\path\to\Beko-Financial-Tool

# Backend environment (pinned versions)
& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --upgrade pip
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt

# Frontend / Electron (versions locked in package-lock.json)
npm ci
```

**Behind a company proxy or antivirus that inspects HTTPS?** If pip reports
`CERTIFICATE_VERIFY_FAILED`, upgrade pip first with
`backend\.venv\Scripts\python.exe -m pip install --use-feature=truststore --upgrade pip`.
Newer pip then uses the Windows certificate store automatically.

## Run the application (development)

```powershell
npm run dev
```

This compiles the Electron main process, starts the renderer dev server with hot reload,
opens the application window and starts the Python data service.

* A new installation has one built-in Super Admin: `admin@beko-technologies.com`. Its starting
  password is handed over separately (it is not written in this repository). The first sign-in
  must choose a new password before anything else can be used.
* Any user can change their password from the sign-in screen ("Change password") or, when
  signed in, from the panel at the bottom of the menu.
* Development data is kept in `%APPDATA%\FinancialVisualizationTool-dev`, separate from a
  real installation. To start again from a fresh first run, close the app and delete that folder.
* To use another folder: `$env:FVT_DATA_DIR = "C:\temp\fvt-test"; npm run dev`

## Tests

```powershell
npm test               # UI tests (Vitest + React Testing Library)
npm run test:backend   # backend tests (pytest)
npm run typecheck      # TypeScript checks
```

## Project layout

```
backend/    FastAPI service, models, Alembic migrations, tests
desktop/    Electron main process and preload
renderer/   React application (screens, charts)
installer/  electron-builder / NSIS configuration and zip script (packaging phase)
docs/       user, admin and backup guides
scripts/    developer scripts (dev runner)
```
