
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenant configuration
CREATE TABLE tenants (
    tenant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_public_key VARCHAR(100) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    brand_logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#0052CC',
    text_color VARCHAR(7) DEFAULT '#172B4D',
    font_family VARCHAR(100) DEFAULT 'Inter, sans-serif',
    kms_wrapped_kek TEXT NOT NULL,
    webhook_url TEXT,
    webhook_secret VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Consent purposes and localized notices
CREATE TABLE consent_purposes (
    purpose_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    purpose_code VARCHAR(50) NOT NULL,
    is_mandatory BOOLEAN DEFAULT true,
    version VARCHAR(20) NOT NULL,
    localized_notices JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, purpose_code, version)
);

-- 3. Consent audit ledger
CREATE TABLE consent_audit_ledger (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    user_id VARCHAR(100) NOT NULL,
    consent_token TEXT NOT NULL,
    granted_purposes VARCHAR(50)[] NOT NULL,
    denied_purposes VARCHAR(50)[] NOT NULL,
    notice_version VARCHAR(20) NOT NULL,
    encrypted_payload TEXT NOT NULL,
    payload_signature VARCHAR(256) NOT NULL,
    client_fingerprint JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Enable Row-Level Security
ALTER TABLE consent_audit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_purposes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ledger_policy
ON consent_audit_ledger
USING (
    tenant_id = NULLIF(
        current_setting('app.current_tenant_id', true), ''
    )::uuid
);

CREATE POLICY tenant_isolation_purposes_policy
ON consent_purposes
USING (
    tenant_id = NULLIF(
        current_setting('app.current_tenant_id', true), ''
    )::uuid
);

-- 5. Indexes
CREATE INDEX idx_purposes_lookup
ON consent_purposes(tenant_id, purpose_code);

CREATE INDEX idx_ledger_audit
ON consent_audit_ledger(tenant_id, user_id);

-- 6. Sample tenant
INSERT INTO tenants (
    tenant_id,
    api_public_key,
    company_name,
    kms_wrapped_kek,
    webhook_url,
    webhook_secret
)
VALUES (
    '99999999-9999-9999-9999-999999999999',
    'pk_live_partner_abc123xyz',
    'Enterprise Partner Corp India',
    '707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f',
    'https://partner.com',
    'webhook_secret_signing_key_abc'
);

-- 7. Sample multilingual consent notice
INSERT INTO consent_purposes (
    tenant_id,
    purpose_code,
    is_mandatory,
    version,
    localized_notices
)
VALUES (
    '99999999-9999-9999-9999-999999999999',
    'PRP_CORE_ONBOARDING',
    true,
    'v2.1',
    '{
        "en": {
            "language_name": "English",
            "notice_text": "I authorize processing of identity metrics for validation."
        },
        "hi": {
            "language_name": "Hindi",
            "notice_text": "मैं सत्यापन के लिए पहचान संबंधी जानकारी के प्रसंस्करण को अधिकृत करता हूँ।"
        },
        "kn": {
            "language_name": "Kannada",
            "notice_text": "ಪರಿಶೀಲನೆಗಾಗಿ ಗುರುತಿನ ಮಾಹಿತಿಯನ್ನು ಸಂಸ್ಕರಿಸಲು ನಾನು ಅನುಮತಿ ನೀಡುತ್ತೇನೆ."
        }
    }'::jsonb
);
