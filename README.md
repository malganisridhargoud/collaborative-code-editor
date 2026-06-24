# CoDe KnOt — Deep Technical Documentation

This document is an exhaustive technical README for CoDe KnOt, the real-time collaborative code editor implemented in this repository. It is intended to be used by developers and operators who will extend, deploy, debug, or maintain the system.

This README covers:
- Project summary and goals
- Architecture overview
- Data model and schema
- WebSocket protocol and message formats (detailed)
- Backend implementation (Django + Channels)
- Frontend implementation (React) and UI behavior
- Persistence, migrations, and room lifecycle
- Owner permissions and administrative actions
- Cursor sharing and remote caret rendering (design + code pointers)
- Code execution architecture and sandboxing notes
- APIs and endpoints (auth, rooms)
- Local development, testing, and deployment steps
- Operational concerns: scaling, monitoring, backups
- Security considerations and hardening
- Troubleshooting and common errors
- Future enhancements and roadmap

This README is intentionally detailed and long (500+ lines) so you can rely on it as single-source documentation for engineering work.

Table of contents
1. Project summary
2. Goals and constraints
3. High-level architecture
4. Data model (detailed schema)
5. WebSocket protocol and examples
6. Backend: key modules and functions
7. Frontend: components and behavior
8. Room lifecycle and persistence rules
9. Owner permissions (Kick / Lock / Delete)
10. Remote cursor sharing and rendering
11. Code execution service and safety
12. REST API endpoints (auth and optional room APIs)
13. Migrations and upgrade notes
14. Local development and runbook
15. Automated tests and manual testing checklist
16. Deployment & scaling for production
17. Monitoring, logging, and metrics
18. Security review and recommendations
19. Troubleshooting guide
20. Design rationale and trade-offs
21. Roadmap and future work
22. Appendix: sample messages, tips, and snippets


1. Project summary
-------------------

CoDe KnOt is a collaborative programming environment where multiple users join a room and edit the same code buffer in real time. Users can run code on the server, see shared output, and collaborate with presence indicators. Rooms persist to the database so sessions can be resumed, and room owners can control membership and lifecycle.

The implementation in this repository uses a Django backend with Django Channels for WebSocket handling and a React single-page application for the frontend.


2. Goals and constraints
------------------------

Primary goals
- Real-time collaboration with low latency for typical coding sessions.
- Persistent rooms so work is not lost when everyone disconnects.
- Owner-based administrative controls: kick users, lock/unlock, delete room.
- Shared server-side execution of code with broadcasted output.
- Minimal operational complexity for local development and small deployments.

Constraints and non-goals
- The editor initially uses a plain `<textarea>` for simplicity rather than a full-featured editor (Monaco/CodeMirror). Cursor rendering is implemented manually for the textarea; full integration with a richer editor would change implementation details.
- This system is not a production-grade IDE; it's an educational and collaborative tool.


3. High-level architecture
--------------------------

Overview

Frontend (React SPA)
- Renders editor UI, presence list, and console
- Connects to backend via WebSocket: `/ws/code/<room_id>/`
- Authenticates users via JWT for REST endpoints

Backend (Django + Channels)
- HTTP REST API for authentication and OAuth flows
- WebSocket consumer `CodeEditorConsumer` manages real-time events and persistence
- Database stores Room, CodeSession, and ActiveUser

Channel layer
- Redis is used as the Channels layer (recommended for multi-process deployments)

Code execution
- A backend CodeExecutor (in `backend/editor/code_executor.py`) executes code in separate threads/processes. For production, sandboxing and strict resource limits are required.

Data flow
- Clients connect via WebSocket to room channels and exchange small JSON messages. Most server actions are: persist to DB, then broadcast to the Channels group.


4. Data model (detailed schema)
--------------------------------

Models and fields

- Room (`backend/editor/models.py`)
  - `id` (pk)
  - `room_id` (string, unique) — used in URL and group naming
  - `name` (string, optional) — human-friendly room name
  - `owner_username` (string, nullable) — who controls this room
  - `locked` (boolean) — prevents non-owner joins when true
  - `created_at`, `updated_at` (timestamps)

