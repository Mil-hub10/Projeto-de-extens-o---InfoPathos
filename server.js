'use strict';
/* InfoPathos: servidor sem dependências externas (só módulos do próprio Node 22+). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { validar, TIPOS } = require('./lib/validar');

const PORTA = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const PRODUCAO = process.env.NODE_ENV === 'production';

const conn = db.abrir(DATA_DIR);
const acesso = db.prepararAcesso(conn);
const semeados = db.semear(conn, path.join(__dirname, 'seed.json'));
const SEGREDO = db.getConfig(conn, 'segredo');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8' };

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function cabecalhos(extra) {
  return Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP }, extra);
}
function json(res, status, obj, extra) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, cabecalhos(Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)));
  res.end(corpo);
}
function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const partes = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limite) { reject(Object.assign(new Error('grande'), { status: 413 })); req.destroy(); } else partes.push(c); });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}
async function lerJson(req, limite = 200 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('tipo'), { status: 415 });
  const t = await lerCorpo(req, limite);
  try { return JSON.parse(t || '{}'); } catch { throw Object.assign(new Error('json'), { status: 400 }); }
}
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function seguro(req) { return PRODUCAO || req.headers['x-forwarded-proto'] === 'https'; }
function sessao(req) {
  const d = auth.leToken(auth.leCookies(req).ip_sessao, SEGREDO);
  return d && d.u === db.getConfig(conn, 'admin_usuario') ? d : null;
}
function cookie(req, valor, maxAge) {
  return `ip_sessao=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (seguro(req) ? '; Secure' : '');
}

/* Imagens enviadas: confere o conteúdo real do arquivo, não só o nome. */
function tipoImagem(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;

  if (p === '/api/publico' && m === 'GET') {
    const todos = db.listar(conn, { apenasPublicados: true });
    const por = (t) => todos.filter((c) => c.tipo === t);
    const noticias = por('noticia').sort((a, b) => String(b.dados.data).localeCompare(String(a.dados.data)));
    return json(res, 200, { patologias: por('patologia'), quizzes: por('quiz'), mitos: por('mito'), noticias });
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = ipDe(req);
    if (auth.bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
    const b = await lerJson(req, 4096);
    const u = String(b.usuario || '').trim().toLowerCase(), s = String(b.senha || '');
    const okUser = u === db.getConfig(conn, 'admin_usuario');
    const okSenha = auth.confereSenha(s, db.getConfig(conn, 'admin_hash')); // sempre calcula, para não revelar qual campo errou
    if (!(okUser && okSenha)) { auth.registraFalha(ip); return json(res, 401, { erro: 'Usuário ou senha incorretos.' }); }
    auth.limpaFalhas(ip);
    return json(res, 200, { ok: true, usuario: u }, { 'Set-Cookie': cookie(req, auth.criaToken(u, SEGREDO), auth.DURACAO_MS / 1000) });
  }
  if (p === '/api/logout' && m === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
  if (p === '/api/me' && m === 'GET') { const s = sessao(req); return json(res, 200, { logada: !!s, usuario: s ? s.u : null }); }

  if (p.startsWith('/api/admin/')) {
    if (!sessao(req)) return json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });

    if (p === '/api/admin/conteudos' && m === 'GET') {
      const tipo = url.searchParams.get('tipo');
      if (tipo && !TIPOS.includes(tipo)) return json(res, 400, { erro: 'Categoria desconhecida.' });
      return json(res, 200, { itens: db.listar(conn, { tipo }) });
    }
    if (p === '/api/admin/conteudos' && m === 'POST') {
      const b = await lerJson(req);
      const status = b.status === 'publicado' ? 'publicado' : 'rascunho';
      const v = validar(b.tipo, b.dados, status);
      if (v.erro) return json(res, 422, { erro: v.erro, erros: v.erros });
      return json(res, 201, { item: db.criar(conn, b.tipo, status, v.titulo, v.dados) });
    }
    const mid = p.match(/^\/api\/admin\/conteudos\/(\d+)$/);
    if (mid) {
      const id = parseInt(mid[1], 10);
      if (m === 'GET') { const it = db.obter(conn, id); return it ? json(res, 200, { item: it }) : json(res, 404, { erro: 'Não encontrado.' }); }
      if (m === 'PUT') {
        const atual = db.obter(conn, id);
        if (!atual) return json(res, 404, { erro: 'Não encontrado.' });
        const b = await lerJson(req);
        const status = b.status === 'publicado' ? 'publicado' : 'rascunho';
        const v = validar(atual.tipo, b.dados, status);
        if (v.erro) return json(res, 422, { erro: v.erro, erros: v.erros });
        return json(res, 200, { item: db.atualizar(conn, id, status, v.titulo, v.dados) });
      }
      if (m === 'DELETE') return db.excluir(conn, id) ? json(res, 200, { ok: true }) : json(res, 404, { erro: 'Não encontrado.' });
    }
    if (p === '/api/admin/imagem' && m === 'POST') {
      const b = await lerJson(req, 6 * 1024 * 1024);
      const mm = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dados || ''));
      if (!mm) return json(res, 422, { erro: 'Envie uma imagem JPG, PNG ou WEBP.' });
      const buf = Buffer.from(mm[1], 'base64');
      if (buf.length > 4 * 1024 * 1024) return json(res, 413, { erro: 'A imagem passa de 4 MB. Reduza e tente de novo.' });
      const ext = tipoImagem(buf);
      if (!ext) return json(res, 422, { erro: 'O arquivo não parece ser uma imagem válida.' });
      const nome = crypto.randomBytes(12).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS, nome), buf);
      return json(res, 201, { url: '/uploads/' + nome });
    }
  }
  return json(res, 404, { erro: 'Não encontrado.' });
}

