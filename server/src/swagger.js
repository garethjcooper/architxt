import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'architxt API',
      version: '1.0.0',
      description: 'Document processing and context management API',
      contact: {
        name: 'API Support',
        email: 'support@architxt.local'
      }
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1'
      }
    ],
    components: {
      schemas: {
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique document identifier'
            },
            ext_id: {
              type: 'string',
              nullable: true,
              description: 'External unique identifier'
            },
            content: {
              type: 'string',
              nullable: true,
              description: 'Document content (extracted text)'
            },
            content_hash: {
              type: 'string',
              nullable: true,
              description: 'Hash of document content for deduplication'
            },
            source_path: {
              type: 'string',
              description: 'Path to the uploaded document'
            },
            status: {
              type: 'string',
              enum: ['uploaded', 'ready_to_extract', 'processing_extract', 'processed_extract_success', 'processed_extract_failed'],
              description: 'Current processing status'
            },
            generated_by: {
              type: 'string',
              enum: ['user', 'import'],
              nullable: true,
              description: 'How the document was created'
            },
            processing_history: {
              type: 'array',
              items: { type: 'object' },
              description: 'Processing history as JSON array'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            },
            context_id: {
              type: 'integer',
              nullable: true,
              description: 'Associated context ID'
            }
          }
        },
        Context: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique context identifier'
            },
            description: {
              type: 'string',
              description: 'Context description'
            },
            generated_by: {
              type: 'string',
              enum: ['user', 'import'],
              description: 'Who created the context'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        Tag: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique tag identifier'
            },
            name: {
              type: 'string',
              description: 'Tag name'
            },
            generated_by: {
              type: 'string',
              enum: ['user', 'import'],
              description: 'Who created the tag'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        Server: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique server identifier'
            },
            base_url: {
              type: 'string',
              description: 'Server base URL'
            },
            name: {
              type: 'string',
              description: 'Server name'
            },
            api_key: {
              type: 'string',
              description: 'API key for server authentication'
            },
            api_version: {
              type: 'string',
              description: 'API version'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        Metadata: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique metadata identifier'
            },
            key: {
              type: 'string',
              description: 'Metadata key'
            },
            value: {
              type: 'string',
              description: 'Metadata value'
            },
            generated_by: {
              type: 'string',
              enum: ['user', 'import'],
              description: 'Who created the metadata'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        EntityType: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Unique entity type identifier' },
            type_name: { type: 'string', description: 'Entity type name' },
            description: { type: 'string', nullable: true, description: 'Entity type description' },
            id_label: { type: 'string', nullable: true, description: 'Label for the entity ID field' },
            name_label: { type: 'string', nullable: true, description: 'Label for the entity name field' },
            case_match: { type: 'string', enum: ['insensitive', 'sensitive'], default: 'insensitive', description: 'Default case matching rule for scan' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            updated_at: { type: 'string', format: 'date-time', description: 'Last update timestamp' }
          }
        },
        Entity: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Unique entity identifier' },
            type_id: { type: 'integer', description: 'Entity type ID' },
            type_name: { type: 'string', description: 'Entity type name' },
            entity_id: { type: 'string', description: 'External entity identifier (e.g. SYS-001)' },
            name: { type: 'string', description: 'Entity name' },
            description: { type: 'string', nullable: true, description: 'Entity description' },
            aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative names for this entity' },
            case_match: { type: 'string', enum: ['insensitive', 'sensitive'], default: 'insensitive', description: 'Case matching rule for scan' },
            type_case_match: { type: 'string', enum: ['insensitive', 'sensitive'], default: 'insensitive', description: 'Inherited type default for scan' },
            generated_by: { type: 'string', enum: ['user', 'import'], description: 'Who created the entity' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            updated_at: { type: 'string', format: 'date-time', description: 'Last update timestamp' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'string',
              description: 'Error code'
            }
          }
        }
      },
      parameters: {
        limitParam: {
          in: 'query',
          name: 'limit',
          schema: {
            type: 'integer',
            default: 100
          },
          description: 'Maximum items to return'
        },
        offsetParam: {
          in: 'query',
          name: 'offset',
          schema: {
            type: 'integer',
            default: 0
          },
          description: 'Number of items to skip'
        }
      }
    }
  },
  apis: [
    './src/routes/*.js',  // Path to route files with JSDoc
    './src/db/crud/*.js' // CRUD files with schemas
  ]
};

const specs = swaggerJsdoc(options);

export default specs;
export { swaggerUi };
