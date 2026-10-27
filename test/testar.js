'use strict';
/* Teste automático da API: npm test (sobe o servidor num banco temporário). */
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-'));
const PORTA = 3900 + Math.floor(Math.random() * 90), base = `http://localhost:${PORTA}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: PORTA, DATA_DIR: dir, ADMIN_PASSWORD: 'SenhaSoDeTeste-42' }, stdio: 'ignore' });
let cookie = '';
const J = (m, u, b, h = {}) => fetch(base + u, { method: m, headers: { ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...h }, body: b !== undefined ? JSON.stringify(b) : undefined });
let ok = 0; const t = async (nome, f) => { try { await f(); ok++; console.log('ok  ', nome); } catch (e) { console.log('FALHOU', nome, '\n   ', e.message); process.exitCode = 1; } };
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/me'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  await t('home e arquivos estáticos', async () => { assert.equal((await fetch(base + '/')).status, 200); assert.equal((await fetch(base + '/css/style.css')).status, 200); assert.equal((await fetch(base + '/js/app.js')).status, 200); });
  await t('bloqueia ../ e arquivos fora do site', async () => {
    for (const u of ['/..%2fserver.js', '/%2e%2e/server.js', '/../lib/db.js', '/uploads/..%2f..%2fserver.js', '/data/infopathos.db']) assert.notEqual((await fetch(base + u)).status, 200, u);
  });
  await t('conteúdo inicial público (febre amarela)', async () => {
    const r = await (await fetch(base + '/api/publico')).json();
    assert.equal(r.patologias.length, 1); assert.equal(r.quizzes.length, 4); assert.equal(r.mitos.length, 2); assert.equal(r.noticias.length, 1);
  });
  await t('painel exige login', async () => { assert.equal((await J('GET', '/api/admin/conteudos')).status, 401); assert.equal((await J('POST', '/api/admin/conteudos', { tipo: 'quiz' })).status, 401); });
  await t('login errado é recusado', async () => { assert.equal((await J('POST', '/api/login', { usuario: 'infopathos', senha: 'errada' })).status, 401); assert.equal((await J('POST', '/api/login', { usuario: 'outro', senha: 'SenhaSoDeTeste-42' })).status, 401); });
  await t('login certo cria sessão (cookie HttpOnly)', async () => {
    const r = await J('POST', '/api/login', { usuario: 'InfoPathos', senha: 'SenhaSoDeTeste-42' });
    assert.equal(r.status, 200); const c = r.headers.get('set-cookie'); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); cookie = c.split(';')[0];
    assert.equal((await (await J('GET', '/api/me')).json()).logada, true);
  });
  let idRasc, idPub;
  await t('salva rascunho e ele não aparece no site', async () => {
    const r = await J('POST', '/api/admin/conteudos', { tipo: 'noticia', status: 'rascunho', dados: { titulo: 'Teste <b>x</b>' } });
    assert.equal(r.status, 201); idRasc = (await r.json()).item.id;
    const pub = await (await fetch(base + '/api/publico')).json(); assert.equal(pub.noticias.length, 1);
  });
  await t('publicar sem campos obrigatórios é recusado com mensagem clara', async () => {
    const r = await J('PUT', '/api/admin/conteudos/' + idRasc, { status: 'publicado', dados: { titulo: 'Teste' } });
    assert.equal(r.status, 422); assert.match((await r.json()).erro, /resumo/i);
  });
  await t('publica notícia completa e ela aparece no site', async () => {
    const r = await J('PUT', '/api/admin/conteudos/' + idRasc, { status: 'publicado', dados: { titulo: 'Nova notícia', resumo: 'Resumo', texto: 'P1\n\nP2', data: '2026-10-01', fonte_nome: 'G1', fonte_url: 'https://g1.globo.com/x' } });
    assert.equal(r.status, 200); idPub = idRasc;
    const pub = await (await fetch(base + '/api/publico')).json(); assert.equal(pub.noticias.length, 2); assert.equal(pub.noticias[0].titulo, 'Nova notícia');
  });
  await t('recusa link com javascript: e imagem de fora', async () => {
    let r = await J('POST', '/api/admin/conteudos', { tipo: 'noticia', status: 'rascunho', dados: { titulo: 'x', fonte_url: 'javascript:alert(1)' } }); assert.equal(r.status, 422);
    r = await J('POST', '/api/admin/conteudos', { tipo: 'noticia', status: 'rascunho', dados: { titulo: 'x', imagem: 'https://evil.com/a.png' } }); assert.equal(r.status, 422);
  });
  await t('quiz e mito válidos', async () => {
    let r = await J('POST', '/api/admin/conteudos', { tipo: 'quiz', status: 'publicado', dados: { pergunta: 'P?', alternativas: ['a', 'b', 'c', 'd'], correta: 2, explicacao: 'E', fontes: [{ titulo: 'F', url: 'https://x.org' }] } }); assert.equal(r.status, 201);
    r = await J('POST', '/api/admin/conteudos', { tipo: 'mito', status: 'publicado', dados: { afirmacao: 'A', tipo: 'fato', explicacao: 'E', fontes: [{ titulo: 'F', url: 'https://x.org' }] } }); assert.equal(r.status, 201);
    r = await J('POST', '/api/admin/conteudos', { tipo: 'quiz', status: 'publicado', dados: { pergunta: 'P?', alternativas: ['a', 'b', '', 'd'], correta: 1, explicacao: 'E', fontes: [] } }); assert.equal(r.status, 422);
  });
  await t('upload valida o conteúdo real da imagem', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    let r = await J('POST', '/api/admin/imagem', { dados: 'data:image/png;base64,' + png.toString('base64') }); assert.equal(r.status, 201);
    const u = (await r.json()).url; assert.equal((await fetch(base + u)).status, 200);
    r = await J('POST', '/api/admin/imagem', { dados: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>padding').toString('base64') }); assert.equal(r.status, 422);
  });
  await t('exclui conteúdo', async () => { assert.equal((await J('DELETE', '/api/admin/conteudos/' + idPub)).status, 200); assert.equal((await J('DELETE', '/api/admin/conteudos/' + idPub)).status, 404); });
  await t('logout encerra a sessão', async () => { await J('POST', '/api/logout', {}); cookie = ''; assert.equal((await J('GET', '/api/admin/conteudos')).status, 401); });
  await t('cookie adulterado não vale', async () => { cookie = 'ip_sessao=' + encodeURIComponent('eyJ1IjoiaW5mb3BhdGhvcyIsImV4cCI6OTk5OTk5OTk5OTk5OX0.assinaturafalsa'); assert.equal((await J('GET', '/api/admin/conteudos')).status, 401); cookie = ''; });
  await t('bloqueia força bruta (5 erros)', async () => {
    let ultimo; for (let i = 0; i < 6; i++) ultimo = await J('POST', '/api/login', { usuario: 'infopathos', senha: 'x' + i });
    assert.equal(ultimo.status, 429);
    assert.equal((await J('POST', '/api/login', { usuario: 'infopathos', senha: 'SenhaSoDeTeste-42' })).status, 429);
  });
  console.log(`\n${ok} verificações passaram.`); srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
})();
