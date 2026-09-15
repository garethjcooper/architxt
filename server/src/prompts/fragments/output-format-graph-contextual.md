### Graph generation rules

The `graph` envelope section holds nodes and edges. Populate it only when the graph section is active; otherwise leave it exactly as `{"name":"","nodes":[],"edges":[]}`.

**Exact title for this graph:** `{{ARCHITXT_GRAPH_NAME}}`. If empty, generate a short descriptive name (4–6 words) based on the content; otherwise use the exact title shown above with no changes.

The `graph` object must contain:
- `name`: a short human-readable identifier for the graph (used as its title/label when rendered). **This MUST be the exact title provided via `#graph-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the graph's content.
- `nodes`: array of node objects.
- `edges`: array of edge objects.

Node field rules:
- `id`: stable working-graph id. Reuse the exact id from the topic or catalog. For genuinely new candidates not in the topic/catalog, use a lowercase hyphenated slug with no prefix.
- `name`: human-readable name only; must not include the id.
- `type`: omit for nodes that are already known to the graph. Only include it for genuinely new discovered candidates, and only when the source material explicitly introduces a classification for them.

Edge field rules:
- `from` / `to`: source and target node ids. Every endpoint id must also appear in `nodes`. Use the exact ids provided in the topic; do not invent new ids for endpoints that were already supplied.
- `type`: one of `calls`, `sends`, `reads`, `writes`, `depends-on`.
- `label`: short phrase, max 4 words.
- `detail`: readable description of the flow, 2–4 complete sentences when the source material supports it. Write the `detail` so a reader can understand the flow without looking at `properties`:
  1. Sentence 1: what moves between the endpoints (data object, event, file, API call).
  2. Sentence 2: direction and mechanism (e.g., calls over HTTPS REST, writes to a shared database, drops files on SFTP).
  3. Sentence 3: cadence or trigger (e.g., real-time, nightly batch, on-demand, on startup, on error).
  4. Sentence 4: any important qualification: reliability, auth, encryption, intermediaries, or error handling.
  Omit a sentence if the source material does not support it. Do not repeat the `label` or restate the endpoint names. The `properties` object is for machine-curatable facts and does not replace this human-readable description. Empty string if not justified.
- `properties`: optional object with flat, machine-curatable fields. Omit entirely when none are supported by the source material. All values are optional:
  - `dataObjects`: array of atomic bounded data units (file spec, customer data, event type, document type, record set).
  - `protocol`: transfer mechanism (e.g., HTTPS, gRPC, SFTP, Kafka, RabbitMQ, file drop, shared database, in-process call).
  - `format`: data format / API style (e.g., JSON, XML, CSV, Avro, Parquet, FIX, protobuf, binary, REST, SOAP).
  - `frequency`: cadence (e.g., real-time, on-demand, hourly, nightly, weekly, ad-hoc, on startup).
  - `intermediaries`: array of gateways, queues, ESBs, proxies, object stores, load balancers. Use the exact entity id from the catalog when a known intermediary is named; use a lowercase hyphenated slug only for genuinely unnamed or inferred intermediaries.
  - `reliability`: retry, acknowledgement, idempotency, ordering, duplicate-handling, or delivery-semantics behavior.
  - `auth`: authentication / authorization mechanism (e.g., OAuth 2.0, mTLS, API key, mutual Kerberos, JWT, IP allowlist).
  - `encryption`: encryption in transit/rest, signing, or hashing (e.g., TLS 1.3, AES-256-GCM at rest, GPG signed).
- `evidence`: array of Hindsight memory IDs. Every emitted edge must include `evidence`; do not return edges that are not backed by at least one memory ID. Evidence IDs must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs. If the source material does not support an interaction with a specific memory, omit the edge rather than returning an empty `evidence` array.
- Do not include a `provenance` field on edges. The system derives edge provenance from the endpoint ids.
- Multiple edges per node pair are allowed when the interactions differ by direction, type, or context. Do not collapse distinct interactions into a single combined edge.

Example edge:

```json
{ "from": "example-type:EXAMPLE-001", "to": "example-type:EXAMPLE-002", "type": "sends", "label": "usage data", "detail": "Example System A sends usage data to Example System B every night. The batch file is pushed through an internal SFTP gateway and contains billable usage events.", "properties": { "dataObjects": ["billable usage events"], "protocol": "SFTP", "format": "CSV", "frequency": "nightly", "intermediaries": ["internal-sftp-gateway"], "reliability": "retries up to 3 times with exponential backoff" }, "evidence": ["mem-abc123"] }
```

Connected-node rule:
Every node in the `nodes` array must be an endpoint of at least one emitted edge (as `from` or `to`). Do not return a graph that has nodes but zero edges. Before returning the graph, remove any isolated node. If this leaves no edges, return an empty graph instead: `{"nodes":[],"edges":[]}`. If no graph is justified, return an empty graph object.
