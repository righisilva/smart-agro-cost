// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { analisarContrato } = require("./index.js");
const { analisarContratoManual, listDeployedContracts, getDeployedContract, getGasPricesFromNetworks, getTokenPrices, registerDeployedContract, clearDeployedContracts } = require("./contractService");
const { ethers } = require("ethers");
const solc = require("solc");

const app = express();
const upload = multer({ dest: "uploads/" });
const networksJson = require("./networks.json");

const gasHistoryRoutes = require("./routes/gasHistoryRoutes");
const ibgeRoutes = require("./routes/ibgeRoutes");
const resultsRoutes = require("./routes/resultsRoutes");






// ---  Gas Estimator automático ---

// Endpoint para analisar contrato enviado pelo usuário
app.post("/analisar", upload.single("contrato"), async (req, res) => {
    // Verifica se um arquivo foi enviado
    if (!req.file) return res.status(400).send("❌ Nenhum arquivo enviado.");

    // Configura resposta para envio em chunks (texto HTML)
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Transfer-Encoding": "chunked"
    });

    // Função de log que escreve no console e no cliente
    const log = (msg) => {
        console.log(msg);
      
        const texto =
          typeof msg === "string"
            ? msg
            : JSON.stringify(msg, null, 2);
      
        res.write(texto.replace(/\n/g, "<br>") + "<br>");
      };
      

    try {
        // Analisa o contrato
        await analisarContrato(req.file.path, log);

        // Deleta arquivo temporário
        fs.unlink(req.file.path, err => {
            if (err) console.warn("⚠️ Não foi possível deletar arquivo temporário:", err.message);
        });

        res.write("<br>✅ Análise concluída!<br>");
        res.end();
    } catch (err) {
        res.write(`<br>❌ Erro: ${err.message}<br>`);
        res.end();
    }
});

// ---  Fim de Gas Estimator automático ---


// --- Variáveis globais ---
let gasPricesByNetwork = null;
let tokenPrices = null;
let currentDeployedContract = null;  // objeto { id, address, abi, name, ... }
const deployedContracts = new Map();




// --- Banco de dados SQLite ---
const db = new Database("smartagro.db");

// --- Inicializa redes no banco ---
const networks = {};

for (const [key, n] of Object.entries(networksJson)) {
    // 🔧 Normaliza RPC (funciona para rpc OU rpcs)
    const rpc = n.rpc || (Array.isArray(n.rpcs) ? n.rpcs[0] : null);

    if (!rpc) {
        console.warn(`⚠️ Rede ${n.name} sem RPC válido. Ignorando...`);
        continue;
    }

    const existing = db
        .prepare("SELECT id FROM networks WHERE name = ?")
        .get(n.name);

    if (!existing) {
        const result = db
            .prepare("INSERT INTO networks (name, token, rpc) VALUES (?, ?, ?)")
            .run(n.name, n.token, rpc);

        networks[n.token] = {
            id: result.lastInsertRowid,
            ...n,
            rpc // garante que existe no objeto final
        };
    } else {
        networks[n.token] = {
            id: existing.id,
            ...n,
            rpc // padroniza também aqui
        };
    }
}



// ---  Gas Estimator iterativo ---


// --- Funções auxiliares para DB ---
function salvarContractNoDB(name, address) {
    const existing = db.prepare("SELECT id FROM contracts WHERE name = ?").get(name);
    if (existing) return existing.id;
    const result = db.prepare("INSERT INTO contracts (name, address) VALUES (?, ?)").run(name, address);
    return result.lastInsertRowid;
}

function salvarFuncaoContratoNoDB(contractId, nomeFuncao) {
    const existing = db.prepare("SELECT id FROM contract_functions WHERE contract_id = ? AND name = ?").get(contractId, nomeFuncao);
    if (existing) return existing.id;
    const result = db.prepare("INSERT INTO contract_functions (contract_id, name) VALUES (?, ?)").run(contractId, nomeFuncao);
    return result.lastInsertRowid;
}

