# CoDe KnOt - Real-Time Collaborative Code Editor

CoDe KnOt is a room-based collaborative coding app where multiple users can edit code together in real time, run supported languages on the server, and view shared output instantly.

## Tech Stack (Current)

### Frontend
- React 18 (Create React App)
- Axios
- Lucide React (icons)
- Google OAuth client (`@react-oauth/google`)
- Bootstrap 5 + custom CSS (responsive layout)
- Native WebSocket API

### Backend
- Django 4.2
- Django REST Framework
- Django Channels 4 + Daphne (ASGI)
- SimpleJWT (JWT auth)
- `requests` (OAuth calls)
- WhiteNoise (static files)

### Realtime and Messaging
- WebSockets via Django Channels
- Redis channel layer (`channels-redis`)

### Persistence
- Django auth/session tables for user login and JWT issuance
- MySQL for room state, shared code, active users, and auth/session data



## Features Implemented (Step by Step)

1. User authentication with email/password
- Register and login endpoints issue JWT access tokens.
- Frontend stores token/user in `localStorage` and restores session on refresh.

2. Google OAuth login
- Frontend uses Google OAuth popup and sends token to backend.
- Backend validates Google token and returns JWT for app access.

3. Room-based collaboration flow
- Users can create a random room ID or join an existing room.
- Each room maps to a dedicated WebSocket channel group.

4. Real-time shared editor
- Typing sends `code_update` events to the room.
- Other participants receive updates live and keep code in sync.

5. Shared language switching
- Language changes are broadcast with `language_change`.
- Template code is synced so all participants move together.

6. Presence tracking (active users)
- Join/leave events update and broadcast current room user list.
- Backend tracks active users per room with `ActiveUser` records.

7. Remote code execution and shared output
- Run action sends `compile` event through WebSocket.
- Backend executes code and broadcasts `compile_result` to everyone in room.
- Supported backend execution languages: JavaScript, Python, Java, C++, C.

8. Shared output utilities
- Output panel is synchronized across users.
- `clear_output` clears output for all participants.
- UI supports output copy and room ID copy actions.

## Auth APIs

- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/google/`
- `GET /api/auth/github/login/`
- `GET /api/auth/github/callback/`

Note: GitHub OAuth backend routes exist. The current frontend login screen is wired to email/password and Google login.

## WebSocket Endpoint

- `ws://<host>/ws/code/<room_id>/`
- `wss://<host>/ws/code/<room_id>/` for HTTPS deployments

## Local Setup

### 1. Clone
```bash
git clone <your-repo-url>
cd collaborative-code-editor
```

### 2. Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

### 3. MySQL
Create a MySQL database, then set these backend environment variables before starting Django:
```env
DB_NAME=codesync
DB_USER=root
DB_PASSWORD=your-password
DB_HOST=127.0.0.1
DB_PORT=3306
```

Then run the Django migrations against MySQL:
```bash
python manage.py migrate
```

### 4. Redis
Run Redis locally (or via Docker) and make sure `REDIS_URL` points to it.

Example local default:
```env
REDIS_URL=redis://localhost:6379
```

### 5. Frontend
```bash
cd frontend
npm install
npm start
```

Optional env:
```env
REACT_APP_BACKEND_URL=http://localhost:8000
REACT_APP_GOOGLE_CLIENT_ID=<google-client-id>
```

For local development, copy `frontend/.env.example` to `frontend/.env` and fill in your Google client ID.

## Styling & Theme

- The frontend uses Bootstrap 5 for base styling and layout, with lightweight custom CSS on top.
- Theme variables and the dark-mode overrides live in `frontend/src/index.css`.
- A theme toggle is available in the app header; the choice is persisted in `localStorage` under the key `theme` (values: `light` or `dark`).
- To customize colors, edit the CSS variables at the top of `frontend/src/index.css`.


### Google Login Setup

If you see `Access blocked: Authorization Error`, configure the Google OAuth client in Google Cloud Console with the correct authorized JavaScript origins for the frontend you are using.

For local development, add:
```text
http://localhost:3000
http://127.0.0.1:3000
```

For the deployed frontend, add the production origin shown in your browser address bar.

The Google OAuth client ID used by the frontend must also match the backend `GOOGLE_CLIENT_ID` value in `backend/config/settings.py`.

### MySQL Notes

MySQL is now the single persistence layer for the backend. Room state, active users, shared code, and Django auth data all live in the same database.

## Production Deployment & Scaling (100+ Users)

For scaling to support 100+ concurrent users, deploy with:

### 1. Cloud MySQL Database
- Use AWS RDS, Google Cloud SQL, or Azure Database for MySQL
- Update `backend/.env`:
  ```env
  DB_HOST=your-cloud-db-host
  DB_USER=your-db-user
  DB_PASSWORD=your-secure-password
  ```

### 2. Cloud Redis Service (Required for Multi-Process Scaling)
Deploy with a managed Redis service (Redis Cloud, AWS ElastiCache, Heroku Redis, etc.):
- Update `backend/.env`:
  ```env
  DEBUG=False
  REDIS_URL=redis://username:password@your-redis-host:6379/0
  ```

### 3. Multi-Process Application Server
Replace local `runserver` with production ASGI server:
```bash
gunicorn --workers 4 --worker-class=uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 config.asgi:application
```
Or use Daphne with a load balancer for multiple instances.

### 4. WebSocket Load Balancing
- Use a load balancer (nginx, HAProxy, or cloud provider) with sticky sessions
- CloudFlare, AWS ALB, or Google Cloud Load Balancer
- Ensure `session_affinity` is enabled so users stay on the same server for WebSocket connections

### Architecture for 100+ Users:
```
Frontend (React SPA)
    ↓
Load Balancer (sticky sessions)
    ↓
Multiple Django App Servers
    ↓
Shared Redis (Channels Layer)
    ↓
Cloud MySQL DB
```

With this setup, each server can handle ~50-100 WebSocket connections, so 2-3 app server instances support 100+ users.



Services:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Redis: `localhost:6379`

## Current Notes

- WebSocket room route currently uses `\w+` room matching (letters, digits, underscore).
