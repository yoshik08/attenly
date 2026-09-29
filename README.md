# Attenly — KL Attendance (v3, cloud captcha)

Student attendance portal for KL University NewERP. Captcha is solved
**server-side**: the browser never loads the model.

## How it works

1. Browser → `POST /api/erp` (`init`) → proxy fetches the ERP login page,
   CSRF token, session cookies and the captcha image.
2. Proxy → `POST {SOLVER_URL}/solve` with the image → solver (FastAPI +
   onnxruntime, CRNN model from the KLU ERP Captcha Auto-Fill extension)
   returns the text.
3. Browser logs in with the solved text. Wrong guess → fresh captcha →
   re-solve, up to 5 tries, then manual entry fallback. MFA prompt included.
4. Attendance/timetable pages are discovered from post-login dashboard links
   and parsed in the browser.

`solver/` runs as a separate service (Render). The Vercel app only needs
`SOLVER_URL` pointing at it. If the solver is down/unset, `captchaText`
comes back empty and the UI falls back to manual captcha entry.

## Deploy

**Solver (Render):**
1. New → Web Service → select this repo, root directory `solver`
2. Build: `pip install -r requirements.txt`
3. Start: `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. Free tier is fine. Note: it sleeps after ~15 min idle, first solve of the
   day takes ~30 s to wake.

**App (Vercel):**
1. Import repo, `vercel.json` pins `api/*` to `bom1` (Mumbai).
2. Env vars: `MONGODB_URI` (Atlas), `SOLVER_URL` (the Render service URL).
3. Deploy. Atlas project `attenly`, Cluster0 (Mumbai) already exists.

## Verified 2026-09-29

- Live ERP handshake: `POST /index.php?r=site/login` with `_csrf` +
  `LoginForm[username|password|captcha]` (+ `LoginForm[qr_code]` for MFA);
  success = HTTP 302. Captcha at `img#loginFormCaptcha-image` (120×50
  transparent PNG), refresh via `?r=site/captcha&refresh=1`.
- CRNN solved live captchas end-to-end (`dukeuoa`, `gidivl`).
- Proxy → solver wiring tested with a mock solver: image forwarded,
  text lowercased/sanitized, graceful empty string when solver is down.

## Still TODO (needs Yoshik)

- First live login → confirm attendance/timetable URL discovery; the exact
  route gets hardcoded if the heuristic misses.
- Parser tuning against real attendance table HTML.

## Disclaimer

Independent student-built project for educational purposes. Not affiliated
with, endorsed by, or operated by KL University. Use responsibly and in
accordance with university policies.
