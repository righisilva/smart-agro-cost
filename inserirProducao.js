const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const csvParser = require("csv-parser");

const db = new Database("smartagro.db");
const csvFile = path.resolve(__dirname, "producaoBovina.csv");

// 🔷 Normalizar valores
const parseValue = (v) => {
  if (!v || v === "X") return null;
  return Number(v);
};

// 🔷 Buscar produto
const getProduto = db.prepare(`
  SELECT id FROM produtos WHERE nome = ?
`);

// 🔷 Buscar região
const getRegiao = db.prepare(`
  SELECT id FROM regioes WHERE nome = ?
`);

// 🔷 Buscar ou criar unidade
const getOrCreateUnidade = (nome) => {
  let u = db.prepare(`
    SELECT id FROM unidades_medida WHERE nome = ?
  `).get(nome);

  if (!u) {
    const result = db.prepare(`
      INSERT INTO unidades_medida (nome) VALUES (?)
    `).run(nome);

    u = { id: result.lastInsertRowid };
    console.log(`🆕 Unidade criada: ${nome}`);
  }

  return u.id;
};

// 🔷 Insert produção
const insertProducao = db.prepare(`
  INSERT INTO producao_ibge 
  (regiao_id, produto_id, unidade_id, quantidade, familiar)
  VALUES (?, ?, ?, ?, ?)
`);

fs.createReadStream(csvFile)
  .pipe(csvParser({
    mapHeaders: ({ header }) => header.trim(),
    mapValues: ({ value }) => value?.trim()
  }))
  .on("data", (row) => {

    const produtoNome = row["Produtos"];
    const unidadeNome = row["Unidade"];

    if (!produtoNome || !unidadeNome) {
      console.warn("⚠️ Linha inválida:", row);
      return;
    }

    const produto = getProduto.get(produtoNome);
    if (!produto) {
      console.warn(`⚠️ Produto não encontrado: ${produtoNome}`);
      return;
    }

    const unidadeId = getOrCreateUnidade(unidadeNome);

    const regioes = [
      { nome: "Brasil", tipo: "Total" },
      { nome: "Sul", tipo: "Total" },
      { nome: "RS", tipo: "Total" },
      { nome: "Alegrete", tipo: "Total" },
      { nome: "Brasil", tipo: "Familiar" },
      { nome: "Sul", tipo: "Familiar" },
      { nome: "RS", tipo: "Familiar" },
      { nome: "Alegrete", tipo: "Familiar" }
    ];

    regioes.forEach((r) => {
      const coluna = `${r.nome} ${r.tipo}`;
      const valor = parseValue(row[coluna]);

      if (valor === null) return;

      const regiao = getRegiao.get(r.nome);

      if (!regiao) {
        console.warn(`⚠️ Região não encontrada: ${r.nome}`);
        return;
      }

      insertProducao.run(
        regiao.id,
        produto.id,
        unidadeId,
        valor,
        r.tipo === "Familiar" ? 1 : 0
      );
    });

    console.log(`✅ ${produtoNome} inserido`);
  })
  .on("end", () => {
    console.log("🎉 Importação de produção concluída!");
    db.close();
  })
  .on("error", (err) => {
    console.error("❌ Erro:", err.message);
  });