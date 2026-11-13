# CareerMate AI

AI tutoring + career guidance for college students.
**Stack:** HTML/CSS/JS (vanilla ES modules) · Node.js + Express · Firebase Auth · Firestore · Google Gemini (called only from the server).

```
careermate-ai/
├── server.js          # Express API: token check, Gemini calls, Firestore, plan limits
├── public/            # index.html, style.css, app.js (SPA, hash routing)
├── firestore.rules    # deny all client access; only the server (Admin SDK) touches data
├── .env.example
└── package.json
```

## Run it
1. Install Node 18+.
2. **Firebase console:** create a project → *Authentication → Sign-in method → Email/Password* → enable. *Firestore Database* → create (production mode), then paste `firestore.rules`.
3. *Project settings → Service accounts → Generate new private key*; save as `serviceAccountKey.json` in this folder.
4. *Project settings → Your apps → Web app*: copy `apiKey`, `authDomain`, `projectId`, `appId`.
5. Get a Gemini key at https://aistudio.google.com/apikey.
6. `cp .env.example .env` and fill in the values.
7. `npm install && npm start` → open http://localhost:3000

## Security notes
- `GEMINI_API_KEY` and the service account live only on the server (`.env`, git-ignored).
- The Firebase web config is public by design; all data access goes through the API, which verifies the Firebase ID token.
- Firestore rules block all direct client reads/writes.

## Data model
`users/{uid}`: `profile`, `plan`, `usage` (daily counters), `stats`, `career` · `users/{uid}/chats/{id}`: `title`, `subject`, `messages[]`

## Plans
Free: 10 tutor messages/day, 3 career analyses/day, short answers, 2 paths without roadmaps. Premium (₹199/month): deeper tutoring, day-by-day plans, 4 paths with roadmaps. Upgrade is a **demo toggle**; no payment is processed.
