# Nexo PWA — Fase 13H

Versão web instalável do Nexo, pensada para iPhone sem Expo Go e sem Apple Developer.

## O que já funciona

- instalação pela Tela de Início no Safari;
- splash/branding Nexo;
- Visão Geral;
- Movimentos + lançamento de entrada/saída;
- Uber do dia;
- Assistente por texto gratuito;
- seleção de perfil;
- mesma sincronização Supabase do desktop/mobile;
- cache do último snapshot e app shell offline.

## Publicar grátis na Vercel

A pasta `pwa/` é estática. Crie um projeto Vercel apontando o Root Directory para `pwa` ou publique essa pasta como projeto estático.

Depois de publicada em HTTPS, abra a URL no Safari do iPhone.

## Instalar no iPhone

1. Abra a URL do Nexo no **Safari**.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.
4. Confirme o nome **Nexo**.
5. Abra pelo ícone criado.

Ele abre em modo standalone, sem a interface do Safari e sem Expo Go.

## Primeira configuração

Em **Mais**, informe os mesmos quatro valores já usados no mobile/desktop:

- Project URL;
- Anon / public key;
- ID da família;
- Chave da família.

Eles ficam salvos localmente neste dispositivo e o snapshot financeiro fica disponível para consulta mesmo se a conexão cair.

## Observação sobre offline

A interface e o último snapshot ficam em cache. Novos lançamentos ainda precisam de internet para chegar ao Supabase; uma fila de escrita offline pode ser adicionada em uma próxima fase.
