// Faithful React conversion of pages/api.html: a sticky top nav plus the
// Scalar API reference. Scalar renders the committed OpenAPI document
// (./openapi.json, served at the site root) as an interactive reference —
// its loader script scans the DOM for `script#api-reference[data-url]`,
// so we inject the same two <script> tags the original page shipped.
import { useEffect } from 'react';
import Nav from '../components/Nav';
import '../styles/api.css';

export default function ApiReference() {
  useEffect(() => {
    // <script id="api-reference" data-url="./openapi.json"></script>
    const config = document.createElement('script');
    config.id = 'api-reference';
    config.dataset.url = './openapi.json';
    document.body.appendChild(config);

    // <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
    document.body.appendChild(loader);

    return () => {
      config.remove();
      loader.remove();
    };
  }, []);

  return <Nav current="api" />;
}
