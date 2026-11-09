# Lunaris Licita

Aplicação web para apoiar a gestão de licitações e dos processos comerciais relacionados, do planejamento ao recebimento.

Este repositório foi preparado como uma **exportação de código com histórico novo e reduzido**. Foram excluídos deliberadamente o histórico privado de desenvolvimento, o aplicativo Apps Script legado e os registros internos de continuidade e auditoria. A varredura automatizada de segredos faz parte obrigatória do CI e precisa estar verde antes de qualquer publicação.

## Estado e limites

O projeto está em desenvolvimento. A interface React e os módulos de domínio estão versionados para inspeção e evolução; isso não significa que todos os fluxos estejam homologados ou liberados para uso real.

O snapshot não deve ser tratado como autorização para conectar bancos, contas Google, armazenamento externo, e-mail, modelos de IA ou dados financeiros reais. Qualquer implantação exige configuração própria, revisão de segurança, autenticação e autorização no servidor, testes e aprovação operacional.

Os dados demonstrativos presentes no código são fictícios. Não substitua esses dados por informações reais em commits, testes, issues ou capturas de tela.

## Estrutura

- `web/ui/`: interface React, componentes, testes e Worker de laboratório.
- `web/src/`: módulos de domínio e contratos do Worker.
- `web/integration/` e `web/tests/`: testes automatizados.
- `migrations/`: migrations SQL versionadas.
- `tests/`: testes de integridade e compatibilidade SQLite.
- `tools/emit-r7-sql-fixtures.mjs`: geração de fixtures SQL para testes.

## Requisitos

- Node.js 22.12 ou superior.
- npm compatível com a versão do Node.js.
- Python 3.10 ou superior para os testes SQLite.

## Desenvolvimento local

Instale as dependências do projeto e da interface:

```bash
npm install --no-save --no-package-lock
npm ci --prefix web/ui
```

Execute os testes JavaScript:

```bash
npm run test:node
```

Execute os testes Python:

```bash
node tools/emit-r7-sql-fixtures.mjs ./r7_statements.json
R7_SQL_FIXTURE=./r7_statements.json python -m unittest discover -s tests -v
```

Valide a interface:

```bash
npm run check --prefix web/ui
```

No PowerShell, defina a variável de ambiente com `$env:R7_SQL_FIXTURE="./r7_statements.json"` antes de executar os testes Python.

## Segurança e publicação

Leia [SECURITY.md](SECURITY.md) antes de reportar uma vulnerabilidade ou contribuir. A publicação deve seguir integralmente o [checklist de publicação](PUBLICATION_CHECKLIST.md); não torne o repositório privado de desenvolvimento público. Nunca versione tokens, segredos OAuth, IDs de recursos privados, dados pessoais, documentos, planilhas ou informações financeiras reais.

## Licença

Este snapshot não inclui uma licença de código aberto. A visibilidade pública do código, por si só, não concede autorização para reutilização, distribuição ou exploração comercial.