/**
 * ArchiMate Open Exchange XML 3.0/3.1 export.
 *
 * Produces XML matching the Open Group ArchiMate Model Exchange File
 * Format so it can be imported by Archi and other ArchiMate-compatible
 * tools.
 *
 * Nodes are mapped to ArchiMate elements using
 * `entity_types.et_archimate_element`.  Edges are mapped to ArchiMate
 * relationships using `edge_types.edt_archimate_relationship`.
 *
 * Unmapped nodes become ArchiMate ApplicationComponent by default.
 * Unmapped edges become Association relationships by default.
 */

function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeIdGenerator(prefix) {
  // Fast, deterministic id generator.  ArchiMate only needs unique
  // id-... strings within the document; they do not have to be UUIDs.
  const seen = new Map();
  let next = 1;
  return (value) => {
    if (seen.has(value)) return seen.get(value);
    const id = `id-${prefix}-${String(next).padStart(8, '0')}`;
    seen.set(value, id);
    next += 1;
    return id;
  };
}

const ELEMENT_LAYER = {
  // Business layer
  BusinessActor: 'business',
  BusinessRole: 'business',
  BusinessCollaboration: 'business',
  BusinessInterface: 'business',
  BusinessProcess: 'business',
  BusinessFunction: 'business',
  BusinessInteraction: 'business',
  BusinessEvent: 'business',
  BusinessService: 'business',
  BusinessObject: 'business',
  Contract: 'business',
  Representation: 'business',
  Product: 'business',
  // Application layer
  ApplicationComponent: 'application',
  ApplicationCollaboration: 'application',
  ApplicationInterface: 'application',
  ApplicationFunction: 'application',
  ApplicationProcess: 'application',
  ApplicationInteraction: 'application',
  ApplicationEvent: 'application',
  ApplicationService: 'application',
  DataObject: 'application',
  // Technology layer
  Node: 'technology',
  Device: 'technology',
  SystemSoftware: 'technology',
  TechnologyCollaboration: 'technology',
  TechnologyInterface: 'technology',
  TechnologyFunction: 'technology',
  TechnologyProcess: 'technology',
  TechnologyInteraction: 'technology',
  TechnologyEvent: 'technology',
  TechnologyService: 'technology',
  Artifact: 'technology',
  Equipment: 'technology',
  Facility: 'technology',
  DistributionNetwork: 'technology',
  Material: 'technology',
  // Strategy layer
  Resource: 'strategy',
  Capability: 'strategy',
  ValueStream: 'strategy',
  CourseOfAction: 'strategy',
  // Motivation
  Stakeholder: 'motivation',
  Driver: 'motivation',
  Assessment: 'motivation',
  Goal: 'motivation',
  Outcome: 'motivation',
  Principle: 'motivation',
  Requirement: 'motivation',
  Constraint: 'motivation',
  Meaning: 'motivation',
  Value: 'motivation',
  // Implementation & Migration
  WorkPackage: 'implementation_migration',
  Deliverable: 'implementation_migration',
  Plateau: 'implementation_migration',
  Gap: 'implementation_migration',
};

const LAYER_LABEL = {
  business: 'Business',
  application: 'Application',
  technology: 'Technology',
  strategy: 'Strategy',
  motivation: 'Motivation',
  implementation_migration: 'Implementation & Migration',
};

/**
 * Convert a short relationship token into the short ArchiMate
 * relationship type name used by the Open Exchange Format
 * (e.g. "serving" -> "Serving").
 */