- CodeSession
  - OneToOne `room` -> `Room`
  - `code` (text) — shared code buffer
  - `language` (string) — language identifier (javascript, python, java, cpp, ...)
  - `updated_at` (timestamp)

- ActiveUser
  - `room` (FK to Room)
  - `username` (string) — e.g., user email
  - `channel_name` (string) — channels layer channel name for direct messaging
  - `joined_at` (timestamp)
  - unique_together: `(room, username)`

Notes
- `ActiveUser` entries are created on join and removed on disconnect or when kicked.
- `Room` is created lazily when a user first joins a new `room_id`.

Data integrity
- For robustness, consider adding database-level constraints and indexes on `room_id` and `owner_username` where appropriate.


5. WebSocket protocol and examples
-----------------------------------

Message format
- All messages are JSON objects with a top-level `type` field that indicates intent.
- Example: `{ "type": "code_update", "code": "console.log('hi')", "user": "alice@example.com" }`

Client -> Server messages (full list)
- `join`: `{ type: 'join', username }` — join room
- `code_update`: `{ type: 'code_update', code, user, language? }` — update shared code
- `language_change`: `{ type: 'language_change', language, code, user }` — change language and optionally set template code
- `compile`: `{ type: 'compile', code, language, user }` — run code on the server
- `clear_output`: `{ type: 'clear_output', user }` — clear the console output
- `cursor_move`: `{ type: 'cursor_move', cursor: { pos, selStart?, selEnd? }, user }` — caret/selection position
- `kick_user`: `{ type: 'kick_user', target, user }` — owner requests kick
- `lock_room`: `{ type: 'lock_room', lock: true|false, user }` — owner locks/unlocks
- `delete_room`: `{ type: 'delete_room', user }` — owner deletes room

Server -> Client messages (full list)
- `init`: `{ type: 'init', code, language, users, owner, locked }` — initial state delivered to joining socket
- `user_joined`, `user_left`: `{ type: 'user_joined'|'user_left', username, users }` — presence updates
- `code_update`: `{ type: 'code_update', code, user, language }` — broadcast code changes
- `language_change`: `{ type: 'language_change', language, code, user }` — language changes
- `compile_result`: `{ type: 'compile_result', output, language, user }` — execution output broadcast
- `output_cleared`: `{ type: 'output_cleared', user }` — output cleared
- `cursor_move`: `{ type: 'cursor_move', user, cursor }` — remote caret position
- `user_kicked`: `{ type: 'user_kicked', target, users }` — after a successful kick
- `room_locked`: `{ type: 'room_locked', locked, user }` — lock state broadcast
- `room_deleted`: `{ type: 'room_deleted', user }` — room deleted notification
- `kicked`: `{ type: 'kicked', reason }` — direct message to kicked user; socket closes on client after receipt

Example flows

Join flow (detailed example)
1. Client opens WebSocket to `/ws/code/<room_id>/`.
2. Client sends `{ type: 'join', username: 'alice@example.com' }`.
3. Server (consumer) checks `Room.locked`. If `locked` and `owner != 'alice@example.com'`, server sends `{ type: 'room_locked' }` and closes socket.
4. Otherwise, server calls `add_active_user()` (creates `Room` and `ActiveUser` if needed), gets current `code` and `language` from `CodeSession` (creates default session if missing).
5. Server sends `init` message to the joining socket only with the latest state and then broadcasts `user_joined` to the rest of the room.

Kick flow (detailed example)
1. Owner 'owner@example.com' calls `kick_user` with payload `{ type: 'kick_user', target: 'bob@example.com', user: 'owner@example.com' }`.
2. Server verifies that the `user` is the owner by checking `Room.owner_username`.
3. Server looks up `ActiveUser` for `bob@example.com` to get `channel_name`.
4. Server sends a direct `kick` event to the channel. The consumer receives `kick` and sends `{ type: 'kicked', reason }` to the client, then calls `close()` on the connection.
5. Server removes the `ActiveUser` row for Bob and broadcasts `user_kicked` with updated user list.

