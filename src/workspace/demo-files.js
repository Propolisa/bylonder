// Blender's demo files and .blend files at a web address, opened as File > Open opens a chosen file, after the user
// confirms the download. The demo files come from the site's own copy (scripts/demo-files.mjs), then their source.
import { files as demoFiles, page as demoPage } from './blender-demo-files.json';

const megabytes = (size) => `${(size / 2 ** 20).toFixed(size < 2 ** 20 ? 2 : 1)} MB`;

function dialog(heading, build) {
  const d = Object.assign(document.createElement('dialog'), { className: 'workbench-dialog' });
  d.append(Object.assign(document.createElement('h2'), { textContent: heading }));
  return new Promise((resolve) => {
    const actions = Object.assign(document.createElement('div'), { className: 'dialog-actions' });
    const button = (label, value) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick: () => { resolve(value()); d.close(); } });
    const ok = build(d, (label, value) => actions.append(button(label, value)));
    actions.append(button('Cancel', () => null));
    d.append(actions);
    d.addEventListener('close', () => { resolve(null); d.remove(); });
    document.body.append(d);
    d.showModal();
    ok?.focus();
  });
}
const line = (text) => Object.assign(document.createElement('p'), { textContent: text });
const message = (heading, text) => dialog(heading, (d) => { d.append(line(text)); });

async function download(urls, name) {
  let failure;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return new File([await response.blob()], name);
      failure = `${url} answered ${response.status}`;
    } catch {
      failure = `${url} does not allow downloads from a web page (no CORS headers): download it and use File > Open`;
    }
  }
  throw Error(failure);
}

async function openDownloaded(urls, name, openBlend) {
  try {
    await openBlend(await download(urls, name));
  } catch (error) {
    await message('Cannot open the file', error.message);
  }
}

export const listedDemoFiles = demoFiles;

// A demo file, once the user agrees to download it.
export async function openDemoFile(file, openBlend) {
  const agreed = await dialog(file.title, (d, add) => {
    d.append(line([file.artist, file.license].filter(Boolean).join(', ') || 'From Blender\'s demo files'), line(`${megabytes(file.size)} from ${file.url}`));
    if (file.limit) d.append(line(`Not working yet: ${file.limit}`));
    add('Download and Open', () => true);
  });
  if (agreed) await openDownloaded([`${import.meta.env.BASE_URL}blender-demo-files/${file.id}.blend`, file.url], `${file.id}.blend`, openBlend);
}

// A .blend at an address the user types.
export async function openFromUrl(openBlend) {
  let input;
  const url = await dialog('Open from URL', (d, add) => {
    input = Object.assign(document.createElement('input'), { type: 'url', placeholder: 'https://example.com/scene.blend', style: 'width:100%' });
    d.append(line('Downloads the .blend file at this address and opens it.'), input, line(`Blender's demo files are listed at ${demoPage}.`));
    add('Download and Open', () => input.value.trim());
    return input;
  });
  if (url) await openDownloaded([url], new URL(url, location.href).pathname.split('/').pop() || 'download.blend', openBlend);
}
