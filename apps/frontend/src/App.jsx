import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <Router>
      <div className="app-container">
        <header className="glass-header">
          <div className="header-content">
            <Link to="/" className="logo">
              <span className="logo-icon">✨</span>
              <h1>AI DevOps CRUD</h1>
            </Link>
            <nav className="nav-links">
              <a href="http://localhost:3000/docs" target="_blank" rel="noreferrer" className="nav-link btn-secondary" style={{ textDecoration: 'none' }}>
                API Docs
              </a>
            </nav>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {/* The multi-page routing is now obsolete. All features sit inside Dashboard. */}
            <Route path="*" element={<Dashboard />} /> 
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
