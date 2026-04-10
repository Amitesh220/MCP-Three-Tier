import { useState, useEffect } from 'react';
import api from '../api';

export default function ItemForm({ initialData = null, onClose, onSuccess }) {
  const isEdit = Boolean(initialData);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'active'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name,
        description: initialData.description,
        status: initialData.status
      });
    }
  }, [initialData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isEdit) {
        await api.put(`/${initialData._id}`, formData);
      } else {
        await api.post('/', formData);
      }
      onSuccess();
    } catch (err) {
      console.error('Error saving item', err);
      setError(err.response?.data?.message || 'An error occurred while saving.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
      
      <div className="form-group">
        <label htmlFor="name">Name</label>
        <input 
          type="text" 
          id="name" 
          name="name" 
          className="form-control" 
          value={formData.name} 
          onChange={handleChange} 
          required 
          placeholder="Enter item name"
        />
      </div>

      <div className="form-group">
        <label htmlFor="description">Description</label>
        <textarea 
          id="description" 
          name="description" 
          className="form-control" 
          value={formData.description} 
          onChange={handleChange} 
          required
          placeholder="Enter item description"
        ></textarea>
      </div>

      <div className="form-group">
        <label htmlFor="status">Status</label>
        <select 
          id="status" 
          name="status" 
          className="form-control" 
          value={formData.status} 
          onChange={handleChange}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Saving...' : isEdit ? 'Update Item' : 'Create Item'}
        </button>
      </div>
    </form>
  );
}
