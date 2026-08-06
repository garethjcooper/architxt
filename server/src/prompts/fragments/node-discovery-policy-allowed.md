### Node discovery policy — discovery allowed

For every persistent architectural element mentioned in the source material, make an explicit choice:

1. If it is listed in the entity catalog above, use its canonical entity id from the catalog.
2. If it is **not** listed in the entity catalog above, emit it as a discovered node with a bare lowercase hyphenated slug id.

Only emit a discovered node when all of the following are true:

- The candidate is a persistent named architectural element (system, service, database, broker, external actor, etc.).
- It is not a file, message, record, field, processing step, job, report, dashboard, or generic temporary object.
- You are confident the candidate should be a node.
- Its id does not collide with an id already in the entity catalog above.

When a discovered element interacts with a known entity, use the known entity's canonical id from the entity catalog above as the edge endpoint. Do **not** invent a new discovered alias for a known entity.

If in doubt, do not create the node; describe the relationship in edge detail or narrative instead.
