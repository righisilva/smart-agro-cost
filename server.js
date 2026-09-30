// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const gasHistoryRoutes = require("./routes/gasHistoryRoutes");
const ibgeRoutes = require("./routes/ibgeRoutes");
const resultsRoutes = require("./routes/resultsRoutes");
const contractsRoutes = require("./routes/contractsRoutes");
const { initNetworks } = require("./db/initNetworks");

const app = express();
app.use(express.json());

// --- Banco de dados SQLite ---
const db = new Database("smartagro.db");

// --- Inicializa redes no banco ---
const networks = initNetworks(db);

// --- Arquivos estáticos e rotas de cada módulo ---
app.use("/dashboard", express.static("public/IBGE"));
app.use("/api/ibge", ibgeRoutes(db));

app.use("/gas-history", express.static(path.join(__dirname, "public/gas-history")));
app.use("/api/gas-history", gasHistoryRoutes);

app.use("/results", express.static(path.join(__dirname, "public/results")));
app.use("/api/results", resultsRoutes(db));

app.use("/interface", express.static(path.join(__dirname, "public/interface-contratos")));
app.use("/gas", express.static("public/gas-estimator"));

// --- Gas Estimator (automático + manual) ---
app.use("/", contractsRoutes(db, networks));

// --- Páginas/rotas gerais ---
app.get("/status", (req, res) => {
    res.json({
        status: "online",
        timestamp: new Date(),
        version: "1.0.0",
    });
});

app.get("/manual", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "manual", "index.html"));
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