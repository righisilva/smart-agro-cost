# Agro Smart Cost

🌐 Acesse a ferramenta:  
https://agro-smart-cost.onrender.com/

Ferramenta para estimar e comparar custos de execução de contratos inteligentes em redes blockchain, integrando medições on-chain com indicadores econômicos do agronegócio brasileiro.

---

> ⚠️ Este projeto possui caráter experimental e acadêmico.  
> A ferramenta pode ser utilizada diretamente via web, enquanto a reprodução completa do experimento requer configuração adicional descrita neste documento.

---


## 🎯 Objetivo

O projeto tem como objetivo analisar a viabilidade econômica da adoção de blockchain em sistemas agroindustriais, considerando os custos de execução de contratos inteligentes em diferentes redes.

A abordagem combina:

- Consumo de gas (execução real)
- Preço das criptomoedas
- Indicadores econômicos do IBGE

---

## ⚙️ Funcionalidades

- Estimativa de custo de deploy e execução de contratos
- Comparação entre redes (Ethereum, BNB Chain, Polygon)
- Coleta automática de gas price via RPC
- Conversão de custos para USD e BRL
- Armazenamento de histórico
- Integração com dados do IBGE

---

## 🏗️ Arquitetura

A solução é composta por:

- Frontend web (HTML/CSS/JS)
- Backend Node.js (Express)
- Banco de dados SQLite (local) e PostgreSQL (em nuvem)
- Integração com APIs externas (preço e RPC)


<p align="center">
  <img src="docs/imagens/Arquitetura-1.png" width="700"/>
</p>

Fluxo:

1. Compilação do contrato (solc)
2. Deploy e execução (Hardhat)
3. Coleta de gas
4. Cálculo de custos
5. Armazenamento e visualização

---

## 🛠️ Tecnologias

- Node.js
- Express
- Ethers.js (v5)
- Hardhat
- SQLite
- Axios
- APIs externas (RPC + preços)

---

## 🚀 Instalação

```
git clone git@github.com:righisilva/agro-smart-cost.git
cd agro-smart-cost/
sudo apt install npm
npm install --legacy-peer-deps
```
Alguns avisos de incompatibilidade com a versão do Ethers (v5.8.0) podem ser exibidos, mas não afetam o funcionamento da ferramenta.

---

## ▶️ Execução Local

### Iniciar node local (Hardhat)
```bash
npx hardhat node
```

### Iniciar servidor
Em outra janela do terminal:
```bash
node server.js
```
Em um navegador, acessar http://localhost:3000/


### Ou iniciar node local (Hardhat) + servidor
Se desejar utilizar apenas uma janela (a tela com os logs fica mais poluída):
```bash
npm start
```
Em um navegador, acessar http://localhost:3000/

---

## 🔄 Execução contínua do Hardhat (PM2)

> ⚙️ Opcional  
> Se preferir deixar o Hardhat rodando continuamente, mesmo após reinicialização do sistema, pode utilizar o gerenciador de processos PM2.

Para instalar:
```bash
sudo npm install -g pm2
```
Para iniciar:
```bash
pm2 start --name hardhat-node "npx hardhat node"
pm2 save
pm2 startup
```
Conferir se funcionou:
```bash
pm2 logs hardhat-node
```
Para parar a execução:
```bash
pm2 stop hardhat-node
```
Para retomar a execução parada:
```bash
pm2 start hardhat-node
```
Para remover:
```bash
pm2 delete hardhat-node
```
---



A aplicação pode ser utilizada diretamente pela interface web, sem necessidade de configuração adicional.


---

## 🔬 Reprodução do experimento (opcional)

> ⚠️ Importante:  
> As etapas a seguir destinam-se exclusivamente à reprodução do ambiente experimental utilizado neste estudo.


## ⏱️ Execução automática (crontab)
Um processo automático coleta periodicamente os preços de gas das redes definidas no arquivo `networks.json`, armazenando um histórico para análise.

A coleta é realizada pelo script `buscaGas/buscaGasPrices.js` e pode ser agendada utilizando o `crontab`.

Abrir o crontab para editar:
```bash
crontab -e
```
Adicionar no final do arquivo e salvar:
```bash
*/15 * * * * cd /SEU_CAMINHO/agro-smart-cost && /usr/bin/node buscaGas/buscaGasPrices.js >> buscaGas/cron.log 2>&1
```

Para parar a execução automática:
Remover tudo que está no crontab:
```bash
crontab -r
```
ou
Abrir o crontab e apagar a linha correspondente:
```bash
crontab -e
```

### 📊 Integração com Google Sheets

> ⚙️ Opcional: caso não queira salvar os dados no Google Sheets, comente a linha abaixo no código:
>
> ```js
> await saveToGoogleSheets([row]);
> ```

Esta aplicação pode armazenar os dados coletados diretamente em uma planilha do Google Sheets.

---

#### 1. Criar uma planilha

1. Acesse o Google Sheets
2. Crie uma nova planilha
3. Copie o ID da URL:

    Exemplo:
`https://docs.google.com/spreadsheets/d/SEU_SHEET_ID/edit`


4. Guarde esse ID para usar no `.env`

---

#### 2. Criar credenciais (Service Account)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto (ou selecione um existente)
   - "Selecionar projeto" → "Novo projeto"

---

#### 3. Ativar a API

1. Vá em:
   - **APIs e Serviços** → **Biblioteca**
2. Busque por:
   - Google Sheets API
3. Clique em **Ativar**

---

#### 4. Criar a conta de serviço

1. Vá em:
   - **APIs e Serviços** → **Credenciais**
2. Clique em:
   - **Criar credenciais** → **Conta de serviço**

3. Preencha:
   - **ID da conta de serviço**: (ex: `agro-smart-cost`)
   - Demais campos: podem ficar em branco

4. Clique em **Concluir**

---

#### 5. Gerar o arquivo `credentials.json`

1. Após criar, clique na conta de serviço (e-mail gerado)
2. Vá na aba **Chaves**
3. Clique em:
   - **Adicionar chave** → **Criar nova chave**
   - Tipo: **JSON**
4. Clique em **Criar**

👉 O arquivo será baixado automaticamente

5. Renomeie para:
    credentials.json


6. Coloque na raiz do projeto:
    `./credentials.json`


---

#### 6. Compartilhar a planilha

1. Copie o e-mail da conta de serviço, exemplo:
    nome@projeto.iam.gserviceaccount.com


2. Abra sua planilha no Google Sheets
3. Clique em **Compartilhar**
4. Adicione esse e-mail como:

👉 **Editor**

---

#### 7. Configurar variáveis de ambiente

No arquivo `.env`:

```env
SHEET_ID=SEU_SHEET_ID
```

Exemplo:
SHEET_ID=1d35-kE5HOGNk-eDQqmoGXPfnlycuNofMhOON4lfs7GI



## 🐘 Banco de dados (PostgreSQL - Neon)

A aplicação utiliza PostgreSQL em nuvem (Neon).

---

### 1. Criar banco de dados

1. Acesse o Neon: https://neon.tech
2. Crie uma conta
3. Crie um novo projeto

---

### 2. Obter a string de conexão

Após criar o banco, copie a **connection string** fornecida pelo Neon.

Exemplo:
DATABASE_URL=postgresql://seu_usuario:sua_senha@seu_host/neondb?sslmode=require


---

### 3. Configurar variáveis de ambiente

No arquivo `.env`:

```env
DATABASE_URL=postgresql://seu_usuario:sua_senha@seu_host/neondb?sslmode=require
```


---

## 📄 Licença

MIT