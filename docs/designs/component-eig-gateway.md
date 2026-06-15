# Component Design: Enterprise Integration Gateway

## Overview

The Enterprise Integration Gateway serves as the central communication hub for the architxt platform, facilitating secure, monitored, and resilient data exchange between internal application components and external systems. It abstracts protocol complexity, enforces security policies, and provides a unified audit trail for all cross-boundary traffic.

## Scope

This document details the design of a middleware-style integration layer. It defines the message routing, transformation, and security enforcement mechanisms required to connect the architxt document processing pipeline with external enterprise systems. It does not cover the specific business logic of the consuming applications, nor the internal implementation details of the external systems themselves.

---

## Business Capability Mapping

| Component | Business Capability |
|---|---|
| Enterprise Integration Gateway | Standardized enterprise system interoperability |
| Message Router | Reliable asynchronous message routing and delivery |
| Transform Engine | Data format transformation and validation |
| Auth Adapter | Unified identity and access management |

---

## Architecture

The Enterprise Integration Gateway is not a monolithic application, but a logical boundary encapsulating a set of interacting services and adapters. It acts as a reverse proxy and broker for all north-south traffic.

### Component Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                    Enterprise Integration Gateway              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌─────────────────────┐      ┌─────────────────────┐       │
│   │   Message Router    │<────>│   Transform Engine  │       │
│   │ (Queue Manager)     │      │ (JSON/XML/Markdown)│       │
│   └──────────┬──────────┘      └─────────────────────┘       │
│              │                                               │
│              ▼                                               │
│   ┌─────────────────────┐                                    │
│   │   Adapters Layer    │                                    │
│   │  ┌───┐ ┌───┐ ┌───┐ │                                    │
│   │  │   │ │   │ │   │ │                                    │
│   │  │ERP│ │Pay│ │Auth│ │                                    │
│   │  └───┘ └───┘ └───┘ │                                    │
│   └──────────┬──────────┘                                    │
│              │                                               │
│              ▼                                               │
│   ┌─────────────────────┐                                    │
│   │   Security Layer    │                                    │
│   │   (Token Vault)     │                                    │
│   └─────────────────────┘                                    │
└───────────────────────────────────────────────────────────────┘
              │
   ┌──────────┴──────────┬──────────┐
   ▼                     ▼          ▼
