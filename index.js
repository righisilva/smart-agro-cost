// index.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const axios = require("axios");
const solc = require("solc");
const { ethers } = require("ethers");
const networks = require("./networks.json");

const { Pool } = require("pg");
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ------------------------------
// CSV
// ------------------------------
const csvFilePath = path.resolve(__dirname, "relatorio_gas.csv");
const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'rede', title: 'Rede' },
        { id: 'token', title: 'Token' },
        { id: 'cotacaoUsd', title: 'Cotação USD' },
        { id: 'cotacaoBrl', title: 'Cotação BRL' },
        { id: 'funcao', title: 'Função' },
        { id: 'gas', title: 'Gas Usado' },
        { id: 'gasPrice', title: 'Preço do Gas (em gwei)' },
        { id: 'custoToken', title: 'Custo (token)' },
        { id: 'usd', title: 'USD' },
        { id: 'brl', title: 'BRL' },
    ],
    append: fs.existsSync(csvFilePath),
});



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

    for (const [key, net] of Object.entries(networks)) {
        if (key === "localhost") continue;

        try {
            // Permite um ou mais RPCs (fallback automático)
            const rpcList = Array.isArray(net.rpc) ? net.rpc : [net.rpc];
            let provider, gasPrice;

            // Tenta RPCs alternativos até conseguir um resultado válido
            for (const rpc of rpcList) {
                try {
                    provider = new ethers.providers.JsonRpcProvider(rpc);
                    gasPrice = await provider.getGasPrice();
                    if (gasPrice) break;
                } catch (e) {
                    console.warn(`⚠️  RPC ${rpc} falhou para ${net.name}`);
                }
            }

            if (!gasPrice) {
                console.warn(`⚠️  Nenhum RPC válido para ${net.name}`);
                continue;
            }

            const networkInfo = await provider.getNetwork();
            console.log(`✅ Conectado à ${net.name} (chainId: ${networkInfo.chainId})`);

            gasPrices[net.token] = {
                name: net.name,
                gasPrice,
                tokenId: net.token
            };

        } catch (err) {
            console.log(`⚠️  Falha ao buscar gasPrice da rede ${net.name}: ${err.message}`);
        }
    }

    return gasPrices;
}



async function getGasPricesFromNetworks(periodo = "last") {
  if (periodo === "current") {
    return await getLiveGasPricesFromNetworks(); // CoinGecko
  }

  return await getHistoricalGasPrices(periodo);
}















// ------------------------------
// Contrato deployado em memória
// ------------------------------
let deployedContract = null;
function setDeployedContract(contract) { deployedContract = contract; }
function getDeployedContract() { return deployedContract; }