function toRelationshipType(relationship) {
  if (!relationship) return 'Association';
  const r = String(relationship).toLowerCase();
  const mapping = {
    association: 'Association',
    access: 'Access',
    aggregation: 'Aggregation',
    assignment: 'Assignment',
    composition: 'Composition',
    flow: 'Flow',
    influence: 'Influence',
    realization: 'Realization',
    serving: 'Serving',
    specialization: 'Specialization',
    triggering: 'Triggering',
    depends_on: 'Association',
    relates_to: 'Association',
  };
  if (mapping[r]) return mapping[r];
  if (/relationship$/i.test(r)) {
    return r.replace(/relationship$/, '').replace(/^[a-z]/, (c) => c.toUpperCase());
  }
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function nodeLabel(node) {
  return (
    node.properties?.name ||
    node.properties?.display_name ||
    node.properties?.label ||
    node.labels?.find((l) => l !== 'canonical' && l !== 'candidate') ||
    node.labels?.[0] ||
    node.id
  );
}

export function toArchimateXml(nodes, edges, meta, undirected, nodeMap, edgeMap) {
  const modelId = makeIdGenerator('model');
  const elementId = makeIdGenerator('element');
  const relationshipId = makeIdGenerator('rel');
  const viewNodeIdGen = makeIdGenerator('vnode');
  const viewConnIdGen = makeIdGenerator('vconn');

  const modelIdentifier = modelId(meta.bank_id || 'architxt-export');
  const modelName = escapeXml(meta.bank_id || 'Architecture export');

  const emittedElements = new Map();
  const elementLines = [];
  const organizationByLayer = new Map();

  for (const node of nodes) {
    const identifier = elementId(node.id);
    if (emittedElements.has(identifier)) continue;

    const mapping = nodeMap.get(node.id) || {};
    const elementType = mapping.archimateElement || 'ApplicationComponent';
    const layer = ELEMENT_LAYER[elementType] || 'application';

    const label = escapeXml(nodeLabel(node));
    const description = escapeXml(node.properties?.description || '');

    let elementXml = `    <element identifier="${identifier}" xsi:type="${elementType}">`;
    elementXml += `\n      <name xml:lang="en">${label}</name>`;
    if (description) {
      elementXml += `\n      <documentation>${description}</documentation>`;
    }
    elementXml += '\n    </element>';
    elementLines.push(elementXml);

    emittedElements.set(identifier, { layer, elementType, label });

    if (!organizationByLayer.has(layer)) {
      organizationByLayer.set(layer, []);
    }
    organizationByLayer.get(layer).push(identifier);
  }

  const usedRelIds = new Set();
  const relationshipLines = [];
  const relationshipIdentifiers = [];
  for (const edge of edges) {
    const mapping = edgeMap.get(edge.id) || {};
    const relType = toRelationshipType(mapping.archimateRelationship);

    const sourceIdentifier = elementId(edge.source_id);
    const targetIdentifier = elementId(edge.target_id);
    let relIdentifier = relationshipId(edge.id);

    let counter = 1;
    while (usedRelIds.has(relIdentifier)) {
      relIdentifier = relationshipId(`${edge.id}:${counter}`);
      counter += 1;
    }
    usedRelIds.add(relIdentifier);

    relationshipLines.push(
      `    <relationship identifier="${relIdentifier}" source="${sourceIdentifier}" target="${targetIdentifier}" xsi:type="${relType}"/>`
    );
    relationshipIdentifiers.push({ identifier: relIdentifier, source: sourceIdentifier, target: targetIdentifier });
  }

  const organizationLines = [];
  for (const [layer, identifiers] of organizationByLayer) {
    organizationLines.push(`    <item>`);
    organizationLines.push(`      <label xml:lang="en">${escapeXml(LAYER_LABEL[layer] || layer)}</label>`);
    for (const identifier of identifiers) {
      organizationLines.push(`      <item identifierRef="${identifier}"/>`);
    }
    organizationLines.push(`    </item>`);
  }

  const viewIdentifier = modelId(`${meta.bank_id || 'export'}-view`);

  const gridCols = Math.max(1, Math.ceil(Math.sqrt(emittedElements.size)));
  const nodeViewLines = [];
  const nodeIdentifierToViewNode = new Map();
  const elementList = Array.from(emittedElements.entries());
  for (let i = 0; i < elementList.length; i += 1) {
    const [identifier] = elementList[i];
    const x = 120 + (i % gridCols) * 160;
    const y = 120 + Math.floor(i / gridCols) * 100;
    const viewNodeId = viewNodeIdGen(`${i}:${identifier}`);
    nodeIdentifierToViewNode.set(identifier, viewNodeId);
    nodeViewLines.push(
      `        <node identifier="${viewNodeId}" elementRef="${identifier}" xsi:type="Element" x="${x}" y="${y}" w="120" h="55">`,
      `          <style>`,
      `            <fillColor r="181" g="255" b="255" a="100"/>`,
      `            <lineColor r="92" g="92" b="92" a="100"/>`,
      `            <font name="Segoe UI" size="9">`,
      `              <color r="0" g="0" b="0"/>`,
      `            </font>`,
      `          </style>`,
      `        </node>`
    );
  }

  const connectionLines = [];
  for (const rel of relationshipIdentifiers) {
    const sourceViewNode = nodeIdentifierToViewNode.get(rel.source);
    const targetViewNode = nodeIdentifierToViewNode.get(rel.target);
    if (!sourceViewNode || !targetViewNode) continue;
    connectionLines.push(
      `        <connection identifier="${viewConnIdGen(rel.identifier)}" relationshipRef="${rel.identifier}" xsi:type="Relationship" source="${sourceViewNode}" target="${targetViewNode}">`,
      `          <style>`,
      `            <lineColor r="0" g="0" b="0"/>`,
      `            <font name="Segoe UI" size="9">`,
      `              <color r="0" g="0" b="0"/>`,
      `            </font>`,
      `          </style>`,
      `        </connection>`
    );
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd"');
  lines.push(`  identifier="${modelIdentifier}">`);
  lines.push(`  <name xml:lang="en">${modelName}</name>`);

  lines.push('  <elements>');
  for (const xml of elementLines) {
    lines.push(xml);
  }
  lines.push('  </elements>');

  if (relationshipLines.length > 0) {
    lines.push('  <relationships>');
    for (const xml of relationshipLines) {
      lines.push(xml);
    }
    lines.push('  </relationships>');
  } else {
    lines.push('  <relationships/>');
  }

  if (organizationLines.length > 0) {
    lines.push('  <organizations>');
    for (const xml of organizationLines) {
      lines.push(xml);
    }
    lines.push('  </organizations>');
  } else {
    lines.push('  <organizations/>');
  }

  lines.push('  <views>');
  lines.push('    <diagrams>');
  lines.push(`      <view identifier="${viewIdentifier}" xsi:type="Diagram">`);
  lines.push('        <name xml:lang="en">Default View</name>');
  for (const xml of nodeViewLines) {
    lines.push(xml);
  }
  for (const xml of connectionLines) {
    lines.push(xml);
  }
  lines.push('      </view>');
  lines.push('    </diagrams>');
  lines.push('  </views>');

  lines.push('</model>');

  return lines.join('\n');
}

export default toArchimateXml;
