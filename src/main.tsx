import { createRoot } from 'react-dom/client';
import App from './App';
import { AiAccess } from './features/ai-access';
import '../style.css';

createRoot(document.getElementById('root')!).render(
  location.pathname === '/ai-access'
    ? <main className="main-content"><div className="content-area"><div className="content-column"><AiAccess /></div></div></main>
    : <App />
);
