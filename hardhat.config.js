require("@nomiclabs/hardhat-ethers");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.18" },
      { version: "0.8.20" },
      { version: "0.8.22" },
      { version: "0.8.28" }
    ]
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};

