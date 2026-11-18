# Auxiliar Honkai: Star Rail

Site pessoal (GitHub Pages) que lê sua conta pela HoYoLAB e recomenda:

- **O que fazer agora**: 5★ grátis, se vale puxar no banner atual e as correções de build mais importantes;
- **Times**: times do meta em ordem de prioridade, com o que você já pode montar e o que falta;
- **Builds**: nota de cada personagem com base nas relíquias, status principais, conjuntos, cone e traços;
- **Banners**: banner atual e os próximos, com veredito para conta F2P;
- **Conteúdo**: Memória do Caos, Ficção Pura e Sombra Apocalíptica da temporada, e quais times seus combinam.

Os dados da conta são **criptografados com a sua senha** (AES-256-GCM + PBKDF2) antes de ir para o site.
Os cookies ficam só nos Secrets do GitHub e nunca aparecem no site.

## Configuração (uma vez)

1. **Cookies da HoYoLAB**: entre em https://www.hoyolab.com no PC, aperte F12 → *Application* → *Cookies* →
   `https://www.hoyolab.com` e copie `ltuid_v2`, `ltoken_v2` e `ltmid_v2`.
2. Em **Settings → Secrets and variables → Actions → New repository secret**, crie:
   - `HOYOLAB_COOKIES` = `ltuid_v2=XXX; ltoken_v2=XXX; ltmid_v2=XXX`
   - `SITE_PASSWORD` = uma senha **forte** (o arquivo criptografado é público, então use 12+ caracteres)
3. Opcional, em *Variables*: `HSR_UID` (padrão `624603379`).
4. Em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.
5. Faça merge deste código na branch `main` e rode **Actions → "Atualizar conta e publicar site" → Run workflow**.

O site atualiza sozinho todo dia por volta das 06:17 (horário de Brasília). Se a coleta começar a falhar,
provavelmente os cookies venceram: pegue de novo e atualize o secret.

## Atualizar o meta

Times, tiers, banners e temporadas ficam em `site/meta.json`. Edite a cada patch (ou peça para o Claude atualizar).

## Testar localmente

```bash
pip install -r scripts/requirements.txt
HOYOLAB_COOKIES='ltuid_v2=...; ltoken_v2=...; ltmid_v2=...' SITE_PASSWORD=teste python scripts/fetch_account.py
cd site && python -m http.server 8000
```