function salvarFuncaoNoDB(functionId, networkId, gasUsed, costUSD, costBRL) {
  db.prepare(`
    INSERT INTO contract_function_costs
      (function_id, network_id, gas_used, cost_usd, cost_brl)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(function_id, network_id)
    DO UPDATE SET
      gas_used = excluded.gas_used,
      cost_usd = excluded.cost_usd,
      cost_brl = excluded.cost_brl
  `).run(functionId, networkId, gasUsed, costUSD, costBRL);
}


function salvarNetworkCosts(networkId, gasPrice, costUSD, costBRL) {
    db.prepare(`
        INSERT INTO network_costs (network_id, gas_tracker, cost_usd, cost_brl)
        VALUES (?, ?, ?, ?)
    `).run(networkId, gasPrice, costUSD, costBRL);
}

// Converte argumentos com base no formato e tipo esperado
function parseArgument(arg) {
    // Caso o argumento já venha em formato objeto (ex: JSON), tenta converter
    if (typeof arg === "object") return arg;

    // Trata strings
    if (typeof arg === "string") {
        // Endereço Ethereum (address)
        if (/^0x[a-fA-F0-9]{40}$/.test(arg)) return arg;

        // Boolean
        if (arg.toLowerCase() === "true") return true;
        if (arg.toLowerCase() === "false") return false;

        // Array JSON (por ex: "[1,2,3]" ou '["a","b"]')
        if (arg.trim().startsWith("[") && arg.trim().endsWith("]")) {
            try {
                const arr = JSON.parse(arg);
                return Array.isArray(arr)
                    ? arr.map(parseArgument)
                    : arg;
            } catch {
                return arg;
            }
        }

        // Número (inteiro ou decimal)
        if (!isNaN(arg) && arg.trim() !== "") return Number(arg);

        // Bytes32 ou bytes genérico
        if (/^0x[a-fA-F0-9]+$/.test(arg)) return arg;

        // Caso contrário, mantém como string
        return arg;
    }

    // Número direto
    if (typeof arg === "number") return arg;

    return arg;
}









// Serve arquivos estáticos da interface de contratos

app.use(express.json());

app.use("/dashboard", express.static("public/IBGE"));
app.use("/api/ibge", ibgeRoutes(db));
app.use("/gas-history", express.static(path.join(__dirname, "public/gas-history")));
app.use("/api/gas-history", gasHistoryRoutes);
app.use("/results", express.static(path.join(__dirname, "public/results")));
app.use("/api/results", resultsRoutes(db));
app.use("/interface", express.static(path.join(__dirname, "public/interface-contratos")));
app.use("/gas", express.static("public/gas-estimator"));




// --- 1️⃣ Carregar ABI e deploy automático ---

