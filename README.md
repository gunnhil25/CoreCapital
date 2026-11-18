# CoreCapital 🌌💰

> Production-Grade Personal Budget & Financial Analytics Web Application with an **Immutable Ledger System**, automated Australian bank statement ingestion, **First Home Super Saver (FHSS)** tracking, **Defence Home Ownership Assistance Scheme (DHOAS)** subsidy tier progression, and **Subscription Creep Monitoring**.

Optimized for self-hosting in an unprivileged **Proxmox LXC container running Debian 12**, utilizing Next.js standalone server behind a **Cloudflare Tunnel**.

---

## 🏗️ Architecture & Technology Stack

* **Framework**: Next.js 15 (App Router, Node.js 22 runtime, `output: "standalone"`)
* **Language**: TypeScript 5 (Strict Mode enabled)
* **Database**: PostgreSQL 16
* **ORM**: Drizzle ORM
* **Styling**: Tailwind CSS + shadcn/ui design tokens
* **Icons**: Lucide React
* **Charts**: Recharts (SSR-safe dynamic hydration)
* **Hosting Target**: Unprivileged Proxmox LXC (Debian 12) + Cloudflare Tunnel

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
* Pinned desktop sidebar with live LXC host telemetry.
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

## 🐳 Quick Deployment via GitHub Container Registry & Docker Compose

### 1. Automatic Image Publishing (GitHub Actions -> GHCR)
Every push to `main`, `dev`, or a `v*.*.*` release tag triggers [docker-publish.yml](.github/workflows/docker-publish.yml), which runs TypeScript & Vitest checks and pushes a multi-layer standalone Docker image to:
```text
ghcr.io/gunnhil25/corecapital:dev
ghcr.io/gunnhil25/corecapital:latest
```
*(Ensure **Settings → Actions → General → Workflow permissions** allows Read and write permissions, and set your package visibility to Public or authenticate with a GitHub PAT via `docker login ghcr.io`.)*

### 2. Deploy on Any Host with `docker compose`
Copy `docker-compose.yml` and `.env.example` to your server, set strong secrets in `.env`, then pull and start:

```bash
cp .env.example .env
# Edit .env and set CORECAPITAL_IMAGE=ghcr.io/gunnhil25/corecapital:dev (or :latest for main)
# plus strong POSTGRES_PASSWORD, AUTH_SECRET, and OPEN_BANKING_WEBHOOK_SECRET values

docker compose pull
docker compose up -d
```

On first startup, the CoreCapital container automatically waits for PostgreSQL 16 (`service_healthy`), applies Drizzle SQL migrations (`src/db/migrations`), and launches the **`/setup` First-Run Wizard** so you can create your primary Admin account and choose either a Clean Slate or Demo Data ledger.

---

## 🚀 Proxmox LXC Debian Deployment (Cloudflare Tunnel)

### 1. Unprivileged LXC Setup
Create a Debian 12 LXC in Proxmox (`unprivileged: 1`, 2 vCPUs, 2GB RAM, 20GB disk).

```bash
# Update and install Node.js 22 LTS
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git postgresql postgresql-contrib

# Configure PostgreSQL 16
sudo -u postgres psql
CREATE DATABASE corecapital;
CREATE USER corecapital_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE corecapital TO corecapital_user;
\q
```

### 2. Clone & Build Standalone Server
```bash
git clone https://github.com/gunnhil25/CoreCapital.git /opt/corecapital
cd /opt/corecapital

# Set up environment variables
cp .env.example .env.production
nano .env.production

# Install and build standalone server
npm ci
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

### 3. Run via Systemd Service
Create `/etc/systemd/system/corecapital.service`:
```ini
[Unit]
Description=CoreCapital Next.js Standalone Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/corecapital
EnvironmentFile=/opt/corecapital/.env.production
ExecStart=/usr/bin/node /opt/corecapital/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now corecapital
```

### 4. Cloudflare Tunnel (cloudflared)
Install Cloudflare Tunnel inside the LXC:
```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb

# Authenticate and route traffic to local standalone server (port 3000)
cloudflared tunnel login
cloudflared tunnel create corecapital
cloudflared tunnel route dns corecapital budget.yourdomain.com
cloudflared tunnel run corecapital --url http://localhost:3000
```
