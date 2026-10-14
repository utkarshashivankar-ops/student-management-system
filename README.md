# Student Information Management System
Three-tier cloud app: **Netlify (frontend) -> Render (Express API) -> MongoDB Atlas (database)**

```
student-management-system/
├── backend/      Node.js + Express + Mongoose  -> deploy on Render
└── frontend/     Static HTML/CSS/JS            -> deploy on Netlify
```

## API

| Operation | Method | Endpoint | Notes |
|---|---|---|---|
| Create | POST | /api/students | JSON body: studentId, name, email, department, semester, contact (optional) |
| Read all | GET | /api/students | `?search=term` filters by ID, name, email, department |
| Read one | GET | /api/students/:id | `:id` is the Student ID (e.g. ST101) |
| Update | PUT | /api/students/:id | Student ID cannot be changed |
| Delete | DELETE | /api/students/:id | |
| Health | GET | /api/health | Shows database connection state |

## Step 1: MongoDB Atlas
1. Create a free account at mongodb.com/atlas and create a free **M0** cluster.
2. **Database Access** -> Add Database User -> username + password, role **Read and write to any database** (or only `studentDB`). Avoid special characters in the password, or URL-encode them.
3. **Network Access** -> Add IP Address -> `0.0.0.0/0` (Render's free tier has no fixed IP).
4. **Database** -> Connect -> Drivers -> copy the connection string. Insert the database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/studentDB?retryWrites=true&w=majority`
   The `students` collection is created automatically on the first insert.

## Step 2: Test the backend locally (optional but recommended)
```bash
cd backend
npm install
cp .env.example .env      # then edit .env and paste your MONGODB_URI
npm run dev
```
Open http://localhost:5000/api/health, it should report `connected`.

## Step 3: Deploy the backend on Render
1. Push the project to a GitHub repository.
2. Render dashboard -> **New + -> Web Service** -> connect the repo.
3. Settings:
   - Root Directory: `backend`
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: Free
4. **Environment** -> add variables:
   - `MONGODB_URI` = your Atlas connection string
   - `FRONTEND_URL` = your Netlify URL (set a placeholder now, update in Step 5)
   - (`PORT` is provided by Render automatically)
5. Deploy. Your API URL will look like `https://student-api-xxxx.onrender.com`. Open `/api/health` to verify.

> Free Render services sleep after ~15 minutes idle; the first request can take up to a minute. The frontend shows a "Waking up server" status for this.

## Step 4: Deploy the frontend on Netlify
1. Edit `frontend/config.js` and set `API_URL` to your Render URL (no trailing slash). Commit and push.
2. Netlify -> **Add new site -> Import an existing project** -> pick the repo.
   - Base directory: `frontend`
   - Build command: *(leave empty)*
   - Publish directory: `frontend` (or `.` if the base directory is already `frontend`)
   
   Or simply drag and drop the `frontend` folder at app.netlify.com/drop.
3. Note your URL, e.g. `https://student-management-system.netlify.app` (you can rename it under Site configuration -> Change site name).

## Step 5: Lock down CORS
Back in Render -> Environment, set `FRONTEND_URL` to the exact Netlify URL (https, no trailing slash) and save; Render redeploys. Multiple origins can be comma-separated.

## Step 6: End-to-end tests (from the assignment)
1. **Add**: Add ST101 / Rahul Sharma / CSE / semester 5 -> toast "Student added successfully".
2. **Display**: Student list shows all records (same data as `GET /api/students`).
3. **Update**: Edit ST101, change semester 5 -> 6 -> check the document in Atlas.
4. **Delete**: Delete ST101 -> record disappears and is gone from Atlas.
5. **Database check**: Atlas -> Browse Collections -> `studentDB.students`.

Handy curl checks:
```bash
curl https://YOUR-API.onrender.com/api/students
curl -X POST https://YOUR-API.onrender.com/api/students -H "Content-Type: application/json" \
  -d '{"studentId":"ST102","name":"Asha Patil","email":"asha@example.com","department":"IT","semester":3}'
```

## Security notes (matches the assignment's requirements)
- The database credentials exist only in Render environment variables. The frontend never talks to MongoDB.
- `.env` is git-ignored; only `.env.example` is committed.
- CORS only accepts requests from `FRONTEND_URL`.
- Input is validated both in the browser and on the server (Mongoose schema); only whitelisted fields are accepted.
- Errors return friendly messages without stack traces.
- HTTPS is provided by Netlify and Render.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Server unreachable" in the header | Check `API_URL` in `config.js`; wait ~1 minute if Render is waking up |
| CORS error in the browser console | `FRONTEND_URL` on Render must exactly match the Netlify URL |
| Render logs: `MongooseServerSelectionError` | Atlas Network Access must allow `0.0.0.0/0`; re-check username/password in `MONGODB_URI` |
| `bad auth` | Wrong DB user/password; special characters in the password must be URL-encoded |
