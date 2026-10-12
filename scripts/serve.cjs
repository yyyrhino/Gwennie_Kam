const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 4187);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif','.woff2':'font/woff2','.woff':'font/woff','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.mp4':'video/mp4'};
http.createServer((request,response)=>{
  let relative;
  try {relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname);} catch {response.writeHead(400);return response.end('Bad request');}
  if(relative.split('/').some(part=>part.startsWith('.'))) {response.writeHead(404);return response.end('Not found');}
  let file=path.resolve(root, '.'+relative);
  if(file!==root&&!file.startsWith(root+path.sep)) {response.writeHead(403);return response.end('Forbidden');}
  try {
    if(fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(response);
  } catch {response.writeHead(404);response.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/`));
