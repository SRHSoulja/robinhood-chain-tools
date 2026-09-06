// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {OZ721, OZ721Enum, OZ721Pausable, A721, OZ1155, OZ20, NoReturn20, False20, Fee20, Blacklist20, Accepts, Deaf, WrongMagic, Rejects, Reenter, GasHog, Bomb, Weird20} from "./RealTokens.sol";
import {IERC721Errors, IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// Every airdrop method, against real token implementations, in every mode, with every awkward recipient.
contract BulkSendRealTest is Test {
    BulkSend bulk;
    address me = address(0xA11CE);
    address other = address(0x0DD);

    function setUp() public { bulk = new BulkSend(); }

    function _to(uint256 n, uint256 seed) internal pure returns (address[] memory a) { a = new address[](n); for (uint256 i; i < n; i++) a[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))))); }
    function _range(uint256 from, uint256 n) internal pure returns (uint256[] memory a) { a = new uint256[](n); for (uint256 i; i < n; i++) a[i] = from + i; }
    function _fill(uint256 n, uint256 v) internal pure returns (uint256[] memory a) { a = new uint256[](n); for (uint256 i; i < n; i++) a[i] = v; }

    // ======================= ERC-721: OpenZeppelin, Enumerable, ERC721A =======================

    function testOZ721_strict_unsafe_all_delivered() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 120);
        address[] memory to = _to(120, 1);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 120), false, false);
        vm.stopPrank();
        assertEq(sent, 120); assertEq(skipped, 0); assertEq(t.balanceOf(me), 0);
        for (uint256 i; i < 120; i++) assertEq(t.ownerOf(i + 1), to[i]);
    }

    function testOZ721Enumerable_delivers_and_enumeration_holds() public {
        OZ721Enum t = new OZ721Enum(); for (uint256 i = 1; i <= 30; i++) t.mint(me, i);
        address[] memory to = _to(30, 2);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        bulk.airdrop721(address(t), to, _range(1, 30), false, false);
        vm.stopPrank();
        assertEq(t.totalSupply(), 30); assertEq(t.balanceOf(me), 0);
        assertEq(t.tokenOfOwnerByIndex(to[7], 0), 8);
    }

    function testERC721A_sequential_ids_deliver() public {
        A721 t = new A721(); t.mint(me, 250);   // ids 1..250
        address[] memory to = _to(250, 3);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        uint256 g0 = gasleft();
        (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, 250), false, false);
        uint256 used = g0 - gasleft();
        vm.stopPrank();
        assertEq(sent, 250); assertEq(t.balanceOf(me), 0); assertEq(t.ownerOf(1), to[0]); assertEq(t.ownerOf(250), to[249]);
        emit log_named_uint("gas per recipient (ERC721A, 250)", used / 250);
    }

    function testOZ721_safe_strict_to_accepting_contract() public {
        OZ721 t = new OZ721(); t.mint(me, 1); Accepts a = new Accepts();
        address[] memory to = new address[](1); to[0] = address(a);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, 1), true, false);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(t.ownerOf(1), address(a));
    }

    function testOZ721_safe_strict_reverts_for_deaf_wrongmagic_rejecting() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2); t.mint(me, 3);
        address[] memory bad = new address[](3); bad[0] = address(new Deaf()); bad[1] = address(new WrongMagic()); bad[2] = address(new Rejects());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        for (uint256 i; i < 3; i++) {
            address[] memory to = new address[](1); to[0] = bad[i]; uint256[] memory ids = new uint256[](1); ids[0] = i + 1;
            vm.expectRevert();
            bulk.airdrop721(address(t), to, ids, true, false);
            assertEq(t.ownerOf(i + 1), me);
        }
        vm.stopPrank();
    }

    function testOZ721_safe_lenient_skips_each_bad_recipient_with_reason() public {
        OZ721 t = new OZ721(); for (uint256 i = 1; i <= 5; i++) t.mint(me, i);
        address[] memory to = new address[](5); to[0] = address(new Deaf()); to[1] = address(0xC0FFEE); to[2] = address(new WrongMagic()); to[3] = address(new Rejects()); to[4] = address(new Accepts());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.recordLogs();
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 5), true, true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 3);
        assertEq(t.ownerOf(1), me); assertEq(t.ownerOf(2), to[1]); assertEq(t.ownerOf(3), me); assertEq(t.ownerOf(4), me); assertEq(t.ownerOf(5), to[4]);
        Vm.Log[] memory logs = vm.getRecordedLogs(); uint256 skips;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == keccak256("Skipped(address,address,uint256,uint256,bytes)")) skips++;
        assertEq(skips, 3);
    }

    function testOZ721_unsafe_lenient_skips_zero_address_and_unowned() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(other, 2); t.mint(me, 3);
        address[] memory to = new address[](3); to[0] = address(0); to[1] = address(0xB1); to[2] = address(0xB2);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 3), false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 2); assertEq(t.ownerOf(1), me); assertEq(t.ownerOf(2), other); assertEq(t.ownerOf(3), address(0xB2));
    }

    function testOZ721_unsafe_strict_reverts_on_unowned_with_oz_error() public {
        OZ721 t = new OZ721(); t.mint(other, 1);
        address[] memory to = new address[](1); to[0] = address(0xB1);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        // OZ v5 checks the operator's approval against the REAL owner first, so the error names the missing approval
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, address(bulk), 1));
        bulk.airdrop721(address(t), to, _range(1, 1), false, false);
        vm.stopPrank();
    }

    function testOZ721_nonexistent_id_strict_reverts_lenient_skips() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        address[] memory to = new address[](2); to[0] = address(0xB1); to[1] = address(0xB2);
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 999;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(); bulk.airdrop721(address(t), to, ids, false, false);
        assertEq(t.ownerOf(1), me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.ownerOf(1), address(0xB1));
    }

    function testOZ721_paused_collection_strict_reverts_lenient_skips_everything() public {
        OZ721Pausable t = new OZ721Pausable(); t.mint(me, 1); t.mint(me, 2); t.pause();
        address[] memory to = _to(2, 9);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(); bulk.airdrop721(address(t), to, _range(1, 2), false, false);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 2), false, true);
        vm.stopPrank();
        assertEq(sent, 0); assertEq(skipped, 2); assertEq(t.balanceOf(me), 2);
    }

    function testOZ721_without_approval_nothing_moves_in_either_mode() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        address[] memory to = _to(2, 4);
        vm.startPrank(me);
        vm.expectRevert(); bulk.airdrop721(address(t), to, _range(1, 2), false, false);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 2), false, true);
        vm.stopPrank();
        assertEq(sent, 0); assertEq(skipped, 2); assertEq(t.balanceOf(me), 2);
    }

    function testOZ721_single_id_approval_is_enough_for_that_id_only() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        address[] memory to = _to(2, 5);
        vm.startPrank(me); t.approve(address(bulk), 1);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 2), false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.ownerOf(1), to[0]); assertEq(t.ownerOf(2), me);
    }

    function testOZ721_stranger_cannot_use_my_approval() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        vm.prank(me); t.setApprovalForAll(address(bulk), true);
        address[] memory to = new address[](1); to[0] = other;
        vm.prank(other);
        vm.expectRevert(); bulk.airdrop721(address(t), to, _range(1, 1), false, false);
        vm.prank(other);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 1), false, true);
        assertEq(sent, 0); assertEq(skipped, 1); assertEq(t.ownerOf(1), me);
    }

    function testOZ721_same_wallet_many_ids_and_send_to_self() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 4);
        address[] memory to = new address[](4); to[0] = other; to[1] = other; to[2] = other; to[3] = me;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, 4), false, false);
        vm.stopPrank();
        assertEq(sent, 4); assertEq(t.balanceOf(other), 3); assertEq(t.ownerOf(4), me);
    }

    function testOZ721_duplicate_id_in_list_strict_reverts_lenient_skips_second() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        address[] memory to = new address[](2); to[0] = address(0xB1); to[1] = address(0xB2);
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 1;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(); bulk.airdrop721(address(t), to, ids, false, false);
        assertEq(t.ownerOf(1), me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.ownerOf(1), address(0xB1));
    }

    function testOZ721_reentrant_recipient_cannot_steal_and_batch_completes() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        Reenter r = new Reenter(address(bulk), address(t));
        address[] memory to = new address[](2); to[0] = address(r); to[1] = address(0xB2);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, 2), true, false);
        vm.stopPrank();
        assertEq(sent, 2); assertTrue(r.reentered()); assertFalse(r.innerOk());
        assertEq(t.ownerOf(1), address(r)); assertEq(t.ownerOf(2), address(0xB2));
    }

    /// Audit finding 2: under EIP-150 a hook that burns everything it is given used to leave the loop with 1/64 of its
    /// gas, so one hostile address near the front of a long lenient batch sank the whole batch. With the per-transfer
    /// gas cap the hog is skipped and the other 119 are delivered, on a gas budget that is realistic for the batch.
    function testOZ721_gas_griefing_at_front_of_long_lenient_batch_cannot_sink_it() public {
        uint256 n = 120;
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, 77); to[1] = address(new GasHog());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721{gas: 8_000_000}(address(t), to, _range(1, n), true, true);
        vm.stopPrank();
        assertEq(sent, n - 1); assertEq(skipped, 1); assertEq(t.ownerOf(2), me); assertEq(t.ownerOf(1), to[0]); assertEq(t.ownerOf(n), to[n - 1]);
    }

    function testOZ721_three_gas_hogs_in_lenient_batch_all_skipped_rest_delivered() public {
        uint256 n = 60;
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, 78); to[0] = address(new GasHog()); to[30] = address(new GasHog()); to[59] = address(new GasHog());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721{gas: 6_000_000}(address(t), to, _range(1, n), true, true);
        vm.stopPrank();
        assertEq(sent, n - 3); assertEq(skipped, 3); assertEq(t.balanceOf(me), 3);
    }

    function testOZ721_return_bomb_recipient_lenient_skipped_rest_delivered() public {
        uint256 n = 40;
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, 79); to[3] = address(new Bomb());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721{gas: 5_000_000}(address(t), to, _range(1, n), true, true);
        vm.stopPrank();
        assertEq(sent, n - 1); assertEq(skipped, 1); assertEq(t.ownerOf(4), me);
    }

    function testOZ1155_gas_hog_and_bomb_in_lenient_batch_skipped_rest_delivered() public {
        uint256 n = 80;
        OZ1155 t = new OZ1155(); t.mint(me, 1, n);
        address[] memory to = _to(n, 80); to[0] = address(new GasHog()); to[40] = address(new Bomb());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155{gas: 7_000_000}(address(t), to, _fill(n, 1), _fill(n, 1), true);
        vm.stopPrank();
        assertEq(sent, n - 2); assertEq(skipped, 2); assertEq(t.balanceOf(me, 1), 2);
    }

    function testOZ721_strict_safe_forwards_full_gas_so_a_heavy_honest_hook_still_works() public {
        // strict mode has no cap: an honest recipient hook that needs more than the lenient cap must still succeed there
        OZ721 t = new OZ721(); t.mint(me, 1);
        address[] memory to = new address[](1); to[0] = address(new Accepts());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, 1), true, false);
        vm.stopPrank();
        assertEq(sent, 1);
    }

    function testWeird20_odd_return_data_is_a_failure_not_a_panic() public {
        Weird20 t = new Weird20(); t.mint(me, 100);
        address[] memory to = _to(2, 81);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        t.setMode(1);   // 16-byte return
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1), true);
        assertEq(sent, 0); assertEq(skipped, 2);
        t.setMode(2);   // a word holding 2
        (sent, skipped) = bulk.airdrop20(address(t), to, _fill(2, 1), true);
        assertEq(sent, 0); assertEq(skipped, 2);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.TransferFailed.selector, to[0], 0)); bulk.airdrop20(address(t), to, _fill(2, 1), false);
        t.setMode(0);
        (sent, skipped) = bulk.airdrop20(address(t), to, _fill(2, 1), true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 0);
    }

    function testFuzz_OZ721_any_batch_size_delivers_exactly(uint8 nRaw) public {
        uint256 n = bound(nRaw, 1, 200);
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, nRaw);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, n), false, false);
        vm.stopPrank();
        assertEq(sent, n); assertEq(skipped, 0); assertEq(t.balanceOf(me), 0); assertEq(t.balanceOf(address(bulk)), 0);
        for (uint256 i; i < n; i++) assertEq(t.ownerOf(i + 1), to[i]);
    }

    // ======================= ERC-1155: OpenZeppelin =======================

    function testOZ1155_strict_amounts_to_wallets_and_accepting_contract() public {
        OZ1155 t = new OZ1155(); t.mint(me, 5, 1000); t.mint(me, 6, 10);
        Accepts a = new Accepts();
        address[] memory to = new address[](3); to[0] = address(0xB1); to[1] = address(a); to[2] = address(0xB1);
        uint256[] memory ids = new uint256[](3); ids[0] = 5; ids[1] = 5; ids[2] = 6;
        uint256[] memory amt = new uint256[](3); amt[0] = 100; amt[1] = 250; amt[2] = 3;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, ids, amt, false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(skipped, 0);
        assertEq(t.balanceOf(address(0xB1), 5), 100); assertEq(t.balanceOf(address(a), 5), 250); assertEq(t.balanceOf(address(0xB1), 6), 3);
        assertEq(t.balanceOf(me, 5), 650); assertEq(t.balanceOf(me, 6), 7);
    }

    function testOZ1155_strict_reverts_on_deaf_wrongmagic_rejecting_insufficient() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 5);
        address[] memory bad = new address[](3); bad[0] = address(new Deaf()); bad[1] = address(new WrongMagic()); bad[2] = address(new Rejects());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        for (uint256 i; i < 3; i++) { address[] memory to = new address[](1); to[0] = bad[i]; vm.expectRevert(); bulk.airdrop1155(address(t), to, _fill(1, 1), _fill(1, 1), false); }
        address[] memory w = new address[](1); w[0] = address(0xB1);
        vm.expectRevert(); bulk.airdrop1155(address(t), w, _fill(1, 1), _fill(1, 6), false);   // more than held
        vm.stopPrank();
        assertEq(t.balanceOf(me, 1), 5);
    }

    function testOZ1155_lenient_skips_bad_and_over_amount_delivers_rest() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 5);
        address[] memory to = new address[](4); to[0] = address(new Deaf()); to[1] = address(0xB1); to[2] = address(0xB2); to[3] = address(new Rejects());
        uint256[] memory amt = new uint256[](4); amt[0] = 1; amt[1] = 2; amt[2] = 10; amt[3] = 1;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, _fill(4, 1), amt, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 3); assertEq(t.balanceOf(address(0xB1), 1), 2); assertEq(t.balanceOf(me, 1), 3);
    }

    function testOZ1155_without_approval_strict_reverts_lenient_skips() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 5);
        address[] memory to = new address[](1); to[0] = address(0xB1);
        vm.startPrank(me);
        vm.expectRevert(); bulk.airdrop1155(address(t), to, _fill(1, 1), _fill(1, 1), false);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, _fill(1, 1), _fill(1, 1), true);
        vm.stopPrank();
        assertEq(sent, 0); assertEq(skipped, 1); assertEq(t.balanceOf(me, 1), 5);
    }

    function testFuzz_OZ1155_amounts_conserve_supply(uint8 nRaw, uint32 perRaw) public {
        uint256 n = bound(nRaw, 1, 150); uint256 per = bound(perRaw, 1, 1e6);
        OZ1155 t = new OZ1155(); t.mint(me, 42, per * n);
        address[] memory to = _to(n, perRaw);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent,) = bulk.airdrop1155(address(t), to, _fill(n, 42), _fill(n, per), false);
        vm.stopPrank();
        assertEq(sent, n); assertEq(t.balanceOf(me, 42), 0); uint256 sum; for (uint256 i; i < n; i++) sum += t.balanceOf(to[i], 42); assertEq(sum, per * n);
    }

    // ======================= ERC-20: OpenZeppelin, no-return, returns-false, fee-on-transfer, blacklist =======================

    function testOZ20_strict_exact_amounts_and_allowance_consumed() public {
        OZ20 t = new OZ20(); t.mint(me, 100e18);
        address[] memory to = _to(3, 7); uint256[] memory amt = new uint256[](3); amt[0] = 10e18; amt[1] = 20e18; amt[2] = 30e18;
        vm.startPrank(me); t.approve(address(bulk), 60e18);
        (uint256 sent,) = bulk.airdrop20(address(t), to, amt, false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(t.balanceOf(to[2]), 30e18); assertEq(t.balanceOf(me), 40e18); assertEq(t.allowance(me, address(bulk)), 0);
    }

    function testOZ20_allowance_short_strict_reverts_lenient_skips_tail() public {
        OZ20 t = new OZ20(); t.mint(me, 100e18);
        address[] memory to = _to(3, 8); uint256[] memory amt = new uint256[](3); amt[0] = 10e18; amt[1] = 10e18; amt[2] = 10e18;
        vm.startPrank(me); t.approve(address(bulk), 25e18);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.TransferFailed.selector, to[2], 0)); bulk.airdrop20(address(t), to, amt, false);
        assertEq(t.balanceOf(me), 100e18);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1); assertEq(t.balanceOf(to[2]), 0); assertEq(t.balanceOf(me), 80e18);
    }

    function testOZ20_zero_address_recipient_strict_reverts_lenient_skips() public {
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        address[] memory to = new address[](2); to[0] = address(0); to[1] = address(0xB1);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(); bulk.airdrop20(address(t), to, _fill(2, 1e18), false);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1e18), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(address(0xB1)), 1e18);
    }

    function testNoReturn20_usdt_style_delivers() public {
        NoReturn20 t = new NoReturn20(); t.mint(me, 1_000_000);
        address[] memory to = _to(4, 11);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(4, 100_000), false);
        vm.stopPrank();
        assertEq(sent, 4); assertEq(skipped, 0); assertEq(t.balanceOf(to[3]), 100_000); assertEq(t.balanceOf(me), 600_000);
    }

    function testFalse20_returns_false_is_a_failure_not_a_delivery() public {
        False20 t = new False20(); t.mint(me, 100);
        address[] memory to = _to(2, 12); uint256[] memory amt = new uint256[](2); amt[0] = 60; amt[1] = 60;   // second one fails: balance short
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.TransferFailed.selector, to[1], 0)); bulk.airdrop20(address(t), to, amt, false);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(to[0]), 60); assertEq(t.balanceOf(to[1]), 0);
    }

    function testFee20_delivers_less_than_sent_and_reports_sent_count_only() public {
        Fee20 t = new Fee20(); t.mint(me, 100e18);
        address[] memory to = _to(2, 13);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent,) = bulk.airdrop20(address(t), to, _fill(2, 50e18), false);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(t.balanceOf(to[0]), 49e18); assertEq(t.balanceOf(me), 0);   // the page must warn about fee-on-transfer tokens
    }

    function testBlacklist20_blocked_recipient_strict_reverts_lenient_skips_with_reason() public {
        Blacklist20 t = new Blacklist20(); t.mint(me, 10e18); t.block_(address(0xBAD), true);
        address[] memory to = new address[](2); to[0] = address(0xBAD); to[1] = address(0xB1);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(); bulk.airdrop20(address(t), to, _fill(2, 1e18), false);
        vm.recordLogs();
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1e18), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(address(0xB1)), 1e18);
        Vm.Log[] memory logs = vm.getRecordedLogs(); bool found;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == keccak256("Skipped(address,address,uint256,uint256,bytes)")) { (,, bytes memory reason) = abi.decode(logs[i].data, (uint256, uint256, bytes)); assertEq(bytes4(reason), Blacklist20.Blocked.selector); found = true; }
        assertTrue(found);
    }

    function testOZ20_not_a_token_address_strict_reverts_lenient_skips() public {
        address notToken = address(new Deaf());
        address[] memory to = _to(1, 14);
        vm.expectRevert(); bulk.airdrop20(notToken, to, _fill(1, 1), false);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(notToken, to, _fill(1, 1), true);
        assertEq(sent, 0); assertEq(skipped, 1);
    }

    function testOZ20_eoa_as_token_address_is_never_a_delivery() public {
        // a call to an address with no code "succeeds" with empty return data; the contract must refuse it outright
        address eoa = address(0xE0A);
        address[] memory to = _to(1, 15);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAContract.selector, eoa)); bulk.airdrop20(eoa, to, _fill(1, 1), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAContract.selector, eoa)); bulk.airdrop20(eoa, to, _fill(1, 1), false);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAContract.selector, eoa)); bulk.airdrop721(eoa, to, _fill(1, 1), false, true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAContract.selector, eoa)); bulk.airdrop1155(eoa, to, _fill(1, 1), _fill(1, 1), true);
    }

    function testFuzz_OZ20_conserves_total(uint8 nRaw, uint64 perRaw) public {
        uint256 n = bound(nRaw, 1, 200); uint256 per = bound(perRaw, 1, 1e18);
        OZ20 t = new OZ20(); t.mint(me, per * n);
        address[] memory to = _to(n, perRaw);
        vm.startPrank(me); t.approve(address(bulk), per * n);
        (uint256 sent,) = bulk.airdrop20(address(t), to, _fill(n, per), false);
        vm.stopPrank();
        assertEq(sent, n); assertEq(t.balanceOf(me), 0); uint256 sum; for (uint256 i; i < n; i++) sum += t.balanceOf(to[i]); assertEq(sum, per * n); assertEq(t.balanceOf(address(bulk)), 0);
    }

    // ======================= the contract itself =======================

    function test_bulk_has_no_owner_no_ether_path_no_state() public {
        (bool ok,) = address(bulk).call{value: 1 ether}("");
        assertFalse(ok);   // no receive/fallback: ether cannot be sent to it
        assertEq(address(bulk).balance, 0);
    }
}
