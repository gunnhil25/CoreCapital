# 🌌 CoreCapital — Personal Budget & Financial Analytics Engine

> Production-grade personal budget and financial analytics web application (**CoreCapital**) featuring an **Immutable Ledger System**, automated Australian bank statement ingestion, **First Home Super Saver (FHSS)** tracking, **Defence Home Ownership Assistance Scheme (DHOAS)** subsidy tier progression, and **Subscription Creep Monitoring**.

Built with **Next.js 15 (Node.js 22 standalone)**, **PostgreSQL 16**, and **Drizzle ORM**, fully containerized with **Docker** and automatically built & published to GitHub Container Registry (`ghcr.io/gunnhil25/corecapital:latest`) via GitHub Actions.

---

## 🚀 Quick Start (Prebuilt Image via GHCR)

The fastest way to deploy **CoreCapital** on a server or Proxmox LXC is by pulling the prebuilt image from GitHub Container Registry:

```bash
# 1. Clone this repository
git clone https://github.com/gunnhil25/CoreCapital.git
cd CoreCapital

# 2. (Optional) Customize database passwords, auth secrets, or port in .env
cp .env.example .env

# 3. Pull the latest images and start the stack
docker compose pull
docker compose up -d
```

> **Note for private repositories:** If the GitHub repository or GHCR package is private, authenticate Docker once with a GitHub Personal Access Token (`read:packages` scope):
> ```bash
> echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
> ```

Once running:
* **Web Application:** `http://<YOUR_SERVER_IP>:3000/` — On first launch, PostgreSQL migrations run automatically (`src/db/migrations`) and you are redirected to **`/setup`** (First-Run Wizard) to create your primary Admin account and choose either **Start Clean** or **Load Demo Data**.
* **Health Check:** `http://<YOUR_SERVER_IP>:3000/api/health`

> **HTTPS / Reverse Proxy Note:** CoreCapital inspects `X-Forwarded-Proto` automatically for session cookies, so plain HTTP deployments (such as testing directly on a local Proxmox LXC) work out of the box, while serving behind an HTTPS reverse proxy or Cloudflare Tunnel automatically enables `Secure` cookies. You can also set `COOKIE_SECURE=true` or `COOKIE_SECURE=false` in `.env` to override auto-detection. For production deployments, make sure to replace the default `POSTGRES_PASSWORD`, `AUTH_SECRET`, and `OPEN_BANKING_WEBHOOK_SECRET` values in `.env`.

### Building Locally from Source (Optional)
If you prefer to build the image locally instead of pulling from GHCR (do not pass `--build` when using the prebuilt GHCR image):
```bash
docker compose up -d --build
```

### Updating to the Latest Release
Whenever new changes are pushed to `main`, GitHub Actions runs checks and publishes an updated `:latest` image. To update your running instance:
```bash
docker compose pull
docker compose up -d
```

---

## 📦 Proxmox LXC Deployment Guide

### Step-by-Step Setup (Docker inside an LXC Container)
If you are running Docker inside a Proxmox LXC container (e.g., Debian 12 or Ubuntu 24.04 template):

1. **Enable LXC features for Docker:**
   - In the Proxmox VE Web UI, select your LXC container → **Options** → **Features**.
   - Enable **`nesting=1`** and **`keyctl=1`** (required for Docker inside an unprivileged LXC), then reboot the LXC if prompted.

2. **Install Docker & Docker Compose plugin inside the LXC:**
   ```bash
   apt-get update && apt-get install -y curl git
   curl -fsSL https://get.docker.com | sh
   ```
   Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

3. **Clone the repository and configure environment:**
   ```bash
   git clone https://github.com/gunnhil25/CoreCapital.git /opt/corecapital
   cd /opt/corecapital
   cp .env.example .env
   # Optional (recommended for production): edit POSTGRES_PASSWORD, AUTH_SECRET, OPEN_BANKING_WEBHOOK_SECRET, or PORT
   nano .env
   ```

4. **Pull the image and launch the stack:**
   ```bash
   # (Only needed if the GHCR package is private)
   # docker login ghcr.io -u gunnhil25

   docker compose pull
   docker compose up -d
   ```

5. **Verify the deployment:**
   ```bash
   docker compose ps
   curl -s http://localhost:3000/api/health
   ```
   You should see `"status":"ok"` and `"database":"connected"`.

6. **Auto-start on LXC boot:**
   Both `corecapital-db` and `corecapital-app` use `restart: unless-stopped`, so they start automatically whenever your Proxmox LXC boots.

### Optional: Exposing via Cloudflare Tunnel (`cloudflared`)
If you want to expose your LXC instance over HTTPS via Cloudflare Tunnel:
```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb

# Authenticate and route traffic to the Docker app port (3000)
cloudflared tunnel login
cloudflared tunnel create corecapital
cloudflared tunnel route dns corecapital budget.yourdomain.com
cloudflared tunnel run corecapital --url http://localhost:3000
```

---

