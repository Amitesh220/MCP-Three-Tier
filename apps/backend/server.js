require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const itemsRouter = require('./routes/items');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crud-dev';

// Middleware
app.use(cors());
app.use(express.json());

// Swagger definition
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'CRUD API',
    version: '1.0.0',
    description: 'A simple CRUD API for managing items'
  },
  servers: [{ url: `http://localhost:${PORT}` }],
  paths: {
    '/api/items': {
      get: {
        summary: 'Get all items',
        responses: {
          '200': {
            description: 'List of items',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } } } }
          }
        }
      },
      post: {
        summary: 'Create an item',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ItemInput' } } }
        },
        responses: {
          '201': { description: 'Item created' },
          '400': { description: 'Bad request' }
        }
      }
    },
    '/api/items/{id}': {
      get: {
        summary: 'Get an item by ID',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Item found' }, '404': { description: 'Item not found' } }
      },
      put: {
        summary: 'Update an item',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ItemInput' } } }
        },
        responses: { '200': { description: 'Item updated' }, '404': { description: 'Item not found' } }
      },
      delete: {
        summary: 'Delete an item',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Item deleted' }, '404': { description: 'Item not found' } }
      }
    }
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      ItemInput: {
        type: 'object',
        required: ['name', 'description'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'inactive', 'archived'] }
        }
      }
    }
  }
};

// Routes
app.use('/api/items', itemsRouter);

// Swagger endpoints
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/openapi.json', (req, res) => res.json(swaggerDocument));

// Database connection
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));