app.post("/api/load-abi", upload.array("contratos", 20), async (req, res) => {
    clearDeployedContracts(); // limpa sessão anterior
    const tipo_calculo = req.body.tipo_calculo || "last";

    if (!req.files || req.files.length === 0)
        return res.status(400).send("❌ Nenhum arquivo enviado.");

    let contratosResponse = [];

    try {

        // carregar preços uma vez só
        gasPricesByNetwork = await getGasPricesFromNetworks(tipo_calculo);
        tokenPrices = await getTokenPrices(tipo_calculo);

        for (const file of req.files) {

            const filePath = file.path;

            // deploy contratos do arquivo atual
            const deployedContracts = await analisarContratoManual(filePath, console.log);
            if (!deployedContracts.length) continue;

            for (const c of deployedContracts) {

                const contractId = salvarContractNoDB(c.contractName, c.address);

                registerDeployedContract(c.contractName, {
                    id: contractId,
                    address: c.address,
                    abi: c.abi,
                    name: c.contractName
                });

                // calcular custos por rede
                const custosPorRede = {};

                for (const [token, data] of Object.entries(gasPricesByNetwork)) {
                    const tokenPrice = tokenPrices[token];
                    if (!tokenPrice) continue;

                    const costInToken = ethers.utils.formatEther(c.gasUsed.mul(data.gasPrice));
                    const costUSD = parseFloat(costInToken) * tokenPrice.usd;
                    const costBRL = parseFloat(costInToken) * tokenPrice.brl;

                    
                    const networkId = networks[token].id;
                    // salvarDeployNoDB(contractId, networks[token].id, c.gasUsed.toNumber(), costUSD, costBRL);
                    //TODO
                    const functionId = salvarFuncaoContratoNoDB(contractId, "deploy");
                    // console.log("Function ID do deploy:", functionId);
                    salvarFuncaoNoDB(functionId, networks[token].id, c.gasUsed.toNumber(), costUSD, costBRL);

                    salvarNetworkCosts(networkId, parseFloat(ethers.utils.formatUnits(data.gasPrice, "gwei")), tokenPrice.usd, tokenPrice.brl);


                    custosPorRede[token] = {
                        name: data.name,
                        token,
                        gasPrice: ethers.utils.formatUnits(data.gasPrice, "gwei") + " Gwei",
                        custoTotalToken: costInToken,
                        custoUSD: `$${costUSD.toFixed(4)}`,
                        custoBRL: `R$${costBRL.toFixed(4)}`,
                        cotacao: tokenPrice
                    };
                }

                contratosResponse.push({
                    nome: c.contractName,
                    endereco: c.address,
                    gas: c.gasUsed.toString(),
                    custosPorRede,
                    abi: c.abi
                });
            }

            // remover arquivo temporário
            fs.unlink(filePath, () => {});
        }

        res.json({ contratos: contratosResponse });

    } catch (err) {
        console.error(err);
        res.status(500).send("❌ Erro ao processar arquivos.");
    }
});


// --- 2️⃣ Executar funções do contrato deployado ---

app.post("/api/execute-function", async (req, res) => {
    const {nomeContrato, nomeFuncao, args, execCount = 1 } = req.body;
    const contratoSelecionado = getDeployedContract(nomeContrato);

    if (!contratoSelecionado)
        return res.status(400).send(`❌ Contrato "${nomeContrato}" não encontrado.`);

    // Constrói o contrato real com ethers
    const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = provider.getSigner(0);
    const contract = new ethers.Contract(
        contratoSelecionado.address,
        contratoSelecionado.abi,
        signer
    );

    try {
        const processedArgs = args.map(parseArgument);

        // Estima o gas da função
        const estimatedGas = await contract.estimateGas[nomeFuncao](...processedArgs);

        // Executa função
        const tx = await contract[nomeFuncao](...processedArgs);
        const receipt = await tx.wait();
        const gasTotalSimulado = receipt.gasUsed.mul(execCount);



        // ------------------------------
        // 🔹 Calcular custo total por rede
        // ------------------------------
        const custosPorRede = {};

        const insertFunc = db.transaction(() => {
            const functionId = salvarFuncaoContratoNoDB(contratoSelecionado.id, nomeFuncao);

            for (const [token, data] of Object.entries(gasPricesByNetwork)) {
                // console.log(data);
                const tokenPrice = tokenPrices[token]; if (!tokenPrice) continue;
                 console.log(tokenPrice);
                const costInToken = ethers.utils.formatEther(gasTotalSimulado.mul(data.gasPrice));
                const costUSD = parseFloat(costInToken) * tokenPrice.usd;
                const costBRL = parseFloat(costInToken) * tokenPrice.brl;

                custosPorRede[token] = {
                    name: data.name,
                    token: token,
                    gasPrice: ethers.utils.formatUnits(data.gasPrice, "gwei") + " Gwei",
                    custoTotalToken: costInToken,
                    custoUSD: costUSD ? `$${costUSD.toFixed(4)}` : "N/A",
                    custoBRL: costBRL ? `R$${costBRL.toFixed(4)}` : "N/A",
                    cotacao: tokenPrice
                        ? { usd: tokenPrice.usd, brl: tokenPrice.brl }
                        : { usd: null, brl: null }
                };

                const networkId = networks[token].id;
                salvarFuncaoNoDB(functionId, networkId, gasTotalSimulado.toNumber(), costUSD, costBRL);

            }
        });
        insertFunc();
        // ------------------------------
        // 🔹 Retorna dados para o frontend
        // ------------------------------
        res.json({
            funcao: nomeFuncao,
            execucoes: execCount,
            // gasEstimado: estimatedGas.toString(),
            gasEstimado: receipt.gasUsed.toString(),
            // gasReal: receipt.gasUsed.toString(),
            gasReal: gasTotalSimulado.toString(),
            
        
            custosPorRede
        });

    } catch (err) {
        res.status(500).send(`⚠️ Erro ao executar "${nomeFuncao}": ${err.message}`);
    }
});