## ⚙️ CI/CD Pipeline (GitHub Actions)

Every push to `main`, `master`, `dev`, or a `v*.*.*` tag (as well as manual `workflow_dispatch`) triggers [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml):
1. Installs dependencies (`npm ci` on Node.js 22) and runs TypeScript type checking (`npx tsc --noEmit`) and automated tests (`npm test`).
2. Builds the multi-stage standalone image from `Dockerfile` with GitHub Actions layer caching.
3. Pushes the image to GHCR (`ghcr.io/gunnhil25/corecapital`) with branch, `sha-`, and semver tags, plus `:latest` on the default branch (`main`).

---

## 🏗️ Architecture & Technology Stack

* **Framework**: Next.js 15 (App Router, Node.js 22 runtime, `output: "standalone"`)
* **Language**: TypeScript 5 (Strict Mode enabled)
* **Database**: PostgreSQL 16 (Alpine in Docker Compose, persistent volume `corecapital_pgdata`)
* **ORM**: Drizzle ORM (automatic startup migration from `src/db/migrations`)
* **Styling**: Tailwind CSS + shadcn/ui design tokens
* **Icons**: Lucide React
* **Charts**: Recharts (SSR-safe dynamic hydration)
* **Hosting Target**: Unprivileged Proxmox LXC (Docker) + optional Cloudflare Tunnel

---

## 🏛️ Architectural Principles

### 1. Immutable Ledger System
Financial data is audit-grade. Hard SQL `DELETE` operations on transactions and ledger entries are strictly prohibited.
* **Offsetting Reversals**: To correct a mistaken or duplicate entry, the system generates an atomic reversing transaction (`amount = -original.amount`, `isReversal: true`) linked to `reversesTransactionId` with an audit reason, and marks the original transaction as `reversed`.
* **Split Transactions**: A single transaction can be split across multiple categories (e.g. $150 supermarket receipt into $100 Groceries and $50 Household Supplies), verified to the exact cent (`numeric(12, 2)`).
* **SHA-256 Deduplication**: Every imported bank record computes a hash over `accountId + date + amount + rawDescription` to block duplicate imports.

### 2. Secure Server Actions
All database mutations occur exclusively via Next.js Server Actions (`"use server"`). No database connection strings or raw SQL queries leak to the client.

### 3. Mobile-First Responsiveness
Dual-navigation architecture:
* Pinned desktop sidebar with live host/ledger telemetry.
* Fixed mobile bottom bar with quick touch action button for mobile receipt capture and instant transaction logging.

---

## 📦 Core Feature Modules

### 1. Statement Ingestion & Classification
* **CSV Parsing Engine**: Supports Commonwealth Bank (CBA), Macquarie Bank, ANZ, NAB, and generic CSV statements.
* **Auto-Classification Rules**: Priority-ordered matching engine (`contains`, `exact`, `ilike`, `starts_with`, `regex`) to tag transactions automatically.
* **Open Banking & OCR Stubs**:
  * `/api/webhooks/open-banking`: HMAC-verified CDR webhook hook for Basiq/Frollo.
  * `/api/receipts/ocr`: Mobile receipt image parser extracting merchant, date, total, and suggested line-item splits.

### 2. Subscriptions & Cash Flow
* **Subscription Creep Monitor**: Isolates recurring drains and calculates **true annualized costs** (e.g. $19.95/wk = $1,037.40/yr) to flag micro-charge creep.
* **Cash Flow Forecasting**: 30-day and 90-day balance trajectories simulating scheduled ADF paydays, rent, and subscriptions to identify low-water marks.

### 3. Long-Term 2029 Property & Scheme Modeling
* **2029 Adelaide vs Melbourne Goal**: Real-time deposit runway, state stamp duty calculators (South Australia sliding scale vs Victoria first home buyer exemptions), and monthly savings requirements.
* **FHSS Scheme Tracker**: Tracks voluntary BPAY super contributions up to the **$15,000/FY** and **$50,000 lifetime cap**, calculates marginal tax savings (32.5% vs 15% super tax), and compounds ATO SIC deemed earnings (~7.15%).
* **DHOAS Subsidy Tier Accrual**: Models Defence qualifying service years, displaying current accrued tier vs projected tier unlocked when purchasing in 2029 (Tier 1: $386k, Tier 2: $579k, Tier 3: $772k subsidized loan cap).

### 4. Dashboards & Investigation
* **Cockpit Dashboard**: High-level financial KPIs, monthly inflow vs outflow charts, category spending donut distribution, and budget pacing gauges.
* **Investigation View**: Interactive data table with sorting, severity filters, and anomaly flags for budget overshoots and unclassified transactions.

---

## 🗄️ Database Management & Backups

### Creating a Database Backup
```bash
docker exec -t corecapital-db pg_dump -U corecapital_user corecapital > backup_$(date +%F).sql
```

### Restoring from Backup
```bash
cat backup_YYYY-MM-DD.sql | docker exec -i corecapital-db psql -U corecapital_user corecapital
```
