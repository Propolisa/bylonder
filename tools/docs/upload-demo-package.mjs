// Publishes a demo's exported package (docs/demos/<demo>/world/, written by tools/docs/export-demo.mjs) as a release
// asset that scripts/module.mjs fetches: zipped, named by its content, uploaded to the release demo-packages (made if
// missing, an asset already there kept), and named in docs/demos/packages.json for the commit.
//   usage: node tools/docs/upload-demo-package.mjs <demo>   (signed in to GitHub as git is, or with GITHUB_TOKEN set)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEMO_RELEASE, DEMOS, REPO } from '../../scripts/module.mjs';
import { packageArchive } from './demo-package.mjs';

const demo = process.argv[2];
if (!demo) throw Error('usage: node tools/docs/upload-demo-package.mjs <demo>');
const { zip, hash } = packageArchive(`${DEMOS}/${demo}/world`);
const asset = `${demo}-${hash}.zip`;

// The token git pushes with, from its credential helper.
const token = process.env.GITHUB_TOKEN ?? /^password=(.*)$/m.exec(execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' }))?.[1];
async function github(url, { method = 'GET', body, type = 'application/json' } = {}) {
  const response = await fetch(url.startsWith('https:') ? url : `https://api.github.com/repos/${REPO}/${url}`, { method, body,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': type, 'User-Agent': 'bylonder-tools' } });
  if (!response.ok && response.status !== 404) throw Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  return response.ok ? response.json() : null;
}

const release = await github(`releases/tags/${DEMO_RELEASE}`) ?? await github('releases', { method: 'POST', body: JSON.stringify({ tag_name: DEMO_RELEASE,
  name: 'Demo packages', body: "The live demos' exported packages, fetched by scripts/module.mjs.", make_latest: 'false' }) });
if (release.assets.some((a) => a.name === asset)) console.log(`${asset} is already published`);
else {
  await github(release.upload_url.replace(/\{.*\}$/, `?name=${asset}`), { method: 'POST', body: zip, type: 'application/zip' });
  console.log(`${asset} uploaded (${(zip.length / 1e6).toFixed(1)} MB)`);
}
const manifest = `${DEMOS}/packages.json`, wanted = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
writeFileSync(manifest, `${JSON.stringify({ ...wanted, [demo]: hash }, null, 2)}\n`);
writeFileSync(`${DEMOS}/${demo}/world/.key`, asset);
console.log(`${manifest}: ${demo} is ${hash}; commit it`);
