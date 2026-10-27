'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashSenha } = require('./auth');

function abrir(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'infopathos.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conteudos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK (tipo IN ('patologia','quiz','mito','noticia')),
      slug TEXT UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('rascunho','publicado')),
      titulo TEXT NOT NULL,
      dados TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      publicado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conteudos_tipo_status ON conteudos (tipo, status);
  `);
  return db;
}

function getConfig(db, chave) {
  const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return r ? r.valor : null;
}
function setConfig(db, chave, valor) {
  db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}

/* Na primeira execução: cria o segredo das sessões e o login do grupo. */
function prepararAcesso(db) {
  if (!getConfig(db, 'segredo')) setConfig(db, 'segredo', process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'));
  const usuario = (process.env.ADMIN_USER || 'infopathos').toLowerCase();
  if (!getConfig(db, 'admin_usuario')) {
    setConfig(db, 'admin_usuario', usuario);
    // Sem ADMIN_PASSWORD, nasce com uma senha aleatória, mostrada uma única vez no terminal. Nenhuma senha fica escrita no código.
    const senha = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    setConfig(db, 'admin_hash', hashSenha(senha));
    return { primeira: true, senhaGerada: process.env.ADMIN_PASSWORD ? null : senha };
  }
  return { primeira: false };
}

function slugify(txt) {
  return String(txt).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(.{1,60})(?:-.*)?$/, '$1') || 'conteudo';
}
function slugUnico(db, base, idAtual) {
  let slug = base, n = 2;
  for (;;) {
    const r = db.prepare('SELECT id FROM conteudos WHERE slug = ?').get(slug);
    if (!r || r.id === idAtual) return slug;
    slug = `${base}-${n++}`;
  }
}
function linha(r) {
  return { id: r.id, tipo: r.tipo, slug: r.slug, status: r.status, titulo: r.titulo, dados: JSON.parse(r.dados),
    criado_em: r.criado_em, atualizado_em: r.atualizado_em, publicado_em: r.publicado_em };
}
function agora() { return new Date().toISOString(); }

function criar(db, tipo, status, titulo, dados) {
  const t = agora();
  const r = db.prepare('INSERT INTO conteudos (tipo, slug, status, titulo, dados, criado_em, atualizado_em, publicado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(tipo, slugUnico(db, slugify(titulo)), status, titulo, JSON.stringify(dados), t, t, status === 'publicado' ? t : null);
  return obter(db, Number(r.lastInsertRowid));
}
function atualizar(db, id, status, titulo, dados) {
  const atual = db.prepare('SELECT * FROM conteudos WHERE id = ?').get(id);
  if (!atual) return null;
  const t = agora();
  const pub = status === 'publicado' ? (atual.publicado_em || t) : null;
  db.prepare('UPDATE conteudos SET status=?, titulo=?, dados=?, atualizado_em=?, publicado_em=? WHERE id=?')
    .run(status, titulo, JSON.stringify(dados), t, pub, id);
  return obter(db, id);
}
function obter(db, id) {
  const r = db.prepare('SELECT * FROM conteudos WHERE id = ?').get(id);
  return r ? linha(r) : null;
}
function excluir(db, id) {
  return db.prepare('DELETE FROM conteudos WHERE id = ?').run(id).changes > 0;
}
function listar(db, { tipo, apenasPublicados }) {
  let sql = 'SELECT * FROM conteudos WHERE 1=1';
  const p = [];
  if (tipo) { sql += ' AND tipo = ?'; p.push(tipo); }
  if (apenasPublicados) sql += " AND status = 'publicado'";
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(...p).map(linha);
}

/* Conteúdo inicial: a febre amarela enviada pelo grupo. Só entra se o banco estiver vazio. */
function semear(db, arquivo) {
  const n = db.prepare('SELECT COUNT(*) c FROM conteudos').get().c;
  if (n > 0 || process.env.SEM_CONTEUDO_INICIAL === '1') return 0;
  const { validar } = require('./validar');
  const itens = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  let k = 0;
  for (const it of itens) {
    const v = validar(it.tipo, it.dados, it.status);
    if (v.erro) throw new Error('Conteúdo inicial inválido: ' + v.erro);
    criar(db, it.tipo, it.status, v.titulo, v.dados); k++;
  }
  return k;
}

module.exports = { abrir, getConfig, setConfig, prepararAcesso, criar, atualizar, obter, excluir, listar, semear };
