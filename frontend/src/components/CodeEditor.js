// frontend/src/components/CodeEditor.js
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { GoogleLogin } from "@react-oauth/google";
import "./CodeEditor.css";

import {
  Users,
  Copy,
  Check,
  LogOut,
  Play,
  Terminal,
  Code2,
  Wifi,
  WifiOff,
  GitPullRequest,
  Zap,
} from "lucide-react";

/* Backend URL */
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://collaborative-code-editor-1-darj.onrender.com";

/* Language templates — removed Go, Rust, Ruby, PHP, Kotlin */
const LANGUAGE_TEMPLATES = {
  javascript: {
    label: "JavaScript",
    template: `// JavaScript\nconsole.log("Hello, World!");`,
    compiler: "Node.js",
  },
  typescript: {
    label: "TypeScript",
    template: `// TypeScript\nconst greet = (name: string) => console.log("Hello, " + name);\ngreet("World");`,
    compiler: "ts-node",
  },
  python: {
    label: "Python",
    template: `# Python\nprint("Hello, World!")`,
    compiler: "Python 3",
  },
  java: {
    label: "Java",
    template: `// Java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, World!");\n  }\n}`,
    compiler: "JDK",
  },
  cpp: {
    label: "C++",
    template: `// C++\n#include <iostream>\nint main(){ std::cout << "Hello, World!\\n"; return 0; }`,
    compiler: "g++",
  },
  c: {
    label: "C",
    template: `// C\n#include <stdio.h>\nint main(){ printf("Hello, World!\\n"); return 0; }`,
    compiler: "gcc",
  },
};

/* ----- Helpers ----- */
function initialsFromEmail(email) {
  if (!email) return "?";
  const part = email.split("@")[0];
  const pieces = part.split(/[._-]/).filter(Boolean);
  if (pieces.length >= 2) return (pieces[0][0] + pieces[1][0]).toUpperCase();
  return part.slice(0, 2).toUpperCase();
}