Cursor sharing flow
1. Client sends `{ type: 'cursor_move', cursor: { pos: N }, user }` each time caret moves.
2. Server receives and broadcasts `{ type: 'cursor_move', user, cursor }` to the group.
3. Clients receive and update overlay rendering.


6. Backend: key modules and functions
-------------------------------------

Primary consumer: `CodeEditorConsumer` (in `backend/editor/consumers.py`)

Responsibilities
- Manage WebSocket connection lifecycle: `connect`, `disconnect`, `receive`.
- Translate WebSocket messages into DB operations and group broadcasts.
- Use `database_sync_to_async` decorators for database access.

Key methods and roles
- `connect()` — compute `room_id`, `room_group_name`, add channel to group, accept socket.
- `disconnect()` — remove `ActiveUser`, transfer owner if needed, group_discard.
- `receive(text_data)` — parse JSON and dispatch to handlers: `handle_join`, `handle_code_update`, `handle_language_change`, `handle_compile`, `handle_clear_output`, `handle_cursor_move`, `handle_kick_user`, `handle_lock_room`, `handle_delete_room`.
- DB helper methods (synchronously decorated): `add_active_user`, `remove_active_user`, `remove_user_by_name`, `get_active_users`, `get_current_code`, `save_code`, `update_language`, `get_channel_for_user`, `get_room_owner`, `get_room_locked_and_owner`, `set_room_locked`, `delete_room_db`, `transfer_owner_if_needed`.

Important implementation notes
- Always guard critical DB calls with try/except to prevent crashes in `disconnect` or `receive`.
- Owner-related actions verify that the requesting `user` matches `room.owner_username`.
- `transfer_owner_if_needed` picks the earliest `ActiveUser.joined_at` as the next owner. If none exists, `owner_username` is set to `NULL`.

Testing and local debugging tips
- Add logging in the consumer (already present) to trace join/leave and owner transfers.
- For direct channel messaging (kick), ensure `channel_name` is current; ActiveUser records are updated on `add_active_user`.


7. Frontend: components and behavior
------------------------------------

Main file: `frontend/src/components/CodeEditor.js`

High-level responsibilities
- Connect to WebSocket and manage lifecycle.
- Maintain editor state (`code`, `language`) and local UI state (`usersInRoom`, `roomOwner`, `roomLocked`).
- Send `code_update` and `cursor_move` events.
- Render remote cursors via an overlay that maps text positions to pixel coordinates.

Editor choice
- The current implementation uses a `<textarea>` for simplicity. Advantages: minimal dependencies and straightforward mapping between text positions and value index. Drawbacks: limited editing features and harder cursor measurement for bidi/wrapping.

Remote cursor rendering (client-side approach)
- Clients maintain `remoteCursors: { [username]: pos }` when receiving `cursor_move` messages.
- To render an overlay caret at the correct pixel location inside the textarea, the app constructs an offscreen DOM element that reproduces the textarea's styles (font, width, padding, line-height) and measures the bounding box of a zero-width span placed at the desired text offset.
- The overlay is absolutely positioned over the textarea and renders a narrow vertical bar and a username label.

Code structure and state
- `wsRef` — ref for WebSocket connection.
- `editorRef` — ref for textarea DOM node (used for selection and measurement).
- `code` — current buffer state.
- `usersInRoom` — array of active usernames.
- `roomOwner` — string for owner username.
- `roomLocked` — boolean for lock state.
- `remoteCursors` and `remoteCursorCoords` — positions and computed coordinates.

UX and owner UI controls
- When `roomOwner === currentUser`, the UI shows Lock/Unlock and Delete buttons, plus Kick buttons for each other user.
- Confirmation dialogs use `window.confirm` (ESLint-safe) before destructive actions.

