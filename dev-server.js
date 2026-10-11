// dev-server.js
// Runs the whole app on your own computer, the same way Vercel runs it online.
//   Start:  node dev-server.js
//   Open:   http://localhost:3000
//
//   /api/<name>            -> runs api/<name>.js  (or api/<name>.py through Python)
//   /auth/<action>/<p>     -> runs api/auth.js     (same rewrite as vercel.json)
//   /login                 -> public/login.html    (same "clean URLs" as Vercel)
//   anything else          -> a file from public/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

// Python functions: run api/<name>.py and pass the JSON body in, like Vercel does
function runPython(file, body, res) {
  const child = spawn('python3', [file]);
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('error', () => {
    res.statusCode = 500;
    res.end(JSON.stringify({ errors: ['Python 3 is not installed on this computer.'] }));
  });
  child.on('close', (code) => {
    res.statusCode = code === 0 ? 200 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(code === 0 ? out : JSON.stringify({ errors: [err.trim().split('\n').pop() || 'Python error'] }));
  });
  child.stdin.end(body || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const query = Object.fromEntries(url.searchParams);
  let apiName = null;

  // Same rewrite as vercel.json: /auth/start/google -> /api/auth?action=start&provider=google
  const authMatch = url.pathname.match(/^\/auth\/(start|callback)\/([a-z]+)$/);
  if (authMatch) {
    apiName = 'auth';
    query.action = authMatch[1];
    query.provider = authMatch[2];
  } else if (url.pathname.startsWith('/api/')) {
    apiName = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
  }

  // ----- API routes -----
  if (apiName) {
    const jsFile = path.join(__dirname, 'api', apiName + '.js');
    const pyFile = path.join(__dirname, 'api', apiName + '.py');
    const body = await readBody(req);
    if (fs.existsSync(jsFile)) {
      req.query = query;
      req.body = body || undefined;
      return require(jsFile)(req, res);
    }
    if (fs.existsSync(pyFile)) return runPython(pyFile, body, res);
    res.statusCode = 404;
    return res.end(JSON.stringify({ errors: ['No such API route.'] }));
  }

  // ----- Static files (with clean URLs: /login -> login.html) -----
  let requested = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!path.extname(requested)) requested += '.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`HireTrack running at http://localhost:${PORT}`);
});
