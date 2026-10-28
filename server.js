var http = require('http'), https = require('https'), urlm = require('url'), fs = require('fs'), path = require('path');
var PORT = process.env.PORT || 8080;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range');
}
function abs(base, rel) { try { return urlm.resolve(base, rel); } catch (e) { return rel; } }
function wrap(u) { return '/proxy?u=' + encodeURIComponent(u); }
function rewrite(text, base) {
  return text.split(/\r?\n/).map(function (l) {
    if (!l.trim()) return l;
    if (l.charAt(0) === '#') return l.replace(/URI="([^"]+)"/g, function (m, u) { return 'URI="' + wrap(abs(base, u)) + '"'; });
    return wrap(abs(base, l.trim()));
  }).join('\n');
}
function fetchUp(target, req, res, raw, hops) {
  var u = urlm.parse(target), lib = u.protocol === 'https:' ? https : http;
  var h = { 'User-Agent': 'Mozilla/5.0 IPTVProxy' };
  if (req.headers.range) h.Range = req.headers.range;
  var r = lib.get({ hostname: u.hostname, port: u.port, path: u.path, headers: h, rejectUnauthorized: false }, function (up) {
    if ([301, 302, 303, 307, 308].indexOf(up.statusCode) !== -1 && up.headers.location && hops < 5) {
      up.resume();
      return fetchUp(abs(target, up.headers.location), req, res, raw, hops + 1);
    }
    var ct = up.headers['content-type'] || '';
    var isList = !raw && (/mpegurl/i.test(ct) || /\.m3u8?(\?|$)/i.test(u.pathname || ''));
    cors(res);
    if (isList) {
      var chunks = [];
      up.on('data', function (c) { chunks.push(c); });
      up.on('end', function () {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(rewrite(Buffer.concat(chunks).toString('utf8'), target));
      });
      return;
    }
    var oh = {};
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(function (k) { if (up.headers[k]) oh[k] = up.headers[k]; });
    res.writeHead(up.statusCode, oh);
    up.pipe(res);
    req.on('close', function () { up.destroy(); });
  });
  r.on('error', function () {
    if (!res.headersSent) { cors(res); res.writeHead(502); }
    res.end('upstream error');
  });
}

http.createServer(function (req, res) {
  var p = urlm.parse(req.url, true);
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (p.pathname === '/proxy') {
    if (p.query.ping) { cors(res); res.writeHead(200); return res.end('ok'); }
    if (!/^https?:\/\//i.test(p.query.u || '')) { res.writeHead(400); return res.end('bad url'); }
    return fetchUp(p.query.u, req, res, !!p.query.raw, 0);
  }
  fs.readFile(path.join(__dirname, 'index.html'), function (e, d) {
    if (e) { res.writeHead(500); return res.end('index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(d);
  });
}).listen(PORT, function () { console.log('IPTV player: http://localhost:' + PORT); });
