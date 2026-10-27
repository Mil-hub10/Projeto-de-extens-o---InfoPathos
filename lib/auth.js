'use strict';
const crypto = require('node:crypto');

/* Senha: scrypt com sal aleatório. Formato guardado: scrypt$<sal>$<hash> */
function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `scrypt$${sal}$${h}`;
}
function confereSenha(senha, guardado) {
  const [alg, sal, h] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const calc = crypto.scryptSync(String(senha), sal, 64);
  const esperado = Buffer.from(h, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

/* Sessão: cookie assinado (HMAC), sem estado no servidor. */
const DURACAO_MS = 8 * 60 * 60 * 1000;
function criaToken(usuario, segredo) {
  const exp = Date.now() + DURACAO_MS;
  const corpo = Buffer.from(JSON.stringify({ u: usuario, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', segredo).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}
function leToken(token, segredo) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [corpo, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', segredo).update(corpo).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function leCookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}

/* Limite de tentativas de login: 5 erros por IP a cada 15 minutos. */
const falhas = new Map();
const JANELA = 15 * 60 * 1000, MAX = 5;
function bloqueado(ip) {
  const f = (falhas.get(ip) || []).filter((t) => Date.now() - t < JANELA);
  falhas.set(ip, f);
  return f.length >= MAX;
}
function registraFalha(ip) { const f = falhas.get(ip) || []; f.push(Date.now()); falhas.set(ip, f); }
function limpaFalhas(ip) { falhas.delete(ip); }

module.exports = { hashSenha, confereSenha, criaToken, leToken, leCookies, bloqueado, registraFalha, limpaFalhas, DURACAO_MS };