// ------------------------------
// Função principal
// ------------------------------
async function analisarContrato(filePath, log = console.log) {
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
            const resolvedPath = require.resolve(importPath);
            const contents = fs.readFileSync(resolvedPath, 'utf8');
            return { contents };
        } catch (err) {
            return { error: `Import not found: ${importPath}` };
        }
    }

    const compiled = solc.compile(JSON.stringify(input), { import: findImports });
    const output = JSON.parse(compiled);

    if (!output.contracts || !output.contracts[path.basename(filePath)]) {
        log("❌ Erro ao compilar o contrato. Verifique os imports.");
        if (output.errors) output.errors.forEach(e => log(e.formattedMessage));
        return;
    }

    const contractName = Object.keys(output.contracts[path.basename(filePath)])[0];
    const contract = output.contracts[path.basename(filePath)][contractName];
    const abi = contract.abi;
    const bytecode = contract.evm.bytecode.object;
    log(`🔌 Conectando ao Hardhat local...`);
    const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");
    const network = await provider.getNetwork().catch(() => { log("❌ Falha ao conectar ao Hardhat local."); return null; });
    if (!network) return;

    log(`✅ Conectado à ${network.name} (chainId: ${network.chainId})`);
    const signer = (await provider.listAccounts())[0];
    if (!signer) { log("❌ Nenhuma conta encontrada no Hardhat node."); return; }
    const wallet = provider.getSigner(signer);
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    const constructor = abi.find(item => item.type === "constructor");
    const fakeArgs = constructor?.inputs?.map((input, i) => {
        switch (input.type) {
            case "string": return `fake_string_${i}`;
            case "uint256": case "uint": case "int": case "int256": return 1000 + i;
            case "address": return signer;
            case "bool": return i % 2 === 0;
            case "bytes32": return ethers.utils.formatBytes32String(`val${i}`);
            case "bytes": return ethers.utils.toUtf8Bytes(`data${i}`);
            case "string[]": return [`str1_${i}`, `str2_${i}`];
            case "uint256[]": return [1 + i, 2 + i];
            case "address[]": return [signer];
            default: return null;
        }
    }) || [];

    // ------------------------------
    // Deploy
    // ------------------------------
    log("🚀 Fazendo deploy REAL na Hardhat local...");
    let deployTx, deployTxReceipt;
    try {
        deployTx = await factory.deploy(...fakeArgs);
        log("⏳ Aguardando confirmação do deploy...\n");
        deployTxReceipt = await deployTx.deployTransaction.wait();
        const contractInstance = await deployTx.deployed();
        setDeployedContract(contractInstance); // <-- salva globalmente
        log(`✅ Contrato deployado: ${contractInstance.address}`);
    } catch (err) { log(`❌ Falha no deploy: ${err.message}`); return; }

    log(`📦 Gas usado no deploy: ${deployTxReceipt.gasUsed}\n`);

    const gasPricesByNetwork = await getGasPricesFromNetworks();
    const tokenPrices = await getTokenPrices();
    log(`\n`);

    // ------------------------------
    // Cálculo de custos deploy
    // ------------------------------
    for (const [token, data] of Object.entries(gasPricesByNetwork)) {
        const tokenPrice = tokenPrices[token];
        // log(tokenPrice);
        if (!tokenPrice) continue;
        const costInToken = ethers.utils.formatEther(deployTxReceipt.gasUsed.mul(data.gasPrice));
        const costUSD = parseFloat(costInToken) * tokenPrice.usd;
        const costBRL = parseFloat(costInToken) * tokenPrice.brl;
        log(`🌍 ${data.name}`);
        log(`   🪙 Cotação de 1 ${token}: U$${tokenPrice.usd.toFixed(2)} / R$${tokenPrice.brl.toFixed(2)}`);
        log(`   ⛽ gasPrice: ${ethers.utils.formatUnits(data.gasPrice,"gwei")} gwei`);
        log(`   💰 Custo estimado de deploy: ${costInToken} ${token} ≈ $${costUSD.toFixed(4)} / R$${costBRL.toFixed(4)}\n`);
    }

    // ------------------------------
    // Estimativa de gas para funções públicas
    // ------------------------------
    log("🔍 Estimando GÁS para funções públicas...\n");

    const deployedContractInstance = getDeployedContract();
    const txFunctions = abi.filter(
        item => item.type === "function" && !["view", "pure"].includes(item.stateMutability)
    );

    for (const item of txFunctions) {
        const functionName = item.name;
        const args = item.inputs.map((input, i) => {
            if (input.type.startsWith("uint")) return 1;
            if (input.type.startsWith("int")) return -1;
            if (input.type === "address") return signer;
            if (input.type === "string") return "exemplo";
            if (input.type === "bool") return false;
            if (input.type === "bytes32") return ethers.utils.formatBytes32String("ex");
            if (input.type.startsWith("bytes")) return "0x1234";
            if (input.type.endsWith("[]")) return [1,2,3];
            return null;
        });

        try {
            const estimatedGas = await deployedContractInstance.estimateGas[functionName](...args);
            const tx = await deployedContractInstance[functionName](...args);
            const receipt = await tx.wait();
            log(`🔧 Função: ${functionName}`);
            log(`   📍 Gas estimado: ${estimatedGas}`);
            log(`   ✅ Gas real usado: ${receipt.gasUsed}`);

            for (const [token, data] of Object.entries(gasPricesByNetwork)) {
                const tokenPrice = tokenPrices[token]; if (!tokenPrice) continue;
                const costInToken = ethers.utils.formatEther(receipt.gasUsed.mul(data.gasPrice));
                const costUSD = parseFloat(costInToken) * tokenPrice.usd;
                const costBRL = parseFloat(costInToken) * tokenPrice.brl;
                log(`   💰 ${token.toUpperCase()}: ${costInToken} ${token} ≈ $${costUSD.toFixed(4)} / R$${costBRL.toFixed(4)}`);
            }
            log("-------------------------------------------------------\n");
        } catch (err) {
            log(`⚠️ Erro ao executar "${functionName}": ${err.message}`);
        }
    }
}

// ------------------------------
// CLI
// ------------------------------
if (require.main === module) {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("❌ Por favor, informe o caminho do arquivo Solidity.");
        process.exit(1);
    }

    analisarContrato(filePath, console.log)
        .then(() => console.log("✅ Análise concluída!"))
        .catch(err => console.error("❌ Erro:", err.message));
}

// ------------------------------
// Exportações
// ------------------------------
module.exports = { analisarContrato, getDeployedContract, setDeployedContract };

