require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(
  cors({
    origin: "http://localhost:4200",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use("/demo2", express.static(path.join(__dirname, "demo-partner2")));
// Serve local demo partner website and SDK
app.use("/public", express.static(path.join(__dirname, "public")));

app.use("/demo", express.static(path.join(__dirname, "demo-partner")));
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
});

// Load security keys from environment
function loadHexKey(name) {
  const value = process.env[name];

  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must contain exactly 64 hexadecimal characters`);
  }

  return Buffer.from(value, "hex");
}

const dataKey = loadHexKey("CONSENT_DATA_KEY");
const signingKey = loadHexKey("CONSENT_SIGNING_KEY");

// Encrypt consent payload using AES-256-GCM
function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  const envelope = {
    algorithm: "AES-256-GCM",
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };

  return envelope;
}

// Sign encrypted payload using HMAC-SHA256
function signPayload(envelope) {
  return crypto
    .createHmac("sha256", signingKey)
    .update(JSON.stringify(envelope))
    .digest("hex");
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "GREEN" });
});

// Database health check
app.get("/health/db", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");
    res.json({ status: "CONNECTED" });
  } catch (error) {
    console.error("Database health error:", error.message);
    res.status(500).json({ status: "ERROR" });
  }
});

// Tenant authentication middleware
async function resolveTenantContext(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      error: "Missing API key",
    });
  }

  try {
    const result = await pool.query(
      `SELECT tenant_id, company_name, primary_color,
              text_color, font_family, brand_logo_url
       FROM tenants
       WHERE api_public_key = $1`,
      [apiKey],
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "Invalid API key",
      });
    }

    req.tenant = result.rows[0];
    next();
  } catch (error) {
    console.error("Tenant authentication error:", error.message);

    res.status(500).json({
      error: "Tenant authentication failed",
    });
  }
}

// Retrieve localized consent notices
app.get("/api/v1/consent/notice", resolveTenantContext, async (req, res) => {
  const language = req.query.lang || "en";
  let client;

  try {
    client = await pool.connect();

    await client.query("BEGIN");

    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.tenant_id,
    ]);

    const result = await client.query(
      `SELECT purpose_code,
                is_mandatory,
                version,
                localized_notices -> $1 AS notice_payload
         FROM consent_purposes`,
      [language],
    );

    await client.query("COMMIT");

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No consent notices found",
      });
    }

    res.json({
      tenant: req.tenant,
      language,
      purposes: result.rows,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Notice retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve consent notice",
    });
  } finally {
    if (client) client.release();
  }
});

// Grant or deny consent and record audit event
app.post("/api/v1/consent/grant", resolveTenantContext, async (req, res) => {
  const {
    userId,
    grantedPurposes,
    deniedPurposes,
    noticeVersion,
    clientFingerprint,
  } = req.body;

  // Input validation
  if (typeof userId !== "string" || !userId.trim() || userId.length > 100) {
    return res.status(400).json({
      error: "Valid userId is required",
    });
  }

  if (
    !Array.isArray(grantedPurposes) ||
    !Array.isArray(deniedPurposes) ||
    grantedPurposes.length + deniedPurposes.length === 0 ||
    [...grantedPurposes, ...deniedPurposes].some(
      (p) => typeof p !== "string" || !p.trim() || p.length > 50,
    )
  ) {
    return res.status(400).json({
      error: "Valid grantedPurposes and deniedPurposes arrays are required",
    });
  }

  if (
    new Set(grantedPurposes).size !== grantedPurposes.length ||
    new Set(deniedPurposes).size !== deniedPurposes.length ||
    grantedPurposes.some((p) => deniedPurposes.includes(p))
  ) {
    return res.status(400).json({
      error: "Duplicate or overlapping consent purposes are not allowed",
    });
  }

  if (
    typeof noticeVersion !== "string" ||
    !noticeVersion.trim() ||
    noticeVersion.length > 20
  ) {
    return res.status(400).json({
      error: "Valid noticeVersion is required",
    });
  }

  if (
    !clientFingerprint ||
    typeof clientFingerprint !== "object" ||
    Array.isArray(clientFingerprint)
  ) {
    return res.status(400).json({
      error: "Valid clientFingerprint object is required",
    });
  }

  let client;

  try {
    client = await pool.connect();

    await client.query("BEGIN");

    // Establish tenant context for RLS
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.tenant_id,
    ]);

    // Verify that all submitted purposes belong to this tenant
    // and use the supplied notice version.
    const requestedPurposes = [...grantedPurposes, ...deniedPurposes];

    const purposeResult = await client.query(
      `SELECT purpose_code
         FROM consent_purposes
         WHERE version = $1
           AND purpose_code = ANY($2::varchar[])`,
      [noticeVersion, requestedPurposes],
    );

    if (purposeResult.rows.length !== requestedPurposes.length) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Unknown consent purpose or invalid notice version",
      });
    }

    // Build consent payload
    const consentPayload = {
      userId,
      grantedPurposes,
      deniedPurposes,
      noticeVersion,
      clientFingerprint,
      recordedAt: new Date().toISOString(),
    };

    // Encrypt and sign payload
    const encryptionEnvelope = encryptPayload(consentPayload);
    const signature = signPayload(encryptionEnvelope);

    const consentToken = "ct_" + crypto.randomBytes(32).toString("hex");

    // Insert audit ledger record
    const insertResult = await client.query(
      `INSERT INTO consent_audit_ledger (
          tenant_id,
          user_id,
          consent_token,
          granted_purposes,
          denied_purposes,
          notice_version,
          encrypted_payload,
          payload_signature,
          client_fingerprint
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING event_id, timestamp`,
      [
        req.tenant.tenant_id,
        userId,
        consentToken,
        grantedPurposes,
        deniedPurposes,
        noticeVersion,
        JSON.stringify(encryptionEnvelope),
        signature,
        JSON.stringify(clientFingerprint),
      ],
    );

    await client.query("COMMIT");

    res.status(201).json({
      status: "CONSENT_RECORDED",
      consentToken,
      eventId: insertResult.rows[0].event_id,
      timestamp: insertResult.rows[0].timestamp,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Consent grant error:", error.message);

    res.status(500).json({
      error: "Unable to record consent",
    });
  } finally {
    if (client) client.release();
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`DPDP Gateway running on port ${PORT}`);
});