/* ===== Component ===== */
export default function CodeEditor() {
  /* Auth */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [user, setUser] = useState(null);

  /* Room / Connection */
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionHint, setConnectionHint] = useState("Disconnected");
  const [reconnectTick, setReconnectTick] = useState(0);

  /* Editor */
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(LANGUAGE_TEMPLATES.javascript.template);
  const [users, setUsers] = useState([]);
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSide, setShowSide] = useState(false);

  const wsRef = useRef(null);
  const reconnectRef = useRef({ attempts: 0, timer: null });
  const outputEndRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get("access");
    const emailParam = params.get("email");

    if (access && emailParam) {
      localStorage.setItem("access", access);
      localStorage.setItem("user", JSON.stringify({ email: emailParam }));

      axios.defaults.headers.common.Authorization = `Bearer ${access}`;

      setUser({ email: emailParam });

      // clean URL
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  // 🔐 Restore login on refresh
  useEffect(() => {
    const token = localStorage.getItem("access");
    const savedUser = localStorage.getItem("user");

    if (token && savedUser) {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;

      setUser(JSON.parse(savedUser));
    }
  }, []);

  //logout
  const logout = () => {
    localStorage.removeItem("access");
    localStorage.removeItem("user");
    localStorage.removeItem("lastRoom");

    delete axios.defaults.headers.common.Authorization;

    setUser(null);
    setJoined(false);
  };

  /* ---------- WebSocket connection & handlers ---------- */
  useEffect(() => {
    if (!joined || !user || !roomId) return;
    const reconnectState = reconnectRef.current;

    const protocol = BACKEND_URL.startsWith("https") ? "wss" : "ws";
    const host = BACKEND_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const url = `${protocol}://${host}/ws/code/${roomId}/`;

    let ws;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      setConnectionHint("Connecting...");
    } catch (e) {
      setConnectionHint("Connection failed");
      return;
    }

    ws.onopen = () => {
      reconnectState.attempts = 0;
      setConnected(true);
      setConnectionHint("Connected");
      // join with stable identifier
      try {
        ws.send(JSON.stringify({ type: "join", username: user.email }));
      } catch (e) {}
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        switch (data.type) {
          case "init":
            if (data.code) setCode(data.code);
            if (data.language) setLanguage(data.language);
            if (Array.isArray(data.users)) setUsers(data.users);
            break;

          case "user_joined":
          case "user_left":
            setUsers(Array.isArray(data.users) ? data.users : []);
            break;

          case "code_update":
            // update only when from other users to avoid echo
            if (!data.user || data.user !== user.email) {
              if (typeof data.code === "string") setCode(data.code);
            }
            break;

          case "language_change":
            if (!data.user || data.user !== user.email) {
              if (data.language) setLanguage(data.language);
              if (typeof data.code === "string") setCode(data.code);
              setOutput("");
            }
            break;

          case "compile_result":
            setOutput(String(data.output ?? ""));
            setIsRunning(false);
            break;

          case "output_cleared":
            setOutput("");
            break;

          default:
            // ignore unknown messages
            break;
        }
      } catch (err) {
        console.error("WS message parse error", err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnectionHint("Disconnected");
      reconnectState.attempts += 1;
      const a = reconnectState.attempts;
      const delay = Math.min(1000 * Math.pow(2, a), 10000);
      reconnectState.timer = setTimeout(() => {
        setReconnectTick((t) => t + 1); // trigger reconnect effect
      }, delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error", err);
      setConnected(false);
      setConnectionHint("Connection error");
    };

    return () => {
      const timer = reconnectState.timer;
      try {
        if (timer) {
          clearTimeout(timer);
        }
        ws.close();
      } catch (e) {}
    };
    // reconnectTick included to trigger re-run when reconnection is attempted
  }, [joined, roomId, user, reconnectTick]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  /* ---------- Auth handlers (simple local auth endpoints) ---------- */
  const handleAuth = async () => {
    if (!email || !password) return alert("Email & password required");
    try {
      const url = isRegister ? `${BACKEND_URL}/api/auth/register/` : `${BACKEND_URL}/api/auth/login/`;
      const res = await axios.post(url, { email, password });
      if (isRegister) {
        alert("Registered. Please sign in.");
        setIsRegister(false);
        return;
      }
      localStorage.setItem("access", res.data.access);
      localStorage.setItem("user", JSON.stringify(res.data.user));

      axios.defaults.headers.common.Authorization = `Bearer ${res.data.access}`;

      setUser(res.data.user);
    } catch (err) {
      console.error("auth error", err);
      alert(err.response?.data?.error || "Auth failed");
    }
  };

  // Google login
  const handleGoogleSuccess = async (credentialResponse) => {
    const token = credentialResponse?.credential;
    if (!token) {
      alert("Google token missing");
      return;
    }

    try {
      const res = await axios.post(`${BACKEND_URL}/api/auth/google/`, { token });
      localStorage.setItem("access", res.data.access);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      axios.defaults.headers.common.Authorization = `Bearer ${res.data.access}`;
      setUser(res.data.user);
    } catch (err) {
      console.error("google auth error", err);
      alert(err.response?.data?.error || "Google login failed");
    }
  };

  const handleGoogleError = () => {
    alert("Google login failed");
  };

  /* ---------- small utilities ---------- */
  const copyRoom = async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  /* ---------- code / language events ---------- */
  const sendCodeUpdate = (newCode) => {
    setCode(newCode);
    try {
      wsRef.current?.send(
        JSON.stringify({ type: "code_update", code: newCode, language, user: user.email })
      );
    } catch (e) {}
  };

  const handleLanguageChange = (langKey) => {
    const template = LANGUAGE_TEMPLATES[langKey]?.template ?? "";
    setLanguage(langKey);
    setCode(template);
    try {
      wsRef.current?.send(
        JSON.stringify({ type: "language_change", language: langKey, code: template, user: user.email })
      );
    } catch (e) {}
  };

  /* ---------- run / compile / clear ---------- */
  const handleRun = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert("Not connected to server");
      return;
    }
    setIsRunning(true);
    setOutput("Compiling and executing...\n");
    try {
      wsRef.current.send(JSON.stringify({ type: "compile", code, language, user: user.email }));
    } catch (e) {
      console.error(e);
      setIsRunning(false);
    }
  };

  const handleClearOutput = () => {
    setOutput("");
    try {
      wsRef.current?.send(JSON.stringify({ type: "clear_output", user: user.email }));
    } catch (e) {}
  };

  /* ---------- leave ---------- */
  const handleLeave = () => {
    try {
      wsRef.current?.close();
    } catch (e) {}
    setJoined(false);
    setRoomId("");
    setUsers([]);
    setOutput("");
    setConnected(false);
    setConnectionHint("Disconnected");
  };

  /* ---------- UI states ---------- */
  if (!user) {
    return (
      <div className="ce-auth-wrap">
        <div className="ce-auth-card">
          <div className="ce-brand">
            <Code2 size={28} /> <h1>CodeSync</h1>
          </div>

          <p className="ce-sub">Real-time collaborative code editor</p>

          <input
            className="ce-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="ce-input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="ce-btn primary" onClick={handleAuth}>
            {isRegister ? "Create account" : "Sign in"}
          </button>

          <div className="google-login-wrap">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              text="signin_with"
              shape="pill"
            />
          </div>

          <div className="ce-row between">
            <button className="link" onClick={() => setIsRegister(!isRegister)}>
              {isRegister ? "Already have an account?" : "New user? Register"}
            </button>
            <small className="muted">Authorize</small>
          </div>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="ce-auth-wrap">
        <div className="ce-auth-card">
          <div className="ce-brand">
            <Code2 size={28} /> <h1>CodeSync</h1>
          </div>

          <button onClick={logout}>
            <LogOut size={16} />
          </button>

          <p className="ce-sub">
            Welcome, <b>{user.email}</b>
          </p>

          <input
            className="ce-input"
            placeholder="Room ID (e.g. team-frontend)"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ce-btn primary"
              onClick={() => {
                if (!roomId) return alert("Enter Room ID");
                setJoined(true);
              }}
            >
              Join Room
            </button>
            <button
              className="ce-btn"
              onClick={() => {
                const id = Math.random().toString(36).slice(2, 9);
                setRoomId(id);
                setJoined(true);
              }}
            >
              Create & Join
            </button>
          </div>

          <div className="ce-row" style={{ marginTop: 12 }}>
            <small className="muted">Share Room ID to collaborate</small>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Main Editor UI ---------- */
  return (
    <div className="ce-app">
      <header className="ce-header">
        <div className="ce-left">
          <div className="ce-logo">
            <Code2 /> <span className="ce-title">CodeSync</span>
          </div>

          <div className="ce-room">
            <strong>{roomId}</strong>
            <button className="icon-btn" title="Copy room" onClick={copyRoom}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </div>

        <div className="ce-center">
          <select className="ce-select" value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
            {Object.entries(LANGUAGE_TEMPLATES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          <button
            className="ce-btn run"
            onClick={handleRun}
            disabled={isRunning || !connected}
            title={!connected ? "Connect to server first" : "Run code"}
          >
            <Play /> {isRunning ? "Running..." : "Run"}
          </button>
        </div>

        <div className="ce-right">
          <div className={`ce-conn ${connected ? "online" : "offline"}`}>
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />} <span>{connectionHint}</span>
          </div>

          <div className="user-chip">
            <div className="avatar">{initialsFromEmail(user.email)}</div>
            <div className="user-email">{user.email}</div>

            <button className="icon-btn mobile-only" title="Show output & users" onClick={() => setShowSide((v) => !v)}>
              <Terminal size={18} />
            </button>

            <button className="icon-btn danger" title="Leave room" onClick={handleLeave}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="ce-main">
        <section className="ce-editor-pane">
          <div className="ce-editor-toolbar">
            <div className="meta">
              <GitPullRequest size={14} /> <span className="muted">{LANGUAGE_TEMPLATES[language].compiler}</span>
            </div>
            <div className="meta">
              <Zap size={14} /> <span className="muted">Realtime</span>
            </div>
          </div>

          <textarea
            className="ce-textarea"
            value={code}
            onChange={(e) => sendCodeUpdate(e.target.value)}
            spellCheck={false}
          />
        </section>

        <aside className={`ce-side ${showSide ? "open" : ""}`}>
          <div className="side-block">
            <div className="side-title">
              <Users size={16} /> Active users
            </div>
            <div className="users-list">
              {users.length === 0 ? (
                <div className="muted">No other users</div>
              ) : (
                users.map((u) => (
                  <div className="user-row" key={u}>
                    <div className="avatar small">{initialsFromEmail(u)}</div>
                    <div className="user-name">{u}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="side-block">
            <div className="side-title">
              <Terminal size={16} /> Output
            </div>
            <div className="output">
              {output ? (
                output.split("\n").map((ln, i) => (
                  <div key={i} className={ln.toLowerCase().includes("error") ? "err" : ""}>
                    {ln || "\u00A0"}
                  </div>
                ))
              ) : (
                <div className="muted">No output yet</div>
              )}
              <div ref={outputEndRef} />
            </div>

            <div className="side-actions">
              <button className="ce-btn small" onClick={handleClearOutput}>
                Clear
              </button>
              <button className="ce-btn small secondary" onClick={() => navigator.clipboard.writeText(output || "")}>
                Copy
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
