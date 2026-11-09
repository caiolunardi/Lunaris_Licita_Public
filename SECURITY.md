# Política de segurança

## Escopo

Este repositório contém código em desenvolvimento. Não o utilize para processar dados financeiros reais nem o conecte a serviços de produção sem uma revisão independente e autorização explícita.

## Reportar vulnerabilidades

Não publique detalhes exploráveis em issues, pull requests ou discussões públicas. Use o recurso **Private vulnerability reporting / Security Advisories** do GitHub, se estiver habilitado para este repositório. Caso não esteja disponível, entre em contato privadamente com o mantenedor pelo GitHub para combinar um canal seguro.

Inclua uma descrição, impacto, passos mínimos de reprodução e versão/commit afetado. Não anexe dados pessoais, documentos, tokens ou segredos.

## Regras para contribuições

- Nunca commitar tokens, senhas, chaves privadas, segredos OAuth ou valores de secrets.
- Não commitar IDs de planilhas, pastas, buckets, bancos ou recursos privados.
- Não utilizar dados reais de pessoas, empresas, fornecedores, órgãos, pagamentos ou documentos em fixtures e testes.
- Use exclusivamente dados sintéticos claramente identificados.
- Armazene credenciais fora do repositório, em variáveis de ambiente locais ou secret stores apropriados.
- Revogue e rotacione imediatamente qualquer credencial que tenha sido exposta; apagar o arquivo não remove o segredo do histórico Git.
- Não habilite integrações externas, envios, pagamentos, armazenamento ou IA em produção sem revisão de segurança e autorização específica.

## Limitações

A presença de testes automatizados não equivale a auditoria de segurança, homologação funcional ou aprovação para produção.