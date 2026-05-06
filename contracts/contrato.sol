// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Produto {
    string public nome;
    uint256 public preco;

    constructor(string memory _nome, uint256 _preco) {
        nome = _nome;
        preco = _preco;
    }

    function setNome(string memory _nome) public {
        nome = _nome;
    }

    function setPreco(uint256 _preco) public {
        preco = _preco;
    }

    function getPreco() public view returns (uint256) {
        return preco;
    }
}
