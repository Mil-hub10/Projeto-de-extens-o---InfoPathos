'use strict';
/* Uso: node trocar-senha.js "NovaSenha"  (ou: ADMIN_PASSWORD=... node trocar-senha.js) */
const path = require('node:path');
const db = require('./lib/db');
const { hashSenha } = require('./lib/auth');
const nova = process.argv[2] || process.env.ADMIN_PASSWORD;
if (!nova || nova.length < 8) { console.error('Informe a nova senha (mínimo 8 caracteres): node trocar-senha.js "NovaSenha"'); process.exit(1); }
const conn = db.abrir(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')));
db.prepararAcesso(conn);
db.setConfig(conn, 'admin_hash', hashSenha(nova));
db.setConfig(conn, 'segredo', require('node:crypto').randomBytes(48).toString('hex')); // encerra as sessões abertas
console.log('Senha trocada. As sessões abertas foram encerradas.');
