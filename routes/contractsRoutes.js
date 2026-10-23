// routes/contractsRoutes.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { ethers } = require("ethers");

const { analisarContrato } = require("../index");
const { compilarContrato, deployContratoCompilado } = require("../contractService");
const {
    clearCompiledContracts,
    registerCompiledContract,
    getCompiledContract,
} = require("../services/compiledContractsStore");
const {
    getDeployedContract,
    registerDeployedContract,
    listDeployedContracts,
    clearDeployedContracts,
} = require("../services/deployedContractsStore");
const { getGasPricesFromNetworks } = require("../services/gasPriceService");
const { getTokenPrices } = require("../services/priceService");
const { getHardhatProvider } = require("../services/providerService");
const { parseArgument } = require("../utils/parseArgument");
const { createContractRepository } = require("../db/contractRepository");

const upload = multer({ dest: "uploads/" });

// Recebe `db` (better-sqlite3) e `networks` (objeto { token: { id, ... } }
// já inicializado por db/initNetworks.js) e devolve o router.
module.exports = function contractsRoutes(db, networks) {
    const router = express.Router();
    const repo = createContractRepository(db);

    // Preços/gas carregados no último /api/load-abi, reaproveitados no deploy
    // e na execução de funções.
    let gasPricesByNetwork = null;
    let tokenPrices = null;

    // ---  Gas Estimator automático (fluxo antigo, ainda em uso) ---
    router.post("/analisar", upload.single("contrato"), async (req, res) => {
        if (!req.file) return res.status(400).send("❌ Nenhum arquivo enviado.");

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Transfer-Encoding": "chunked",
        });

        const log = (msg) => {
            console.log(msg);
            const texto = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
            res.write(texto.replace(/\n/g, "<br>") + "<br>");
        };

        try {
            await analisarContrato(req.file.path, log);

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

    // ---  1️⃣ Compilar contrato(s) (NÃO deploya mais automaticamente) ---
    router.post("/api/load-abi", upload.array("contratos", 20), async (req, res) => {
        clearCompiledContracts();
        clearDeployedContracts();
        const tipo_calculo = req.body.tipo_calculo || "last";

        if (!req.files || req.files.length === 0)
            return res.status(400).send("❌ Nenhum arquivo enviado.");

        let contratosResponse = [];

        try {
            // Carrega os preços/gas agora, para já estarem prontos quando o
            // usuário clicar em "Fazer Deploy" de qualquer um dos contratos.
            gasPricesByNetwork = await getGasPricesFromNetworks(tipo_calculo);
            tokenPrices = await getTokenPrices(tipo_calculo);

            for (const file of req.files) {
                const filePath = file.path;

                const compilados = await compilarContrato(filePath, console.log);

                for (const c of compilados) {
                    registerCompiledContract(c.contractName, { abi: c.abi, bytecode: c.bytecode });

                    contratosResponse.push({
                        nome: c.contractName,
                        abi: c.abi,
                        constructorInputs: c.constructorInputs,
                    });
                }

                fs.unlink(filePath, () => {});
            }

            res.json({ contratos: contratosResponse });
        } catch (err) {
            console.error(err);
            res.status(500).send("❌ Erro ao processar arquivos.");
        }
    });

    // ---  2️⃣ Deployar um contrato já compilado, com os argumentos informados ---
    router.post("/api/deploy-contract", async (req, res) => {
        const { nomeContrato, args = [] } = req.body;

        const compilado = getCompiledContract(nomeContrato);
        if (!compilado) {
            return res
                .status(400)
                .send(`❌ Contrato "${nomeContrato}" não encontrado. Carregue o arquivo .sol novamente.`);
        }

        if (!gasPricesByNetwork || !tokenPrices) {
            return res.status(400).send("❌ Preços de gas/token não carregados. Carregue o contrato novamente.");
        }

        try {
            const processedArgs = args.map(parseArgument);
            const resultado = await deployContratoCompilado(nomeContrato, compilado, processedArgs, console.log);

            const contractId = repo.salvarContractNoDB(resultado.contractName, resultado.address);

            registerDeployedContract(resultado.contractName, {
                id: contractId,
                address: resultado.address,
                abi: resultado.abi,
                name: resultado.contractName,
            });

            const custosPorRede = {};

            for (const [token, data] of Object.entries(gasPricesByNetwork)) {
                const tokenPrice = tokenPrices[token];
                if (!tokenPrice) continue;

                const costInToken = ethers.utils.formatEther(resultado.gasUsed.mul(data.gasPrice));
                const costUSD = parseFloat(costInToken) * tokenPrice.usd;
                const costBRL = parseFloat(costInToken) * tokenPrice.brl;

                const networkId = networks[token].id;
                const functionId = repo.salvarFuncaoContratoNoDB(contractId, "deploy");
                repo.salvarFuncaoNoDB(functionId, networkId, resultado.gasUsed.toNumber(), costUSD, costBRL);
                repo.salvarNetworkCosts(
                    networkId,
                    parseFloat(ethers.utils.formatUnits(data.gasPrice, "gwei")),
                    tokenPrice.usd,
                    tokenPrice.brl
                );

                custosPorRede[token] = {
                    name: data.name,
                    token,
                    gasPrice: ethers.utils.formatUnits(data.gasPrice, "gwei") + " Gwei",
                    custoTotalToken: costInToken,
                    custoUSD: `$${costUSD.toFixed(4)}`,
                    custoBRL: `R$${costBRL.toFixed(4)}`,
                    cotacao: tokenPrice,
                };
            }

            res.json({
                nome: resultado.contractName,
                endereco: resultado.address,
                gas: resultado.gasUsed.toString(),
                custosPorRede,
            });
        } catch (err) {
            res.status(500).send(`❌ Erro ao deployar "${nomeContrato}": ${err.message}`);
        }
    });

    // ---  3️⃣ Executar funções do contrato deployado ---
    router.post("/api/execute-function", async (req, res) => {
        const { nomeContrato, nomeFuncao, args, execCount = 1 } = req.body;
        const contratoSelecionado = getDeployedContract(nomeContrato);

        if (!contratoSelecionado)
            return res.status(400).send(`❌ Contrato "${nomeContrato}" não encontrado.`);

        const provider = getHardhatProvider();
        const signer = provider.getSigner(0);
        const contract = new ethers.Contract(contratoSelecionado.address, contratoSelecionado.abi, signer);

        try {
            const processedArgs = args.map(parseArgument);

            const estimatedGas = await contract.estimateGas[nomeFuncao](...processedArgs);
            const tx = await contract[nomeFuncao](...processedArgs);
            const receipt = await tx.wait();
            // gasTotalSimulado é usado SOMENTE para exibição (simula o custo de
            // rodar a função execCount vezes). O que é persistido no banco é
            // sempre o custo de UMA execução real (receipt.gasUsed).
            const gasTotalSimulado = receipt.gasUsed.mul(execCount);

            const custosPorRede = {};

            const insertFunc = db.transaction(() => {
                const functionId = repo.salvarFuncaoContratoNoDB(contratoSelecionado.id, nomeFuncao);

                for (const [token, data] of Object.entries(gasPricesByNetwork)) {
                    const tokenPrice = tokenPrices[token];
                    if (!tokenPrice) continue;

                    // Custo de UMA execução — é isso que vai para o banco.
                    const costInTokenUnico = ethers.utils.formatEther(receipt.gasUsed.mul(data.gasPrice));
                    const costUSDUnico = parseFloat(costInTokenUnico) * tokenPrice.usd;
                    const costBRLUnico = parseFloat(costInTokenUnico) * tokenPrice.brl;

                    // Custo total simulado (execCount execuções) — apenas para exibição.
                    const costInTokenTotal = ethers.utils.formatEther(gasTotalSimulado.mul(data.gasPrice));
                    const costUSDTotal = parseFloat(costInTokenTotal) * tokenPrice.usd;
                    const costBRLTotal = parseFloat(costInTokenTotal) * tokenPrice.brl;

                    custosPorRede[token] = {
                        name: data.name,
                        token,
                        gasPrice: ethers.utils.formatUnits(data.gasPrice, "gwei") + " Gwei",
                        custoTotalToken: costInTokenTotal,
                        custoUSD: costUSDTotal ? `$${costUSDTotal.toFixed(4)}` : "N/A",
                        custoBRL: costBRLTotal ? `R$${costBRLTotal.toFixed(4)}` : "N/A",
                        cotacao: tokenPrice
                            ? { usd: tokenPrice.usd, brl: tokenPrice.brl }
                            : { usd: null, brl: null },
                    };

                    const networkId = networks[token].id;
                    // Grava no banco o custo de UMA execução, não o total simulado.
                    repo.salvarFuncaoNoDB(functionId, networkId, receipt.gasUsed.toNumber(), costUSDUnico, costBRLUnico);
                }
            });
            insertFunc();

            res.json({
                funcao: nomeFuncao,
                execucoes: execCount,
                gasEstimado: receipt.gasUsed.toString(),
                gasReal: gasTotalSimulado.toString(),
                custosPorRede,
            });
        } catch (err) {
            res.status(500).send(`⚠️ Erro ao executar "${nomeFuncao}": ${err.message}`);
        }
    });

    // --- Endpoint para pegar contas do Hardhat ---
    router.get("/api/accounts", async (req, res) => {
        try {
            const provider = getHardhatProvider();
            const accounts = await provider.listAccounts();
            res.json(accounts);
        } catch (err) {
            res.status(500).send("Erro ao obter contas: " + err.message);
        }
    });

    // 🔹 Listar contratos
    router.get("/api/contracts-list", (req, res) => {
        try {
            const rows = repo.listarContratos();
            res.json(rows.map(r => r.name));
        } catch (err) {
            console.error("Erro ao listar contratos:", err);
            res.status(500).send("Erro ao listar contratos");
        }
    });

    // 🔹 Listar redes
    router.get("/api/networks-list", (req, res) => {
        try {
            const rows = repo.listarRedes();
            const redes = rows
                .map(r => r.name)
                .filter(name => {
                    const n = name.toLowerCase();
                    return !n.includes("local") && !n.includes("hardhat");
                });
            res.json(redes);
        } catch (err) {
            console.error("Erro ao listar redes:", err);
            res.status(500).send("Erro ao listar redes");
        }
    });

    // 🔹 Listar funções de um contrato específico (ou todas se não for passado)
    router.get("/api/functions-list", (req, res) => {
        try {
            const { contract } = req.query;
            const rows = repo.listarFuncoes(contract);
            res.json(rows.map(r => r.name));
        } catch (err) {
            console.error("Erro ao listar funções:", err);
            res.status(500).send("Erro ao listar funções");
        }
    });

    router.get("/api/contract-abi", (req, res) => {
        const { contract } = req.query;
        const contrato = getDeployedContract(contract);
        if (!contrato) return res.status(404).send("Contrato não encontrado");
        res.json({ abi: contrato.abi, name: contrato.name, address: contrato.address });
    });

    router.get("/api/deployed-contracts", (req, res) => {
        try {
            const contratos = listDeployedContracts().map(name => getDeployedContract(name));
            res.json(contratos);
        } catch (err) {
            res.status(500).send("Erro ao listar contratos em memória: " + err.message);
        }
    });

    return router;
};