┌────────┐      ┌──────────┐ ┌──────────┐
│Legacy  │      │External  │ │External  │
│ERP     │      │Payment   │ │Identity  │
│        │      │Provider  │ │Provider  │
└────────┘      └──────────┘ └──────────┘
```

---

## Inbound Flow: Receiving External Data

### Step 1: Authentication (Security Layer)

All inbound requests are intercepted by the Security Layer. It validates the bearer token against the corporate OAuth2 provider.

1. **Token Introspection**: Post to the identity provider's introspection endpoint.
2. **Scope Validation**: Ensures the token contains the required `architxt:ingest` scope.
3. **Identity Propagation**: Extracts the subject claim and maps it to an internal principal ID. This ID is stamped onto the message metadata for the entire journey.

### Step 2: Protocol Adaptation (Adapters)

The request enters the adapter corresponding to the external system:
- **ERP Adapter**: Handles SAP IDoc or OData payloads. Decomposes a single Invoice Packet into multiple smaller architxt-compatible Document Fragments.
- **Payment Adapter**: Handles payment gateway webhooks. Transforms JSON event payloads into architxt markdown events.
- **Auth Adapter**: Handles SAML assertions or userinfo endpoints. Primarily used for authentication flow, but can ingest User Access Reports as documents.

### Step 3: Transformation (Transform Engine)

The raw payload is passed to the Transform Engine.

| Source Format | Target Format | Logic |
|---|---|---|
| SAP IDoc | Markdown Tables | Flattens hierarchical segments into markdown tables. Preserves message number as heading anchor. |
| JSON Webhook | Frontmatter YAML | Converts flat JSON into YAML frontmatter. Body of webhook becomes markdown text. |
| XML SAML Assertion | Key-Value List | Extracts attribute nodes into bulleted key-value list for audit logging. |

### Step 4: Enrichment and Routing (Message Router)

The Message Router enriches the message with routing metadata:
- **Target queue**: Determined by document type (e.g., queue for invoices)
- **Priority**: Calculated from SLA rules (e.g., Payment Disputes = High)
- **Correlation ID**: UUID generated for distributed tracing

Finally, it publishes the message to the internal message bus.

### Step 5: Consumption (Internal Services)

An internal service (e.g., the Ingestion Controller of the Document Processing Service) polls its assigned queue, picks up the message, and treats it exactly like a user-uploaded document.

---

## Outbound Flow: Sending Data to External Systems

### Step 1: Trigger

An internal process (e.g., the Hindsight Push Daemon) generates an event to push a document to an external server.

### Step 2: Packaging (Transform Engine)

The Transform Engine packages the internal document representation into the external system's expected format.

| Internal Format | External Format | Logic |
|---|---|---|
| Markdown + Entities | JSON | Converts entity tags into compatible label arrays. Strips markdown for plain text content field. |
| SQLite Row (Audit Log) | CSV | Exports a window of audit records to flattened CSV for external SIEM ingestion. |
| Document Status Change | Webhook Payload | Constructs minimal JSON payload with document ID, old status, and new status. |

### Step 3: Dispatch (Message Router)

The Message Router handles dispatch:
- **Retries**: Implements exponential backoff (1s, 2s, 4s, 8s, 16s).
- **Dead Letter Queue**: After 5 failures, the message is moved to a dead letter queue for manual inspection.
- **Circuit Breaker**: If an external endpoint returns server errors repeatedly, the circuit opens. Subsequent requests are rejected until a health check succeeds.

### Step 4: Delivery (Adapters)

The appropriate adapter handles the physical delivery:
- **Hindsight Adapter**: Authenticates with API key, sends POST to retain endpoint.
- **SIEM Adapter**: Authenticates with mutual TLS, streams CSV over persistent TCP socket.
- **Slack Adapter**: Sends formatted message to a webhook URL.

---

## Data Model

### Message Queues

```sql
-- message_queues: internal routing topology
CREATE TABLE message_queues (
  q_id INTEGER PRIMARY KEY,
  q_name TEXT NOT NULL UNIQUE,
  q_type TEXT CHECK(q_type IN ('inbound','outbound','dlq')),
  q_target_adapter TEXT,
  q_sla_seconds INTEGER DEFAULT 300
);

-- queue_messages: individual messages
CREATE TABLE queue_messages (
  msg_id INTEGER PRIMARY KEY,
  msg_q_id INTEGER REFERENCES message_queues(q_id),
  msg_correlation_id TEXT NOT NULL,
  msg_principal_id TEXT NOT NULL,
  msg_payload TEXT NOT NULL,
  msg_status TEXT CHECK(msg_status IN (
    'pending','processing','retrying','delivered','failed','dead_lettered'
  )),
  msg_attempt_count INTEGER DEFAULT 0,
  msg_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  msg_delivered_at DATETIME
);

-- dlq_audit: dead letter inspection log
CREATE TABLE dlq_audit (
  dlq_id INTEGER PRIMARY KEY,
  dlq_msg_id INTEGER REFERENCES queue_messages(msg_id),
  dlq_reason TEXT NOT NULL,
  dlq_final_error TEXT,
  dlq_inspected_by TEXT,
  dlq_resolved_at DATETIME
);
```

---

## Configuration

```bash
# --- Message Router ---
EIG_MSG_MAX_RETRIES=5
EIG_MSG_BACKOFF_BASE_MS=1000
EIG_MSG_CIRCUIT_BREAKER_THRESHOLD=5
EIG_MSG_CIRCUIT_BREAKER_TIMEOUT_MS=60000

# --- Transform Engine ---
EIG_XFR_MAX_PAYLOAD_SIZE=5242880
EIG_XFR_ENABLE_XML_VALIDATION=true
EIG_XFR_MARKDOWN_ESCAPE_CHARS=true

# --- Adapter: Hindsight ---
AD_HINDSIGHT_BASE_URL=http://localhost:8080
AD_HINDSIGHT_TIMEOUT_MS=10000
AD_HINDSIGHT_RETRYABLE_STATUS_CODES=502,503,504

# --- Adapter: ERP ---
AD_ERP_BASE_URL=https://sap.internal.company.com
AD_ERP_CLIENT_ID=architxt-integration
AD_ERP_CLIENT_SECRET=

# --- Adapter: Payment ---
AD_PAY_WEBHOOK_SECRET=whsec_...

