# architxt: Temporal Mosaic Knowledge Model

## Design Concept

This document captures the foundational design concepts for the architxt knowledge architecture, describing how the system models temporal knowledge, processes documents, layers information through mental models, and extracts entities for recall and reasoning.

---

## Table of Contents

- [Core Insight](#core-insight)
- [Key Design Decisions](#key-design-decisions)
- [Documents](#documents)
- [Non-Design Support Data](#non-design-support-data)
- [Mental Models](#mental-models)
- [Entity Modelling](#entity-modelling)

---

## Core Insight

### The Problem

Solution designs describe current → target → change delta, but by delivery, reality drifts. Organizations work this way — scope cuts, pivots, "phase 2" that never comes. Traditional EA tools either ignore time (static models) or force alignment (designed vs delivered reconciliation).

### The Insight

Don't track "promised dates" or "designed vs delivered" streams. Track **knowledge freshness** — the latest document that touched each entity, regardless of document age. A 2020 design for Module A is still valid if Module A hasn't changed, even if the rest of the system was redesigned 5 times since.

### The Temporal Mosaic

The "best known state" isn't a single document. It's a **composite**: the latest design for each scope. Module A from 2020, Module B from 2024 — both coexist in the current view.

---

## Key Design Decisions

### 1. Knowledge Freshness ≠ Document Freshness

- Store only: which document(s) mention this entity, and when
- Don't rank by date — entity might be unchanged for 10 years
- 2015 knowledge is "fresh" if nothing has contradicted it

### 2. Lazy Seam Detection

Don't pre-compute "all seams between all components" — that's n³ madness.

The Pattern:
1. User queries: "Current state of Order Processing?"
2. architxt gathers: relevant entities across all documents
3. LLM reads documents, spots coherence issues at seam boundaries
4. Surface: *"Component A (2015) expects SOAP from Component B (2024) which expects REST. These interfaces were never reconciled."*

Seams are **emergent**, not pre-computable.

### 3. Affirmative Reconfirmations

| Event Type | Meaning | Example |
|---|---|---|
| New Description | First mention or explicit change | "Billing Engine now uses API v3" |
| Reconfirmed Unchanged | Explicitly stated as still valid | "Customer DB: unchanged from SD-2020-017" |
| Implicit (no mention) | Status unknown | Not in any recent document |

**Critical:** Reconfirmations require referencing what they're confirming. Without that, the "unchanged" assertion is meaningless.

### 4. Document Scope ≠ Entity Scope

- A document can touch multiple modules/components in one system
- Same-day documents can affect different modules
- Store **per-touch records**, not just "last touched by doc X"

```
entity_document_touches table
entity_id, doc_id, touch_date, scope_annotation
'SYS-Billing', 'SD-2024-003-A', '2024-03-15', 'Module 1 only'
'SYS-Billing', 'SD-2024-003-B', '2024-03-15', 'Module 2 only'
```

---

## Documents

### Hindsight Data Abstraction

```
Raw markdown (from document)
  → Memories (Verbose)
    → Observations (Consolidated)
      → Mental Models
```

Document input should, ideally, come from **minus-1/−2 of target layer**:
- For solution design level: impact assessments, component designs are preferable (−1)
- For enterprise solution design level: solution designs and component designs are preferable (−1, −2)

### Document Metadata

Each document has consistent metadata (submitted during `retain`, not as front matter):

| Field | Description |
|---|---|
| **Context** | Always set; taken from a curated, consistent list |
| **Document Id** | Consistent ID for the document. Same document versions reuse the same ID |
| **Document Date** | The publish date of the document (ISO 8601: `2025-06-01T10:32:00Z`) |
| **Tags** | Used for filtering; include consistent tags such as `PROJECT_NAME`, `DOMAIN`, `SYSTEM`, `DATA_AREA` |
| **Metadata (presented to fact extraction LLM)** | Key/value list: source, source-location, author |

- **source**: Where the original document came from (Confluence, SharePoint, storage, email)
- **source-location**: URL or file path including full filename
- **author**: Extracted authors

### Document Format

Documents should be translated to clean markdown:

- Remove non-ASCII characters (`>0x7F`)
- Clean up PDF artifacting (intermittent spaces, etc.)
- Remove odd spacing and unnecessary line breaks
- Strip noise, boilerplate, TOC, headers, footers, page numbers — manual review preferred
- Images translated into textual descriptions; remove descriptions that don't add content quality

### Document Images

Document images (diagrams, logos, screenshots) contain varied data noise. Since images aren't ingested as-is, information should be extracted and inserted inline with the markdown.

#### Image Handling Prompt

Classify each extracted image:

**1. Architecture/Flow Diagrams**
→ Extract as Systems Inventory + Connection Mappings tables:

```
[image: Diagram Name]

**Systems Inventory:**

| System Name | Type | Description |
|-------------|------|-------------|
| {name} | system/database/service/external/process | {what it does} |

**Connection Mappings:**

| From | To | Flow | Direction |
|------|-----|------|-----------|
| {system} | {system} | {description of data/action} | -> / <- / <-> / - |

[/image]
```

Directionality:
- `->` : One-way flow (A sends to B)
- `<-` : One-way flow (B receives from A)
- `<->` : Bidirectional
- `-` : No direction/no flow shown

**2. Data Tables** (screenshots of tables/spreadsheets)
→ Extract directly to markdown tables

**3. Icons/Logos/Screenshots/Photos**
→ Mark as `[image: description]` but do not extract tabular content

**Anti-pattern:** Never write "Unable to extract" or placeholder text. If text/systems/connections are visible, extract them as tables.

---

## Non-Design Support Data

Equivalent to **reference data** — domain-specific or abstracted business concepts. The most useful initial list is the definition of **business capabilities**.

This data is more useful when separated into individual documents rather than importing a long list. Break into individual capability documents and group with a tag such as `BUS-CAP`. Then use a mental model to abstract the whole concept.

---

## Mental Models

Mental models are key to layering information in a usable way. They are effectively **pinned reflect operations** and are refreshable as data changes.

Mental models can reference other mental models (or exclude them if needed to contextualise correctly).

### Suggested Basic Mental Model Structure

| Model | Description | Notes |
|---|---|---|
| **Business Capabilities** | "List all business capabilities including short descriptions and IDs" | Expand the description/ID prompt until the right level of detail appears. Restrict to a tag (e.g. `BUS-CAP`) and exclude other mental models to keep focus tight |
| **System Capabilities** | "What are the capabilities for the {System Name}. Also known as {aliases}. For each main system capability derive a matching business capability from the business capabilities data and display it under the system capability heading. If no business capabilities match, note this." | Business capabilities are referenced implicitly by tag name |
| **System Integrations** | "What are the integration points (API, file, etc.) for {System Name}. Also known as {aliases}." | All mental models considered; counter-data in other component documents may provide a more complete picture |

### Notes

- Definitions of "system capabilities" and "capabilities" are currently vague — need refinement for deterministic, higher-quality outcomes
- No directive for formatting/scope — should be decided early for consistency
- When generating items like Business Capabilities, restricting to specific tag(s) and excluding other mental models keeps the focus tight and prevents context leak
- For System Capabilities and Integrations, tags are not referenced and all mental models are considered to allow counter-data from other documents to surface

### Suggested Additional Mental Models

- Overlapping System Capabilities
- Domain points of view (use system tags for all documents, or create a domain tag and restrict)
- End-to-end process points of view (sliced by business capabilities, including all systems and where they touch the business capability)
- Impact assessments (discover and generate a custom list of systems to investigate)
- Document input (mental model output usable for diagramming or descriptive text in solution designs/impact assessments)

---

## Entity Modelling

By default, entity extraction is done automatically, but can be switched off to ensure only specified entity values are extracted.

Defining entity values ensures the same item text is extracted with the same entity every time, which *should* make recall cleaner. With the noise in so many documents (incorrect naming, misspellings, aliases, omissions), it is difficult to provide a list of values that will be picked up consistently.

### Document Tagging Schema

One approach is to pre-tag markdown documents with entity knowledge using a **non-changing key**. This typically requires human review and a tagging tool.

Using the tagging process, ensure the final markdown conforms to:

```markdown
Some text talking about system a (SYS-001) and then connects to system b (SYS-002).

The interface intv1 (SVC-001) is used by system a (SYS-001).

## Some solution design section (CAP-001)

## Some other solution design section (CAP-001, CAP002)
```

It is **NOT recommended** to use capability ID tagging for capabilities, since the memory bank has better overall context to derive this than a single document (see mental models).

### Entity Labels

| Key | Value Example | Description | Type | Tag |
|---|---|---|---|---|
| A-C | SYS-001, SYS-002... | Application components | Multi-values | true |
| A-S | SVC-001, SVC-002... | Application services | Multi-values | true |
| B-C | CAP-001, CAP-002... | Business capabilities | Multi-values | true |

**Notes:**
- Tags allow hard filtering on recall/reflect
- Entities are included in both sparse and dense vectors, so they increase similarity and entity-link density
- If you don't want entries to affect semantics or tags, add them as metadata instead

---

*Copyright 2025 Gareth Cooper*