Performance notes
- Frequent `cursor_move` messages can create churn. It is advisable to throttle cursor emissions on the client (e.g., at 20-50ms intervals) and debounce or coalesce visual updates.
- For larger files or production use, migrating to an editor with decoration APIs (Monaco, CodeMirror) will simplify and speed up cursor rendering.


8. Room lifecycle and persistence rules
--------------------------------------

Lifecycle summary
- Creation: implicit on `join` via `get_or_create` on `Room`.
- Active session: tracked via `ActiveUser` rows.
- Persistence: code persists in `CodeSession` even when all users disconnect.
- Transfer: owner transfer happens on owner disconnect/kick.
- Deletion: owner-triggered via `delete_room` event; cascades through DB.

Why persistent rooms?
- Allows resuming work and provides a stable shareable URL/ID.
- Enables longer-running pair programming sessions that survive temporary disconnects.

Garbage collection
- Optional periodic cleanup can remove inactive rooms after a configurable TTL (e.g., rooms with no owner and no active users for 30 days).
- Implement as a Django management command and schedule via cron or a cloud scheduler.


9. Owner permissions (detailed)
-------------------------------

What the owner can do
- Kick a participant: forcibly disconnect another user.
- Lock/unlock the room: prevent new joiners unless they are the owner.
- Delete the room: remove room and session from the DB; broadcast deletion event first.

Permission enforcement
- All owner-only messages include the `user` (username/email) of the requester. The backend validates this against `Room.owner_username`.
- If validation fails, server responds with an error message for the requester (e.g., `{ type: 'error', message: 'permission_denied' }`) and ignores the command.

Edge cases
- Owner disconnects unexpectedly: `transfer_owner_if_needed` will elect a new owner (earliest join time). This means an owner who quickly reconnects may not be regained automatically — consider routing a `claim_owner` action if you prefer explicit transfer.
- Race conditions on near-simultaneous joins: current approach uses `get_or_create` and `update_or_create`. For strict linearization, implement DB locks or a transaction with `select_for_update`.


10. Remote cursor sharing and rendering (deep dive)
--------------------------------------------------

Objective
- Each participant should see other collaborators' caret positions and a short label indicating who that caret belongs to — similar to Google Docs.

Message payload
- Sender: `{ type: 'cursor_move', cursor: { pos, selStart, selEnd }, user }`
- Receiver: same shape broadcast by the server.

Position model
- `pos` is an integer text-offset into the string buffer (0-based index). `selStart` and `selEnd` can be included for selections.

Mapping text-offset to pixel coordinates
- For a textarea, compute coordinates by creating a mirrored, hidden element with identical CSS (font-family, font-size, line-height, width, padding). Insert the text up to `pos` and place a zero-width marker to measure bounding box. Use that to derive top and left relative to textarea bounding box.

Implementation caveats
- This technique is sensitive to whitespace rendering and tab characters. Normalization of tabs to spaces may be required for consistent measurement.
- Multiline wrapping: `pre-wrap` or `white-space` behavior must match exactly between textarea and measurement element.
- Scrolling: caret's visual position must account for `scrollTop` and `scrollLeft` of the textarea.

Performance optimizations
- Throttle outgoing `cursor_move` messages (send at most 20-30 per second).
- Recompute overlay positions only when `remoteCursors` or `code` changes.
- For large text buffers, consider computing approximate coordinates using line/column math instead of DOM measurement.

Alternative approach (recommended for production)
- Use a rich editor like Monaco or CodeMirror that supports decorations and built-in APIs for rendering remote cursors and selections. These editors also handle text measurement and complex layouts for you.


11. Code execution service and safety considerations
---------------------------------------------------

Current behavior
- When a client sends `compile` with `code` and `language`, the server invokes `CodeExecutor.execute(code, language)` and broadcasts `compile_result` with the output.

Security & sandboxing
- DO NOT run arbitrary user code on a production host without strong sandboxing.
- Recommended sandbox options:
  - Container-based execution: spawn a short-lived container (Docker) per execution with CPU/memory/time limits.
  - Use gVisor or Firecracker microVMs for stronger isolation.
  - Use seccomp profiles, user namespaces, and cgroups to limit resource usage.