/* ---------- Arquivos estáticos ---------- */
function enviaArquivo(req, res, base, relativo, cacheLongo) {
  const alvo = path.normalize(path.join(base, relativo));
  if (alvo !== base && !alvo.startsWith(base + path.sep)) { res.writeHead(403, cabecalhos()); return res.end('Proibido'); }
  fs.stat(alvo, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, cabecalhos({ 'Content-Type': 'text/plain; charset=utf-8' })); return res.end('Página não encontrada'); }
    const ext = path.extname(alvo).toLowerCase();
    const tipo = MIME[ext] || 'application/octet-stream';
    const cache = cacheLongo ? 'public, max-age=86400' : 'no-cache';
    // Vídeos precisam de "Range" para o navegador conseguir avançar e voltar.
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && (ext === '.mp4' || ext === '.webm')) {
      let ini = rg[1] === '' ? Math.max(0, st.size - Number(rg[2])) : Number(rg[1]);
      let fim = rg[1] === '' || rg[2] === '' ? st.size - 1 : Math.min(Number(rg[2]), st.size - 1);
      if (ini > fim || ini >= st.size) { res.writeHead(416, cabecalhos({ 'Content-Range': 'bytes */' + st.size })); return res.end(); }
      res.writeHead(206, cabecalhos({ 'Content-Type': tipo, 'Content-Length': fim - ini + 1, 'Content-Range': 'bytes ' + ini + '-' + fim + '/' + st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(alvo, { start: ini, end: fim }).pipe(res);
    }
    res.writeHead(200, cabecalhos({ 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(alvo).pipe(res);
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, cabecalhos()); return res.end(); }
    if (rel.includes('\0')) { res.writeHead(400, cabecalhos()); return res.end(); }
    if (rel.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cabecalhos()); return res.end(); }
    if (rel.startsWith('/uploads/')) return enviaArquivo(req, res, UPLOADS, rel.slice('/uploads/'.length), true);
    if (rel === '/') rel = '/index.html';
    return enviaArquivo(req, res, PUBLIC, rel.slice(1), /^\/assets\//.test(rel));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    const msg = { 400: 'Pedido inválido.', 413: 'Arquivo grande demais.', 415: 'Tipo de conteúdo não aceito.' }[status] || 'Erro interno. Tente de novo.';
    if (!res.headersSent) json(res, status, { erro: msg }); else res.end();
  }
});

servidor.listen(PORTA, () => {
  console.log(`InfoPathos no ar: http://localhost:${PORTA}`);
  if (semeados) console.log(`Conteúdo inicial criado (${semeados} itens).`);
  if (acesso.primeira) {
    console.log(`Login do grupo criado. Usuário: ${db.getConfig(conn, 'admin_usuario')}`);
    if (acesso.senhaGerada) console.log(`Senha gerada (aparece só agora, anote): ${acesso.senhaGerada}\nPara definir outra: node trocar-senha.js "NovaSenha"`);
  }
});
module.exports = servidor;