# --- Security Layer ---
EIG_SEC_TOKEN_INTROSPECTION_URL=http://auth.internal/oauth2/introspect
EIG_SEC_REQUIRED_SCOPE=architxt:ingest
EIG_SEC_PRINCIPAL_CLAIM=sub
```

---

## Interfaces

### Message Router to Transform Engine

```javascript
// transform(payload, rulesetId): Promise<TransformedPayload>
const transformed = await transformEngine.transform(
  rawPayload,
  'sap_idoc_to_markdown_v2'
);

// validate(transformedPayload, schemaId): Promise<ValidationResult>
const validation = await transformEngine.validate(
  transformed,
  'architxt_document_schema'
);
```

### Adapters to External Systems

**ERP Adapter (Outbound)**
```javascript
// sendIdoc(idocPayload): Promise<{messageId, status}>
const result = await erpAdapter.sendIdoc({
  header: {...},
  items: [...]
});
```

**Hindsight Adapter (Outbound)**
```javascript
// pushDocument(docId, serverId, bankId): Promise<{operation_id, status}>
const result = await hindsightAdapter.pushDocument(123, 1, 'default');
```

**Auth Adapter (Inbound/Security)**
```javascript
// introspect(token): Promise<{active, sub, scope, exp}>
const auth = await authAdapter.introspect('Bearer eyJhbG...');
```

---

## Error Handling

| Scenario | Initial Action | Retry / Circuit Breaker | Final State |
|---|---|---|---|
| External server error | Increment attempt count, log | Exponential backoff. If above threshold, trip breaker. | retrying → failed → dead_lettered |
| External client error | Log, do not increment attempt count | No retry. Invalid request. | failed (immediate) |
| Token expired | Request refresh from Auth Adapter | Retry once with refreshed token. | retrying |
| Transform failure | Catch exception, wrap in error | No retry. Bad data. | failed (immediate) |
| Database lock timeout | Sleep 50ms, re-read queue | Retry up to 3 times. | pending → processing |
| Payload too large | Reject at ingress, return 413 | N/A | N/A |

---

## Security Considerations

1. **Zero Trust**: Every request, even internal, is authenticated. Principal IDs propagate through the entire stack.
2. **Secret Rotation**: Adapter credentials are stored in an encrypted vault, not in environment files. The vault is accessed at runtime.
3. **Input Sanitization**: XML payloads are validated against schemas to prevent attacks. Markdown payloads are escaped to prevent XSS in downstream UI rendering.
4. **Rate Limiting**: Inbound requests are rate-limited per principal: 100 requests/minute for standard users, 1000 requests/minute for service accounts.
5. **Audit Trail**: Every message entering or leaving the gateway is logged with correlation ID, principal ID, and full payload hash.

---

## Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Inbound Latency (Auth+Route) | Under 200ms | P95, excluding external system latency |
| Transform Throughput | 500 msg/sec | Single-node, SQLite backend |
| Outbound Retry Success | Over 95% | Within 3 retries |
| DLQ Population Rate | Under 0.1% | Of total message volume |
| Token Introspection Cache | 60s TTL | Reduces round-trips to identity provider |

---

## Known Limitations

1. **Protocol Support**: Currently only HTTP/REST and gRPC (experimental) are supported. SMB, FTP, or AS2 protocols are not yet implemented.
2. **Eventual Consistency**: The SQLite-backed message queue provides atomicity but not true horizontal scalability. For over 1000 msg/sec, a migration to PostgreSQL with RabbitMQ is required.
3. **Schema Rigidity**: The Transform Engine relies on predefined rulesets. Adding a new external system requires a new ruleset deployment, which is a code change, not a runtime configuration.
4. **OAuth2 Only**: The security layer assumes OAuth2/OIDC. SAML2 or Kerberos integrations are not yet supported.

---

## Deployment Model

The gateway is deployed as a set of sidecar processes alongside the main architxt backend:
- Message Router runs as a forked daemon.
- Adapters are loaded dynamically from the adapters directory at startup.
- The Message Router exposes a health endpoint for load balancer checks.

---

*Document ID: CD-EIGATE-2024-001*

*Component: Enterprise Integration Gateway*

*Services: Message Router, Transform Engine, Audit Logger*

*Capabilities: Standardized enterprise system interoperability, Reliable asynchronous message routing and delivery, Data format transformation and validation, Unified identity and access management*

*Author: System Architect*

*Date: 2024-03-20*
