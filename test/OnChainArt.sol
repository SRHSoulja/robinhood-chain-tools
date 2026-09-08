// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// A collection whose art is on the chain, the way Howl Street, SLIP and /dev/daemons do it: tokenURI returns
/// a data: URI holding JSON, and the JSON's image is a data: URI holding an SVG. Nothing is fetched from
/// anywhere. Deployed to testnet so the picker can be exercised against the real shape.
contract OnChainArt is ERC721 {
    constructor() ERC721("On-Chain Art", "OCA") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string[6] memory hues = ["#e4572e", "#17bebb", "#ffc914", "#2e282a", "#76b041", "#a663cc"];
        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="',
            hues[id % 6], '"/><circle cx="50" cy="42" r="', Strings.toString(12 + (id % 20)),
            '" fill="#fff" opacity="0.85"/><text x="50" y="88" font-size="14" text-anchor="middle" fill="#fff">#',
            Strings.toString(id), '</text></svg>'));
        string memory json = string(abi.encodePacked(
            '{"name":"On-Chain Art #', Strings.toString(id),
            '","description":"art that lives on the chain","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)), '"}'));
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
