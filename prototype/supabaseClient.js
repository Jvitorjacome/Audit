// Conexão com o projeto Supabase real da QAVI ("Auditoria - Qavi").
// A publishable key é segura para expor no navegador: ela só abre a porta,
// quem decide o que pode ser lido/escrito são as políticas de RLS no banco
// (ver db/schema.sql) — sem elas, essa key sozinha não dá acesso a nada.
const SUPABASE_URL = "https://cxgwnnkcznswvpdophio.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f4zfokt0ApU-Etg2P6mwdA_nYMEAJ2N";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
