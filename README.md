
# 🚀 CodeSync — Real-Time Collaborative Code Editor

CodeSync is a **full-stack, real-time collaborative code editor** that allows multiple authenticated users to join a shared room, write code together, and execute it in real time.  
It uses **WebSockets for live collaboration**, **Google OAuth for authentication**, and **Docker + AWS-ready deployment**.

This project demonstrates **real-time systems, backend concurrency, authentication, and DevOps fundamentals**.

---

## 📌 Core Features

### 🔐 Authentication
- Google OAuth 2.0 login
- Backend-verified identity (no frontend trust)
- JWT-based session handling

### 👥 Collaboration
- Room-based collaboration using Room IDs
- Multiple users in the same room
- Live user presence tracking
- Join / leave notifications

### ⚡ Real-Time Code Sync
- WebSocket-based live code editing
- Changes instantly reflected for all users
- Language switching synchronized across room

### ▶️ Shared Code Execution
- Any user can run code
- Output is **broadcast to all users in the room**
- Supports multiple languages:
  - JavaScript (Node.js)
  - Python
  - Java
  - C
  - C++

### 🗄️ Persistence
- Room metadata stored in MySQL
- Code state persisted per room
- Active users tracked per room

### 🐳 Deployment-Ready
- Dockerized frontend, backend, database, Redis
- Nginx reverse proxy
- AWS EC2 compatible setup

---

## 🧠 System Architecture

`

Browser (React)
├─ Google OAuth Login
├─ REST API (JWT, Rooms)
└─ WebSocket (Live Collaboration)
↓
Django ASGI (Daphne)
├─ Django REST Framework
├─ Django Channels
├─ Redis (Pub/Sub)
├─ MySQL (Persistent Storage)
└─ Code Executor (Subprocess)




## 🛠️ Technology Stack

### Frontend
- React (Hooks, SPA)
- Tailwind CSS
- Axios
- WebSocket API
- @react-oauth/google
- Lucide React Icons

### Backend
- Django
- Django REST Framework
- Django Channels
- ASGI + Daphne
- Google OAuth token verification
- JWT (SimpleJWT)
- Redis (channels-redis)
- MySQL
- Python subprocess (code execution)


---

## 📂 Project Structure

```

codesync-project/
├── backend/
│   ├── config/            # Django settings & ASGI
│   ├── editor/            # Core logic (models, consumers)
│   ├── manage.py
│   ├── requirements.txt
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── components/CodeEditor.js
│   │   ├── App.js
│   │   ├── index.js
│   │   └── index.css
│   ├── Dockerfile
│   └── nginx.conf
│
├── docker-compose.yml
└── README.md

````

---

## 🔐 Authentication Flow (Google OAuth)

1. User clicks **Login with Google**
2. Google returns an ID token
3. Frontend sends token to Django
4. Django verifies token using Google public keys
5. Django creates or retrieves the user
6. JWT access token is issued
7. User is authenticated and can join rooms

---

## ⚙️ Backend Implementation Details

### Models
- **Room** → unique room identifier
- **CodeSession** → current code + language per room
- **ActiveUser** → tracks connected users per room

### WebSocket Events
| Event Type | Description |
|-----------|------------|
| `join` | User joins a room |
| `code_update` | Code edited by a user |
| `language_change` | Programming language switched |
| `compile` | Code execution requested |
| `compile_result` | Output broadcast to room |

### Important Design Choice
- **Execution output is broadcast to the entire room**
- Uses Redis Pub/Sub via Django Channels

---

## ⚙️ Local Development Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- Redis
- MySQL
- Google OAuth credentials

---

### 1️⃣ Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
````

Create `.env`:

```env
SECRET_KEY=your-secret-key
DEBUG=True

DB_NAME=codesync_db
DB_USER=root
DB_PASSWORD=yourpassword
DB_HOST=localhost
DB_PORT=3306

GOOGLE_CLIENT_ID=your-google-client-id
```

Run migrations:

```bash
python manage.py makemigrations
python manage.py migrate
python manage.py runserver
```

---

### 2️⃣ Frontend Setup

```bash
cd frontend
npm install
npm start
```

---

### 3️⃣ Redis

```bash
redis-server
```

---

## 🧪 How to Use the App

1. Open the app in two browsers
2. Login with **different Google accounts**
3. Enter the **same Room ID**
4. Type code → see real-time sync
5. Click **Run** → output appears for all users

---


Services:

* Frontend (Nginx) → port 80
* Backend (Daphne) → port 8000
* Redis → port 6379
* MySQL → port 3306

---


---

## 🔒 Security Considerations

* OAuth tokens verified on backend
* JWT-based authentication
* WebSocket room isolation
* Execution timeout enforced
* No frontend-only trust

---

---

---

---

## 👨‍💻 Author

**Sridhar Goud Malgani**


---

## 📜 License

This project is intended for **learning, portfolio, and demonstration purposes**.



