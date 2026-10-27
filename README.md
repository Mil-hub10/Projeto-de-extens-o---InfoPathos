# InfoPathos

Site de informação em saúde (patologias, quiz, mitos e fatos e notícias) com uma área restrita para o grupo de Biomedicina publicar conteúdo. Feito pelo NúcleoTech.

Não tem dependências para instalar: roda só com o Node.js (versão 22.13 ou mais nova).

## Rodar no seu computador

Defina a senha do grupo (ela só vale na primeira vez que o site sobe) e inicie:

```
ADMIN_PASSWORD="UmaSenhaForte123" node server.js
```

No Windows (PowerShell):

```
$env:ADMIN_PASSWORD="UmaSenhaForte123"; node server.js
```

Abra http://localhost:3000. Na primeira vez o site cria o banco (`data/infopathos.db`), o conteúdo inicial (febre amarela) e o login do grupo, com o usuário `infopathos`. Se você não definir `ADMIN_PASSWORD`, o site gera uma senha aleatória e mostra no terminal uma única vez.

Entre pelo botão **Área da Biomedicina**, no canto superior direito.

## Trocar a senha depois

```
node trocar-senha.js "OutraSenhaForte123"
```

A senha é guardada criptografada (scrypt), nunca em texto puro, e nenhuma senha fica escrita no código. O comando também encerra as sessões abertas.

## Como o painel funciona

- **Publicar** coloca o conteúdo no ar na hora. **Salvar rascunho** guarda sem aparecer no site.
- Para tirar algo do ar sem apagar: Editar, depois "Tirar do ar (salvar como rascunho)".
- Todo conteúdo exige fonte para ser publicado. Links só aceitam http:// ou https://.
- Imagens: JPG, PNG ou WEBP; fotos grandes são reduzidas automaticamente.

## Colocar no ar

Qualquer hospedagem que rode Node 22.13+ serve (Render, Railway, Fly.io, um servidor próprio). O importante:

1. Comando de início: `node server.js` (não há etapa de build).
2. **Disco persistente**: o banco e as imagens ficam na pasta `DATA_DIR`. Aponte essa variável para um disco/volume persistente. Sem isso, o conteúdo publicado some quando o servidor reinicia. Em vários provedores o disco persistente é um recurso pago; confira no plano escolhido.
3. Variáveis: `NODE_ENV=production`, `DATA_DIR=<pasta do disco>`, `ADMIN_PASSWORD=<senha forte>` (antes da primeira execução; não escreva a senha em arquivos do repositório).
4. Use HTTPS (as hospedagens acima já oferecem). O cookie de sessão só é marcado como seguro em HTTPS.
5. Faça backup da pasta `DATA_DIR` de vez em quando.

## Segurança já incluída

Senha criptografada, sessão em cookie HttpOnly/SameSite, bloqueio de 5 tentativas erradas de login por 15 minutos, validação de tudo o que chega do painel, conferência do conteúdo real das imagens enviadas, cabeçalhos de segurança (CSP) e texto sempre exibido como texto (sem HTML).

## Testes

```
npm test
```

## Estrutura

- `server.js`: servidor e API
- `lib/`: banco (SQLite), login e validação
- `public/`: o site (HTML, CSS, JS e imagens)
- `seed.json`: conteúdo inicial (febre amarela, enviado pelo grupo)
- `test/`: testes automáticos

## Vídeo da página "Sobre nós"

A página tem um espaço reservado para o vídeo de apresentação. Para colocá-lo no ar, salve o vídeo como `public/assets/sobre.mp4` (formato MP4, H.264) e reinicie/atualize o site. Quando o arquivo existir, o vídeo aparece sozinho no lugar do aviso "Em breve". Dica: comprima o vídeo antes (até uns 50 MB) para carregar rápido no celular.
