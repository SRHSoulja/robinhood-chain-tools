// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Thirteenth-round reviewer probes for src/BulkSend.sol. Same convention as test/AuditProbe.t.sol and
// test/Audit12.t.sol: each test asserts the behaviour a FINDING describes, so a test that PASSES is a
// finding that reproduces and a test that FAILS is a finding that has been fixed.
//
//   forge test --match-path test/Audit13.t.sol

import {Test} from "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {MockERC721} from "./Mocks.sol";

contract Audit13 is Test {
    BulkSend bulk;
    address me = address(0xA11CE);
    address a = address(0xAA);
    address b = address(0xBB);
    address c = address(0xCC);

    function setUp() public { bulk = new BulkSend(); }

    function _to3() internal view returns (address[] memory t) { t = new address[](3); t[0] = a; t[1] = b; t[2] = c; }

    // ---------------------------------------------------------------------------------------------------
    // S13-1  _mustNotBeNft probes ONLY amounts[0]. _mustBeNft, its stated mirror, probes ids[0], then
    //        ids[n-1], then supportsInterface. So the ERC-20 guard is defeated by exactly the state
    //        round twelve taught the 721 guard to survive: a first row whose id is burned or never minted.
    //        The guard passes, row 0 reverts (no such id), and every LATER row spends a real NFT as an
    //        "amount" and is counted as an ERC-20 delivery.
    function test_probe_mustNotBeNft_is_bypassed_when_the_first_id_is_not_minted() public {
        MockERC721 nft = new MockERC721();
        vm.startPrank(me);
        nft.mint(me, 2); nft.mint(me, 3);       // id 1 was burned, or sold, or never minted
        nft.setApprovalForAll(address(bulk), true);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1; amounts[1] = 2; amounts[2] = 3;
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(nft), _to3(), amounts, true);   // LENIENT
        vm.stopPrank();
        assertEq(sent, 2, "reported two ERC-20 deliveries");
        assertEq(skipped, 1);
        assertEq(nft.ownerOf(2), b, "NFT 2 left the sender");
        assertEq(nft.ownerOf(3), c, "NFT 3 left the sender");
    }

    // The same, in STRICT mode: row 0 reverts so the batch comes down. Included to show the lenient mode
    // is the one that loses the NFTs, and that "all or nothing" is what saves the strict caller here.
    function test_probe_strict_mode_survives_the_same_paste() public {
        MockERC721 nft = new MockERC721();
        vm.startPrank(me);
        nft.mint(me, 2); nft.mint(me, 3);
        nft.setApprovalForAll(address(bulk), true);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1; amounts[1] = 2; amounts[2] = 3;
        vm.expectRevert();
        bulk.airdrop20(address(nft), _to3(), amounts, false);
        vm.stopPrank();
        assertEq(nft.ownerOf(2), me, "nothing moved");
    }
}
