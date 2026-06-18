import React from "react";
import ReactDOM from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import { GoogleOAuthProvider } from "@react-oauth/google";
import CodeEditor from "./components/CodeEditor";


const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

if (!googleClientId) {
  console.warn(
    "REACT_APP_GOOGLE_CLIENT_ID is not set. Google login will be disabled until it is configured."
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId || "missing-google-client-id"}>
      <CodeEditor />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
