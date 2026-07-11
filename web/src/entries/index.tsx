import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import Architecture from '../pages/Architecture';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from the page shell');
createRoot(root).render(<Architecture />);
