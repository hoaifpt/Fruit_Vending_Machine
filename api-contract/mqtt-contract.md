# Fruit Vending Machine — MQTT Contract (machine → backend)

Contract version: **schemaVersion 1** (issue #43). Audience: firmware / edge team and backend handler authors.
Examples use fake machine codes (`FV-HCM-001`, `FV-DEV-001`) and contain no real credentials.

MQTT carries **telemetry, status and events only**. Dispensing goes Backend → Kiosk → Serial/USB → ESP32 and is
**not** an MQTT topic; there is no command, dispense, payment or order topic, and the backend does not publish to machine topics.

## 1. Topics

| Topic | Direction | Content | Processed by |
| --- | --- | --- | --- |
| `vending/{machineCode}/telemetry` | machine → backend | temperature / humidity | telemetry issue (#18) |
| `vending/{machineCode}/status` | machine → backend | ONLINE / OFFLINE, firmware info | telemetry issue (#18) |
| `vending/{machineCode}/events` | machine → backend | door, fault, firmware events | event logging issue (#22) |

The backend subscribes to `vending/+/telemetry`, `vending/+/status` and `vending/+/events`.

**Topic identifier decision: machine code, not machine UUID.** The code is unique and immutable after registration,
human-readable for firmware configuration and broker ACLs, and the backend resolves code → machine.

Topic rules (anything else is dropped):

- exactly 3 levels; level 1 is `vending` (backend setting `app.mqtt.topic-root`);
- level 2 is the machine code: uppercase, matching `[A-Z0-9][A-Z0-9._-]{0,63}` (machines whose code falls outside this
  pattern cannot use MQTT);
- level 3 is one of `telemetry`, `status`, `events` (lowercase, exact).

## 2. Envelope

Every message is one UTF-8 JSON object, at most **8192 bytes** (backend setting `app.mqtt.max-payload-bytes`):

```json
{
  "schemaVersion": 1,
  "messageId": "b7c1d3e0-4c1a-4d55-9e1f-0a9c3f2a1b77",
  "machineCode": "FV-HCM-001",
  "sentAt": "2026-10-20T00:05:00Z",
  "payload": { }
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | yes | JSON integer; supported: `1` |
| `messageId` | yes | 1–64 visible ASCII characters (no spaces), unique per machine; a UUID is recommended. Reused on retries of the same message |
| `machineCode` | yes | must equal the topic machine code exactly |
| `sentAt` | no | ISO-8601 instant (`2026-10-20T00:05:00Z`; an offset such as `+07:00` is accepted). Omit it, or send `null`, when the device has no reliable clock. A present but malformed value rejects the message |
| `payload` | yes | JSON object; schema depends on the channel (section 3) |

Unknown extra envelope fields are ignored (forward compatibility). Duplicate JSON keys and trailing data are rejected.
The backend records its own `receivedAt` from the server clock; `sentAt` is informational only and is never used for ordering or freshness.

## 3. Payloads

The backend MQTT layer validates only the envelope and that `payload` is an object. Field-level validation is done by the
channel handlers (later issues) and may reject messages that do not follow these schemas.

### 3.1 telemetry

```json
{ "temperature": 4.7, "humidity": 68.2 }
```

`temperature` in °C (number), `humidity` in %RH (number). Recommended interval: every 60 s.

### 3.2 status

```json
{ "state": "ONLINE", "firmwareVersion": "1.0.3", "uptimeSeconds": 3600 }
```

`state` ∈ {`ONLINE`, `OFFLINE`}. Publish `ONLINE` on every (re)connect and configure the Last Will (section 4) as `OFFLINE`.

### 3.3 events

```json
{ "eventType": "DOOR_OPENED", "details": { } }
```

`eventType`: non-blank, at most 64 characters, extensible vocabulary (stored later in `machine_events.event_type`), for
example `DOOR_OPENED`, `DOOR_CLOSED`, `FAULT`, `FIRMWARE_UPDATED`. `details`: JSON object.

## 4. QoS, retain and Last Will

- Publish with **QoS 1** (at-least-once). Duplicates are possible: keep the same `messageId` when a message is re-sent;
  handlers deduplicate by `messageId`.
- Do **not** set the retain flag on telemetry or events. Retained status is not needed (the backend keeps a persistent session).
- Last Will: topic `vending/{machineCode}/status`, QoS 1, retain false, payload a full envelope whose `payload` is
  `{"state":"OFFLINE"}` (a fixed `messageId` such as `lwt-<boot counter>` is acceptable; `sentAt` omitted).
- Keep-alive 30–60 s is recommended; MQTT protocol 3.1.1 (compatible with ESP32 PubSubClient).

## 5. Broker authentication and ACL

The backend cannot verify a publisher from the message itself: **the broker is the trust boundary**.

- Each machine has its own broker account: username = machine code, password = per-machine secret (never shared, never in Git).
- ACL:
  - machine `FV-HCM-001` may publish **only** `vending/FV-HCM-001/telemetry|status|events`;
  - the backend account may only subscribe to `vending/+/telemetry|status|events`;
  - anonymous clients are denied; anything not granted is denied.
- The topic machine code is trusted only because the ACL enforces it; the backend additionally drops messages whose envelope
  `machineCode` differs from the topic.
- Production: MQTT over TLS on port 8883 (`ssl://` broker URL, enforced by the backend in the prod profile), no anonymous access.
- Creating or rotating machine passwords is an operational step on the broker (`mosquitto_passwd`, see docs/mqtt-integration.md);
  there is no backend API for it.

## 6. Validation and rejection

Invalid messages are dropped (not persisted, not redelivered) and never stop later messages. The backend logs topic,
machine code, messageId and reason (never the payload or credentials), with repeated identical warnings rate-limited per machine.

| Reason | Cause |
| --- | --- |
| `INVALID_TOPIC` | not `vending/{MACHINE_CODE}/{channel}` |
| `UNKNOWN_CHANNEL` | level 3 not `telemetry`, `status` or `events` |
| `PAYLOAD_TOO_LARGE` | more than 8192 bytes |
| `INVALID_JSON` | not UTF-8, not JSON, not an object, duplicate keys or trailing data |
| `INVALID_ENVELOPE` | missing/invalid `schemaVersion`, `messageId`, `machineCode`, `sentAt` or `payload` |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` other than 1 |
| `MACHINE_CODE_MISMATCH` | envelope `machineCode` ≠ topic machine code |
| `UNKNOWN_MACHINE` | no machine with this code in the backend |

Messages of INACTIVE or MAINTENANCE machines are accepted (diagnostics); handlers decide their business meaning.

## 7. Versioning

- `schemaVersion` versions the envelope and the payload schemas together. Adding optional fields keeps version 1;
  removing or changing the meaning of a field requires version 2.
- The backend rejects versions it does not support; during a migration it will accept both versions before firmware switches.
- This document is versioned in Git together with the backend parser (`MachineMessageParser`); a documentation test keeps the
  constants consistent.

## 8. Example

```text
topic:   vending/FV-HCM-001/telemetry   (QoS 1, retain false)
message: {"schemaVersion":1,"messageId":"b7c1d3e0-4c1a-4d55-9e1f-0a9c3f2a1b77","machineCode":"FV-HCM-001",
          "sentAt":"2026-10-20T00:05:00Z","payload":{"temperature":4.7,"humidity":68.2}}
```
