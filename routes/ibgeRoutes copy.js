const express = require("express");
const router = express.Router();

module.exports = (db) => {

  // 🔹 GET /api/ibge
  router.get("/", (req, res) => {
    try {
      const { regiao, classificacao, subclassificacao, familiar, obrigatorio, top, orderBy } = req.query;
      
      console.log("🔧 Subclassificação:", subclassificacao);

      let query = `
          SELECT i.id, r.nome AS regiao, p.nome AS produto, c.nome AS classificacao, s.nome AS subclassificacao,
                 i.estabelecimentos, i.valor_vendas, i.familiar, p.rastreabilidade_obrigatoria AS obrigatorio
          FROM ibge_dados i
          JOIN produtos p ON i.produto_id = p.id
          LEFT JOIN subclassificacoes_ibge s 
                ON p.subclassificacao_id = s.id
          LEFT JOIN classificacoes_ibge c 
                ON s.classificacao_id = c.id
          JOIN regioes r ON i.regiao_id = r.id
          WHERE 1=1
      `;

      const params = {};

      if (regiao) { query += " AND r.nome = @regiao"; params.regiao = regiao; }
      if (classificacao) { query += " AND c.nome = @classificacao"; params.classificacao = classificacao; }
      if (classificacao) { query += " AND c.nome = @classificacao"; params.classificacao = classificacao; }
      if (subclassificacao && subclassificacao !== "undefined") {
        query += " AND s.nome = @subclassificacao";
        params.subclassificacao = subclassificacao;
      }      
      if (familiar !== undefined) { query += " AND i.familiar = @familiar"; params.familiar = Number(familiar); }
      console.log("🔧 Rastreabilidade Obrigatória:", obrigatorio);
      if (obrigatorio !== "") { query += " AND p.rastreabilidade_obrigatoria = @obrigatorio"; params.obrigatorio = Number(obrigatorio); }

      const dados = db.prepare(query).all(params);

      const chaveOrdenacao = orderBy === "estabelecimentos" ? "estabelecimentos" : "valor_vendas";

      const agregados = {};
      dados.forEach(d => {
        agregados[d.produto] = (agregados[d.produto] || 0) + (d[chaveOrdenacao] || 0);
      });

      let produtosOrdenados = Object.entries(agregados)
        .sort((a, b) => b[1] - a[1]);

      const topN = top ? Number(top) : produtosOrdenados.length;
      produtosOrdenados = produtosOrdenados.slice(0, topN);

      const resultado = produtosOrdenados.map(([produto, valor]) => {
        const registros = dados.filter(d => d.produto === produto);
        return registros.reduce((acc, r) => ({
          ...r,
          [chaveOrdenacao]: valor
        }), registros[0]);
      });

      res.json(resultado);

    } catch (err) {
      console.error("Erro IBGE:", err);
      res.status(500).send("Erro ao consultar dados IBGE");
    }
  });

  return router;
};
