import { useState, useEffect } from 'react';
import api from '../api';
import Table from '../components/Table';
import Modal from '../components/Modal';
import ItemForm from '../components/ItemForm';

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await api.get('/');
      setItems(res.data);
    } catch (err) {
      console.error('Error fetching items', err);
      showToast('Error loading items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this item?')) {
      try {
        await api.delete(`/${id}`);
        showToast('Item deleted successfully.');
        fetchItems();
      } catch (err) {
        console.error('Error deleting item', err);
        showToast('Error deleting item.');
      }
    }
  };

  const handleCreate = () => {
    setSelectedItem(null);
    setIsModalOpen(true);
  };

  const handleEdit = (item) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleFormSuccess = () => {
    setIsModalOpen(false);
    showToast(selectedItem ? 'Item updated successfully.' : 'Item created successfully.');
    fetchItems();
  };

  // Filter items based on search query
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h2>Dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Manage your items efficiently.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="Search items..." 
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="btn-primary" onClick={handleCreate} data-testid="create-btn">
            + Create New
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state glass-card">Loading datatable...</div>
      ) : (
        <Table items={filteredItems} onEdit={handleEdit} onDelete={handleDelete} />
      )}

      {/* Reusable Form Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={selectedItem ? "Edit Item" : "Create New Item"}
      >
        <ItemForm 
          initialData={selectedItem} 
          onClose={() => setIsModalOpen(false)} 
          onSuccess={handleFormSuccess} 
        />
      </Modal>

      {/* Basic Toast Notification */}
      {toastMessage && (
        <div className="toast-container">
          <div className="toast">{toastMessage}</div>
        </div>
      )}
    </>
  );
}
