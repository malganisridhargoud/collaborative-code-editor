import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Users, Copy, Check, LogOut, Play, Terminal, Wifi, WifiOff, Settings, Sun, Moon, MessageSquare, Send
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONFIGURATION & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = typeof window !== "undefined" && window.location.hostname === "localhost" 
  ? "http://localhost:8000" 
  : (process.env.REACT_APP_BACKEND_URL || "https://collaborative-code-editor-1-darj.onrender.com");

const LANGUAGES = {
  javascript: { name: "JavaScript", defaultCode: `console.log("Hello, World!");` },
  python: { name: "Python 3", defaultCode: `print("Hello, World!")` },
  java: { name: "Java", defaultCode: `public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, World!");\n  }\n}` },
  cpp: { name: "C++", defaultCode: `#include <iostream>\nint main() {\n  std::cout << "Hello, World!\\n";\n  return 0;\n}` }
};

const getInitials = (email) => email ? email.substring(0, 2).toUpperCase() : "??";

// ─────────────────────────────────────────────────────────────────────────────
// 2. CUSTOM HOOKS (Logic Layer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook: useTheme
 * Manages the dark/light mode toggle and persists it in localStorage.
 */
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, toggleTheme };
}

/**
 * Hook: useGroqChat
 * Manages the state and API calls for the AI Chatbot.
 */
function useGroqChat(language, code) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage = { role: "user", content: chatInput };
    const newMessages = [...chatMessages, userMessage];
    
    setChatMessages(newMessages);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const groqApiKey = process.env.REACT_APP_GROQ_API_KEY;
      const systemPrompt = { 
        role: "system", 
        content: `You are a helpful AI coding assistant. The user is currently editing a file in ${language}. Here is their current code context:\n\n\`\`\`${language}\n${code}\n\`\`\``
      };
      
      const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
        model: "llama-3.1-8b-instant",
        messages: [systemPrompt, ...newMessages]
      }, {
        headers: { Authorization: `Bearer ${groqApiKey}` }
      });
      
      const botMessage = res.data.choices[0].message;
      setChatMessages(prev => [...prev, botMessage]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return { chatMessages, chatInput, setChatInput, isChatLoading, handleSendMessage, chatEndRef };
}

/**
 * Hook: useWebSocket
 * Manages the WebSocket connection and collaborative room state.
 */
