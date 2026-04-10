const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Item', ItemSchema);
