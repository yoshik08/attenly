# Attenly

The KLU ERP, rebuilt for students. Unofficial front for KL University's ERP (`newerp.kluniversity.in`) — attendance, timetable, CGPA, and calculator.

> Unofficial student project, not affiliated with KL University.

## Stack

- Next.js 16, NextAuth v4 (Google), MongoDB, Tailwind
- Deployed on Vercel, served at `yoshik.xyz/attenly` via proxy rewrites
- Backend sync via GitHub Actions (every 10 min)

## Env

See `.env.example`. Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `MONGODB_URI`, `SESSION_SECRET`, `SOLVER_URL`, `CRON_SECRET`.
