import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_URL}/api/items`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
