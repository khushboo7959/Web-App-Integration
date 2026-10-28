
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
  "SFMC_ACCOUNT_ID",
  "SFMC_DE_KEY"
];

const missing = requiredEnv.filter(
  (key) => !process.env[key]
);

if (missing.length) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exit(1);
}

let cachedToken;
let tokenExpiresAt = 0;
let tokenPromise;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const response = await fetch(
      `${process.env.SFMC_AUTH_URL.replace(/\/+$/, "")}/v2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: process.env.SFMC_CLIENT_ID,
          client_secret: process.env.SFMC_CLIENT_SECRET,
          account_id: process.env.SFMC_ACCOUNT_ID
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      throw new Error("SFMC authentication failed");
    }

    cachedToken = data.access_token;
    tokenExpiresAt =
      Date.now() + Math.max(0, (data.expires_in || 1080) - 120) * 1000;

    return cachedToken;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/submit", async (req, res) => {
  const name = typeof req.body.name === "string"
    ? req.body.name.trim()
    : "";

  const email = typeof req.body.email === "string"
    ? req.body.email.trim()
    : "";

  const phone = typeof req.body.phone === "string"
    ? req.body.phone.trim()
    : "";

  if (!name || name.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Enter a name of up to 100 characters."
    });
  }

  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address."
    });
  }

  if (phone.length > 30) {
    return res.status(400).json({
      success: false,
      message: "Phone must be 30 characters or fewer."
    });
  }

  try {
    const token = await getAccessToken();

    const endpoint =
      `${process.env.SFMC_REST_URL.replace(/\/+$/, "")}` +
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
      cachedToken = null;
      tokenExpiresAt = 0;
    }

    if (!response.ok) {
      console.error("SFMC submission failed:", response.status);

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
      message: "Could not connect to SFMC. Please try again."
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`SFMC integration running on port ${port}`);
});