Resource limits
- Enforce wall-clock timeouts (e.g., 5s), CPU quotas, and memory caps.
- Stream partial output to clients if needed and kill runaway processes.

Language support
- Current toy implementation supports common compiled languages as examples. Production support may require language-specific toolchains and careful IO handling.

Auditing and logging
- Log execution metadata (user, room, language, duration) for debugging and abuse detection. Avoid storing sensitive user code in unsecured logs.


12. REST API endpoints (auth and optional room APIs)
---------------------------------------------------

Auth endpoints (already implemented)
- `POST /api/auth/register/` — create user with email/password
- `POST /api/auth/login/` — authenticate and return JWT
- `POST /api/auth/google/` — exchange Google ID token for JWT (server validates token)
- GitHub OAuth: `/api/auth/github/login/` and `/api/auth/github/callback/` — redirect flows

Potential additional APIs to add (recommended)
- `GET /api/rooms/` — list persistent rooms and metadata (owner, created_at, user_count)
- `GET /api/rooms/<room_id>/` — fetch room metadata and current `CodeSession`
- `POST /api/rooms/<room_id>/transfer_owner/` — request explicit ownership transfer (owner-only)

Security for APIs
- Protect APIs with JWT authentication for actions that require identity.
- Rate-limit sensitive endpoints such as `/api/auth/google/` to avoid abuse.


13. Migrations and upgrade notes
--------------------------------

Recent migration
- `backend/editor/migrations/0002_room_owner_locked.py` — adds `owner_username` and `locked` fields to `Room`.

Applying migrations
1. Activate your Python environment
   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Apply migrations
   ```bash
   python manage.py migrate
   ```

Rolling back changes
- Use `python manage.py migrate editor 0001` to roll back editor app migrations (be careful: data loss possible).

Backups
- Backup the database before running destructive migrations in production.


14. Local development and runbook
--------------------------------

Environment variables (examples)
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (DB connection)
- `REDIS_URL` (channels layer)
- `GOOGLE_CLIENT_ID` (for Google OAuth)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`

Start backend (development)
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
# start channels worker using Daphne
daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

Start frontend (development)
```bash
cd frontend
npm install
npm start
```

Notes
- When running locally with HTTPS, use `wss://` for WebSocket connections.
- Ensure `REACT_APP_BACKEND_URL` is set for development to point to the Django backend (e.g. `http://localhost:8000`).


15. Automated tests and manual testing checklist
-----------------------------------------------

Automated tests to add (suggested)
- Consumer unit tests: simulate connects, sends, and disconnections using Channels testing utilities.
- DB tests: verify owner transfer, room persistence, session saving.
- Frontend integration tests: mock WebSocket server and verify UI reacts correctly to messages.

Manual test checklist
- Join a room with two browsers and verify code sync in both directions.
- Test language change: ensure template code and language reflect across clients.
- Test compile: run sample JavaScript and Python code and verify `compile_result` is broadcast.
- Presence: open/close clients and verify `user_joined` / `user_left` updates.
- Kick: owner kicks a user — verify user receives `kicked` and connection closes.
- Lock: owner locks the room — verify non-owner join attempts are rejected.
- Delete: owner deletes room — all connected clients receive `room_deleted` and the DB row is removed.


16. Deployment & scaling for production
---------------------------------------

Key recommendations
- Use a managed MySQL or PostgreSQL instance (RDS / Cloud SQL).
- Use managed Redis for the Channels layer to share state between processes.
- Run multiple Django ASGI workers behind a load balancer; ensure sticky sessions or proper routing for WebSockets.

ASGI server choices
- Daphne or Uvicorn with Gunicorn as process manager. Example production command:
  ```bash
  gunicorn --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 config.asgi:application
  ```

Load balancer
- Configure TCP or HTTP load balancer with sticky sessions (session affinity) to route WebSockets to the correct backend process if necessary.