function useWebSocket(isInRoom, user, roomId, setIsInRoom) {
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(LANGUAGES.javascript.defaultCode);
  const [usersInRoom, setUsersInRoom] = useState([]);
  const [roomOwner, setRoomOwner] = useState(null);
  const [roomLocked, setRoomLocked] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const outputEndRef = useRef(null);

  // Auto-scroll terminal
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalOutput]);

  // Handle WebSocket connection and incoming messages
  useEffect(() => {
    if (!isInRoom || !user || !roomId) return;

    const protocol = BACKEND_URL.startsWith("https") ? "wss" : "ws";
    const host = BACKEND_URL.replace(/^https?:\/\//, "");
    const ws = new WebSocket(`${protocol}://${host}/ws/code/${roomId}/`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: "join", username: user.email }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "init":
          if (data.code) setCode(data.code);
          if (data.language) setLanguage(data.language);
          if (data.users) setUsersInRoom(data.users);
          if (data.owner) setRoomOwner(data.owner);
          if (typeof data.locked !== 'undefined') setRoomLocked(!!data.locked);
          break;
        case "user_joined":
        case "user_left":
          if (data.users) setUsersInRoom(data.users);
          break;
        case "user_kicked":
          if (data.users) setUsersInRoom(data.users);
          if (data.target === user.email) {
            alert("You were kicked from the room");
            setIsInRoom(false);
          }
          break;
        case "room_locked":
          setRoomLocked(!!data.locked);
          break;
        case "room_deleted":
          alert("Room was deleted by the owner");
          setIsInRoom(false);
          break;
        case "cursor_move":
          break;
        case "code_update":
          if (data.user !== user.email) setCode(data.code);
          break;
        case "language_change":
          if (data.user !== user.email) {
            setLanguage(data.language);
            setCode(data.code);
          }
          break;
        case "compile_result":
          setTerminalOutput(String(data.output || ""));
          setIsRunning(false);
          break;
        case "output_cleared":
          setTerminalOutput("");
          break;
        default: break;
      }
    };

    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);

    return () => ws.close();
  }, [isInRoom, roomId, user, setIsInRoom]);

  // Helper functions to send data via WebSocket
  const handleCodeChange = (newCode) => {
    setCode(newCode);
    wsRef.current?.send(JSON.stringify({ type: "code_update", code: newCode, language, user: user.email }));
  };

  const handleCursorChange = (e) => {
    const pos = e.target.selectionStart;
    wsRef.current?.send(JSON.stringify({ type: 'cursor_move', cursor: { pos }, user: user.email }));
  };

  const handleLanguageChange = (newLanguage) => {
    const newCode = LANGUAGES[newLanguage]?.defaultCode || "";
    setLanguage(newLanguage);
    setCode(newCode);
    wsRef.current?.send(JSON.stringify({ type: "language_change", language: newLanguage, code: newCode, user: user.email }));
  };

  const handleRunCode = () => {
    if (!isConnected) return alert("You are not connected to the server.");
    setIsRunning(true);
    setTerminalOutput("Executing code...\n");
    wsRef.current?.send(JSON.stringify({ type: "compile", code, language, user: user.email }));
  };

  return {
    language, code, usersInRoom, roomOwner, roomLocked, terminalOutput, isRunning, isConnected,
    handleCodeChange, handleCursorChange, handleLanguageChange, handleRunCode, wsRef, outputEndRef
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. UI COMPONENTS (Presentational Layer)
// ─────────────────────────────────────────────────────────────────────────────

function ZigzagLogo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <polyline points="2,6 6,12 10,6 14,12 18,6 22,12" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function LoginScreen({ onLoginSuccess, theme, onToggleTheme }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) return alert("Please enter both email and password.");
    try {
      const endpoint = isRegistering ? "register" : "login";
      const res = await axios.post(`${BACKEND_URL}/api/auth/${endpoint}/`, { email, password });
      
      if (isRegistering) {
        alert("Account created! You can now sign in.");
        setIsRegistering(false);
        return;
      }

      localStorage.setItem("access", res.data.access);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      axios.defaults.headers.common.Authorization = `Bearer ${res.data.access}`;
      onLoginSuccess(res.data.user);

    } catch (err) {
      alert(err.response?.data?.error || "Authentication failed. Please try again.");
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-body-tertiary position-relative">
      <button className="btn btn-outline-secondary position-absolute top-0 end-0 m-4 border-0 rounded-circle p-2" onClick={onToggleTheme}>
        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className="card shadow-sm border-0 rounded-4 p-4 bg-body" style={{ width: "100%", maxWidth: "400px" }}>
        <div className="text-center mb-4">
          <span className="text-primary mb-2 d-inline-block"><ZigzagLogo size={40} /></span>
          <h3 className="fw-bold text-body">CoDe KnOt</h3>
          <p className="text-muted small">Collaborate in real-time</p>
        </div>
        
        <input className="form-control form-control-lg bg-body-tertiary text-body border-0 mb-3" placeholder="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="form-control form-control-lg bg-body-tertiary text-body border-0 mb-4" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAuth()} />
        
        <button className="btn btn-primary btn-lg w-100 fw-bold mb-3" onClick={handleAuth}>
          {isRegistering ? "Create Account" : "Sign In"}
        </button>

        <button className="btn btn-link text-decoration-none text-muted w-100 small" onClick={() => setIsRegistering(!isRegistering)}>
          {isRegistering ? "Already have an account? Sign in" : "Need an account? Register"}
        </button>
      </div>
    </div>
  );
}

function RoomLobby({ user, onJoinRoom, onLogout, theme, onToggleTheme }) {
  const [roomId, setRoomId] = useState("");

  const handleJoin = () => roomId.trim() ? onJoinRoom(roomId.trim()) : alert("Please enter a Room ID");
  const handleCreate = () => onJoinRoom(Math.random().toString(36).substring(2, 9));

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-body-tertiary position-relative">
      <button className="btn btn-outline-secondary position-absolute top-0 end-0 m-4 border-0 rounded-circle p-2" onClick={onToggleTheme}>
        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className="card shadow-sm border-0 rounded-4 p-4 bg-body" style={{ width: "100%", maxWidth: "420px" }}>
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div className="d-flex align-items-center gap-2">
            <div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style={{ width: 40, height: 40 }}>
              {getInitials(user.email)}
            </div>
            <div>
              <span className="d-block fw-bold text-body">{user.email}</span>
              <span className="text-muted small">Ready to code</span>
            </div>
          </div>
          <button className="btn btn-outline-danger border-0 p-2 rounded-circle" onClick={onLogout}><LogOut size={18} /></button>
        </div>

        <div className="p-3 bg-body-tertiary rounded-3 mb-4 border">
          <label className="text-muted small fw-bold text-uppercase mb-2">Join Existing Room</label>
          <div className="d-flex gap-2">
            <input className="form-control border-0 shadow-none bg-body text-body" placeholder="Paste Room ID here..." value={roomId} onChange={(e) => setRoomId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleJoin()} />
            <button className="btn btn-primary px-4 fw-bold" onClick={handleJoin}>Join</button>
          </div>
        </div>

        <div className="text-center"><span className="text-muted small px-2">OR</span></div>
        <button className="btn btn-outline-primary w-100 fw-bold mt-3" onClick={handleCreate}>Create a New Room</button>
      </div>
    </div>
  );
}

