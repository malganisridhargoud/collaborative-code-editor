import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';

/* =======================
   Backend URL (ENV-AWARE)
======================= */
const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

/* =======================
   Language Templates
======================= */
const LANGUAGE_TEMPLATES = {
  javascript: {
    code: `// JavaScript
console.log("Hello, World!");

function sum(a, b) {
  return a + b;
}

console.log("5 + 3 =", sum(5, 3));`,
    compiler: 'Node.js',
  },
  python: {
    code: `# Python
print("Hello, World!")

def sum(a, b):
    return a + b

print("5 + 3 =", sum(5, 3))`,
    compiler: 'Python 3',
  },
  java: {
    code: `// Java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
        System.out.println("5 + 3 = " + sum(5, 3));
    }

    public static int sum(int a, int b) {
        return a + b;
    }
}`,
    compiler: 'Java JDK',
  },
  cpp: {
    code: `// C++
#include <iostream>
using namespace std;

int sum(int a, int b) {
    return a + b;
}

int main() {
    cout << "Hello, World!" << endl;
    cout << "5 + 3 = " << sum(5, 3) << endl;
    return 0;
}`,
    compiler: 'G++',
  },
  c: {
    code: `// C
#include <stdio.h>

int sum(int a, int b) {
    return a + b;
}

int main() {
    printf("Hello, World!\\n");
    printf("5 + 3 = %d\\n", sum(5, 3));
    return 0;
}`,
    compiler: 'GCC',
  },
};

export default function CodeEditor() {
  /* =======================
     Auth & Room State
  ======================= */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  /* =======================
     Editor State
  ======================= */
  const [code, setCode] = useState(LANGUAGE_TEMPLATES.javascript.code);
  const [language, setLanguage] = useState('javascript');
  const [users, setUsers] = useState([]);

  const [output, setOutput] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [copied, setCopied] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  const wsRef = useRef(null);
  const outputEndRef = useRef(null);

  /* =======================
     Google Login
  ======================= */
  const handleGoogleLogin = async (credentialResponse) => {
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/auth/google/`,
        { token: credentialResponse.credential }
      );

      localStorage.setItem('access', res.data.access);
      axios.defaults.headers.common.Authorization =
        `Bearer ${res.data.access}`;

      setUserProfile(res.data.user);
      setIsAuthenticated(true);
    } catch (err) {
      console.error('Google login failed', err);
    }
  };

  /* =======================
     WebSocket Logic
  ======================= */
  useEffect(() => {
    if (!isJoined || !userProfile) return;

    const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${BACKEND_URL.replace(
      /^https?:\/\//,
      ''
    )}/ws/code/${roomId}/`;

    setConnectionStatus('Connecting...');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionStatus('Connected');
      ws.send(
        JSON.stringify({
          type: 'join',
          username: userProfile.email, // stable identifier
        })
      );
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === 'init') {
        setCode(data.code);
        setLanguage(data.language);
        setUsers(data.users);
      }

      if (data.type === 'user_joined' || data.type === 'user_left') {
        setUsers(data.users);
      }

      if (data.type === 'code_update' && data.user !== userProfile.email) {
        setCode(data.code);
      }

      if (
        data.type === 'language_change' &&
        data.user !== userProfile.email
      ) {
        setLanguage(data.language);
        setCode(data.code);
        setOutput('');
      }

      if (data.type === 'compile_result') {
        setOutput(data.output);
        setIsCompiling(false);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setConnectionStatus('Disconnected');
    };

    ws.onerror = () => {
      setIsConnected(false);
      setConnectionStatus('Error');
    };

    return () => ws.close();
  }, [isJoined, roomId, userProfile]);

  /* =======================
     Editor Actions
  ======================= */
  const handleCodeChange = (e) => {
    const newCode = e.target.value;
    setCode(newCode);

    wsRef.current?.send(
      JSON.stringify({
        type: 'code_update',
        code: newCode,
        user: userProfile.email,
        language,
      })
    );
  };

  const handleLanguageChange = (lang) => {
    const newCode = LANGUAGE_TEMPLATES[lang].code;
    setLanguage(lang);
    setCode(newCode);
    setOutput('');

    wsRef.current?.send(
      JSON.stringify({
        type: 'language_change',
        language: lang,
        code: newCode,
        user: userProfile.email,
      })
    );
  };

  const handleCompile = () => {
    setIsCompiling(true);
    setOutput('Running...\n');

    wsRef.current?.send(
      JSON.stringify({
        type: 'compile',
        code,
        language,
      })
    );
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /* =======================
     UI STATES
  ======================= */

  // Login
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="bg-slate-800 p-8 rounded-xl w-96 text-center">
          <h1 className="text-3xl font-bold text-white mb-6">CodeSync</h1>
          <GoogleLogin
            onSuccess={handleGoogleLogin}
            onError={() => console.log('Login Failed')}
          />
        </div>
      </div>
    );
  }

  // Room Join
  if (!isJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="bg-slate-800 p-8 rounded-xl w-96">
          <h2 className="text-xl text-white mb-4">
            Welcome, {userProfile.email}
          </h2>

          <input
            placeholder="Enter Room ID"
            className="w-full mb-4 p-2 bg-slate-700 text-white rounded"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />

          <button
            className="w-full bg-indigo-600 py-2 rounded text-white"
            onClick={() => setIsJoined(true)}
            disabled={!roomId}
          >
            Join Room
          </button>
        </div>
      </div>
    );
  }

  /* =======================
     Main Editor UI
  ======================= */
  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      <header className="flex items-center justify-between p-4 bg-slate-800">
        <div className="flex items-center gap-3">
          <Code2 />
          <span className="font-mono">{roomId}</span>
          <button onClick={handleCopyRoomId}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <span className="flex items-center gap-1 text-sm">
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connectionStatus}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-slate-700 p-1 rounded"
          >
            {Object.keys(LANGUAGE_TEMPLATES).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <button
            onClick={handleCompile}
            disabled={isCompiling}
            className="bg-green-600 px-3 py-1 rounded flex items-center gap-1"
          >
            <Play size={14} /> Run
          </button>

          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 px-3 py-1 rounded flex items-center gap-1"
          >
            <LogOut size={14} /> Leave
          </button>
        </div>
      </header>

      <main className="flex flex-1">
        <textarea
          value={code}
          onChange={handleCodeChange}
          className="flex-1 p-4 bg-slate-900 font-mono outline-none"
        />

        <div className="w-80 bg-slate-800 flex flex-col">
          <div className="p-3 border-b border-slate-700 flex items-center gap-2">
            <Users size={16} /> Users ({users.length})
          </div>

          <div className="flex-1 p-3 overflow-auto font-mono text-sm">
            {output.split('\n').map((line, i) => (
              <div key={i}>{line || '\u00A0'}</div>
            ))}
            <div ref={outputEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
