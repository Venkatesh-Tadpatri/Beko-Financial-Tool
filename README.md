# BEKO Financial Visualization Tool

Windows desktop application for importing SAP Excel sales registers and displaying database-backed financial dashboards. It uses Electron and React for the interface, FastAPI and SQLAlchemy for the local service, and SQLite for persistent storage.

## Current features

- Import `.xlsx` Sales Register files.
- Automatically detect headers, map columns, validate rows, and store valid data.
- Publish data directly to Dashboard, Turnover, Revenue, and Product Mix without an approval step.
- Preserve the original Excel file and keep replaced reporting periods in history.
- Show dynamic KPI cards, charts, tables, product shares, channels, customers, and key takeaways.
- Manage users, master data, backups, and audit history locally.

## Technology

| Layer | Technology |
|---|---|
| Desktop | Electron |
| Frontend | React, TypeScript, Tailwind CSS, ECharts |
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic |
| Database | SQLite |
| Tests | Vitest, React Testing Library, pytest |

## Prerequisites

Use Windows 10 or 11 with these tools:

| Tool | Version | Installation |
|---|---:|---|
| Git | Current | `winget install --id Git.Git -e --source winget` |
| Node.js | 22 LTS | `winget install --id OpenJS.NodeJS.LTS -e` |
| Python | 3.11.x | `winget install --id Python.Python.3.11 -e --source winget` |

Verify the installations:

```powershell
git --version
node --version
npm --version
py -3.11 --version
```

## Clone and run on another computer

The active development branch is `feature/excel-import-visualizations`.

```powershell
git clone --branch feature/excel-import-visualizations https://github.com/Venkatesh-Tadpatri/Beko-Financial-Tool.git
cd Beko-Financial-Tool

py -3.11 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --upgrade pip
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt

npm ci
npm run dev
```

`npm run dev` compiles Electron, starts the React development server, launches the Python API, and opens the desktop application.

If PowerShell cannot find `py`, create the environment with the full Python path:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv backend\.venv
```

If pip reports `CERTIFICATE_VERIFY_FAILED` behind a company proxy:

```powershell
backend\.venv\Scripts\python.exe -m pip install --use-feature=truststore --upgrade pip
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

## Using the application

1. Sign in as a user with upload access.
2. Open **Upload data**.
3. Select **Sales Register (SAP)** and choose an Excel workbook.
4. A valid workbook is mapped, validated, stored, and published automatically.
5. The Dashboard opens using the newly imported values.
6. If mappings or rows are invalid, the review screen identifies what requires correction.

Development data is stored at `%APPDATA%\FinancialVisualizationTool-dev`. To use a different folder:

```powershell
$env:FVT_DATA_DIR = "C:\temp\fvt-test"
npm run dev
```

## Verification

```powershell
npm run typecheck       # TypeScript validation
npm test                # Frontend tests
npm run test:backend    # Backend tests
npm run build           # Renderer and Electron build
```

## Build distributables

```powershell
npm run dist
```

The installer configuration is under `installer/`. Users of a packaged build do not need Node.js or Python because its runtime is bundled.

## Project structure

```text
backend/    FastAPI API, models, migrations, import workflow, and tests
desktop/    Electron process, preload bridge, and Python sidecar management
renderer/   React screens, charts, API client, and frontend tests
installer/  Windows packaging configuration
docs/       User, administration, backup, and recovery documentation
scripts/    Development runner and supporting scripts
```

## Update an existing checkout

```powershell
git fetch origin
git switch feature/excel-import-visualizations
git pull --ff-only origin feature/excel-import-visualizations
npm ci
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
npm run dev
```

Do not commit the virtual environment, `node_modules`, builds, databases, uploaded Excel archives, credentials, or local application data.
