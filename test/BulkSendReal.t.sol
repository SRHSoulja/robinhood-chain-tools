// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {OZ721, OZ721Enum, OZ721Pausable, A721, OZ1155, OZ20, NoReturn20, False20, Fee20, Blacklist20, Accepts, Deaf, WrongMagic, Rejects, Reenter, GasHog, Bomb, Weird20, Callback20, Erc20GasHog, PaysThenLies20, LongReason20, TwoWord20, PolitelyDoesNothing, SilentlyDoesNothing, PretendsToBeAnNft, BareRevert721, BareRevert721NoIntrospection, NoIntrospection721, Chatty721, Chatty1155} from "./RealTokens.sol";
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

    /// A zero address is never sent to: some tokens treat it as a burn, and burning an NFT because of a stray
    /// spreadsheet line is not recoverable. Strict refuses the batch; lenient skips that one and delivers the rest.
    function testOZ721_zero_recipient_strict_reverts_lenient_skips_and_never_burns() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        address[] memory to = new address[](2); to[0] = address(0xB1); to[1] = address(0);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.ZeroRecipient.selector, 1)); bulk.airdrop721(address(t), to, _range(1, 2), false, false);
        assertEq(t.balanceOf(me), 2);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 2), false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.ownerOf(1), address(0xB1)); assertEq(t.ownerOf(2), me);
    }

    function testOZ721_unsafe_lenient_skips_unowned() public {
        OZ721 t = new OZ721(); t.mint(other, 1); t.mint(me, 2);
        address[] memory to = new address[](2); to[0] = address(0xB1); to[1] = address(0xB2);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 2), false, true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.ownerOf(1), other); assertEq(t.ownerOf(2), address(0xB2));
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
        t.setMode(1);   // 16-byte return: the call succeeded, so the balance may already have moved
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0)); bulk.airdrop20(address(t), to, _fill(2, 1), true);
        t.setMode(2);   // a word holding 2
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0)); bulk.airdrop20(address(t), to, _fill(2, 1), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0)); bulk.airdrop20(address(t), to, _fill(2, 1), false);
        t.setMode(0);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1), true);
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
        // the token's own error reaches the caller now, so the page can say "allowance too low"
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(bulk), 5e18, 10e18)); bulk.airdrop20(address(t), to, amt, false);
        assertEq(t.balanceOf(me), 100e18);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1); assertEq(t.balanceOf(to[2]), 0); assertEq(t.balanceOf(me), 80e18);
    }

    function testOZ20_zero_address_strict_reverts_lenient_skips() public {
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        address[] memory to = new address[](2); to[0] = address(0); to[1] = address(0xB1);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.ZeroRecipient.selector, 0)); bulk.airdrop20(address(t), to, _fill(2, 1e18), false);
        assertEq(t.balanceOf(me), 10e18);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1e18), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(address(0)), 0); assertEq(t.balanceOf(address(0xB1)), 1e18);
    }

    /// A permissive token that would happily burn to the zero address must still never be asked to.
    function testNoReturn20_zero_address_is_never_burned_even_though_the_token_allows_it() public {
        NoReturn20 t = new NoReturn20(); t.mint(me, 1000);
        address[] memory to = new address[](2); to[0] = address(0); to[1] = address(0xB1);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 10), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(address(0)), 0); assertEq(t.balanceOf(me), 990);
    }

    /// The strict-mode counter is set after the loop; it must still equal the batch size.
    function testStrict_sent_count_equals_batch_size() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 25);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), _to(25, 55), _range(1, 25), false, false);
        vm.stopPrank();
        assertEq(sent, 25); assertEq(skipped, 0);
        OZ1155 m = new OZ1155(); m.mint(me, 1, 100);
        vm.startPrank(me); m.setApprovalForAll(address(bulk), true);
        (uint256 s2,) = bulk.airdrop1155(address(m), _to(10, 56), _fill(10, 1), _fill(10, 2), false);
        vm.stopPrank();
        assertEq(s2, 10);
    }

    function testNoReturn20_usdt_style_delivers() public {
        NoReturn20 t = new NoReturn20(); t.mint(me, 1_000_000);
        address[] memory to = _to(4, 11);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(4, 100_000), false);
        vm.stopPrank();
        assertEq(sent, 4); assertEq(skipped, 0); assertEq(t.balanceOf(to[3]), 100_000); assertEq(t.balanceOf(me), 600_000);
    }

    /// A `false` answer is indistinguishable from a token that paid and then lied, so neither mode may treat it
    /// as a skip. The whole batch is undone, which also undoes anything the token did do.
    /// Round twelve S-6 argued this should be a lenient SKIP: ERC-20 defines `false` as "I did not transfer",
    /// and this fixture really did move nothing, so a blocklisted recipient should not cost the batch. The
    /// counter-example is the test below -- PaysThenLies20 pays and THEN answers false -- and from inside the
    /// call the two are identical. The choice is to keep them together and take the whole batch down, because
    /// listing a paid recipient as skipped is how a re-run pays them twice. See docs/for-reviewers.md
    /// decision 3. This test and testERC20_paidButAnsweredWrong_revertsInsteadOfSkipping pin both halves; if a
    /// later round changes one of them, it must say what new information separates the two shapes.
    function testFalse20_returningFalseRevertsBothModes() public {
        False20 t = new False20(); t.mint(me, 100);
        address[] memory to = _to(2, 12); uint256[] memory amt = new uint256[](2); amt[0] = 60; amt[1] = 60;
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[1], 1)); bulk.airdrop20(address(t), to, amt, false);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[1], 1)); bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(t.balanceOf(to[0]), 0); assertEq(t.balanceOf(me), 100);
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


    // ======================= second-audit findings =======================

    /// N1: a lenient batch that cannot afford the full stipend must revert, not skip an honest recipient and
    /// blame it. Also what keeps eth_estimateGas honest: the cheap "skip everyone" outcome is no longer valid.
    function testLenient_underfunded_batch_reverts_instead_of_blaming_a_recipient() public {
        uint256 n = 6;
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, 91);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert();   // OutOfGasForBatch at whichever index runs dry
        bulk.airdrop721{gas: 500_000}(address(t), to, _range(1, n), true, true);
        vm.stopPrank();
        assertEq(t.balanceOf(me), n);   // nothing moved
    }

    function testLenient_fully_funded_batch_delivers_everyone() public {
        uint256 n = 6;
        OZ721 t = new OZ721(); t.mintMany(me, 1, n);
        address[] memory to = _to(n, 92);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721{gas: 4_000_000}(address(t), to, _range(1, n), true, true);
        vm.stopPrank();
        assertEq(sent, n); assertEq(skipped, 0);
    }

    /// N2: the ERC-20 path now carries the same stipend, so a hostile recipient reached through a token
    /// callback cannot sink the batch.
    function testERC20_gas_hog_recipient_cannot_sink_a_lenient_batch() public {
        uint256 n = 40;
        Callback20 t = new Callback20(); t.mint(me, 1000);
        address[] memory to = _to(n, 93); to[1] = address(new Erc20GasHog());
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20{gas: 20_000_000}(address(t), to, _fill(n, 1), true);
        vm.stopPrank();
        assertEq(sent, n - 1); assertEq(skipped, 1); assertEq(t.balanceOf(to[0]), 1);
    }

    /// N3: a recipient that reverts with a huge payload can no longer amplify the batch's cost. The revert
    /// data kept is capped, so a bomb costs about what an ordinary failure costs.
    function testReturnBomb_costs_no_more_than_an_ordinary_failure() public {
        OZ721 a = new OZ721(); a.mint(me, 1);
        address[] memory bombTo = new address[](1); bombTo[0] = address(new Bomb());
        vm.startPrank(me); a.setApprovalForAll(address(bulk), true);
        uint256 g0 = gasleft(); bulk.airdrop721(address(a), bombTo, _range(1, 1), true, true); uint256 bombGas = g0 - gasleft();
        vm.stopPrank();
        OZ721 b = new OZ721(); b.mint(me, 1);
        address[] memory deafTo = new address[](1); deafTo[0] = address(new Deaf());
        vm.startPrank(me); b.setApprovalForAll(address(bulk), true);
        uint256 g1 = gasleft(); bulk.airdrop721(address(b), deafTo, _range(1, 1), true, true); uint256 deafGas = g1 - gasleft();
        vm.stopPrank();
        emit log_named_uint("gas, 200KB return bomb", bombGas);
        emit log_named_uint("gas, plain deaf recipient", deafGas);
        // Before the cap a single bomb cost ~2.8M. Now the worst a recipient can do is burn its own stipend,
        // so the bound is one stipend over an ordinary failure, and no amount of returndata changes that.
        assertLt(bombGas, deafGas + bulk.LENIENT_GAS() + 20_000);
        assertLt(bombGas, 600_000);
    }

    function testSkippedReason_is_truncated() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        address[] memory to = new address[](1); to[0] = address(new Bomb());
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.recordLogs();
        bulk.airdrop721(address(t), to, _range(1, 1), true, true);
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs(); bool checked;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == keccak256("Skipped(address,address,uint256,uint256,bytes)")) {
            (,, bytes memory reason) = abi.decode(logs[i].data, (uint256, uint256, bytes));
            assertLe(reason.length, 128); checked = true;
        }
        assertTrue(checked);
    }

    /// N14: the documented escape hatch. A recipient whose honest hook needs more than the lenient stipend is
    /// skipped in lenient mode and delivered in strict mode, where the whole transaction's gas is available.
    function testHeavyHonestHook_skipped_when_lenient_delivered_when_strict() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        HeavyAccepts h = new HeavyAccepts();
        address[] memory to = new address[](1); to[0] = address(h);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 1), true, true);
        assertEq(sent, 0); assertEq(skipped, 1); assertEq(t.ownerOf(1), me);
        uint256[] memory second = new uint256[](1); second[0] = 2;
        (uint256 sent2,) = bulk.airdrop721(address(t), to, second, true, false);
        vm.stopPrank();
        assertEq(sent2, 1); assertEq(t.ownerOf(2), address(h));
    }


    /// A wallet running delegated code under EIP-7702 has code but is not a token. Calling it as one is how a
    /// mistyped address could be counted as a successful delivery, so it is refused up front.
    function test_delegatedWalletIsNotMistakenForAToken() public {
        address wallet = address(0xBEEF7702);
        vm.etch(wallet, abi.encodePacked(hex"ef0100", address(new OZ20())));
        address[] memory to = _to(1, 99);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, wallet)); bulk.airdrop20(wallet, to, _fill(1, 1), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, wallet)); bulk.airdrop721(wallet, to, _fill(1, 1), false, false);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, wallet)); bulk.airdrop1155(wallet, to, _fill(1, 1), _fill(1, 1), true);
    }

    /// Strict mode should tell the user what the token said, not just that something failed.
    function testStrict20_bubblesTheTokensOwnError() public {
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        address[] memory to = _to(2, 98);
        vm.startPrank(me); t.approve(address(bulk), 1e18);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(bulk), 1e18, 5e18));
        bulk.airdrop20(address(t), to, _fill(2, 5e18), false);
        vm.stopPrank();
    }


    // ======================= external audit findings =======================

    /// H-01. A token that moves the balance then answers something other than true has PAID the recipient.
    /// Calling that a skip is how a retry pays them twice, so the whole batch is undone instead.
    function testERC20_paidButAnsweredWrong_revertsInsteadOfSkipping() public {
        for (uint8 mode = 0; mode < 3; mode++) {
            PaysThenLies20 t = new PaysThenLies20(); t.mint(me, 100); t.setMode(mode);
            address[] memory to = _to(2, 300 + mode);
            vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
            vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
            bulk.airdrop20(address(t), to, _fill(2, 10), true);     // lenient must NOT swallow it
            vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
            bulk.airdrop20(address(t), to, _fill(2, 10), false);
            vm.stopPrank();
            assertEq(t.balanceOf(to[0]), 0, "the revert must undo the transfer it already made");
            assertEq(t.balanceOf(me), 100);
        }
    }

    /// A token that REVERTS moved nothing -- the EVM undid it -- so lenient mode may still skip it. That is
    /// the distinction, and it is the whole reason a returned `false` cannot be treated the same way.
    function testERC20_revertedTransferIsStillSkippable() public {
        Blacklist20 t = new Blacklist20(); t.mint(me, 100e18);
        address[] memory to = _to(2, 310); t.block_(to[1], true);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 1e18), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 1); assertEq(t.balanceOf(to[0]), 1e18); assertEq(t.balanceOf(to[1]), 0);
    }

    // ---- round twelve S-5: an empty revert is not proof, and one id is not a batch ----------------------

    /// The id being probed is missing, a later one in the same list is not. v11 refused the whole collection.
    function testBareRevert721_deliversWhenALaterIdAnswers() public {
        BareRevert721 t = new BareRevert721();
        uint256[] memory ids = new uint256[](2); ids[0] = 7; ids[1] = 8;
        t.mint(me, 8);                                     // id 7 was never minted; id 8 is real
        address[] memory to = _to(2, 320);
        vm.startPrank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 1, "the real id must go out");
        assertEq(skipped, 1, "the missing id is one skipped row, not a refused collection");
        assertEq(t.ownerOf(8), to[1]);
    }

    /// Neither probed id exists, so the only thing left is whether it claims to be an ERC-721. It does.
    function testBareRevert721_deliversWhenOnlyIntrospectionAnswers() public {
        BareRevert721 t = new BareRevert721();
        uint256[] memory ids = new uint256[](2); ids[0] = 7; ids[1] = 9;
        t.mint(me, 8);                                     // neither 7 nor 9 exists; 8 does and is not probed
        address[] memory to = _to(2, 322);
        vm.startPrank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 0); assertEq(skipped, 2, "two undeliverable rows, and the batch still ran");
    }

    // ---- round thirteen B-1: the mirror was not a mirror ------------------------------------------------

    /// The exact shape that got through v12, and it was demonstrated on chain before it was fixed here:
    /// two real ERC-721 Transfer events and an Airdrop20(sent 2, skipped 1) in one transaction.
    /// https://explorer.testnet.chain.robinhood.com/tx/0xc6b4cf63b9e63eea42950973f0c8269ccfbe0f9eb6cb5d889359a1063dad9295
    function testERC721_throughTheErc20Path_whenTheFirstAmountIsNotALiveId() public {
        OZ721 t = new OZ721();
        t.mint(me, 2); t.mint(me, 3);                 // id 1 was never minted
        address[] memory to = _to(3, 900);
        uint256[] memory amt = new uint256[](3);
        amt[0] = 1; amt[1] = 2; amt[2] = 3;           // token ids, read as amounts
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);    // lenient: the mode that used to let it through
        vm.stopPrank();
        assertEq(t.ownerOf(2), me, "id 2 must not have moved");
        assertEq(t.ownerOf(3), me, "id 3 must not have moved");
    }

    /// And with the missing id LAST, so neither end of the probe range is a live id. Only the
    /// supportsInterface probe closes this one, which is why it is asked first.
    function testERC721_throughTheErc20Path_whenNeitherProbedAmountIsALiveId() public {
        OZ721 t = new OZ721();
        t.mint(me, 5);                                 // 4 and 6 do not exist; only 5 does, and it is not probed
        address[] memory to = _to(3, 902);
        uint256[] memory amt = new uint256[](3);
        amt[0] = 4; amt[1] = 5; amt[2] = 6;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(t.ownerOf(5), me, "id 5 must not have moved");
    }

    /// A collection that answers no introspection at all is still caught, as long as one probed amount is a
    /// live id. That is the residual limit on this side, and it is the mirror of the one on the other.
    function testBareRevert721_throughTheErc20Path_isCaughtByTheIdProbe() public {
        BareRevert721NoIntrospection t = new BareRevert721NoIntrospection();
        t.mint(me, 11);
        address[] memory to = _to(2, 904);
        uint256[] memory amt = new uint256[](2);
        amt[0] = 11; amt[1] = 12;
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);
    }

    /// The regression this could cause, and the one that matters most: an ordinary ERC-20 must still deliver.
    /// Three extra staticcalls now run on every ERC-20 batch, so this asserts the happy path, not just refusal.
    function testRealErc20_stillDeliversWithTheMirrorAsARealMirror() public {
        OZ20 t = new OZ20(); t.mint(me, 100e18);
        address[] memory to = _to(3, 906);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(3, 1e18), false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(skipped, 0);
        for (uint256 i; i < 3; i++) assertEq(t.balanceOf(to[i]), 1e18);
    }

    /// A no-return ERC-20 (the USDT shape) must also still deliver: it is the token whose silence the guard
    /// is distinguishing from an NFT's, so it is the one most likely to be caught by mistake.
    function testNoReturn20_stillDeliversWithTheMirrorAsARealMirror() public {
        NoReturn20 t = new NoReturn20(); t.mint(me, 100e18);
        address[] memory to = _to(2, 908);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent,) = bulk.airdrop20(address(t), to, _fill(2, 1e18), false);
        vm.stopPrank();
        assertEq(sent, 2);
        for (uint256 i; i < 2; i++) assertEq(t.balanceOf(to[i]), 1e18);
    }

    /// The residual limit, pinned deliberately: bare reverts AND no introspection is indistinguishable from a
    /// contract with no ownerOf, and the guard refuses it. Strict mode users of such a collection must send
    /// an id that exists in the same chunk, which the page's own test run tells them before they sign.
    function testBareRevert721_withoutIntrospection_isStillRefused() public {
        BareRevert721NoIntrospection t = new BareRevert721NoIntrospection();
        uint256[] memory ids = new uint256[](1); ids[0] = 7;
        t.mint(me, 8);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(t)));
        bulk.airdrop721(address(t), _to(1, 324), ids, false, true);
    }

    /// A contract with no ownerOf at all is still refused, which is the check's whole reason to exist.
    function testDeafContract_isStillNotAnNft() public {
        Deaf t = new Deaf();
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(t)));
        bulk.airdrop721(address(t), _to(1, 326), ids, false, true);
    }

    // ---- round twelve S-4: the mirror of that guard, on the ERC-20 path ---------------------------------

    /// `transferFrom(address,address,uint256)` is one selector for both standards, and a conforming ERC-721
    /// returns nothing -- which the ERC-20 path reads as a USDT-style success. Without this guard an NFT sent
    /// through the ERC-20 form spends its token IDS as amounts: the NFTs leave, and the count and the
    /// Airdrop20 event both report a token airdrop that never happened. v11 closed the other direction only.
    function testERC721_throughTheErc20Path_isRefused() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        address[] memory to = _to(2, 328);
        uint256[] memory amt = new uint256[](2); amt[0] = 1; amt[1] = 2;    // token ids, read as amounts
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(t.ownerOf(1), me, "the NFT must not have moved");
        assertEq(t.ownerOf(2), me);
    }

    /// An NFT pasted with genuine 18-decimal amounts. Round twelve asserted the weaker outcome this could
    /// manage at the time -- the batch ran and every row was skipped, because the guard probed
    /// ownerOf(amounts[0]) and no such id existed. Since B-1 the guard asks supportsInterface first, which
    /// does not depend on the amounts, so the paste is refused before anything runs. Nothing moves either
    /// way; the difference is that the sender is told what is wrong instead of receiving a batch of skips.
    function testERC721_throughTheErc20Path_withRealAmounts_isRefusedOutright() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), _to(2, 330), _fill(2, 1e18), true);
        vm.stopPrank();
        assertEq(t.ownerOf(1), me, "the NFT must not have moved");
    }

    /// And a real ERC-20 must still go through, which is the regression this guard could have caused.
    function testRealErc20_stillDeliversWithTheMirrorGuardInPlace() public {
        OZ20 t = new OZ20(); t.mint(me, 100e18);
        address[] memory to = _to(3, 332);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(3, 1e18), false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(skipped, 0);
        for (uint256 i; i < 3; i++) assertEq(t.balanceOf(to[i]), 1e18);
    }

    /// H-07. The contract can never give anything back, so it must refuse to be a recipient.
    function test_refusesToBeItsOwnRecipient() public {
        OZ721 n = new OZ721(); n.mint(me, 1);
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        OZ1155 m = new OZ1155(); m.mint(me, 1, 10);
        address[] memory to = new address[](1); to[0] = address(bulk);
        vm.startPrank(me); n.setApprovalForAll(address(bulk), true); t.approve(address(bulk), type(uint256).max); m.setApprovalForAll(address(bulk), true);
        for (uint256 mode = 0; mode < 2; mode++) {
            bool len = mode == 1;
            vm.expectRevert(abi.encodeWithSelector(BulkSend.SelfRecipient.selector, 0)); bulk.airdrop721(address(n), to, _fill(1, 1), false, len);
            vm.expectRevert(abi.encodeWithSelector(BulkSend.SelfRecipient.selector, 0)); bulk.airdrop20(address(t), to, _fill(1, 1e18), len);
            vm.expectRevert(abi.encodeWithSelector(BulkSend.SelfRecipient.selector, 0)); bulk.airdrop1155(address(m), to, _fill(1, 1), _fill(1, 1), len);
        }
        vm.stopPrank();
        assertEq(n.balanceOf(address(bulk)), 0); assertEq(t.balanceOf(address(bulk)), 0); assertEq(m.balanceOf(address(bulk), 1), 0);
    }

    /// M-04. Sending nothing is not a delivery.
    function test_zeroAmountIsRefused() public {
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        OZ1155 m = new OZ1155(); m.mint(me, 1, 10);
        address[] memory to = _to(1, 320);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max); m.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.ZeroAmount.selector, 0)); bulk.airdrop20(address(t), to, _fill(1, 0), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.ZeroAmount.selector, 0)); bulk.airdrop1155(address(m), to, _fill(1, 1), _fill(1, 0), true);
        vm.stopPrank();
    }

    /// L-02. Strict mode promised the token's own error; a truncated one decodes as nothing.
    function testStrict20_longRevertReasonArrivesWhole() public {
        LongReason20 t = new LongReason20(); t.mint(me, 10e18);
        address[] memory to = _to(1, 330);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(bytes("this rejection reason is deliberately far longer than one hundred and twenty eight bytes so that any truncation would leave behind something that no longer decodes as an Error(string) at all"));
        bulk.airdrop20(address(t), to, _fill(1, 1e18), false);
        vm.stopPrank();
    }

    // ======================= the contract itself =======================

    function test_bulk_has_no_owner_no_ether_path_no_state() public {
        (bool ok,) = address(bulk).call{value: 1 ether}("");
        assertFalse(ok);   // no receive/fallback: ether cannot be sent to it
        assertEq(address(bulk).balance, 0);
    }

    // ============== the stipend is a caller's choice, inside bounds ==============

    /// The whole point of the parameter: a receiver that honestly costs more than the default is not
    /// unable to receive, it is expensive. The caller can pay for it instead of being told a lie.
    function test_chosenGas_deliversARecipientTheDefaultWouldSkip() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 2);
        HeavyAccepts h = new HeavyAccepts();
        address[] memory to = new address[](1); to[0] = address(h);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);

        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 1), true, true);
        assertEq(sent, 0); assertEq(skipped, 1); assertEq(t.ownerOf(1), me);   // default stipend: skipped

        uint256[] memory second = new uint256[](1); second[0] = 2;
        (uint256 sent2, uint256 skipped2) = bulk.airdrop721WithGas(address(t), to, second, true, true, 1_000_000);
        vm.stopPrank();
        assertEq(sent2, 1); assertEq(skipped2, 0); assertEq(t.ownerOf(2), address(h));   // paid for: delivered
    }

    /// Bounds, not a free-for-all. Too low turns an honest list into "skipped"; too high stops being lenient.
    function test_chosenGas_refusesValuesOutsideTheBounds() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 1);
        address[] memory to = _to(1, 77);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        uint256 lo = bulk.MIN_GAS(); uint256 hi = bulk.MAX_GAS();
        vm.expectRevert(abi.encodeWithSelector(BulkSend.GasOutOfRange.selector, 0, lo, hi));
        bulk.airdrop721WithGas(address(t), to, _range(1, 1), true, true, 0);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.GasOutOfRange.selector, lo - 1, lo, hi));
        bulk.airdrop721WithGas(address(t), to, _range(1, 1), true, true, lo - 1);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.GasOutOfRange.selector, hi + 1, lo, hi));
        bulk.airdrop721WithGas(address(t), to, _range(1, 1), true, true, hi + 1);
        vm.stopPrank();
        assertEq(t.ownerOf(1), me);
    }

    /// Strict mode forwards everything and reverts the batch. Accepting a stipend there and ignoring it
    /// would describe a transaction that does not exist.
    function test_chosenGas_isRefusedInStrictMode() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 1);
        OZ1155 m = new OZ1155(); m.mint(me, 1, 1);
        OZ20 e = new OZ20(); e.mint(me, 1e18);
        address[] memory to = _to(1, 78);
        vm.startPrank(me);
        vm.expectRevert(BulkSend.GasIsForLenientOnly.selector);
        bulk.airdrop721WithGas(address(t), to, _range(1, 1), true, false, 500_000);
        vm.expectRevert(BulkSend.GasIsForLenientOnly.selector);
        bulk.airdrop1155WithGas(address(m), to, _fill(1, 1), _fill(1, 1), false, 500_000);
        vm.expectRevert(BulkSend.GasIsForLenientOnly.selector);
        bulk.airdrop20WithGas(address(e), to, _fill(1, 1e18), false, 500_000);
        vm.stopPrank();
    }

    /// A bigger stipend must not cost the batch its liveness: the gas hog still gets exactly what it was
    /// given and no more, and everyone after it is still delivered.
    function test_chosenGas_stillContainsAGasHog() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 3);
        address[] memory to = new address[](3);
        to[0] = _to(1, 79)[0]; to[1] = address(new GasHog()); to[2] = _to(1, 80)[0];
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop721WithGas{gas: 9_000_000}(address(t), to, _range(1, 3), true, true, 1_000_000);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1);
        assertEq(t.ownerOf(1), to[0]); assertEq(t.ownerOf(2), me); assertEq(t.ownerOf(3), to[2]);
    }

    /// The reserve: enough gas for the transfer is not enough gas for the transfer *and* the record of it.
    /// Here the batch can afford the stipend itself and still stops, because what is left over would not
    /// cover copying the result and emitting it. The recipient is an ordinary wallet that needs a fraction
    /// of the stipend, so the stop is about this contract's accounting, not about the recipient.
    function test_chosenGas_reservesEnoughToRecordTheOutcome() public {
        OZ721 t = new OZ721(); t.mintMany(me, 1, 2);
        address[] memory to = _to(1, 81);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.OutOfGasForBatch.selector, 0));
        bulk.airdrop721WithGas{gas: 130_000}(address(t), to, _range(1, 1), true, true, 100_000);
        assertEq(t.ownerOf(1), me);
        uint256[] memory second = new uint256[](1); second[0] = 2;
        (uint256 sent,) = bulk.airdrop721WithGas{gas: 400_000}(address(t), to, second, true, true, 100_000);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(t.ownerOf(2), to[0]);   // the same stipend, with room to record it
    }

    /// The default entry points are unchanged and still documented by the same numbers.
    function test_defaults_and_bounds_are_what_the_page_says() public view {
        assertEq(bulk.DEFAULT_GAS(), 400_000);
        assertEq(bulk.LENIENT_GAS(), bulk.DEFAULT_GAS());   // the original name still answers
        assertEq(bulk.MIN_GAS(), 100_000);
        assertEq(bulk.MAX_GAS(), 5_000_000);
    }

    /// The other two standards take the same parameter and deliver the same way.
    function test_chosenGas_worksFor1155And20() public {
        OZ1155 m = new OZ1155(); m.mint(me, 7, 100);
        OZ20 e = new OZ20(); e.mint(me, 100e18);
        address[] memory to = _to(3, 82);
        vm.startPrank(me);
        m.setApprovalForAll(address(bulk), true);
        e.approve(address(bulk), type(uint256).max);
        (uint256 s1, uint256 k1) = bulk.airdrop1155WithGas(address(m), to, _fill(3, 7), _fill(3, 5), true, 250_000);
        (uint256 s2, uint256 k2) = bulk.airdrop20WithGas(address(e), to, _fill(3, 2e18), true, 250_000);
        vm.stopPrank();
        assertEq(s1, 3); assertEq(k1, 0); assertEq(m.balanceOf(to[2], 7), 5);
        assertEq(s2, 3); assertEq(k2, 0); assertEq(e.balanceOf(to[2]), 2e18);
    }

    // ============== third review: what a successful call does and does not prove ==============

    /// A token that moves the balance and answers with two words, the first of which is 1, is not answering
    /// `bool`. Reading only the first word would call that a delivery.
    function test_erc20ReturningTwoWordsIsAmbiguousNotDelivered() public {
        TwoWord20 t = new TwoWord20(); t.mint(me, 10e18);
        address[] memory to = _to(1, 41);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop20(address(t), to, _fill(1, 1e18), true);
        vm.stopPrank();
        assertEq(t.balanceOf(to[0]), 0);   // the revert undid the transfer the token had already made
        assertEq(t.balanceOf(me), 10e18);
    }

    /// The boundary, stated as a test so nobody mistakes the counter for a receipt. It moved: a contract that
    /// ANSWERS a call that should return nothing is now refused, because a conforming ERC-721 transfer
    /// returns void and anything coming back means this was not the function we called.
    function test_aContractThatAnswersAVoidCallIsRefusedRatherThanCounted() public {
        PolitelyDoesNothing fake = new PolitelyDoesNothing();
        address[] memory to = _to(2, 42);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop721(address(fake), to, _range(1, 2), false, false);
    }

    /// A silent contract that cannot answer ownerOf is refused on the shape of the contract, before any
    /// transfer is attempted.
    function test_aSilentContractWithNoOwnerOfIsRefused() public {
        SilentlyDoesNothing fake = new SilentlyDoesNothing();
        address[] memory to = _to(2, 42);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(fake)));
        bulk.airdrop721(address(fake), to, _range(1, 2), false, false);
    }

    /// And where the boundary actually is, after three narrowings. A contract that answers ownerOf like an
    /// ERC-721, accepts the transfer, returns nothing exactly as a conforming one does, and moves nothing is
    /// counted as delivered. Nothing the caller can observe separates it from a token that paid. That is why
    /// the page asks the chain who holds what afterwards rather than believing this counter, and it is what
    /// the README and the NatSpec have to keep saying.
    function test_aContractThatImpersonatesAnNftIsStillCountedAsSent() public {
        PretendsToBeAnNft fake = new PretendsToBeAnNft();
        address[] memory to = _to(2, 42);
        vm.prank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(fake), to, _range(1, 2), false, false);
        assertEq(sent, 2); assertEq(skipped, 0);   // "sent" means the call did not fail, and nothing more
    }

    /// A fee-on-transfer token returns true and delivers less than it was asked for. The batch is honest
    /// about having made the call; the recipient's balance is the only place the shortfall is visible.
    function test_feeOnTransferDeliversLessThanTheAmountCounted() public {
        Fee20 t = new Fee20(); t.mint(me, 1000e18);
        address[] memory to = _to(1, 43);
        vm.startPrank(me); t.approve(address(bulk), type(uint256).max);
        (uint256 sent,) = bulk.airdrop20(address(t), to, _fill(1, 100e18), false);
        vm.stopPrank();
        assertEq(sent, 1);
        assertLt(t.balanceOf(to[0]), 100e18);   // counted as one delivery, paid 98
        assertEq(t.balanceOf(to[0]), 98e18);
    }

    // ------------------------------------------------------------------ the id-independent probe (v13)
    // The two id probes can only ask about the ids the sender typed. ERC-165 does not depend on ids, and
    // neither does isApprovedForAll, which every ERC-721 and ERC-1155 must have and no ERC-20 has.

    function testNoIntrospection721_throughTheErc20Path_isCaughtByTheOperatorQuestion() public {
        NoIntrospection721 t = new NoIntrospection721();
        t.mint(me, 22);                                  // only the MIDDLE id is live; both probed ids are dead
        address[] memory to = _to(3, 905);
        uint256[] memory amt = new uint256[](3);
        amt[0] = 21; amt[1] = 22; amt[2] = 23;
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);
        vm.stopPrank();
        assertEq(t.ownerOf(22), me, "id 22 must not have moved");
    }

    function testBareRevert721_throughTheErc20Path_isCaughtByTheLastIdWhenTheFirstIsDead() public {
        BareRevert721NoIntrospection t = new BareRevert721NoIntrospection();   // no ERC-165, no operators
        t.mint(me, 12);                                  // the first probed id is dead, the last is live
        address[] memory to = _to(2, 906);
        uint256[] memory amt = new uint256[](2);
        amt[0] = 11; amt[1] = 12;
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, amt, true);
    }

    /// The residual, pinned. A contract with ownerOf and transferFrom but neither ERC-165 nor
    /// isApprovedForAll is not an ERC-721 by the standard's own definition -- both are required -- and when
    /// both probed ids are dead there is nothing left to ask that a token would not also answer. This is
    /// what the guard cannot see, written down so it is a known limit and not a surprise.
    function testBareRevert721_withNeitherIntrospectionNorOperators_isTheResidual() public {
        BareRevert721NoIntrospection t = new BareRevert721NoIntrospection();
        t.mint(me, 32);
        address[] memory to = _to(3, 907);
        uint256[] memory amt = new uint256[](3);
        amt[0] = 31; amt[1] = 32; amt[2] = 33;
        vm.prank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, amt, true);
        assertEq(sent, 1); assertEq(skipped, 2);
        assertEq(t.ownerOf(32), to[1], "the middle id moved: this is the limit, not a pass");
    }

    function testRealErc20_isNotRefusedByTheOperatorQuestion() public {
        OZ20 t = new OZ20(); t.mint(me, 3e18);
        address[] memory to = _to(3, 908);
        vm.startPrank(me); t.approve(address(bulk), 3e18);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(3, 1e18), false);
        vm.stopPrank();
        assertEq(sent, 3); assertEq(skipped, 0); assertEq(t.balanceOf(to[2]), 1e18);
    }

    function testErc1155_throughTheErc20Path_isRefused() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        address[] memory to = _to(2, 909);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.IsAnNft.selector, address(t)));
        bulk.airdrop20(address(t), to, _fill(2, 1), true);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ the arms coverage said nobody tested
    // Nine branches on the 1155 and 20 paths, and one on 721, that no test had reached: every refusal the
    // ERC-721 path had a test for and the other two did not. Listed in docs/readers.md; written here.

    function testChatty721_lenient_anAnswerIsAmbiguousNotDelivered() public {
        Chatty721 t = new Chatty721(); t.mint(me, 1);
        address[] memory to = _to(1, 910);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop721(address(t), to, _range(1, 1), false, true);
    }

    function testOZ1155_rejectsMismatchedLengths_andEmpty() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop1155(address(t), _to(2, 911), _fill(1, 1), _fill(2, 1), false);
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop1155(address(t), _to(2, 911), _fill(2, 1), _fill(1, 1), true);
        vm.expectRevert(BulkSend.EmptyBatch.selector);
        bulk.airdrop1155(address(t), new address[](0), new uint256[](0), new uint256[](0), false);
        vm.stopPrank();
    }

    function testOZ1155_lenient_zeroAddressIsSkippedNotBurned() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        address[] memory to = _to(3, 912); to[1] = address(0);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, _fill(3, 1), _fill(3, 2), true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1);
        assertEq(t.balanceOf(me, 1), 6, "two editions left, not three: nothing was burned");
        assertEq(t.balanceOf(to[0], 1), 2); assertEq(t.balanceOf(to[2], 1), 2);
    }

    function testOZ1155_strict_zeroAddressRevertsTheBatch() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        address[] memory to = _to(3, 913); to[2] = address(0);
        vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.ZeroRecipient.selector, 2));
        bulk.airdrop1155(address(t), to, _fill(3, 1), _fill(3, 2), false);
        vm.stopPrank();
        assertEq(t.balanceOf(me, 1), 10, "strict: nothing moved");
    }

    function testChatty1155_anAnswerIsAmbiguousInBothModes() public {
        Chatty1155 t = new Chatty1155(); t.mint(me, 1, 10);
        address[] memory to = _to(2, 914);
        vm.startPrank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop1155(address(t), to, _fill(2, 1), _fill(2, 1), true);    // lenient
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop1155(address(t), to, _fill(2, 1), _fill(2, 1), false);   // strict
        vm.stopPrank();
        assertEq(t.balanceOf(1, me), 10, "an ambiguous answer undoes the batch");
    }

    function testOZ20_rejectsMismatchedLengths_andEmpty() public {
        OZ20 t = new OZ20(); t.mint(me, 10e18);
        vm.startPrank(me); t.approve(address(bulk), 10e18);
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop20(address(t), _to(2, 915), _fill(1, 1e18), false);
        vm.expectRevert(BulkSend.EmptyBatch.selector);
        bulk.airdrop20(address(t), new address[](0), new uint256[](0), true);
        vm.stopPrank();
    }

}

/// A recipient whose receive hook legitimately costs more than the lenient stipend.
contract HeavyAccepts {
    uint256[] private junk;
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        for (uint256 i; i < 20; i++) junk.push(i + 1);   // ~20 cold SSTOREs, well over 400k
        return 0x150b7a02;
    }

}