Scaling considerations
- Redis channels layer ensures messages are propagated between processes; scale Redis appropriately.
- Each ASGI worker has resource limits: plan memory/CPU based on connection counts and expected compile/execution workloads.

Autoscaling
- Use metrics like WebSocket connection count, CPU utilization, and task queue length to autoscale app instances.


17. Monitoring, logging, and metrics
-----------------------------------

Suggested logs to capture
- WebSocket connect/disconnect events (include `room_id`, `channel_name`, `username`).
- Execution logs: duration, language, user, room (without sensitive code content in logs).
- Errors and exceptions in consumer code.

Metrics
- Active connections per instance
- Messages per second (overall and per-room)
- Execution time percentiles for the code execution service

Tools
- Prometheus + Grafana for metrics
- Sentry for exception tracking
- ELK / EFK stack for centralized logs


18. Security review and recommendations
---------------------------------------

Authentication and authorization
- Use JWT (SimpleJWT) for REST APIs and authenticate WebSocket messages by verifying tokens at connection time if you require authenticated sockets.
- Currently the app trusts `username` values sent by clients; in production, validate WebSocket clients using the authentication mechanism (e.g., query param `?token=` or headers passed in handshake). The consumer should map token -> username.

Code execution risks
- Never run untrusted code on the host without strict isolation (containers, microVMs).
- Sanitize inputs to any shell calls and avoid building command strings with user data.

Rate limiting and abuse prevention
- Implement rate limiting for execution requests and other potentially expensive actions.
- Consider per-user quotas for execution time and history.

Data privacy
- If persisting user code, consider encryption-at-rest policies and access controls.


19. Troubleshooting guide
--------------------------

Common problems and quick fixes
- WebSocket connection failing: verify the correct `ws://` or `wss://` URL, and ensure the ASGI server is reachable. Check browser console and server logs for handshake errors.
- Redis connection errors: ensure `REDIS_URL` is correct and Redis instance is reachable.
- DB migration errors: check Django migration status and run `python manage.py showmigrations`.
- `kicked` event not disconnecting user: confirm `channel_name` stored in `ActiveUser` is accurate and consumer handles `kick` event by closing socket.

Debugging tips
- Use Channels `ChannelLayer` debugging to inspect groups and channels in Redis.
- Add verbose logging temporarily in `consumers.py` to trace message flow.


20. Design rationale and trade-offs
----------------------------------

Why not use CRDTs/OT?
- CRDTs and Operational Transforms provide stronger conflict resolution for concurrent text edits. However, they add significant complexity and have a steeper implementation curve.
- For a simpler collaborative editor with low concurrency needs, broadcasting full buffer updates with client-side heuristics is acceptable.

Why a simple `<textarea>` initially?
- Lower engineering burden and fewer dependencies. It allows us to focus on real-time messaging, persistence, and owner controls.

Why persistent rooms?
- Persistence reduces accidental data loss and provides a shareable, bookmarkable collaboration URL.


21. Roadmap and future work
----------------------------

Short-term enhancements
- Integrate a richer editor (Monaco/CodeMirror) for accurate cursor rendering, syntax highlighting, and better collaborative editing primitives.
- Implement per-room chat alongside cursors.
- Add REST endpoints for listing and managing rooms.

Medium-term
- Implement CRDT/OT support to allow seamless concurrent editing of large files.
- Add user presence avatars and role-based access control (read-only guests, editors, owners).
- Add persisted history / revision control for rooms (snapshotting and diffs).

Long-term
- Multi-tenant deployments and workspace management.
- Team and project features (multiple files per room, file tree, git integrations).


22. Appendix: sample messages, commands, and code snippets
---------------------------------------------------------

Sample `join` flow (client code snippet)
```js
const ws = new WebSocket(`${wsUrl}/ws/code/${roomId}/`);
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'join', username: currentUser.email }));
};
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  // handle `init`, `code_update`, `cursor_move`, etc.
};
```

