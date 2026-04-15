const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

router.get("/", async (req, res) => {
  console.log("📦 Recebendo requisição:", req.query);
  
  try {
    const { network, period, gasUnits, data_inicio, data_fim } = req.query;

    // Permitir múltiplas redes
    const networks = [];
    if (Array.isArray(req.query.network)) {
      networks.push(...req.query.network);
    } else if (req.query.network) {
      networks.push(req.query.network);
    }

    const units = Number(gasUnits) || 21000;

    let query = `
      SELECT 
        n.name AS network,
        g.timestamp,
        g.gas_gwei,
        g.price_brl,
        (g.gas_gwei * 1e-9 * g.price_brl * $1) AS gas_cost_brl
      FROM gas_history g
      JOIN networks n ON n.id = g.network_id
      WHERE 1=1
    `;

    const params = [units];
    let paramIndex = 2;

    // Filtro de rede
    if (networks.length > 0) {
      const placeholders = networks.map((_, i) => `$${paramIndex + i}`).join(', ');
      query += ` AND n.name IN (${placeholders})`;
      params.push(...networks);
      paramIndex += networks.length;
    }

    // 🔥 NOVO: Filtro de período personalizado (prioridade máxima)
    if (period === "custom" && data_inicio && data_fim) {
      // Converter timestamps para TIMESTAMP do PostgreSQL
      const dataInicioTimestamp = Number(data_inicio);
      const dataFimTimestamp = Number(data_fim);
      
      const dataInicioDate = new Date(dataInicioTimestamp);
      const dataFimDate = new Date(dataFimTimestamp);
      
      // Validar se as datas são válidas
      if (isNaN(dataInicioTimestamp) || isNaN(dataFimTimestamp)) {
        console.error("❌ Datas inválidas:", { data_inicio, data_fim });
        return res.status(400).json({ 
          error: "Datas inválidas para período personalizado" 
        });
      }
      
      // Adicionar filtro de data
      query += ` AND g.timestamp >= $${paramIndex} AND g.timestamp <= $${paramIndex + 1}`;
      params.push(dataInicioDate, dataFimDate);
      
      console.log(`📅 Período personalizado UTC:`);
      console.log(`   Início: ${dataInicioDate.toISOString()}`);
      console.log(`   Fim: ${dataFimDate.toISOString()}`);
      
      paramIndex += 2;
    } 
    // Períodos predefinidos (day, week, month)
    else if (period && period !== "all") {
      const intervals = {
        'day': '1 day',
        'week': '7 days',
        'month': '30 days'
      };
      
      if (intervals[period]) {
        // 🔥 Usar CURRENT_TIMESTAMP AT TIME ZONE 'UTC' para consistência
        query += ` AND g.timestamp >= NOW() - INTERVAL '${intervals[period]}'`;
        console.log(`📅 Período predefinido: ${intervals[period]} atrás (UTC)`);
      }
    }
    // 'all' não adiciona filtro de período
    else {
      console.log(`📅 Período: Todo o histórico (sem filtro de data)`);
    }

    query += " ORDER BY g.timestamp ASC";

    console.log("🔍 Query:", query);
    console.log("📊 Parâmetros:", params.map(p => p instanceof Date ? p.toISOString() : p));

    const { rows } = await pgPool.query(query, params);
    
    // Ao formatar a resposta, force UTC
    const formattedRows = rows.map(row => ({
      network: row.network,
      // 🔥 FORÇAR UTC na string ISO
      timestamp: new Date(row.timestamp).toISOString(),
      gas_gwei: parseFloat(row.gas_gwei),
      price_brl: parseFloat(row.price_brl),
      gas_cost_brl: parseFloat(row.gas_cost_brl)
    }));

    // Adicionar informações do período usado (opcional, para debug)
    const responseInfo = {
      period_used: period,
      total_records: formattedRows.length,
      data: formattedRows
    };
    
    if (period === "custom" && data_inicio && data_fim) {
      responseInfo.custom_period = {
        start: new Date(Number(data_inicio)).toISOString(),
        end: new Date(Number(data_fim)).toISOString()
      };
    }

    console.log(`✅ Retornando ${formattedRows.length} registros`);
    res.json(formattedRows);

  } catch (err) {
    console.error("❌ Erro ao buscar histórico:", err);
    res.status(500).json({ 
      error: "Erro ao buscar histórico de gas",
      details: err.message 
    });
  }
});

module.exports = router;