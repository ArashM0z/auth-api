// NOTE: this entry deliberately does NOT import global.css — the original
// pages/api.html has its own tiny standalone stylesheet (hardcoded dark
// colors, monospace body, no light theme). See src/styles/api.css.
import { createRoot } from 'react-dom/client';
import ApiReference from '../pages/ApiReference';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from the page shell');
createRoot(root).render(<ApiReference />);
