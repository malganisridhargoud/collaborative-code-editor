
# 🚀 CodeSync — Real-Time Collaborative Code Editor

CodeSync is a **real-time collaborative code editor** inspired by tools like Google Docs and VS Code Live Share.  
It enables multiple users to **edit, run, and collaborate on code simultaneously** with low-latency synchronization using WebSockets.

Designed with **scalability, real-time systems, and production deployment** in mind.

---

## ✨ Features

- 🔄 **Real-time multi-user code collaboration**
- 🧑‍🤝‍🧑 **Live presence tracking (active users per room)**
- 🌐 **WebSocket-based sync using Django Channels**
- ▶️ **Run code remotely and stream output to all users**
- 🔐 **Authentication**
  - Email & Password (JWT)
  - GitHub OAuth
- 🧩 **Room-based collaboration**
- 🌍 **Language synchronization across users**
- 🧪 **Low-latency updates (<100ms in local testing)**
- 📦 **Dockerized & production-ready architecture**

---

## 🛠 Tech Stack

### Frontend
- **React.js**
- **Lucide-React** (icons)
- **Axios** (HTTP requests)
- **WebSockets (native browser API)**
- **CSS (Responsive UI, mobile-friendly)**

### Backend
- **Django**
- **Django REST Framework**
- **Django Channels (ASGI)**
- **Daphne (ASGI server)**
- **JWT Authentication (SimpleJWT)**

### Realtime & Messaging
- **WebSockets**
- **Redis (Channel Layer / Pub-Sub)**

### Databases
- **MySQL / PostgreSQL** (sessions, users, rooms)
- **Redis** (realtime state, pub/sub, caching)

### DevOps & Deployment
- **Docker**
- **Docker Compose**
- **GitHub Actions (CI/CD)**
- **Render (Backend hosting)**
- **Vercel (Frontend hosting)**

---

## 🧱 Architecture Overview

Frontend (React)
│
│ WebSocket / HTTP
▼
Backend (Django + Channels + Daphne)
│
│ Redis Pub/Sub
▼
Redis

- HTTP → Authentication, REST APIs
- WebSocket → Code sync, presence, execution output
- Redis → Message broadcasting & state synchronization

---

## 📂 Project Structure

collaborative-code-editor/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── CodeEditor.js
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
│
├── backend/
│   ├── config/
│   │   ├── asgi.py
│   │   ├── settings.py
│   │   └── urls.py
│   ├── editor/
│   │   ├── consumers.py
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── routing.py
│   │   └── urls.py
│   └── manage.py
│
├── docker-compose.yml
└── README.md

---

## ⚙️ Local Setup

### 1️⃣ Clone Repository
```bash
git clone https://github.com/your-username/codesync.git
cd codesync

2️⃣ Backend Setup

cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt

Run Redis (Memurai / WSL / Docker), then:

daphne -b 0.0.0.0 -p 8000 config.asgi:application


⸻

3️⃣ Frontend Setup

cd frontend
npm install
npm start


⸻

🔐 Authentication
	•	Email & Password
	•	GitHub OAuth
	•	JWT tokens persisted in localStorage
	•	Auto-login on refresh
	•	Secure token exchange on OAuth callback

⸻

🌍 Deployment
	•	Frontend → Vercel
	•	Backend → Render (ASGI service)
	•	Redis → Managed Redis / external Redis service
	•	CI/CD → GitHub Actions

⸻