// --- Endpoint para pegar contas do Hardhat ---

app.get("/api/accounts", async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");
        const accounts = await provider.listAccounts();
        res.json(accounts);
    } catch (err) {
        res.status(500).send("Erro ao obter contas: " + err.message);
    }
});






// 🔹 Listar contratos
app.get("/api/contracts-list", (req, res) => {
    try {
        const rows = db.prepare("SELECT DISTINCT name FROM contracts ORDER BY name").all();
        res.json(rows.map(r => r.name));
    } catch (err) {
        console.error("Erro ao listar contratos:", err);
        res.status(500).send("Erro ao listar contratos");
    }
});

// 🔹 Listar redes
// 🔹 Listar redes
app.get("/api/networks-list", (req, res) => {
    try {
        const rows = db
            // .prepare("SELECT DISTINCT name FROM networks ORDER BY name")
            .prepare("SELECT DISTINCT name FROM networks")
            .all();

        const redes = rows
            .map(r => r.name)
            .filter(name => {
                const n = name.toLowerCase();
                return !n.includes('local') && !n.includes('hardhat');
            });

        res.json(redes);
    } catch (err) {
        console.error("Erro ao listar redes:", err);
        res.status(500).send("Erro ao listar redes");
    }
});


// 🔹 Listar funções de um contrato específico (ou todas se não for passado)
app.get("/api/functions-list", (req, res) => {
    try {
        const { contract } = req.query;
        let query = `
            SELECT DISTINCT f.name
            FROM contract_functions f
            JOIN contracts c ON c.id = f.contract_id
            WHERE 1=1
        `;
        const params = {};

        if (contract) {
            query += " AND c.name = @contract";
            params.contract = contract;
        }

        // query += " ORDER BY f.name";

        const rows = db.prepare(query).all(params);
        res.json(rows.map(r => r.name));
    } catch (err) {
        console.error("Erro ao listar funções:", err);
        res.status(500).send("Erro ao listar funções");
    }
});

app.get("/api/contract-abi", (req, res) => {
 const { contract } = req.query;
 const contrato = getDeployedContract(contract);
 if (!contrato) return res.status(404).send("Contrato não encontrado");
 res.json({ abi: contrato.abi, name: contrato.name, address: contrato.address });
});


app.get("/api/deployed-contracts", (req, res) => {
    try {
        const contratos = Array.from(listDeployedContracts().map(name => getDeployedContract(name)));
        // console.log("Contratos enviados ao frontend:", contratos);
        res.json(contratos);
    } catch (err) {
        res.status(500).send("Erro ao listar contratos em memória: " + err.message);
    }
});

// ---  Fim Gas Estimator iterativo ---


app.get("/status", (req, res) => {
    res.json({
        status: "online",
        timestamp: new Date(),
        version: "1.0.0"
    });
});


app.get('/manual', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manual', 'index.html'));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});






// --- Servidor ---

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

app.listen(PORT, () => {
    console.log(`
🌍 Servidor unificado rodando!
- Home:                ${BASE_URL}/
- Dashboard IBGE:      ${BASE_URL}/dashboard
- Gas Estimator:       ${BASE_URL}/gas
- Interface Contratos: ${BASE_URL}/interface
- Resultados:          ${BASE_URL}/results
- Histórico:           ${BASE_URL}/gas-history
- Manual:              ${BASE_URL}/manual
`);
});

