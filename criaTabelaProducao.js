const Database = require("better-sqlite3");

const db = new Database("smartagro.db");

try {
  console.log("🚀 Criando tabelas...");

  db.exec("PRAGMA foreign_keys = ON;");

  // 🔷 Tabela de unidades
  db.prepare(`
    CREATE TABLE IF NOT EXISTS unidades_medida (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE
    )
  `).run();

  // 🔷 Tabela de produção
  db.prepare(`
    CREATE TABLE IF NOT EXISTS producao_ibge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regiao_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      unidade_id INTEGER NOT NULL,
      quantidade REAL,
      familiar BOOLEAN NOT NULL DEFAULT 0,

      FOREIGN KEY (regiao_id) REFERENCES regioes(id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id),
      FOREIGN KEY (unidade_id) REFERENCES unidades_medida(id)
    )
  `).run();

  // 🔷 Índice (aqui 👇)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_producao_lookup
    ON producao_ibge (produto_id, regiao_id, familiar)
  `);

  console.log("✅ Tabelas e índice criados com sucesso!");

} catch (err) {
  console.error("❌ Erro:", err.message);
} finally {
  db.close();
}