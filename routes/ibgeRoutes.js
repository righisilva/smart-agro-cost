const express = require("express");
const router = express.Router();

module.exports = (db) => {

  router.get("/subclassificacoes", (req, res) => {
    try {
      const { classificacao, idioma } = req.query;
      const SUFIXOS = { pt: "", en: "_en", es: "_es" };
      const sufixo = SUFIXOS.hasOwnProperty(idioma) ? SUFIXOS[idioma] : "";
  
      const colNomeSelect = sufixo
        ? `COALESCE(NULLIF(s.nome${sufixo}, ''), s.nome)`
        : "s.nome";
  
      const query = `
        SELECT s.nome AS value, ${colNomeSelect} AS label
        FROM subclassificacoes_ibge s
        JOIN classificacoes_ibge c ON s.classificacao_id = c.id
        WHERE c.nome = @classificacao
        ORDER BY s.nome
      `;
  
      const dados = db.prepare(query).all({ classificacao });
      res.json(dados);
    } catch (err) {
      console.error("Erro subclassificações:", err);
      res.status(500).send("Erro ao consultar subclassificações");
    }
  });

  // 🔹 GET /api/ibge
  router.get("/", (req, res) => {
    try {
      const { regiao, classificacao, subclassificacao, familiar, obrigatorio, top, orderBy, idioma } = req.query;

      console.log("🔧 Subclassificação:", subclassificacao);
      console.log("🌐 Idioma:", idioma);

      // Whitelist de idiomas -> sufixo de coluna. NUNCA usar `idioma` direto na query.
      const SUFIXOS = { pt: "", en: "_en", es: "_es" };
      const sufixo = SUFIXOS.hasOwnProperty(idioma) ? SUFIXOS[idioma] : "";

      // Monta a expressão da coluna traduzida com fallback pro pt-br
      // quando a tradução for nula/vazia (evita "buraco" no idioma)
      const colTraduzida = (tabela, campoBase = "nome") => {
        if (!sufixo) return `${tabela}.${campoBase}`;
        return `COALESCE(NULLIF(${tabela}.${campoBase}${sufixo}, ''), ${tabela}.${campoBase})`;
      };

      // Colunas SEMPRE em português — usadas nos filtros (WHERE),
      // porque o front manda os values dos <select> fixos em pt-BR.
      const colRegiaoFiltro = "r.nome";
      const colClassificacaoFiltro = "c.nome";
      const colSubclassificacaoFiltro = "s.nome";

      // Colunas traduzidas — usadas SÓ no SELECT (o que volta pro front)
      const colRegiaoSelect = colTraduzida("r");
      const colProdutoSelect = colTraduzida("p");
      const colClassificacaoSelect = colTraduzida("c");
      const colSubclassificacaoSelect = colTraduzida("s");

      let query = `
          SELECT i.id,
                 p.id AS produto_id,
                 ${colRegiaoSelect} AS regiao,
                 ${colProdutoSelect} AS produto,
                 ${colClassificacaoSelect} AS classificacao,
                 ${colSubclassificacaoSelect} AS subclassificacao,
                 i.estabelecimentos, i.valor_vendas, i.familiar,
                 p.rastreabilidade_obrigatoria AS obrigatorio
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

      // Filtros sempre comparam contra a coluna em português
      if (regiao) { query += ` AND ${colRegiaoFiltro} = @regiao`; params.regiao = regiao; }
      if (classificacao) { query += ` AND ${colClassificacaoFiltro} = @classificacao`; params.classificacao = classificacao; }
      if (subclassificacao && subclassificacao !== "undefined") {
        query += ` AND ${colSubclassificacaoFiltro} = @subclassificacao`;
        params.subclassificacao = subclassificacao;
      }
      if (familiar !== undefined) { query += " AND i.familiar = @familiar"; params.familiar = Number(familiar); }
      console.log("🔧 Rastreabilidade Obrigatória:", obrigatorio);
      if (obrigatorio !== "") { query += " AND p.rastreabilidade_obrigatoria = @obrigatorio"; params.obrigatorio = Number(obrigatorio); }

      const dados = db.prepare(query).all(params);

      const chaveOrdenacao = orderBy === "estabelecimentos" ? "estabelecimentos" : "valor_vendas";

      // 🔥 Agrupamos por produto_id (estável, não depende do idioma).
      // O nome exibido (já traduzido) é armazenado junto de cada registro.
      const agregados = {}; // produto_id -> soma

      dados.forEach(d => {
        agregados[d.produto_id] = (agregados[d.produto_id] || 0) + (d[chaveOrdenacao] || 0);
      });

      let produtosOrdenados = Object.entries(agregados)
        .sort((a, b) => b[1] - a[1]);

      const topN = top ? Number(top) : produtosOrdenados.length;
      produtosOrdenados = produtosOrdenados.slice(0, topN);

      const resultado = produtosOrdenados.map(([produtoId, valor]) => {
        const registros = dados.filter(d => String(d.produto_id) === String(produtoId));
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