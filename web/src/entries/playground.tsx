import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import Playground from '../pages/Playground';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from the page shell');
createRoot(root).render(<Playground />);
