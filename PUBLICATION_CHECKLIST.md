# Checklist de publicação — Lunaris Licita

> **Não tornar o repositório privado original público.** O repositório de desenvolvimento contém histórico, branches e material operacional que não fazem parte desta exportação.

## Repositório de destino

- Nome sugerido: `Lunaris_Licita_Public`
- Proprietário: conta pessoal do mantenedor
- Visibilidade inicial: **Private** (staging); mudar para **Public** somente depois de todos os gates passarem
- Licença: **nenhuma nesta etapa**. A publicação do código não concede licença de reutilização.
- Criar vazio: não inicializar com README, .gitignore ou licença.

A disponibilidade do nome foi consultada em 09/11/2026; confirmar novamente ao criar. O repositório de staging deve começar vazio, sem README, .gitignore ou licença.

## Por que a exportação deve começar com um commit novo

A branch privada de preparação contém apenas a árvore sanitizada, mas os metadados dos commits dessa branch ainda foram criados com o e-mail principal da conta GitHub. **Não publicar nem importar a branch como histórico Git.**

Use o ZIP da branch no GitHub para obter somente os arquivos, sem a pasta/histórico Git. O novo repositório deve começar com um commit inicial criado depois de configurar o endereço noreply.

## Antes do primeiro commit

1. Na conta GitHub, abra Settings → Emails.
2. Ative **Keep my email addresses private**.
3. Confirme o endereço noreply exibido pelo GitHub. O formato associado a esta conta é `299233911+caiolunardi@users.noreply.github.com`; confira-o na página de configurações antes de usar.
4. Ative também o bloqueio de pushes que exponham o e-mail, se disponível.

## Preparar e verificar o ZIP no Windows

Extraia o ZIP da branch `public-snapshot/2026-11-09` para uma pasta nova e vazia. Não copie a pasta `.git` do repositório privado.

No PowerShell, dentro da pasta extraída:

```powershell
# 1. Varredura do conteúdo antes de criar qualquer histórico
gitleaks dir --redact .

# 2. Criar um histórico novo, independente
git init -b main
git config user.name "Caio Lunardi"
git config user.email "299233911+caiolunardi@users.noreply.github.com"

# 3. Criar o único commit inicial e conferir seu histórico
git add -A
git commit -m "chore: initial sanitized public source export"
gitleaks git --redact .

# 4. Só depois de as duas varreduras passarem, conectar ao novo repositório vazio
git remote add origin https://github.com/caiolunardi/Lunaris_Licita_Public.git
git push -u origin main
```

Se qualquer varredura apontar um segredo real, **não publicar**. Remova o valor, verifique se houve exposição anterior e rotacione a credencial quando aplicável. Não adicione allowlists para silenciar achados sem investigação.

## Depois do primeiro push

1. Confirmar que o repositório novo continua **privado** e que o original também continua privado.
2. Abrir Actions e executar manualmente **Public snapshot CI** (workflow_dispatch).
3. Exigir sucesso de Gitleaks, testes JavaScript/Workerd, testes SQLite/migrations e typecheck/testes/build da UI.
4. Conferir que o commit inicial e os commits subsequentes usam somente o endereço noreply.
5. Se qualquer job falhar ou houver achado de segurança, corrigir ainda em privado.
6. Somente após todos os gates passarem, alterar a visibilidade do repositório novo para **Public**.
7. Habilitar Private vulnerability reporting nas configurações de Security, se disponível.
8. Não configurar Cloudflare, OAuth, Drive, D1, R2, e-mail ou Gemini como parte da publicação do código.

## Limites do snapshot

- Não inclui dados reais do Apps Script/Sheets/Drive.
- Não habilita integrações externas nem autoriza deploy.
- Não é uma declaração de homologação funcional ou de segurança para produção.
- Não contém licença open source.
