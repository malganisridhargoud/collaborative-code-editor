# CodeSync - Real-Time Collaborative Code Editor

CodeSync is a room-based collaborative coding app where multiple users can edit code together in real time, run supported languages on the server, and view shared output instantly.

## Tech Stack (Current)

### Frontend
- React 18 (Create React App)
- Axios
- Lucide React (icons)
- Google OAuth client (`@react-oauth/google`)
- Plain CSS (responsive layout)
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
- SQLite (currently configured default DB in `backend/config/settings.py`)
- Django models for `Room`, `CodeSession`, `ActiveUser`

### Runtime / DevOps
- Docker 
- Nginx container for serving frontend build
- Python 3.12 backend image

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

### 3. Redis
Run Redis locally (or via Docker) and make sure `REDIS_URL` points to it.

Example local default:
```env
REDIS_URL=redis://localhost:6379
```

### 4. Frontend
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



Services:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Redis: `localhost:6379`

## Current Notes

- WebSocket room route currently uses `\w+` room matching (letters, digits, underscore).
