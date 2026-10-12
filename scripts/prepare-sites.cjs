const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, 'dist');
if (dist !== path.join(root, 'dist') || path.dirname(dist) !== root) throw new Error('Invalid output directory');
if (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink()) throw new Error('Output must be a regular directory');
fs.rmSync(dist, {recursive:true,force:true});
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
const copy = relative => {
  const source = path.join(root, relative), target = path.join(dist, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing ${relative}`);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.cpSync(source, target, {recursive:true,dereference:false});
};
copy('index.html');
copy('styles.css');
for (const page of JSON.parse(fs.readFileSync(path.join(root,'content/pages.json'),'utf8'))) {
  copy(`${page.slug}/index.html`);
  copy(`content/${page.slug}.css`);
}
for (const relative of [
  'assets/images','assets/fonts','assets/videos','assets/vendor',
  'assets/projects/longlati/collection-works.jpg','assets/projects/longlati/gwendoline-kam-portrait.png',
  'assets/fonts.css','assets/readymag-base.css',
  'scripts/layout.js','scripts/animation-config.js','scripts/interactions.js','scripts/media.js'
]) copy(relative);
let count = 0, bytes = 0;
const inspect = directory => {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const filename = path.join(directory,entry.name);
    if(entry.isDirectory()) inspect(filename);
    else if(entry.isFile()) { count++;bytes+=fs.statSync(filename).size; }
    else throw new Error('Static output contains a special file');
  }
};
inspect(dist);
console.log(JSON.stringify({directory:dist,files:count,size_bytes:bytes}));