function EditorHeader({ roomId, language, isConnected, isRunning, onLanguageChange, onRunCode, onLeaveRoom, theme, onToggleTheme }) {
  const [copied, setCopied] = useState(false);

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="d-flex align-items-center justify-content-between px-4 py-3 bg-body border-bottom">
      <div className="d-flex align-items-center gap-4">
        <h5 className="m-0 fw-bold text-primary d-flex align-items-center gap-2"><span className="d-inline-block"><ZigzagLogo size={20} /></span> CoDe KnOt</h5>
        <div className="d-flex align-items-center gap-2 bg-body-tertiary px-3 py-1 rounded-pill border">
          <span className="text-muted small">Room:</span>
          <span className="fw-bold font-monospace text-body">{roomId}</span>
          <button className="btn btn-sm p-0 text-muted ms-2 border-0" onClick={handleCopyRoomId}>
            {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <div className="d-flex align-items-center gap-3">
        <select className="form-select border-0 bg-body-tertiary shadow-none fw-bold text-secondary" value={language} onChange={(e) => onLanguageChange(e.target.value)}>
          {Object.entries(LANGUAGES).map(([key, val]) => <option key={key} value={key}>{val.name}</option>)}
        </select>
        <button className="btn btn-success d-flex align-items-center gap-2 fw-bold px-4" onClick={onRunCode} disabled={isRunning || !isConnected}>
          <Play size={16} /> {isRunning ? "Running..." : "Run Code"}
        </button>
      </div>

      <div className="d-flex align-items-center gap-3">
        <div className={`d-flex align-items-center gap-2 small fw-bold ${isConnected ? "text-success" : "text-danger"}`}>
          {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />} {isConnected ? "Connected" : "Disconnected"}
        </div>
        <button className="btn btn-outline-secondary border-0 rounded-circle p-2" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="btn btn-outline-danger border-0 rounded-circle p-2" onClick={onLeaveRoom}>
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function AIChatbotSidebar({ chatState }) {
  const { chatMessages, chatInput, setChatInput, isChatLoading, handleSendMessage, chatEndRef } = chatState;
  
  return (
    <div className="d-flex flex-column gap-3" style={{ width: "320px" }}>
      <div className="card shadow-sm border-0 rounded-4 p-3 d-flex flex-column bg-body h-100">
        <h6 className="fw-bold text-primary d-flex align-items-center mb-2">
          <MessageSquare size={16} className="me-2" /> AI Assistant
        </h6>
        <div className="flex-grow-1 overflow-auto pe-2 small mb-2 d-flex flex-column gap-2">
          {chatMessages.length === 0 && <div className="text-muted text-center mt-2">Ask me anything about your code!</div>}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`p-2 rounded-3 ${msg.role === 'user' ? 'bg-primary text-white align-self-end text-end' : 'bg-body-tertiary align-self-start'}`} style={{ maxWidth: '90%', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
          ))}
          {isChatLoading && <div className="text-muted small">AI is typing...</div>}
          <div ref={chatEndRef} />
        </div>
        <div className="d-flex gap-2">
          <input className="form-control form-control-sm border shadow-none bg-body text-body" placeholder="Ask AI..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} />
          <button className="btn btn-sm btn-primary p-2 d-flex align-items-center justify-content-center" onClick={handleSendMessage} disabled={isChatLoading}><Send size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function CollaboratorsSidebar({ user, usersInRoom, roomOwner, roomLocked, wsRef }) {
  return (
    <div className="card shadow-sm border-0 rounded-4 p-3 d-flex flex-column bg-body" style={{ flex: 1, minHeight: 0 }}>
      <h6 className="fw-bold text-muted d-flex align-items-center mb-3">
        <Users size={16} className="me-2" /> Active Collaborators
      </h6>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="small text-muted">Owner: {roomOwner || "(none)"}</div>
        {roomOwner === user.email && (
          <div className="d-flex gap-2">
            <button className={`btn btn-sm ${roomLocked ? 'btn-warning' : 'btn-outline-secondary'}`} onClick={() => wsRef.current?.send(JSON.stringify({ type: 'lock_room', lock: !roomLocked, user: user.email }))}>
              {roomLocked ? 'Unlock' : 'Lock'}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => { if (window.confirm('Delete this room for everyone?')) wsRef.current?.send(JSON.stringify({ type: 'delete_room', user: user.email })); }}>
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="flex-grow-1 overflow-auto pe-2">
        {usersInRoom.map((email) => (
          <div key={email} className="d-flex align-items-center gap-2 mb-2 p-2 bg-body-tertiary rounded-3">
            <div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style={{ width: 28, height: 28, fontSize: "0.8rem" }}>
              {getInitials(email)}
            </div>
            <span className="small text-truncate flex-grow-1 text-body">{email}</span>
            {email === user.email && <span className="badge bg-secondary">You</span>}
            {roomOwner === user.email && email !== user.email && (
              <button className="btn btn-sm btn-outline-danger ms-2" onClick={() => { if (window.confirm(`Kick ${email}?`)) wsRef.current?.send(JSON.stringify({ type: 'kick_user', target: email, user: user.email })); }}>Kick</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsoleTerminal({ terminalOutput, outputEndRef, wsRef }) {
  return (
    <div className="card shadow-sm border-0 rounded-4 p-3 d-flex flex-column bg-dark text-light" style={{ flex: 1, minHeight: 0 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold text-secondary d-flex align-items-center m-0">
          <Terminal size={16} className="me-2" /> Console
        </h6>
        <button className="btn btn-sm btn-outline-secondary border-0 p-1 text-light" onClick={() => wsRef.current?.send(JSON.stringify({ type: "clear_output" }))}>
          Clear
        </button>
      </div>
      <div className="flex-grow-1 overflow-auto font-monospace small" style={{ whiteSpace: "pre-wrap", color: "#a9b7c6" }}>
        {terminalOutput || <span className="text-secondary">Waiting for execution...</span>}
        <div ref={outputEndRef} />
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. MAIN APPLICATION COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CodeEditor() {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [isInRoom, setIsInRoom] = useState(false);

  // Use Custom Hooks
  const { theme, toggleTheme } = useTheme();
  
  const wsState = useWebSocket(isInRoom, user, roomId, setIsInRoom);
  
  const chatState = useGroqChat(wsState.language, wsState.code);

  // App Routing (Conditional Rendering)
  if (!user) {
    return <LoginScreen onLoginSuccess={setUser} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (!isInRoom) {
    return <RoomLobby user={user} onJoinRoom={(id) => { setRoomId(id); setIsInRoom(true); }} onLogout={() => setUser(null)} theme={theme} onToggleTheme={toggleTheme} />;
  }

  // Main Editor View
  return (
    <div className="vh-100 d-flex flex-column font-sans bg-body-tertiary">
      
      <EditorHeader 
        roomId={roomId} language={wsState.language} 
        isConnected={wsState.isConnected} isRunning={wsState.isRunning} 
        onLanguageChange={wsState.handleLanguageChange} 
        onRunCode={wsState.handleRunCode} 
        onLeaveRoom={() => setIsInRoom(false)} 
        theme={theme} onToggleTheme={toggleTheme}
      />

      <div className="d-flex flex-grow-1 overflow-hidden p-3 gap-3">
        
        {/* LEFT SIDEBAR */}
        <AIChatbotSidebar chatState={chatState} />

        {/* CENTER: WORKSPACE CARD */}
        <div className="card shadow-sm border-0 rounded-4 flex-grow-1 overflow-hidden d-flex flex-column bg-body">
          <div className="bg-body-tertiary px-4 py-2 border-bottom d-flex align-items-center text-muted small fw-bold">
            <Settings size={14} className="me-2" /> Workspace
          </div>
          <textarea 
            className="form-control border-0 rounded-0 flex-grow-1 p-4 font-monospace fs-6 shadow-none bg-body text-body"
            style={{ resize: "none", outline: "none" }}
            value={wsState.code} 
            onChange={(e) => wsState.handleCodeChange(e.target.value)} 
            onKeyUp={wsState.handleCursorChange}
            onClick={wsState.handleCursorChange}
            spellCheck={false}
            placeholder="Start typing your code here..."
          />
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="d-flex flex-column gap-3" style={{ width: "320px" }}>
          <CollaboratorsSidebar 
            user={user} usersInRoom={wsState.usersInRoom} 
            roomOwner={wsState.roomOwner} roomLocked={wsState.roomLocked} 
            wsRef={wsState.wsRef} 
          />
          <ConsoleTerminal 
            terminalOutput={wsState.terminalOutput} 
            outputEndRef={wsState.outputEndRef} 
            wsRef={wsState.wsRef} 
          />
        </div>
        
      </div>
    </div>
  );
}