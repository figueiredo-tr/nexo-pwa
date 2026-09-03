# Nexo Web 1.0

Versão web responsiva baseada diretamente no renderer desktop completo do Nexo.

## Direção desta fase
- Site financeiro responsivo, não PWA.
- Mesmos módulos e operações do desktop como fonte de verdade.
- Persistência local no navegador + sincronização Supabase.
- Sidebar no desktop e menu lateral recolhível no celular.
- Dashboard com evolução mensal e despesas por categoria.

## Publicação na Vercel
Suba o conteúdo desta pasta na raiz do repositório `nexo-pwa` (o nome do repo pode ser mantido) e faça deploy como projeto estático / Other. Não há build command.

## Primeiro acesso
Abra Configurações > Banco central, informe os mesmos dados do Supabase e use Sincronizar agora. A versão web também tenta importar automaticamente a configuração/dados locais da antiga PWA quando estiver no mesmo navegador e domínio.
