# Nexo PWA — Fase 13I

Objetivo: recuperar paridade funcional da PWA e melhorar a Visão Geral.

## Entregue nesta fase
- Dashboard principal mais limpo com resultado, linha de evolução mensal (realizado + previsto), visão geral compacta e gráfico de despesas por categoria.
- Movimentações: editar e excluir entradas/saídas existentes.
- Prioridades: progresso, editar e excluir.
- Investimentos: editar e excluir.
- Dívidas: progresso, editar e excluir.
- Viagens: botão **Ver mais**, progresso do orçamento, passagens/hospedagens/outros itens, adicionar/editar/excluir itens e editar/excluir viagem.
- Cartões: **Ver fatura**, listar compras/parcelas, adicionar/editar/excluir compras e editar/excluir cartão.
- Calendário: editar/excluir lembretes.
- Perfil: personalizar o terceiro atalho da barra (Uber, Cartões, Prioridades, Viagens ou Investimentos) por perfil.
- Sincronização continua usando a mesma tabela `finance_records` do Supabase.
- Ícone do iOS refeito em full-bleed para evitar halo/fundo branco ao adicionar à Tela de Início.
- Cache do service worker incrementado para forçar atualização dos arquivos.

## Publicação
Substitua os arquivos do repositório `nexo-pwa` pelo conteúdo deste ZIP. A Vercel deve redeployar automaticamente.

No iPhone, por causa do cache de ícone do iOS, remova o atalho antigo da Tela de Início e adicione novamente pelo Safari após o novo deploy.
