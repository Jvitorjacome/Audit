// Conexão com o projeto Supabase real da QAVI ("Auditoria - Qavi").
// A publishable key é segura para expor no navegador: ela só abre a porta,
// quem decide o que pode ser lido/escrito são as políticas de RLS no banco
// (ver db/schema.sql) — sem elas, essa key sozinha não dá acesso a nada.
const SUPABASE_URL = "https://cxgwnnkcznswvpdophio.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f4zfokt0ApU-Etg2P6mwdA_nYMEAJ2N";

// `var` (não `const`/`let`) de propósito: se algo abaixo lançar erro, `sb`
// continua existindo (como null) em vez de travar os scripts seguintes com
// "ReferenceError: sb is not defined" — isso deixa o app.js mostrar um erro
// claro na tela em vez de simplesmente não fazer nada quando o usuário clica
// em "Entrar".
var sb = null;
var SUPABASE_INIT_ERROR = null;
try {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("A biblioteca supabase-js não carregou (conexão bloqueada, ad-blocker, ou CDN fora do ar).");
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} catch (err) {
  SUPABASE_INIT_ERROR = err;
  console.error("Falha ao inicializar o cliente Supabase:", err);
}
