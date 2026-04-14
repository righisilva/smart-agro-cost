const express = require("express");

module.exports = (db) => {
  const router = express.Router();

  const { Pool } = require("pg");

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // --- Endpoint combinado: IBGE + Custos de Contrato ---
  router.get("/", async (req, res) => {
    try {
      const {
        regiao,
        classificacao,
        subclassificacao,
        familiar,
        obrigatorio,
        top,
        orderBy,
        contract,
        network,
        functionName,
        tipo_calculo,
        funcoes,
        data_inicio,  // 🔥 NOVO: timestamp da data inicial
        data_fim,     // 🔥 NOVO: timestamp da data final
      } = req.query;

      console.log("🔧 Tipo de cálculo selecionado:", tipo_calculo);
      console.log("🔧 Subclassificação:", subclassificacao);
      
      // 🔥 Log das datas se for período personalizado
      if (tipo_calculo === 'custom') {
        console.log("📅 Período personalizado:");
        console.log("   Data Início:", data_inicio, new Date(Number(data_inicio)).toLocaleString('pt-BR'));
        console.log("   Data Fim:", data_fim, new Date(Number(data_fim)).toLocaleString('pt-BR'));
      }
      
      // Parse das funções selecionadas
      let funcoesSelecionadas = [];
      let usarTodasFuncoes = false;
      
      if (funcoes && funcoes !== 'undefined' && funcoes !== 'null') {
        try {
          funcoesSelecionadas = JSON.parse(funcoes);
          console.log("📋 Funções selecionadas:", funcoesSelecionadas);
          
          if (funcoesSelecionadas.length === 0) {
            usarTodasFuncoes = true;
          }
        } catch (e) {
          console.error('❌ Erro ao parsear funções:', e);
          usarTodasFuncoes = true;
        }
      } else if (functionName && functionName !== '') {
        console.log("📋 Usando função única (modo legado):", functionName);
        funcoesSelecionadas = [{ name: functionName, executions: 1 }];
      } else {
        usarTodasFuncoes = true;
      }

      // ---------------- IBGE ----------------
      let queryIBGE = `
        SELECT
          i.id,
          r.nome AS regiao,
          p.nome AS produto,
          c.nome AS classificacao,
          s.nome AS subclassificacao,
          i.estabelecimentos,
          i.valor_vendas,
          i.familiar,
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
      const paramsIBGE = {};

      if (regiao) { queryIBGE += " AND r.nome = @regiao"; paramsIBGE.regiao = regiao; }
      if (classificacao) { queryIBGE += " AND c.nome = @classificacao"; paramsIBGE.classificacao = classificacao; }
      if (subclassificacao && subclassificacao !== "undefined") {
        queryIBGE += " AND s.nome = @subclassificacao";
        paramsIBGE.subclassificacao = subclassificacao;
      }      
      if (familiar !== undefined) { queryIBGE += " AND i.familiar = @familiar"; paramsIBGE.familiar = Number(familiar); }
      if (obrigatorio !== undefined) { queryIBGE += " AND p.rastreabilidade_obrigatoria = @obrigatorio"; paramsIBGE.obrigatorio = Number(obrigatorio); }

      const dadosIBGE = db.prepare(queryIBGE).all(paramsIBGE);
      if (!dadosIBGE.length) return res.json([]);

      // ---------------- CONTRATOS ----------------
      let queryContratos = `
        SELECT
          c.id AS contract_id,
          c.name AS contract_name,
          f.name AS function_name,
          f.id AS function_id,
          n.name AS network,
          n.id AS network_id,
          d.gas_used,
          d.cost_usd,
          d.cost_brl
        FROM contracts c
        JOIN contract_functions f ON f.contract_id = c.id
        JOIN contract_function_costs d ON d.function_id = f.id
        JOIN networks n ON n.id = d.network_id
        WHERE 1=1
      `;
      
      const paramsContratos = {};

      if (contract) { 
        queryContratos += " AND c.name = @contract"; 
        paramsContratos.contract = contract;
      }
      if (network) { 
        queryContratos += " AND n.name = @network"; 
        paramsContratos.network = network;
      }
      
      // Se temos funções específicas, construir IN clause com nomes literais
      if (!usarTodasFuncoes && funcoesSelecionadas.length > 0) {
        const functionNames = funcoesSelecionadas.map(f => `'${f.name.replace(/'/g, "''")}'`).join(',');
        queryContratos += ` AND f.name IN (${functionNames})`;
      }

      console.log("📝 Query Contratos:", queryContratos);
      console.log("📝 Params:", paramsContratos);

      const dadosContratos = db.prepare(queryContratos).all(paramsContratos);
      
      if (!dadosContratos.length) {
        console.log("⚠️ Nenhum contrato encontrado");
        return res.json([]);
      }

      // Agrupar custos por função
      const custoPorFuncao = {};
      dadosContratos.forEach(d => {
        const funcName = d.function_name;
        const networkName = d.network;
        const key = `${funcName}|${networkName}`;
        
        if (!custoPorFuncao[key]) {
          custoPorFuncao[key] = {
            function_name: funcName,
            network: networkName,
            gas_used: d.gas_used || 0,
            cost_brl: d.cost_brl || 0
          };
        }
      });
      
      // Calcular custo base por função considerando tipo de cálculo
      const custoBasePorFuncao = {};
      for (const [key, value] of Object.entries(custoPorFuncao)) {
        let custoFuncaoBRL = value.cost_brl;
        const gasFuncao = value.gas_used;
        
        // 🔥 MODIFICADO: Suporte para período personalizado
        if (tipo_calculo !== 'ultima') {
          console.log(`📊 Buscando dados históricos para função ${value.function_name} na rede ${value.network}`);
          
          let queryGas = `
            SELECT AVG(g.gas_gwei * 1e-9 * g.price_brl) AS avg_cost_per_gas
            FROM gas_history g
            JOIN networks n ON n.id = g.network_id
            WHERE n.name = $1
          `;
          
          const queryParams = [value.network];
          
          // 🔥 NOVO: Período personalizado
          if (tipo_calculo === 'custom') {
            if (data_inicio && data_fim) {
              // Converter timestamps para datas PostgreSQL
              const dataInicioDate = new Date(Number(data_inicio));
              const dataFimDate = new Date(Number(data_fim));
              
              queryGas += ` AND g.timestamp >= $2 AND g.timestamp <= $3`;
              queryParams.push(dataInicioDate, dataFimDate);
              console.log(`   📅 Filtro personalizado: ${dataInicioDate.toISOString()} até ${dataFimDate.toISOString()}`);
            } else {
              console.warn("⚠️ Período personalizado selecionado mas sem datas, usando fallback para 'all'");
              // Fallback: usar todo período se não houver datas
              tipo_calculo = 'all';
            }
          }
          
          // Períodos predefinidos
          const intervals = {
            day: "1 day",
            week: "7 days",
            month: "30 days"
          };
          
          if (intervals[tipo_calculo] && tipo_calculo !== 'custom') {
            queryGas += ` AND g.timestamp >= NOW() - INTERVAL '${intervals[tipo_calculo]}'`;
          }
          
          try {
            console.log("📝 Query Gas:", queryGas);
            console.log("📝 Params:", queryParams);
            
            const { rows } = await pgPool.query(queryGas, queryParams);
            const custoMedioPorGas = Number(rows[0]?.avg_cost_per_gas) || 0;
            custoFuncaoBRL = gasFuncao * custoMedioPorGas;
            
            console.log(`   📊 Custo médio por gas: ${custoMedioPorGas.toFixed(10)}`);
            console.log(`   💰 Custo função: ${custoFuncaoBRL.toFixed(6)}`);
          } catch (err) {
            console.error(`❌ Erro ao buscar média para ${value.function_name}:`, err);
            custoFuncaoBRL = value.cost_brl; // fallback para o valor padrão
          }
        }
        
        custoBasePorFuncao[value.function_name] = {
          custo_brl: custoFuncaoBRL,
          gas_used: gasFuncao
        };
      }
      
      // Calcular custo TOTAL considerando múltiplas execuções
      let custoTotalFuncoesBRL = 0;
      let gasTotal = 0;
      
      if (usarTodasFuncoes) {
        // Usar todas as funções com 1 execução cada
        for (const [funcName, custoData] of Object.entries(custoBasePorFuncao)) {
          custoTotalFuncoesBRL += custoData.custo_brl;
          gasTotal += custoData.gas_used;
        }
        console.log(`📊 Usando TODAS as funções (${Object.keys(custoBasePorFuncao).length} funções)`);
      } else {
        // Usar apenas as funções selecionadas com seus multiplicadores
        for (const funcSelecionada of funcoesSelecionadas) {
          const custoData = custoBasePorFuncao[funcSelecionada.name];
          if (custoData) {
            const multiplicador = Number(funcSelecionada.executions) || 1;
            custoTotalFuncoesBRL += custoData.custo_brl * multiplicador;
            gasTotal += custoData.gas_used * multiplicador;
            console.log(`  🔹 ${funcSelecionada.name}: ${multiplicador}x = R$ ${(custoData.custo_brl * multiplicador).toFixed(6)}`);
          } else {
            console.warn(`⚠️ Função "${funcSelecionada.name}" não encontrada no contrato`);
          }
        }
      }

      console.log(`💰 Custo Total Funções: R$ ${custoTotalFuncoesBRL.toFixed(6)}`);
      console.log(`⛽ Gas Total: ${gasTotal}`);

      // ---------------- AGREGAÇÃO ----------------
      const agregados = {};

      dadosIBGE.forEach(d => {
        const estabelecimentos = Number(d.estabelecimentos) || 0;
        const chave = `${d.produto} | ${d.classificacao}`;

        if (!agregados[chave]) {
          agregados[chave] = {
            produto: d.produto,
            classificacao: d.classificacao,
            regiao: d.regiao,
            familiar: d.familiar,
            obrigatorio: d.obrigatorio,
            estabelecimentos: 0,
            total_estimado_brl: 0,
            valor_vendas: d.valor_vendas
          };
        }

        agregados[chave].estabelecimentos += estabelecimentos;
        agregados[chave].total_estimado_brl += estabelecimentos * custoTotalFuncoesBRL;
      });

      const resultado = Object.values(agregados).map(d => {
        const totalEstimado = d.total_estimado_brl;
        const valorVendas = (Number(d.valor_vendas) || 0) * 1000;
        const percentual = valorVendas > 0 ? Number(((totalEstimado / valorVendas) * 100).toFixed(2)) : 0;

        return {
          produto: d.produto,
          regiao: d.regiao,
          classificacao: d.classificacao,
          familiar: d.familiar,
          obrigatorio: d.obrigatorio,
          estabelecimentos: d.estabelecimentos,
          valor_vendas: valorVendas,
          total_estimado_brl: Number(totalEstimado.toFixed(2)),
          custo_total_funcoes_brl: Number(custoTotalFuncoesBRL.toFixed(6)),
          custo_medio_contrato_brl: Number(custoTotalFuncoesBRL.toFixed(2)),
          percentual_custo: percentual,
          gas_contrato: gasTotal,
          // 🔥 Informação do período usado (para debug)
          periodo_usado: tipo_calculo === 'custom' ? 
            `Personalizado: ${data_inicio ? new Date(Number(data_inicio)).toLocaleDateString('pt-BR') : '?'} até ${data_fim ? new Date(Number(data_fim)).toLocaleDateString('pt-BR') : '?'}` : 
            tipo_calculo
        };
      });

      // Ordenação
      switch (orderBy) {
        case "estabelecimentos":
          resultado.sort((a, b) => b.estabelecimentos - a.estabelecimentos);
          break;
        case "valor_vendas":
          resultado.sort((a, b) => b.valor_vendas - a.valor_vendas);
          break;
        default:
          resultado.sort((a, b) => b.total_estimado_brl - a.total_estimado_brl);
      }

      const topN = top ? Number(top) : resultado.length;
      
      console.log(`✅ Simulação concluída: ${resultado.slice(0, topN).length} produtos retornados`);
      
      res.json(resultado.slice(0, topN));

    } catch (err) {
      console.error("❌ Erro em /results:", err);
      res.status(500).json({ 
        error: "Erro ao gerar resultados combinados",
        details: err.message 
      });
    }
  });

  return router;
};