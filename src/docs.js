import { marked } from 'marked';
import { blender } from '../tools/blender-port/manifest.json';
import features from '../docs/features/index.json';
import { coverageText, frontMatter, LIMITS, LIVE_SITE, REFERENCE, SOURCE } from './feature-docs.js';
import './theme.css';
import './docs.css';

const raw = { 'README.md': (await import('../README.md?raw')).default, ...Object.fromEntries(Object.entries(import.meta.glob(['../docs/**/*.md', '../examples/**/*.md'], { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [path.slice(3), text])) };
const media = Object.fromEntries(Object.entries(import.meta.glob('../docs/media/**/*', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [path.slice(3), url]));
const pages = Object.fromEntries(Object.entries(raw).map(([path, text]) => {
  const { data, body } = frontMatter(text);
  return [path, { path, data, body, title: data.title || body.match(/^#\s+(.+)/m)?.[1] || path }];
}));
const FEATURES = 'docs/features/README.md';
const SECTIONS = [
  ['Overview', (p) => p === 'README.md'],
  ['Features', (p) => p.startsWith('docs/features/')],
  ['Architecture', (p) => /^docs\/[^/]+\.md$/.test(p)],
  ['Examples', (p) => p.startsWith('examples/')],
];
const byTitle = (a, b) => a.title.localeCompare(b.title);
const tree = SECTIONS.map(([name, test]) => [name, Object.values(pages).filter((p) => test(p.path)).sort((a, b) => (b.path === FEATURES) - (a.path === FEATURES) || byTitle(a, b))]);
const order = tree.flatMap(([, list]) => list);
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const link = (text, href, className = '') => el('a', { href, textContent: text, className });
const resolve = (href, from) => new URL(href, 'http://x/' + from).pathname.slice(1);
// The live site's links open this build of the app, where it is served.
const local = (url) => (url.startsWith(LIVE_SITE) ? new URL(import.meta.env.BASE_URL + url.slice(LIVE_SITE.length), location.href).href : url);
const mediaUrl = (file) => media['docs/media/features/' + file];
const slug = (text) => text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

const navLink = (page) => {
  const a = Object.assign(link(page.title, '#' + page.path), { title: page.data.summary || page.path });
  a.dataset.path = page.path;
  return a;
};
function navigation() {
  $('doc-tree').replaceChildren(...tree.map(([name, list]) => el('section', {}, el('p', { className: 'doc-caption', textContent: name }),
    el('ul', {}, ...list.map((p) => el('li', {}, navLink(p)))))));
  $('doc-search').oninput = ({ target }) => {
    const words = target.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const a of $('doc-tree').querySelectorAll('a')) {
      const page = pages[a.dataset.path], text = (page.title + ' ' + (page.data.summary ?? '') + ' ' + page.body).toLowerCase();
      a.parentElement.hidden = !words.every((w) => text.includes(w));
    }
  };
  $('doc-menu').onclick = () => $('doc-menu').setAttribute('aria-expanded', document.body.classList.toggle('nav-open'));
}

const counts = (f) => coverageText(f.coverage ?? {}).map((text) => el('span', { className: 'doc-count', textContent: text }));
const expect = (f) => (f.expect ? [el('p', { className: 'feature-expect', textContent: f.expect })] : []);
const buttons = (f, manuals = f.blender_manual) => el('p', { className: 'doc-buttons' },
  link('Open in Bylonder', local(f.open), 'doc-button primary'),
  ...manuals.map((url, i) => Object.assign(link(i ? 'Manual: ' + url.split('/').slice(-2).join('/') : 'Blender Manual', url, 'doc-button'), { target: '_blank' })));

// The index page: a card per feature, from docs/features/index.json.
const featureCards = () => el('div', { className: 'feature-grid' }, ...features.map((f) => el('article', { className: 'feature-card' },
  el('a', { href: '#' + f.page, className: 'feature-thumb' }, el('img', { src: mediaUrl(f.thumbnail), alt: '', loading: 'lazy' })),
  el('div', { className: 'feature-text' },
    el('h3', {}, link(f.title, '#' + f.page)), el('p', { textContent: f.summary }), ...expect(f),
    el('p', { className: 'feature-meta' }, ...counts(f), el('span', { textContent: `Example: ${f.example_title}` })), buttons(f, f.blender_manual.slice(0, 1))))));

const codeList = (files) => el('ul', {}, ...files.map((file) => el('li', {}, Object.assign(link(file, SOURCE + file), { target: '_blank' }))));
const codes = (ids) => el('p', { className: 'doc-ids' }, ...ids.map((id) => el('code', { textContent: id })));
// What a feature page's front matter adds around its body: the summary and links first, the reference last.
function featurePage(body, f) {
  const lead = el('div', { className: 'feature-lead' }, el('p', { className: 'feature-summary', textContent: f.summary }), ...expect(f),
    el('p', { className: 'feature-meta' }, ...counts(f), el('span', { textContent: `Blender ${f.blender_version}` }), el('span', { textContent: `Example: ${f.example_title ?? f.example}` })), buttons(f));
  body.querySelector('h1')?.after(lead);
  body.querySelector(`p > a[href^="${LIVE_SITE}"]:only-child`)?.parentElement.remove();
  body.append(el('h2', { textContent: LIMITS }), el('ul', {}, ...f.limits.map((l) => el('li', { textContent: l }))),
    el('h2', { textContent: REFERENCE }),
    el('dl', { className: 'doc-reference' },
      el('dt', { textContent: 'Interface' }), el('dd', {}, codes(f.ui)),
      el('dt', { textContent: 'Operators' }), el('dd', {}, codes(f.operators)),
      el('dt', { textContent: 'Code' }), el('dd', {}, codeList(f.code)),
      el('dt', { textContent: 'Tests' }), el('dd', {}, codeList(f.tests))));
}

// Blender manual's look for Markdown's plain blocks: an image alone in a paragraph is a figure captioned by its alt
// text, and a quote opening with **Note**, **Tip** or **Warning** is an admonition.
function manualBlocks(body, path) {
  for (const a of body.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^[a-z]+:/.test(href)) { a.href = local(href); a.target = '_blank'; continue; }
    if (href.startsWith('#')) continue;
    const target = resolve(href, path);
    if (target in pages) a.href = '#' + target;
    else { a.href = SOURCE + target; a.target = '_blank'; }
  }
  for (const img of body.querySelectorAll('img[src]')) {
    const target = resolve(img.getAttribute('src'), path);
    if (target in media) img.src = media[target];
    else if (target.startsWith('public/')) img.src = import.meta.env.BASE_URL + target.slice(7);
    img.loading = 'lazy';
    const p = img.parentElement;
    if (p.tagName === 'P' && p.childNodes.length === 1) p.replaceWith(el('figure', {}, img, ...(img.alt ? [el('figcaption', { textContent: img.alt })] : [])));
  }
  for (const quote of body.querySelectorAll('blockquote')) {
    const kind = quote.querySelector('p:first-child > strong:first-child')?.textContent.replace(/:$/, '');
    if (!['Note', 'Tip', 'Warning'].includes(kind)) continue;
    quote.querySelector('strong').remove();
    quote.replaceWith(el('div', { className: 'admonition ' + kind.toLowerCase() }, el('p', { className: 'admonition-title', textContent: kind }), ...quote.childNodes));
  }
  for (const h of body.querySelectorAll(':scope > h2, :scope > h3')) h.id = slug(h.textContent);
}

function show() {
  const path = decodeURIComponent(location.hash.slice(1)) || 'README.md';
  const page = pages[path] ?? { path, title: 'Not found', data: {}, body: '# Not found' };
  const body = $('doc-body');
  body.innerHTML = marked.parse(page.body);
  if (path === FEATURES) body.querySelector('table')?.replaceWith(featureCards());
  if (page.data.id) featurePage(body, { ...page.data, ...features.find((f) => f.id === page.data.id) });
  manualBlocks(body, path);
  const section = tree.find(([, list]) => list.includes(page))?.[0];
  $('doc-crumbs').replaceChildren(link('Manual', '#'), el('span', { textContent: ' / ' + (section ? section + ' / ' : '') + page.title }));
  const at = order.indexOf(page), [prev, next] = [order[at - 1], order[at + 1]];
  $('doc-pager').replaceChildren(prev && at > 0 ? el('a', { href: '#' + prev.path, className: 'prev' }, el('small', { textContent: 'Previous' }), el('span', { textContent: prev.title })) : el('span'),
    next ? el('a', { href: '#' + next.path, className: 'next' }, el('small', { textContent: 'Next' }), el('span', { textContent: next.title })) : el('span'));
  const headings = [...body.querySelectorAll(':scope > h2, :scope > h3')];
  $('doc-toc').replaceChildren(...(headings.length ? [el('p', { className: 'doc-caption', textContent: 'On this page' }), el('ul', {}, ...headings.map((h) =>
    el('li', { className: h.tagName.toLowerCase() }, Object.assign(link(h.textContent, '#' + path), { onclick: (e) => { e.preventDefault(); h.scrollIntoView(); } }))))] : []));
  for (const a of $('doc-tree').querySelectorAll('a')) a.classList.toggle('active', a.dataset.path === path);
  document.title = page.title + ' - Bylonder Manual';
  document.body.classList.remove('nav-open');
  scrollTo(0, 0);
}

$('doc-version').textContent = `Blender ${blender.replace(/^v/, '')}`;
navigation();
addEventListener('hashchange', show);
show();