Sample `cursor_move` (client throttled sender)
```js
let lastSent = 0;
function sendCursor(pos) {
  const now = Date.now();
  if (now - lastSent < 30) return; // throttle to ~33ms
  lastSent = now;
  ws.send(JSON.stringify({ type: 'cursor_move', cursor: { pos }, user: currentUser.email }));
}
```

Server-side snippet (owner check)
```py
@database_sync_to_async
def is_owner(self, username):
    try:
        room = Room.objects.get(room_id=self.room_id)
        return room.owner_username == username
    except Room.DoesNotExist:
        return False
```


Contact and contribution
-------------------------

If you want me to implement any of the items in the roadmap, or if you need tests, CI setup, or production deployment scripts, tell me which item and I'll prepare a targeted plan and patch.

End of document.


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

## Recent Features & Implementation Details

This project recently added several collaboration and room-persistence features. Briefly:

- Live cursor tracking
  - Frontend: editor emits `cursor_move` events containing the caret/selection position (`{ type: 'cursor_move', cursor, user }`). The current implementation sends position on `onKeyUp` and `onClick` from the textarea in `frontend/src/components/CodeEditor.js`.
  - Backend: `CodeEditorConsumer` receives `cursor_move` and broadcasts `cursor_moved` events to the room so other clients can render remote cursors. (Handler in `backend/editor/consumers.py`.)

- Room owner permissions (Kick / Lock / Delete)
  - Owner field: `Room.owner_username` stores the owner. The first joiner becomes owner if none exists.
  - Kick: owner sends `kick_user` with the target username; backend looks up the target's channel and sends a direct `kick` event to that channel to force disconnect, removes the `ActiveUser`, and broadcasts `user_kicked` to the room.
  - Lock/Unlock: owner sends `lock_room` with `lock: true|false`; backend persists `Room.locked` and broadcasts `room_locked` state to the room. Joining is rejected for non-owners when a room is locked.
  - Delete: owner sends `delete_room`; backend broadcasts `room_deleted` and deletes the `Room` row (and cascades to session and active users).

- Persistent Rooms and Sessions
  - Models: `Room` (room_id, name, owner_username, locked, created_at, updated_at), `CodeSession` (OneToOne to Room: `code`, `language`, `updated_at`), and `ActiveUser` (room FK, `username`, `channel_name`, `joined_at`). See `backend/editor/models.py`.
  - Persistence: Rooms and sessions are stored in the primary DB (MySQL in current config). Rooms no longer disappear when users leave — the `Room` and `CodeSession` rows remain until explicitly deleted by the owner or via migrations/cleanup scripts.

- Ownership transfer when owner leaves
  - When the owner disconnects or is kicked, backend helper `transfer_owner_if_needed` selects the next active user (earliest `joined_at`) and assigns them as owner; if no users remain, `owner_username` is cleared.

- DB helpers and Channels handlers
  - New DB helper methods (in `CodeEditorConsumer`): `get_room_locked_and_owner`, `get_channel_for_user`, `remove_user_by_name`, `set_room_locked`, `delete_room_db`, `transfer_owner_if_needed`.
  - New WebSocket message types: `cursor_move`, `user_kicked`, `room_locked`, `room_deleted`, and direct `kick` sent to a specific channel.

- Frontend wiring
  - `frontend/src/components/CodeEditor.js` now:
    - Sends `cursor_move` events and listens for `cursor_move` updates.
    - Shows owner UI controls (Lock/Unlock, Delete, Kick) when `owner` equals current user.
    - Handles `user_kicked`, `room_locked`, and `room_deleted` events.
    - Uses `window.confirm` for owner confirmation dialogs (ESLint-safe).

### Migrations

- A migration was added to add the `owner_username` and `locked` fields: `backend/editor/migrations/0002_room_owner_locked.py`.

### Notes & Next Steps

- Remote-cursor rendering is a TODO: events are broadcast and received; rendering visual colored cursors in the editor is left as a follow-up enhancement.
- Consider policies for automatic owner reassignment strategies (random, round-robin, or explicit transfer UI).
- Add admin or periodic cleanup for stale rooms if desired.

