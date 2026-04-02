// contractService.js

// Carrega variáveis de ambiente do arquivo .env
require("dotenv").config();

// Módulo do Node para manipular arquivos (ler, escrever, etc)
const fs = require("fs");

// Módulo do Node para manipular caminhos de arquivos
const path = require("path");

// Biblioteca HTTP para fazer requisições externas
const axios = require("axios");

// Compilador Solidity
const solc = require("solc");

// Biblioteca ethers.js para interagir com Ethereum/Smart Contracts
const { ethers } = require("ethers");

// JSON com informações de redes (ex: Hardhat, testnets, mainnet)
const networks = require("./networks.json");


const deployedContracts = new Map();

const { Pool } = require("pg");

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function clearDeployedContracts() {
  deployedContracts.clear();
}
// Obter um contrato específico
function getDeployedContract(nameOrAddress) {
    return deployedContracts.get(nameOrAddress) || null;
}

// Registrar contrato
function registerDeployedContract(nameOrAddress, contractInstance) {
    deployedContracts.set(nameOrAddress, contractInstance);
    // console.log("📦 Contratos deployados:", [...deployedContracts.entries()]);
}

// Retornar lista de todos
function listDeployedContracts() {
    return Array.from(deployedContracts.keys());
}


// Variável que armazenará o contrato deployado em memória
// let deployedContract = null;
/**
 * Retorna o contrato que foi deployado (ou null se ainda não tiver deploy)
 */
// function getDeployedContract() {
//     return deployedContract;
// }


async function getHistoricalTokenPrices(tipo_calculo = "last") {
  console.log("📊 Usando preços históricos:", tipo_calculo);

  try {
    // 1️⃣ Filtra redes válidas (ignora localhost)
    const redesValidas = Object.values(networks)
      .filter(net => net.name !== "Local Hardhat")
      .map(net => net.token);

    if (redesValidas.length === 0) return {};

    // 2️⃣ Define intervalos
    const intervals = {
      day: "1 day",
      week: "7 days",
      month: "30 days"
    };
    let query = "";
    // 3️⃣ Cria placeholders dinâmicos
    const placeholders = redesValidas.map((_, i) => `$${i + 1}`).join(", ");

    if (tipo_calculo === "last") {
      
      query = `
        SELECT DISTINCT ON (n.token)
          n.name,
          n.token,
          g.price_usd AS avg_price_usd,
          g.price_brl AS avg_price_brl
        FROM gas_history g
        JOIN networks n ON n.id = g.network_id
        WHERE n.token IN (${placeholders})
        ORDER BY n.token, g.timestamp DESC, g.id DESC
      `;

    } else {

      // 4️⃣ Query base
      query = `
        SELECT 
          n.name,
          n.token,
          AVG(g.price_usd) AS avg_price_usd,
          AVG(g.price_brl) AS avg_price_brl
        FROM gas_history g
        JOIN networks n ON n.id = g.network_id
        WHERE n.token IN (${placeholders})
      `;
    

      // 5️⃣ Aplica filtro temporal se necessário
      if (intervals[tipo_calculo]) {
        query += ` AND g.timestamp >= NOW() - INTERVAL '${intervals[tipo_calculo]}'`;
      }

      query += ` GROUP BY n.name, n.token`;
    }

    // 6️⃣ Executa query
    const { rows } = await pgPool.query(query, redesValidas);

    // 7️⃣ Monta retorno no formato CoinGecko
    const resultado = {};

    rows.forEach(row => {
      resultado[row.token] = {
        usd: Number(row.avg_price_usd) || 0,
        brl: Number(row.avg_price_brl) || 0
      };
    });

    return resultado;

  } catch (err) {
    console.error("⚠️ Erro ao buscar preços históricos:", err.message);
    return {};
  }
}

/**
 * Busca preços dos tokens em USD e BRL via CoinGecko
 */
