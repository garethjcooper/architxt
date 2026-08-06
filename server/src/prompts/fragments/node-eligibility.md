### Node eligibility

A node is a named, persistent architectural element with a distinct responsibility that other parts of the architecture reference.

Include as nodes:
- Applications, systems, software platforms.
- Services, APIs, integration points.
- Components or modules that represent a deployable unit or a clear architectural boundary.
- Databases, data stores, persistent repositories.
- Message brokers, queues, event buses.
- External actors: users, roles, organizations, third-party systems.

Exclude as nodes:
- Files, documents, messages, events, streams, records.
- Data fields, attributes, tables, schemas, records.
- Atomic processing steps: translation, transformation, validation, pricing, rating, aggregation.
- Jobs, scripts, routines, batches.
- UI pages, reports, dashboards, controls.
- Generic or unnamed temporary objects.

Special handling:
- Collapse an entire processing chain into a single node unless a stage is itself a known/deployed system.
- Emit edges directly between systems for data carriers; do not create a node for the file, message, table, or stream.
- Auto-collapse function-named components (for example, "Invoice Server", "PDF Generator") into the parent system unless the catalog explicitly marks them as a system.
- Keep external/boundary sources as discovered nodes only if explicitly named and persistent; generic references become edge detail.
