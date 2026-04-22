const Database = require("better-sqlite3");

const db = new Database("smartagro.db");

try {
  console.log("📊 INSPEÇÃO DO BANCO DE DADOS\n");

  // 🔷 Listar tabelas
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    AND name NOT LIKE 'sqlite_%'
  `).all();

  tables.forEach((table) => {
    const tableName = table.name;

    console.log("=================================");
    console.log(`📁 Tabela: ${tableName}`);

    // 🔷 Estrutura
    const schema = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name = ?
    `).get(tableName);

    console.log("\n📐 Estrutura:");
    console.log(schema.sql);

    // 🔷 Índices
    const indexes = db.prepare(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='index' AND tbl_name = ?
    `).all(tableName);

    if (indexes.length > 0) {
      console.log("\n⚡ Índices:");
      indexes.forEach(idx => {
        console.log(`- ${idx.name}`);
        if (idx.sql) console.log(`  ${idx.sql}`);
      });
    }

    // 🔷 Contagem de registros
    const count = db.prepare(`
      SELECT COUNT(*) as total FROM ${tableName}
    `).get();

    console.log(`\n📦 Registros: ${count.total}`);

    console.log("=================================\n");
  });

} catch (err) {
  console.error("❌ Erro:", err.message);
} finally {
  db.close();
}