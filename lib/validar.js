'use strict';
/* Valida e limpa o que chega do painel. Nada vai ao banco sem passar por aqui. */
const TIPOS = ['patologia', 'quiz', 'mito', 'noticia'];

function txt(v, max) { return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : ''; }
function urlOk(v) {
  const s = txt(v, 600);
  if (!s) return '';
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null; } catch { return null; }
}
function imgOk(v) {
  const s = txt(v, 200);
  if (!s) return '';
  return /^\/(uploads|assets)\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
}
function fontes(v, erros) {
  const lista = Array.isArray(v) ? v : [];
  const out = [];
  for (const f of lista.slice(0, 15)) {
    const titulo = txt(f && f.titulo, 200), url = urlOk(f && f.url);
    if (!titulo && !(f && f.url)) continue;
    if (url === null || (f && f.url && !url)) { erros.push(`O link da fonte "${titulo || '?'}" não parece válido (use http:// ou https://).`); continue; }
    if (!titulo) { erros.push('Toda fonte precisa de um nome.'); continue; }
    out.push({ titulo, url: url || '' });
  }
  return out;
}

function validar(tipo, d, status) {
  if (!TIPOS.includes(tipo)) return { erro: 'Categoria desconhecida.' };
  d = d && typeof d === 'object' ? d : {};
  const publicar = status === 'publicado';
  const erros = [];
  const exige = (cond, msg) => { if (publicar && !cond) erros.push(msg); };
  let titulo = '', dados = {};

  if (tipo === 'patologia') {
    const nome = txt(d.nome, 120);
    titulo = nome;
    const imagem = imgOk(d.imagem), cu = urlOk(d.credito_url);
    if (imagem === null) erros.push('Imagem inválida.');
    if (cu === null) erros.push('O link do crédito da imagem não parece válido.');
    const secoes = (Array.isArray(d.secoes) ? d.secoes : []).slice(0, 20).map((s) => ({
      titulo: txt(s && s.titulo, 120),
      alerta: !!(s && s.alerta),
      itens: (Array.isArray(s && s.itens) ? s.itens : []).map((i) => txt(i, 1200)).filter(Boolean).slice(0, 20)
    })).filter((s) => s.titulo || s.itens.length);
    secoes.forEach((s) => { if (!s.titulo || !s.itens.length) erros.push('Cada seção precisa de título e de pelo menos um item.'); });
    const f = fontes(d.fontes, erros);
    dados = { nome, resumo: txt(d.resumo, 700), imagem: imagem || '', credito_texto: txt(d.credito_texto, 150), credito_url: cu || '', secoes, fontes: f };
    exige(nome, 'Informe o nome da patologia.');
    exige(dados.resumo, 'Escreva o resumo (o que é).');
    exige(secoes.length, 'Adicione pelo menos uma seção.');
    exige(f.length, 'Cite pelo menos uma fonte.');
  }

  if (tipo === 'quiz') {
    const pergunta = txt(d.pergunta, 400);
    titulo = pergunta;
    const alt = (Array.isArray(d.alternativas) ? d.alternativas : []).slice(0, 4).map((a) => txt(a, 300));
    while (alt.length < 4) alt.push('');
    const correta = Number.isInteger(d.correta) ? d.correta : parseInt(d.correta, 10);
    const f = fontes(d.fontes, erros);
    dados = { pergunta, alternativas: alt, correta: correta >= 0 && correta <= 3 ? correta : 0, explicacao: txt(d.explicacao, 1800), fontes: f };
    exige(pergunta, 'Escreva a pergunta.');
    exige(alt.every(Boolean), 'Preencha as 4 alternativas.');
    exige(correta >= 0 && correta <= 3, 'Marque a alternativa correta.');
    exige(dados.explicacao, 'Escreva a explicação.');
    exige(f.length, 'Cite pelo menos uma fonte.');
  }

  if (tipo === 'mito') {
    const afirmacao = txt(d.afirmacao, 400);
    titulo = afirmacao;
    const tp = d.tipo === 'fato' ? 'fato' : d.tipo === 'mito' ? 'mito' : '';
    const f = fontes(d.fontes, erros);
    dados = { afirmacao, tipo: tp || 'mito', explicacao: txt(d.explicacao, 1800), fontes: f };
    exige(afirmacao, 'Escreva a afirmação.');
    exige(tp, 'Escolha se é mito ou fato.');
    exige(dados.explicacao, 'Escreva a explicação.');
    exige(f.length, 'Cite pelo menos uma fonte.');
  }

  if (tipo === 'noticia') {
    const tit = txt(d.titulo, 250);
    titulo = tit;
    const imagem = imgOk(d.imagem), cu = urlOk(d.credito_url), fu = urlOk(d.fonte_url);
    if (imagem === null) erros.push('Imagem inválida.');
    if (cu === null) erros.push('O link do crédito da imagem não parece válido.');
    if (fu === null) erros.push('O link da fonte não parece válido (use http:// ou https://).');
    const data = /^\d{4}-\d{2}-\d{2}$/.test(txt(d.data, 10)) ? txt(d.data, 10) : '';
    dados = { titulo: tit, resumo: txt(d.resumo, 800), texto: txt(d.texto, 20000), data, fonte_nome: txt(d.fonte_nome, 200), fonte_url: fu || '',
      imagem: imagem || '', credito_texto: txt(d.credito_texto, 150), credito_url: cu || '' };
    exige(tit, 'Escreva o título.');
    exige(dados.resumo, 'Escreva o resumo.');
    exige(dados.texto, 'Escreva o texto completo.');
    exige(data, 'Informe a data da notícia.');
    exige(dados.fonte_nome && dados.fonte_url, 'Informe o nome e o link da fonte.');
  }

  if (!titulo) titulo = '(sem título)';
  if (!publicar && titulo === '(sem título)') erros.push('Dê um título (ou nome) para salvar o rascunho.');
  if (erros.length) return { erro: erros[0], erros };
  return { titulo, dados };
}

module.exports = { validar, TIPOS };
