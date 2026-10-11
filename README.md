# HireTrack — Job Application Tracker

Track every job application from wishlist to offer: sign up or log in (email, Google, GitHub or LinkedIn), add, edit, delete, change status, search, filter, see your pipeline, upcoming interviews and charts, export to CSV. Each user sees only their own applications.

**Tech:** HTML, CSS, JavaScript (frontend) · Node.js serverless functions (REST API, login, sessions) · Python serverless function with pygal (charts) · Upstash Redis (database) · OAuth 2.0 (Google, GitHub, LinkedIn) · Vercel (hosting)

## Folder structure

```
hiretrack/
├── public/              FRONTEND (what the browser downloads)
│   ├── index.html       dashboard page
│   ├── app.js           dashboard logic: calls the API, draws the page, handles clicks
│   ├── login.html       login / sign-up page
│   ├── login.js         login page logic
│   └── styles.css       design for both pages
├── api/                 BACKEND (runs on Vercel's servers)
│   ├── applications.js  REST API: GET, POST, PUT, DELETE  →  /api/applications
│   ├── auth.js          signup, login, logout, me, social login  →  /api/auth, /auth/...
│   ├── chart.py         Python + pygal: draws the charts  →  /api/chart
│   └── health.js        status check                      →  /api/health
├── lib/                 shared backend code
│   ├── db.js            database layer (Redis, or memory if no database)
│   ├── session.js       signed login cookie
│   ├── users.js         accounts, password hashing (scrypt)
│   ├── oauth.js         Google / GitHub / LinkedIn login
│   ├── validate.js      checks incoming data
│   └── http.js          small reply helpers
├── requirements.txt     Python library list (pygal) for Vercel
├── dev-server.js        runs the app on your computer
├── vercel.json          frontend folder + /auth/... route
└── package.json         project info (no npm libraries needed)
```

## Run on your computer

Install Node.js 18 or newer from nodejs.org, then:

```
cd hiretrack
node dev-server.js
```

Open http://localhost:3000. Without a database, data is kept in memory until you stop the server. For charts locally, also run `pip install pygal`.

## Deploy to Vercel

1. **GitHub:** create a new public repository called `hiretrack`, click *uploading an existing file*, drag in everything inside this folder, and commit.
2. **Vercel:** log in with GitHub → **Add New… → Project** → import `hiretrack` → **Deploy** (no settings to change).
3. **Database (free, 1 minute):** in your Vercel project open **Storage → Create Database → Upstash for Redis** (Marketplace) → free plan → **Connect** to the project.
4. **Redeploy:** **Deployments → ⋯ on the latest → Redeploy**. The header now says **Saved to database**.

Without step 3 the app still works online, but data is temporary and can disappear.

5. **Session secret (recommended):** **Settings → Environment Variables** → add `SESSION_SECRET` = any long random text → Redeploy.

## Social login (Google, GitHub, LinkedIn)

Email signup works with no setup. Each social button switches on when you add its two keys in **Vercel → Settings → Environment Variables** and redeploy. In each provider, register this callback URL (use your own Vercel address):

| Provider | Where to create the app | Callback / redirect URL | Vercel variables |
|---|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID (Web application) | `https://YOUR-APP.vercel.app/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | github.com → Settings → Developer settings → OAuth Apps → New OAuth App | `https://YOUR-APP.vercel.app/auth/callback/github` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| LinkedIn | linkedin.com/developers → Create app (needs a LinkedIn Page) → Products: "Sign In with LinkedIn using OpenID Connect" | `https://YOUR-APP.vercel.app/auth/callback/linkedin` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |

## API reference

| Method | URL | Body | Response |
|---|---|---|---|
| GET | `/api/applications` | — | `200 { applications: [...], storage }` |
| POST | `/api/applications` | `{ company, role, ... }` | `201 { application }` or `400 { errors }` |
| PUT | `/api/applications?id=ID` | fields to change | `200 { application }`, `404` if not found |
| DELETE | `/api/applications?id=ID` | — | `200 { deleted: ID }`, `404` if not found |
| GET | `/api/health` | — | `200 { status: "ok", storage, socialLogin }` |
| POST | `/api/auth?action=signup` | `{ name, email, password }` | `201 { user }` + session cookie |
| POST | `/api/auth?action=login` | `{ email, password }` | `200 { user }` or `401` |
| POST | `/api/auth?action=logout` | — | `200` |
| GET | `/api/auth?action=me` | — | `200 { user }` or `401` |
| GET | `/auth/start/<provider>` | — | redirect to Google / GitHub / LinkedIn |
| POST | `/api/chart` | `{ stages, weekly, theme }` | `200 { stageChart, weeklyChart }` (SVG) |

All `/api/applications` routes need you to be logged in (`401` otherwise).

Application fields: `company` (required), `role` (required), `location`, `status` (Wishlist / Applied / Interview / Offer / Rejected), `appliedOn`, `interviewOn` (YYYY-MM-DD), `link` (http/https), `notes`.
