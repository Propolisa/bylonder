import { marked } from 'marked';
import './theme.css';
import './docs.css';

const files = { 'README.md': (await import('../README.md?raw')).default, ...Object.fromEntries(Object.entries(import.meta.glob(['../docs/*.md', '../examples/**/*.md'], { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [path.slice(3), text])) };
const media = Object.fromEntries(Object.entries(import.meta.glob('../docs/media/*', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [path.slice(3), url]));
const nav = document.getElementById('doc-nav'), body = document.getElementById('doc-body');
const title = (path, text) => text.match(/^#\s+(.+)/m)?.[1] || path;
const show = () => {
  const path = decodeURIComponent(location.hash.slice(1)) || 'README.md';
  body.innerHTML = marked.parse(files[path] ?? '# Not found');
  for (const a of body.querySelectorAll('a[href]')) {
    const target = new URL(a.getAttribute('href'), 'http://x/' + path).pathname.slice(1);
    if (target in files) a.href = '#' + target; else if (/^https?:/.test(a.href)) a.target = '_blank';
  }
  for (const img of body.querySelectorAll('img[src]')) {
    const target = new URL(img.getAttribute('src'), 'http://x/' + path).pathname.slice(1);
    if (target in media) img.src = media[target];
  }
  for (const a of nav.children) a.classList.toggle('active', a.dataset.path === path);
  document.title = title(path, files[path] || '') + ' - Bylonder Docs';
  body.scrollTop = 0;
};
for (const [path, text] of Object.entries(files)) { const a = Object.assign(document.createElement('a'), { href: '#' + path, textContent: title(path, text), title: path }); a.dataset.path = path; nav.append(a); }
addEventListener('hashchange', show);
show();