async function getLiveTokenPrices() {
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

async function getTokenPrices(periodo = "last") {
  if (periodo === "current") {
    return await getLiveTokenPrices(); // CoinGecko
  }

  return await getHistoricalTokenPrices(periodo);
}

async function getGasPricesFromNetworks(periodo = "last") {
  if (periodo === "current") {
    return await getLiveGasPricesFromNetworks(); // CoinGecko
  }

  return await getHistoricalGasPrices(periodo);
}


async function getHistoricalGasPrices(tipo_calculo = "last") {
  console.log("⛽ Usando gas histórico:", tipo_calculo);

  try {

    const redesValidas = Object.values(networks)
      .filter(net => net.name !== "Local Hardhat")
      .map(net => net.token);

    if (redesValidas.length === 0) return {};

    const intervals = {
      day: "1 day",
      week: "7 days",
      month: "30 days"
    };

    const placeholders = redesValidas.map((_, i) => `$${i + 1}`).join(", ");

    let query = "";

    // 🔹 CASO 1: Último gas registrado
    if (tipo_calculo === "last") {

      query = `
        SELECT DISTINCT ON (n.token)
          n.name,
          n.token,
          g.gas_gwei
        FROM gas_history g
        JOIN networks n ON n.id = g.network_id
        WHERE n.token IN (${placeholders})
        ORDER BY n.token, g.timestamp DESC, g.id DESC
      `;

    } else {

      // 🔹 CASO 2: Média
      query = `
        SELECT 
          n.name,
          n.token,
          AVG(g.gas_gwei) AS gas_gwei
        FROM gas_history g
        JOIN networks n ON n.id = g.network_id
        WHERE n.token IN (${placeholders})
      `;

      if (intervals[tipo_calculo]) {
        query += ` AND g.timestamp >= NOW() - INTERVAL '${intervals[tipo_calculo]}'`;
      }

      query += ` GROUP BY n.name, n.token`;
    }

    const { rows } = await pgPool.query(query, redesValidas);

    const resultado = {};

    rows.forEach(row => {

      if (!row.gas_gwei) return;

      // 🔹 Converter gwei → wei
      const gasPriceWei = ethers.utils.parseUnits(
        Number(row.gas_gwei).toFixed(9), 
        "gwei"
      );

      resultado[row.token] = {
        name: row.name,
        gasPrice: gasPriceWei,
        token: row.token
      };
    });

    return resultado;

  } catch (err) {
    console.error("⚠️ Erro ao buscar gas histórico:", err.message);
    return {};
  }
}


async function getLiveGasPricesFromNetworks() {
  const gasPrices = {};
  console.log("⛽ Obtendo gas prices das redes...");

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
    console.log(`✅ Gas price para ${net.name} (${net.token}): ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
  }

  return gasPrices;
}

/**
 * Função principal para analisar e deployar um contrato Solidity manualmente
 * @param {string} filePath Caminho do arquivo Solidity
 * @param {function} log Função de log (padrão console.log)
 */
async function analisarContratoManual(filePath, log = console.log) {
  if (!filePath) throw new Error("❌ Por favor, informe o caminho do arquivo Solidity.");

  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, "utf8");

  const input = {
    language: "Solidity",
    sources: { [path.basename(filePath)]: { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };

  function findImports(importPath) {
    try {
      const baseDir = path.dirname(filePath);
      let resolvedPath = path.resolve(baseDir, importPath);
      if (fs.existsSync(resolvedPath)) {
        return { contents: fs.readFileSync(resolvedPath, "utf8") };
      }

      const contractsDir = path.resolve(__dirname, "contracts");
      resolvedPath = path.resolve(contractsDir, importPath);
      if (fs.existsSync(resolvedPath)) {
        return { contents: fs.readFileSync(resolvedPath, "utf8") };
      }

      const npmResolved = require.resolve(importPath);
      return { contents: fs.readFileSync(npmResolved, "utf8") };
    } catch (err) {
      return { error: `Import não encontrado: ${importPath}` };
    }
  }

  const compiled = solc.compile(JSON.stringify(input), { import: findImports });
  const output = JSON.parse(compiled);

  if (!output.contracts || !output.contracts[path.basename(filePath)]) {
    log("❌ Erro ao compilar o contrato. Verifique os imports.");
    if (output.errors) output.errors.forEach(e => log(e.formattedMessage));
    return [];
  }

  // Conecta ao nó Hardhat local
  log("🔌 Conectando ao Hardhat local...");
  const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");
  const accounts = await provider.listAccounts();
  const wallet = provider.getSigner(accounts[0]);

  const results = [];

  // Percorre todos os contratos compilados no arquivo
  for (const [contractName, contractData] of Object.entries(output.contracts[path.basename(filePath)])) {
    log(`🚀 Fazendo deploy do contrato: ${contractName}`);

    const abi = contractData.abi;
    const bytecode = contractData.evm.bytecode.object;
    if (!bytecode || bytecode === "0x") {
      log(`⚠️ Contrato ${contractName} não possui bytecode (provavelmente é uma interface ou biblioteca).`);
      continue;
    }

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    const constructor = abi.find(item => item.type === "constructor");
    const fakeArgs = constructor?.inputs?.map((input, i) => {
      switch (input.type) {
        case "string": return `fake_string_${i}`;
        case "uint256": case "uint": case "int": return 1000 + i;
        case "address": return accounts[0];
        case "bool": return i % 2 === 0;
        case "bytes32": return ethers.utils.formatBytes32String(`val${i}`);
        case "bytes": return ethers.utils.toUtf8Bytes(`data${i}`);
        case "string[]": return [`str1_${i}`, `str2_${i}`];
        case "uint256[]": return [1 + i, 2 + i];
        case "address[]": return [accounts[0]];
        default: return null;
      }
    }) || [];
    log(`📦 Parâmetros de deploy (${contractName}): ${JSON.stringify(fakeArgs, null, 2)}`);

    try {
      const contractInstance = await factory.deploy(...fakeArgs);
      const txReceipt = await contractInstance.deployTransaction.wait();

      log(`✅ ${contractName} deployado em: ${contractInstance.address}`);
      results.push({
        contractName,
        address: contractInstance.address,
        gasUsed: txReceipt.gasUsed,
        abi,
      });
    } catch (err) {
      log(`❌ Falha no deploy de ${contractName}: ${err.message}`);
    }
  }

  if (!results.length) {
    log("⚠️ Nenhum contrato foi deployado com sucesso.");
  }

  return results;
}


// Permite alterar o contrato deployado em memória
function setDeployedContract(contract) {
    deployedContract = contract;
}

// Exporta funções para uso externo
module.exports = {
  analisarContratoManual,
  getDeployedContract,
  setDeployedContract,
  registerDeployedContract,
  listDeployedContracts,
  getGasPricesFromNetworks,
  getTokenPrices,
  clearDeployedContracts
};

