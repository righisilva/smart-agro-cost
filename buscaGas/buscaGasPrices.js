require("dotenv").config();
const fs = require("fs");
const path = require("path");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const axios = require("axios");
const { ethers } = require("ethers");
const { google } = require("googleapis");
const { Pool } = require("pg");

// === CONFIG DB ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // ok para NeonDB
});

// === CONFIG CSV ===
const csvFilePath = path.resolve(__dirname, "cotacoes_blockchain.csv");
const csvWriter = createCsvWriter({
  path: csvFilePath,
  header: [
    { id: "timestamp", title: "Timestamp" },
    { id: "rede", title: "Rede" },
    { id: "token", title: "Token" },
    { id: "cotacaoUsd", title: "Cotação USD" },
    { id: "cotacaoBrl", title: "Cotação BRL" },
    { id: "gasPrice", title: "Preço do Gas (gwei)" },
  ],
  append: fs.existsSync(csvFilePath),
});

// === CONFIG GOOGLE SHEETS ===
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID;

async function saveToGoogleSheets(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const values = data.map((item) => [
    item.timestamp,
    item.rede,
    item.token,
    item.cotacaoUsd,
    item.cotacaoBrl,
    item.gasPrice,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Página1!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log("✅ Dados também salvos no Google Sheets!");
}

// === TOKEN PRICES ===
async function getTokenPrices() {
  const ids = [...new Set(
    Object.values(networks)
      .map(net => net.token)
      .filter(token => typeof token === "string" && token.length > 0)
  )].join(",");

  if (!ids) {
    console.warn("⚠️ Nenhum token válido encontrado");
    return {};
  }

  console.log("📡 Buscando preços para:", ids);

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,brl`;

  try {
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    console.error("❌ Erro ao buscar preços:", err.message);
    return {};
  }
}

// === GAS PRICES ===
const networks = require(path.join(process.cwd(), "networks.json")); // JSON com RPCs e tokens

// === GAS PRICES ===
async function getGasPricesFromNetworks() {
  const gasPrices = {};

  for (const [key, net] of Object.entries(networks)) {
    if (key === "localhost") continue;

    const rpcList = net.rpcs || (net.rpc ? [net.rpc] : []);
    if (!rpcList.length) {
      console.warn(`⚠️ Nenhum RPC definido para ${net.name}`);
      continue;
    }

    let gasPrice;
    let provider;
    for (const rpc of rpcList) {
      try {
        provider = new ethers.providers.JsonRpcProvider({
          url: rpc,
          timeout: 5000
        });

        const network = await provider.getNetwork();
        if (key === "polygon" && network.chainId !== 137) {
          console.warn(`⚠️ RPC ${rpc} não é Polygon`);
          continue;
        }

        gasPrice = await provider.getGasPrice();

        const gwei = parseFloat(ethers.utils.formatUnits(gasPrice, "gwei"));
        if (key === "polygon" && gwei < 1) {
          console.warn(`⚠️ Gas anormal para Polygon: ${gwei}`);
          continue;
        }
        if (gasPrice) break;
      } catch (e) {
        console.warn(`⚠️ RPC ${rpc} falhou para ${net.name}`);
      }
    }

    if (!gasPrice) {
      console.warn(`⚠️ Nenhum RPC válido para ${net.name}`);
      continue;
    }

    gasPrices[net.token] = { name: net.name, gasPrice, token: net.token };
  }

  return gasPrices;
}



// === DB HELPERS ===
async function getOrCreateNetworkId(name, token) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT id FROM networks WHERE token = $1",
      [token]
    );
    if (res.rows.length > 0) return res.rows[0].id;

    const insertRes = await client.query(
      "INSERT INTO networks (name, token) VALUES ($1, $2) RETURNING id",
      [name, token]
    );
    return insertRes.rows[0].id;
  } finally {
    client.release();
  }
}

async function insertGasHistory(networkId, gasGwei, priceUsd, priceBrl) {
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO gas_history (network_id, gas_gwei, price_usd, price_brl) VALUES ($1, $2, $3, $4)",
      [networkId, gasGwei, priceUsd, priceBrl]
    );
  } finally {
    client.release();
  }
}

// === MAIN ===
async function main() {
  const tokenPrices = await getTokenPrices();
  const gasPricesByNetwork = await getGasPricesFromNetworks();

  for (const [token, data] of Object.entries(gasPricesByNetwork)) {
    try {
      const tokenPrice = tokenPrices[token];
      if (!tokenPrice) continue;

      const now = new Date().toISOString();

      const row = {
        timestamp: now,
        rede: data.name,
        token: token,
        cotacaoUsd: tokenPrice.usd.toFixed(4).replace(".", ","),
        cotacaoBrl: tokenPrice.brl.toFixed(4).replace(".", ","),
        gasPrice: ethers.utils.formatUnits(data.gasPrice, "gwei").replace(".", ","),
      };

      console.log(`🌍 ${data.name}`);

      // CSV
      try {
        await csvWriter.writeRecords([row]);
      } catch (e) {
        console.warn("⚠️ Erro CSV:", e.message);
      }

      // Google Sheets
      try {
        await saveToGoogleSheets([row]);
      } catch (e) {
        console.warn("⚠️ Erro Sheets:", e.message);
      }

      // DB
      try {
        const networkId = await getOrCreateNetworkId(data.name, token);
        await insertGasHistory(
          networkId,
          parseFloat(ethers.utils.formatUnits(data.gasPrice, "gwei")),
          tokenPrice.usd,
          tokenPrice.brl
        );
      } catch (e) {
        console.warn("⚠️ Erro DB:", e.message);
      }

    } catch (err) {
      console.error(`❌ Erro geral na rede ${data.name}:`, err.message);
    }
  }

  console.log("✅ Tudo registrado com sucesso!");
  await pool.end();
}

main().catch((err) => console.error(err));