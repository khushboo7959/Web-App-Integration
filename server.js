require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const requiredEnv = [
  "SFMC_AUTH_URL",
  "SFMC_REST_URL",
  "SFMC_CLIENT_ID",
  "SFMC_CLIENT_SECRET",
  "SFMC_REDIRECT_URI",
  "SFMC_DE_KEY"
];

const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exit(1);
}

// Token State for Web App (Authorization Code Flow)
let cachedAccessToken = null;
let cachedRefreshToken = null;
let tokenExpiresAt = 0;
let tokenPromise = null;

// 1. Step one of Auth: Redirect user to SFMC authorization page
app.get("/api/auth/login", (req, res) => {
  const authUrl = `${process.env.SFMC_AUTH_URL.replace(/\/+$/, "")}/v2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(process.env.SFMC_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(process.env.SFMC_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(process.env.SFMC_SCOPE || "email_read email_write data_extensions_write")}` +
    `&state=mystate`;

  res.redirect(authUrl);
});

// 2. Step two of Auth: Handle the callback code at /secondpage and exchange for tokens
app.get("/secondpage", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).json({ success: false, message: `Authorization failed: ${error}` });
  }

  if (!code) {
    return res.status(400).json({ success: false, message: "No authorization code provided." });
  }

  try {
    const response = await fetch(`${process.env.SFMC_AUTH_URL.replace(/\/+$/, "")}/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code,
        client_id: process.env.SFMC_CLIENT_ID,
        client_secret: process.env.SFMC_CLIENT_SECRET,
        redirect_uri: process.env.SFMC_REDIRECT_URI
      }),
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error("Token exchange failed:", data);
      return res.status(500).json({ success: false, message: "Failed to exchange authorization code for tokens." });
    }

    cachedAccessToken = data.access_token;
    cachedRefreshToken = data.refresh_token || cachedRefreshToken;
    tokenExpiresAt = Date.now() + Math.max(0, (data.expires_in || 1080) - 120) * 1000;

    // Redirect user back to home page with success flag
    return res.redirect("/?auth=success");
  } catch (err) {
    console.error("Callback error:", err.message);
    return res.status(500).json({ success: false, message: "Internal server error during token exchange." });
  }
});

async function getAccessToken() {
  // If we have a valid token, return it
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  if (tokenPromise) return tokenPromise;

  // If token is expired but we have a refresh token, try refreshing
  if (cachedRefreshToken) {
    tokenPromise = (async () => {
      const response = await fetch(`${process.env.SFMC_AUTH_URL.replace(/\/+$/, "")}/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: cachedRefreshToken,
          client_id: process.env.SFMC_CLIENT_ID,
          client_secret: process.env.SFMC_CLIENT_SECRET
        }),
        signal: AbortSignal.timeout(15000)
      });

      const data = await response.json();

      if (!response.ok || !data.access_token) {
        throw new Error("SFMC token refresh failed");
      }

      cachedAccessToken = data.access_token;
      cachedRefreshToken = data.refresh_token || cachedRefreshToken;
      tokenExpiresAt = Date.now() + Math.max(0, (data.expires_in || 1080) - 120) * 1000;

      return cachedAccessToken;
    })();

    try {
      return await tokenPromise;
    } finally {
      tokenPromise = null;
    }
  }

  throw new Error("No active session or refresh token available. Please authenticate via /api/auth/login first.");
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", authenticated: !!cachedAccessToken });
});

app.post("/api/submit", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";

  if (!name || name.length > 100) {
    return res.status(400).json({ success: false, message: "Enter a name of up to 100 characters." });
  }

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }

  if (phone.length > 30) {
    return res.status(400).json({ success: false, message: "Phone must be 30 characters or fewer." });
  }

  try {
    const token = await getAccessToken();

    const endpoint = `${process.env.SFMC_REST_URL.replace(/\/+$/, "")}` +
      `/data/v1/async/dataextensions/key:` +
      `${encodeURIComponent(process.env.SFMC_DE_KEY)}/rows`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{
          values: {
            Name: name,
            Email: email,
            Phone: phone
          }
        }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      cachedAccessToken = null;
      tokenExpiresAt = 0;
    }

    if (!response.ok) {
      console.error("SFMC submission failed:", response.status, result);
      return res.status(502).json({
        success: false,
        message: "SFMC rejected the request. Check server logs and DE configuration."
      });
    }

    return res.status(202).json({
      success: true,
      message: "Submission accepted by SFMC for processing.",
      requestId: result.requestId || null
    });
  } catch (error) {
    console.error("Integration error:", error.message);
    return res.status(502).json({
      success: false,
      message: error.message.includes("authenticate") 
        ? "App is not authenticated with SFMC. Please visit /api/auth/login first." 
        : "Could not connect to SFMC. Please try again."
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`SFMC Auth Code integration running on port ${port}`);
});
