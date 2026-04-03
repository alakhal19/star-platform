# STAR — System for Tracking and Automating Releases

Release orchestration platform built for a private OpenStack cloud. Part of a Cloud Engineering PFE (end-of-study project).

## Features

- Multi-project release management (ERP Platform as first project)
- GitHub Actions webhook integration
- Async deployment queue (Redis + BullMQ)
- Blue/Green deployment strategy
- Real-time deployment tracking (SSE)
- Docker snapshots before deployment
- File diff viewer (GitHub API)
- Version comparison and changelog
- Scheduled deployments
- Deployment approval gates
- Email notifications
- AI-powered risk analysis and log analysis (Anthropic Claude API)
- Keycloak SSO authentication
- Structured logging (ELK via Filebeat)
- Node.js cluster with master/worker architecture
- Apache HTTPD load balancer (mod_proxy_balancer)
- Health checks and readiness probes

## Tech Stack

- **Backend:** Node.js, Express, Prisma, PostgreSQL
- **Queue:** Redis, BullMQ
- **Frontend:** Next.js, Tailwind CSS
- **Auth:** Keycloak SSO (OAuth 2.0 / OIDC)
- **CI/CD:** GitHub Actions
- **Deployment:** Docker, Blue/Green via Nginx
- **Monitoring:** ELK stack via Filebeat, Pino structured logging
- **AI:** Anthropic Claude API
- **Infrastructure:** OpenStack private cloud, ZeroTier, systemd, Apache HTTPD

## Architecture
VM1 — OpenStack Controller / Storage
VM2 — ERP Application (Docker containers)
VM3 — STAR Release Platform (this repo)

## Getting Started
```bash
cd backend
npm install
npx prisma migrate dev --name init
npx prisma generate
npm run seed
npm run dev
```

## Author

Amine Lakhal — PFE 2025/2026