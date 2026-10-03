# ERP Protocol — newerp.kluniversity.in

Source: corroborated from two independent open-source integrations against this portal
(`tejaswin-amara/kl-sync`, `sivadhanushreddykotturu/render_testb_docker`).
The portal is a Yii2 PHP app. All routes are `index.php?r=<url-encoded route>`.
Responses are server-rendered HTML (no JSON API) — parse with Cheerio.

## Session handling
- Maintain a manual cookie jar: merge every `Set-Cookie` into the jar after each
  response, send assembled `Cookie` header on each request.
- CSRF token: scrape `input[name="_csrf"]` value from pages that contain forms.
- After login, encrypt the jar (+ CSRF) with AES-256-GCM into an httpOnly,
  Secure, SameSite=Lax cookie (e.g. `erp_session`, 1–7 day expiry).
- **Never persist the user's password anywhere.**
- Session expiry is detected when an ERP response contains `id="login-form"`.

## 1. CAPTCHA (server-side, passed through to the user)
1. `GET https://newerp.kluniversity.in/index.php?r=site%2Flogin`
2. Parse login HTML: CSRF token from `input[name="_csrf"]`; captcha image element
   `#loginFormCaptcha-image`, src like `index.php?r=site%2Fcaptcha&v=<token>`.
3. `GET` the captcha image URL (resolved against the login page URL) **from the
   server**, with `Referer: <login page URL>` and the jar's cookies — the captcha
   is bound to the PHP session cookie, so it must be fetched in the same session.
4. Convert image bytes to a base64 data URL and send to the browser for display.
   Keep the pre-login session (jar + CSRF) server-side keyed by a short-lived id
   (5 min TTL), returned to the client as an opaque token (NOT the raw cookies).

## 2. Login
- `POST https://newerp.kluniversity.in/index.php?r=site%2Flogin`
- `Content-Type: application/x-www-form-urlencoded`, with `Origin` + `Referer`
  headers and the jar cookies.
- Form fields:
  - `_csrf` = token from step 1
  - `LoginForm[username]` = student ID
  - `LoginForm[password]` = password
  - `LoginForm[captcha]` = captcha text, trimmed + lowercased
  - `LoginForm[qr_code]` = `''`
  - `LoginForm[rememberMe]` = `'1'`
  - `login-button` = `''`
- Follow 301/302/303 redirects manually (convert to GET), staying within the ERP
  origin; merge `Set-Cookie` after every response.
- Verify auth by `GET`-ing an authenticated page and checking for
  `academicyear` / `semesterid` form inputs.
- Scrape error text from `.help-block` / `.alert-danger` to distinguish
  wrong-password vs wrong-captcha.

## 3. Attendance
- `POST https://newerp.kluniversity.in/index.php?r=studentattendance%2Fstudentdailyattendance%2Fsearchgetinput`
- Fields: `_csrf`, `DynamicModel[academicyear]`, `DynamicModel[semesterid]`,
  `DynamicModel[semester]`; headers `X-Requested-With: XMLHttpRequest`,
  `Origin`, `Referer`; jar cookies.
- Response HTML → parse table rows: subject/course, conducted vs attended counts
  per LTPS component (Lecture / Tutorial / Practical / Skilling).
- Course titles: `POST .../studentdailyattendance/courselist` with the same params.

## 4. Timetable
- Primary: `POST https://newerp.kluniversity.in/index.php?r=timetables%2Funiversitymasteracademictimetableview%2Findexstudentindisearch`
  with `UniversityMasterAcademicTimetableView[academicyear|semesterid|semester]`
  + `DynamicModel[...]` equivalents, XHR headers.
- Fallbacks (in order): `.../individualstudenttimetableget`,
  `.../studenttimetable`, `studentattendance/.../studenttimetable` —
  each tried as POST, then GET-with-query-params, then plain GET.
- Response HTML → parse day/period grid: course codes, rooms, faculty, timings.

## 5. Rate limiting
- ERP returns HTTP 429 or pages containing "Too many requests… try again in one
  minute" → back off and surface a friendly "try again in a minute" message.

## 6. Why a server proxy is mandatory
The ERP sends no CORS headers permitting cross-origin credentialed requests, the
captcha image must be fetched with server-held session cookies, and session
cookies must be managed server-side. The browser must only talk to the app's own
API routes — never to the ERP directly.
