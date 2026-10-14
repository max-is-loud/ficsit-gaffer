#!/usr/bin/env node
// Maintain integrations/foreman-bridge/source-manifest.json.
//
// Each component keeps its upstream provenance untouched: `sourceCommit` and
// `files` are the byte-for-byte hashes imported from that commit. The `current`
// section records today's hashes plus the paths changed in this repository
// since the import. Hashing covers files git would track (tracked or untracked
// but not ignored), so private/generated artifacts excluded by .gitignore never
// enter the manifest. The manifest itself lives outside every component.
//
//   node integrations/foreman-bridge/scripts/update-source-manifest.mjs --check
//   node integrations/foreman-bridge/scripts/update-source-manifest.mjs --write
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath=join(root,'source-manifest.json');
const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--check'&&mode!=='--write')) {
 console.error('Usage: update-source-manifest.mjs --check|--write');process.exit(2);
}

function componentFiles(component) {
 const dir=join(root,component);
 // Paths are printed relative to cwd, i.e. to the component directory.
 const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','.'],{cwd:dir,encoding:'utf8'});
 // --cached still lists deleted-but-unstaged paths; hash only what exists.
 return listed.split('\0').filter(path=>path&&existsSync(join(dir,path))).sort();
}
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const expected={schema:2,components:{}};
for(const [name,component] of Object.entries(manifest.components)) {
 const imported=component.files;
 const files=Object.fromEntries(componentFiles(name).map(path=>[path,sha256(join(root,name,path))]));
 const modified=Object.keys(files).filter(path=>path in imported&&imported[path]!==files[path]);
 const added=Object.keys(files).filter(path=>!(path in imported));
 const deleted=Object.keys(imported).filter(path=>!(path in files)).sort();
 expected.components[name]={sourceCommit:component.sourceCommit,files:imported,current:{modified,added,deleted,files}};
}
// Both codecs must exercise the same canonical protocol fixtures.
const [canonical,native]=['receiver/fixtures/v1.json','mod/Tests/fixtures/v1.json'].map(path=>sha256(join(root,path)));
if(canonical!==native) {
 console.error('Protocol fixture copies differ; copy receiver/fixtures/v1.json to mod/Tests/fixtures/v1.json');process.exit(1);
}
const text=JSON.stringify(expected,null,2)+'\n';
if(mode==='--write') {
 writeFileSync(manifestPath,text);console.log('source-manifest.json updated');
} else if(readFileSync(manifestPath,'utf8')!==text) {
 for(const [name,component] of Object.entries(expected.components)) {
  const stored=manifest.components[name]?.current?.files??{};
  for(const path of new Set([...Object.keys(stored),...Object.keys(component.current.files)])) {
   if(stored[path]!==component.current.files[path])console.error(`stale: ${name}/${path}`);
  }
 }
 console.error('source-manifest.json is out of date; run with --write after reviewing the changes');process.exitCode=1;
} else {
 console.log('source-manifest.json matches the working tree');
}
