# Migrações arquivadas

As 33 migrações de 19–20/10/2026 que construíram o schema do Mapa. Foram consolidadas em `../migrations/20261021185253_base.sql` (ticket 30) e ficam aqui só como histórico: mostram por que cada função chegou à forma atual.

O Supabase CLI não lê esta pasta. No banco de produção, essas versões estão marcadas como `reverted` no histórico de migrações. Não mover os arquivos de volta para `../migrations/` nem reaplicá-los.
