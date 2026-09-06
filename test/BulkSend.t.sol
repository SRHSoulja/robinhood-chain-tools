// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {MockERC721, MockERC1155, MockERC20, DeafRecipient, GoodRecipient} from "./Mocks.sol";

contract BulkSendTest is Test {
    BulkSend bulk;
    MockERC721 nft;
    MockERC1155 multi;
    MockERC20 erc20;
    address sender = address(0xA11CE);
    address stranger = address(0xBAD);

    function setUp() public {
        bulk = new BulkSend();
        nft = new MockERC721();
        multi = new MockERC1155();
        erc20 = new MockERC20();
    }

    function _recipients(uint256 n) internal pure returns (address[] memory to) {
        to = new address[](n);
        for (uint256 i; i < n; i++) to[i] = address(uint160(0x1000 + i));
    }

    function _ids(uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = i + 1;
    }

    // ---------- ERC-721 ----------
    function test721_sends_each_id_to_each_recipient() public {
        uint256 n = 50;
        for (uint256 i = 1; i <= n; i++) nft.mint(sender, i);
        vm.startPrank(sender);
        nft.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(nft), _recipients(n), _ids(n), false, false);
        vm.stopPrank();
        assertEq(sent, n); assertEq(skipped, 0);
        for (uint256 i = 1; i <= n; i++) assertEq(nft.ownerOf(i), address(uint160(0x1000 + i - 1)));
        assertEq(nft.balanceOf(sender), 0);
    }

    function test721_needs_approval() public {
        nft.mint(sender, 1);
        address[] memory to = _recipients(1); uint256[] memory ids = _ids(1);
        vm.prank(sender);
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        bulk.airdrop721(address(nft), to, ids, false, false);
    }

    function test721_cannot_move_someone_elses_token() public {
        nft.mint(sender, 1);
        vm.prank(sender); nft.setApprovalForAll(address(bulk), true);
        address[] memory to = _recipients(1); uint256[] memory ids = _ids(1);
        vm.prank(stranger);
        vm.expectRevert(bytes("WRONG_FROM"));   // transferFrom(msg.sender=stranger, ...) never touches the owner's token
        bulk.airdrop721(address(nft), to, ids, false, false);
        assertEq(nft.ownerOf(1), sender);
    }

    function test721_strict_reverts_whole_batch_on_one_bad_recipient() public {
        for (uint256 i = 1; i <= 3; i++) nft.mint(sender, i);
        address[] memory to = _recipients(3); to[1] = address(new DeafRecipient());
        uint256[] memory ids = _ids(3);
        vm.startPrank(sender); nft.setApprovalForAll(address(bulk), true);
        vm.expectRevert(bytes("UNSAFE_RECIPIENT"));
        bulk.airdrop721(address(nft), to, ids, true, false);
        vm.stopPrank();
        assertEq(nft.balanceOf(sender), 3);   // nothing moved
    }

    function test721_lenient_skips_bad_recipient_and_delivers_the_rest() public {
        for (uint256 i = 1; i <= 3; i++) nft.mint(sender, i);
        address[] memory to = _recipients(3); to[1] = address(new DeafRecipient()); to[2] = address(new GoodRecipient());
        uint256[] memory ids = _ids(3);
        vm.startPrank(sender); nft.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(nft), to, ids, true, true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1);
        assertEq(nft.ownerOf(1), to[0]); assertEq(nft.ownerOf(2), sender); assertEq(nft.ownerOf(3), to[2]);
    }

    function test721_lenient_skips_ids_you_do_not_own() public {
        nft.mint(sender, 1); nft.mint(stranger, 2);
        vm.startPrank(sender); nft.setApprovalForAll(address(bulk), true);
        address[] memory to = _recipients(2); uint256[] memory ids = _ids(2);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(nft), to, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(nft.ownerOf(2), stranger);
    }

    function test721_rejects_mismatched_and_empty() public {
        address[] memory to = _recipients(2); uint256[] memory ids = _ids(1);
        vm.expectRevert(BulkSend.LengthMismatch.selector); bulk.airdrop721(address(nft), to, ids, false, false);
        address[] memory none = new address[](0); uint256[] memory noIds = new uint256[](0);
        vm.expectRevert(BulkSend.EmptyBatch.selector); bulk.airdrop721(address(nft), none, noIds, false, false);
    }

    function test721_gas_per_recipient_in_a_batch_of_200() public {
        uint256 n = 200;
        for (uint256 i = 1; i <= n; i++) nft.mint(sender, i);
        vm.startPrank(sender); nft.setApprovalForAll(address(bulk), true);
        uint256 g0 = gasleft();
        bulk.airdrop721(address(nft), _recipients(n), _ids(n), false, false);
        uint256 used = g0 - gasleft();
        vm.stopPrank();
        emit log_named_uint("gas per recipient (721, unsafe)", used / n);
        assertLt(used / n, 60_000);
    }

    // ---------- ERC-1155 ----------
    function test1155_sends_amounts() public {
        multi.mint(sender, 7, 1000);
        address[] memory to = _recipients(4); uint256[] memory ids = new uint256[](4); uint256[] memory amt = new uint256[](4);
        for (uint256 i; i < 4; i++) { ids[i] = 7; amt[i] = 10 * (i + 1); }
        vm.startPrank(sender); multi.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(multi), to, ids, amt, false);
        vm.stopPrank();
        assertEq(sent, 4); assertEq(skipped, 0);
        assertEq(multi.balanceOf(7, to[3]), 40); assertEq(multi.balanceOf(7, sender), 900);
    }

    function test1155_lenient_skips_deaf_contract() public {
        multi.mint(sender, 1, 10);
        address[] memory to = _recipients(2); to[0] = address(new DeafRecipient());
        uint256[] memory ids = new uint256[](2); uint256[] memory amt = new uint256[](2); ids[0] = 1; ids[1] = 1; amt[0] = 1; amt[1] = 1;
        vm.startPrank(sender); multi.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(multi), to, ids, amt, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(multi.balanceOf(1, sender), 9);
    }

    // ---------- ERC-20 ----------
    function test20_sends_and_tolerates_no_return_tokens() public {
        erc20.mint(sender, 1_000e18);
        address[] memory to = _recipients(3); uint256[] memory amt = new uint256[](3); amt[0] = 1e18; amt[1] = 2e18; amt[2] = 3e18;
        vm.startPrank(sender); erc20.approve(address(bulk), type(uint256).max);
        (uint256 sent,) = bulk.airdrop20(address(erc20), to, amt, false);
        erc20.setReturnsNothing(true);
        (uint256 sent2,) = bulk.airdrop20(address(erc20), to, amt, false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(sent2, 3); assertEq(erc20.balanceOf(to[2]), 6e18);
    }

    function test20_strict_reverts_on_insufficient_balance_lenient_skips() public {
        erc20.mint(sender, 5e18);
        address[] memory to = _recipients(2); uint256[] memory amt = new uint256[](2); amt[0] = 4e18; amt[1] = 4e18;
        vm.startPrank(sender); erc20.approve(address(bulk), type(uint256).max);
        // strict mode now passes the token's own reason through instead of replacing it
        vm.expectRevert(bytes("BALANCE"));
        bulk.airdrop20(address(erc20), to, amt, false);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(erc20), to, amt, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(erc20.balanceOf(sender), 1e18);
    }

    // ---------- the contract never holds anything ----------
    function test_contract_holds_nothing_after_batches() public {
        nft.mint(sender, 1); erc20.mint(sender, 1e18); multi.mint(sender, 1, 1);
        vm.startPrank(sender); nft.setApprovalForAll(address(bulk), true); erc20.approve(address(bulk), 1e18); multi.setApprovalForAll(address(bulk), true);
        address[] memory to = _recipients(1); uint256[] memory one = new uint256[](1); one[0] = 1; uint256[] memory amt = new uint256[](1); amt[0] = 1e18;
        bulk.airdrop721(address(nft), to, one, false, false); bulk.airdrop20(address(erc20), to, amt, false); bulk.airdrop1155(address(multi), to, one, one, false);
        vm.stopPrank();
        assertEq(nft.balanceOf(address(bulk)), 0); assertEq(erc20.balanceOf(address(bulk)), 0); assertEq(multi.balanceOf(1, address(bulk)), 0);
    }
}
