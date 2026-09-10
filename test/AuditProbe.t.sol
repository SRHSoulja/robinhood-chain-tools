// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Independent audit probe. Written to test the author's promises rather than assume them.
// Every test here either PROVES a claim holds or DEMONSTRATES a gap. Nothing is removed.

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {
    OZ721, OZ1155, OZ20, False20, Fee20, Blacklist20, Accepts, Deaf, GasHog, Bomb, PolitelyDoesNothing
} from "./RealTokens.sol";

/// An ERC-20 that returns `false` on failure, reachable through the 721 entry point because
/// transferFrom(address,address,uint256) is the SAME selector for ERC-20 and ERC-721.
contract Erc20ShapedFalse is False20 {}

/// A recipient whose ERC-1155 hook re-enters BulkSend and does NOT catch the revert.
contract HardReenterer {
    BulkSend public bulk;
    constructor(BulkSend b) { bulk = b; }
    function onERC1155Received(address, address, uint256 id, uint256 amt, bytes calldata) external returns (bytes4) {
        address[] memory to = new address[](1); to[0] = address(this);
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        uint256[] memory amts = new uint256[](1); amts[0] = amt;
        bulk.airdrop1155WithGas(msg.sender, to, ids, amts, true, 100_000);   // reverts: Reentered()
        return 0xf23a6e61;
    }
}

/// ERC-20 that moves nothing and answers success with MORE than REASON_CAP bytes.
contract OversizeReturn20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address, address, uint256) external pure returns (bool) {
        assembly { mstore(0, 1) mstore(32, 1) mstore(64, 1) mstore(96, 1) mstore(128, 1) mstore(160, 1) return(0, 192) }
    }
}

contract AuditProbe is Test {
    BulkSend bulk;
    address me = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public { bulk = new BulkSend(); }

    function _to(uint256 n, uint256 seed) internal pure returns (address[] memory a) {
        a = new address[](n);
        for (uint256 i; i < n; i++) a[i] = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
    }
    function _range(uint256 from, uint256 n) internal pure returns (uint256[] memory a) {
        a = new uint256[](n); for (uint256 i; i < n; i++) a[i] = from + i;
    }
    function _fill(uint256 n, uint256 v) internal pure returns (uint256[] memory a) {
        a = new uint256[](n); for (uint256 i; i < n; i++) a[i] = v;
    }

    // =====================================================================================
    // FINDING 1. The 721/1155 paths never look at return data. The ERC-20 path's careful
    // three-outcome logic (AmbiguousResult) has no counterpart there, and
    // transferFrom(address,address,uint256) is the same selector for ERC-20 and ERC-721.
    // An ERC-20 that returns `false` therefore reports DELIVERED with nothing moved.
    // =====================================================================================

    function test_probe_F1a_erc20ReturningFalseThroughThe721EntryPointIsCountedAsDelivered() public {
        Erc20ShapedFalse t = new Erc20ShapedFalse();
        t.mint(me, 1000);
        // deliberately NO approval, so transferFrom returns false without reverting
        address[] memory to = _to(3, 1);

        vm.prank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 3), false, true);

        assertEq(sent, 3, "counted as three deliveries");
        assertEq(skipped, 0, "and nothing was skipped");
        for (uint256 i; i < 3; i++) assertEq(t.balanceOf(to[i]), 0, "but nobody was paid");
        assertEq(t.balanceOf(me), 1000, "the sender still holds everything");

        // strict mode reports the same lie, via `sent = n`
        vm.prank(me);
        (uint256 sent2,) = bulk.airdrop721(address(t), to, _range(1, 3), false, false);
        assertEq(sent2, 3);
        assertEq(t.balanceOf(me), 1000);
    }

    /// The same selector collision, but with a token that DOES move: pointing the 721 entry point at a
    /// real ERC-20 silently transfers `ids[i]` base units of it. The id becomes an amount.
    function test_probe_F1b_the721EntryPointWillHappilyMoveErc20Balances() public {
        OZ20 t = new OZ20();
        t.mint(me, 1000e18);
        address[] memory to = _to(2, 2);
        uint256[] memory idsAreAmounts = new uint256[](2);
        idsAreAmounts[0] = 100e18; idsAreAmounts[1] = 250e18;

        vm.startPrank(me);
        t.approve(address(bulk), type(uint256).max);
        (uint256 sent,) = bulk.airdrop721(address(t), to, idsAreAmounts, false, false);
        vm.stopPrank();

        assertEq(sent, 2, "reported as an NFT airdrop");
        assertEq(t.balanceOf(to[0]), 100e18, "but real ERC-20 balance left the wallet");
        assertEq(t.balanceOf(to[1]), 250e18);
        assertEq(t.balanceOf(me), 650e18);
    }

    // =====================================================================================
    // FINDING 2. ZERO_REASON is 0x9fabe1c1, which is not the selector of any error this
    // contract declares. ZeroRecipient(uint256) is 0xef28bd44.
    // =====================================================================================

    function test_probe_F2_zeroReasonSelectorMatchesNoDeclaredError() public {
        OZ721 t = new OZ721(); t.mint(me, 1);
        address[] memory to = new address[](1); to[0] = address(0);

        vm.startPrank(me);
        t.setApprovalForAll(address(bulk), true);
        vm.recordLogs();
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(t), to, _range(1, 1), false, true);
        vm.stopPrank();

        assertEq(sent, 0); assertEq(skipped, 1);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes4 emitted;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Skipped(address,address,uint256,uint256,bytes)")) {
                (,, bytes memory reason) = abi.decode(logs[i].data, (uint256, uint256, bytes));
                emitted = bytes4(reason);
            }
        }
        assertEq(emitted, bytes4(0x9fabe1c1), "what the contract actually emits");
        assertTrue(emitted != BulkSend.ZeroRecipient.selector, "which is NOT ZeroRecipient(uint256)");
        assertTrue(emitted != BulkSend.TransferFailed.selector);
        assertTrue(emitted != BulkSend.AmbiguousResult.selector);
        assertTrue(emitted != BulkSend.SelfRecipient.selector);
        assertTrue(emitted != BulkSend.ZeroAmount.selector);
        assertTrue(emitted != BulkSend.NotAContract.selector);
        assertTrue(emitted != BulkSend.DelegatedWallet.selector);
        assertTrue(emitted != BulkSend.OutOfGasForBatch.selector);
        assertTrue(emitted != BulkSend.Reentered.selector);
        assertTrue(emitted != BulkSend.LengthMismatch.selector);
        assertTrue(emitted != BulkSend.EmptyBatch.selector);
        assertTrue(emitted != BulkSend.GasIsForLenientOnly.selector);
    }

    // =====================================================================================
    // PROVING P2/P3 hold where it counts. These pass; they are the "silence means something" half.
    // =====================================================================================

    /// The reentrancy lock turns a hostile hook into a skip. Reentrancy.t.sol asserts the counters but
    /// sends to the recipient FROM the recipient, so its balances cannot tell paid from unpaid.
    /// Here sender and recipient are different, so the balance is a real check.
    function test_probe_reentrantRecipientIsSkippedAndGenuinelyUnpaid() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        HardReenterer r = new HardReenterer(bulk);
        address[] memory to = new address[](2); to[0] = address(r); to[1] = bob;

        vm.startPrank(me);
        t.setApprovalForAll(address(bulk), true);
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, _fill(2, 1), _fill(2, 3), true);
        vm.stopPrank();

        assertEq(sent, 1); assertEq(skipped, 1);
        assertEq(t.balanceOf(address(r), 1), 0, "skipped means genuinely unpaid");
        assertEq(t.balanceOf(bob, 1), 3);
        assertEq(t.balanceOf(me, 1), 7);
    }

    /// The transient lock must be released by a revert, or a caught failure would poison the rest of
    /// a smart-contract wallet's transaction.
    function test_probe_lockIsReleasedByARevertInTheSameTransaction() public {
        OZ721 t = new OZ721(); t.mint(me, 1); t.mint(me, 2);
        address[] memory bad = new address[](1); bad[0] = address(new Deaf());
        address[] memory good = new address[](1); good[0] = bob;

        vm.startPrank(me);
        t.setApprovalForAll(address(bulk), true);
        try bulk.airdrop721(address(t), bad, _range(1, 1), true, false) { revert("should have failed"); }
        catch { /* swallowed, exactly as a Safe would */ }
        (uint256 sent,) = bulk.airdrop721(address(t), good, _range(2, 1), false, false);
        vm.stopPrank();

        assertEq(sent, 1);
        assertEq(t.ownerOf(2), bob);
    }

    /// The key P2 property: because _tryCall forwards EXACTLY the stipend or reverts, the set of
    /// recipients delivered in lenient mode does not depend on the transaction's gas limit. A caller
    /// cannot under-fund a batch into silently paying fewer people.
    function test_probe_theDeliveredSetDoesNotDependOnTheGasLimit() public {
        uint256 n = 20;
        uint256[3] memory limits = [uint256(6_000_000), 15_000_000, 30_000_000];
        uint256[3] memory sents;
        for (uint256 k; k < 3; k++) {
            OZ721 t = new OZ721(); t.mintMany(me, 1, n);
            address[] memory to = _to(n, 500); to[3] = address(new GasHog()); to[11] = address(new Bomb());
            vm.startPrank(me);
            t.setApprovalForAll(address(bulk), true);
            (uint256 sent, uint256 skipped) = bulk.airdrop721{gas: limits[k]}(address(t), to, _range(1, n), true, true);
            vm.stopPrank();
            sents[k] = sent;
            assertEq(sent + skipped, n);
            assertEq(t.ownerOf(4), me, "the hog is never delivered");
            assertEq(t.ownerOf(12), me, "the bomb is never delivered");
            assertEq(t.balanceOf(me), skipped, "the counter equals the tokens that stayed put");
        }
        assertEq(sents[0], sents[1]); assertEq(sents[1], sents[2]);
    }

    /// The strongest statement of P2 for a mixed batch: every counter is reconciled against the chain.
    function test_probe_countersReconcileAgainstRealBalances_erc20Lenient() public {
        uint256 n = 12;
        Blacklist20 t = new Blacklist20(); t.mint(me, 1000e18);
        address[] memory to = _to(n, 600);
        for (uint256 i; i < n; i++) if (i % 3 == 0) t.block_(to[i], true);

        vm.startPrank(me);
        t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(n, 1e18), true);
        vm.stopPrank();

        uint256 paid; uint256 unpaid;
        for (uint256 i; i < n; i++) { if (t.balanceOf(to[i]) == 1e18) paid++; else if (t.balanceOf(to[i]) == 0) unpaid++; }
        assertEq(paid, sent, "sent equals the number of wallets that actually gained");
        assertEq(unpaid, skipped, "skipped equals the number that gained nothing");
        assertEq(t.balanceOf(me), 1000e18 - sent * 1e18, "and the sender lost exactly what was delivered");
    }

    /// A success answer larger than REASON_CAP is truncated to 128 bytes by _tryCall. Confirm the
    /// truncation cannot manufacture a `true`: it must still be refused, not counted.
    function test_probe_oversizeSuccessReturndataIsNeverADelivery() public {
        OversizeReturn20 t = new OversizeReturn20(); t.mint(me, 100e18);
        address[] memory to = _to(1, 700);
        vm.startPrank(me);
        t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop20(address(t), to, _fill(1, 1e18), true);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, to[0], 0));
        bulk.airdrop20(address(t), to, _fill(1, 1e18), false);
        vm.stopPrank();
    }

    /// _mustBeContract inspects only 3 bytes of a 23-byte account but reads a whole word to do it.
    /// Confirm a 23-byte non-delegation account is not a false positive.
    function test_probe_a23ByteNonDelegationAccountIsNotRejected() public {
        address weird = address(0x2323);
        vm.etch(weird, hex"fe112233445566778899aabbccddeeff00112233445566");   // 23 bytes, not 0xef0100
        assertEq(weird.code.length, 23);
        address[] memory to = _to(1, 800);
        vm.prank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(weird, to, _fill(1, 1), true);   // must not revert
        assertEq(sent, 0, "not a false DelegatedWallet"); assertEq(skipped, 1);

        address seven02 = address(0x7702);
        vm.etch(seven02, abi.encodePacked(hex"ef0100", address(new OZ20())));
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, seven02));
        bulk.airdrop20(seven02, to, _fill(1, 1), true);

        // _mustBeContract reads a full word to inspect 3 bytes, so it depends on memory above the free
        // pointer being zero. Re-check through the WithGas entry points, which allocate more memory first.
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, seven02));
        bulk.airdrop20WithGas(seven02, to, _fill(1, 1), true, 250_000);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, seven02));
        bulk.airdrop721WithGas(seven02, to, _fill(1, 1), true, true, 250_000);
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.DelegatedWallet.selector, seven02));
        bulk.airdrop1155WithGas(seven02, to, _fill(1, 1), _fill(1, 1), true, 250_000);
    }

    // =====================================================================================
    // FINDING 3. _mustBeContract exists because "a low-level call to an address with no code
    // succeeds with empty return data, which is also what USDT-style tokens return on success."
    // A single 0x00 byte (STOP) is code, so the guard passes, and the call still succeeds with
    // empty return data. The guard closes the EOA case only.
    // =====================================================================================

    function test_probe_F3_aOneByteStopContractIsCountedAsAUsdtStyleDelivery() public {
        address stopByte = address(0x570F);
        vm.etch(stopByte, hex"00");   // STOP. One byte. Not an EOA, so _mustBeContract is satisfied.
        assertEq(stopByte.code.length, 1);

        address[] memory to = _to(3, 810);
        vm.prank(me);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(stopByte, to, _fill(3, 1e18), true);
        assertEq(sent, 3, "three deliveries reported against an address that cannot pay anyone");
        assertEq(skipped, 0);

        vm.prank(me);
        (uint256 s2,) = bulk.airdrop20(stopByte, to, _fill(3, 1e18), false);
        assertEq(s2, 3, "strict mode reports it too");

        // and the same address through the other two entry points
        vm.prank(me);
        (uint256 s3,) = bulk.airdrop721(stopByte, to, _range(1, 3), false, true);
        assertEq(s3, 3);
        vm.prank(me);
        (uint256 s4,) = bulk.airdrop1155(stopByte, to, _fill(3, 1), _fill(3, 1), true);
        assertEq(s4, 3);
    }

    /// Whatever the gas limit, a lenient batch either reverts wholesale or its counters match the chain.
    /// It must never come back "successful" with a recipient counted sent who was not paid.
    function test_probe_gasSweep_neverReportsADeliveryThatDidNotHappen() public {
        uint256 succeeded;
        for (uint256 g = 300_000; g <= 3_000_000; g += 150_000) {
            OZ721 t = new OZ721(); t.mintMany(me, 1, 4);
            address[] memory to = _to(4, 900); to[1] = address(new Bomb());
            vm.startPrank(me);
            t.setApprovalForAll(address(bulk), true);
            try bulk.airdrop721{gas: g}(address(t), to, _range(1, 4), true, true) returns (uint256 sent, uint256 skipped) {
                succeeded++;
                assertEq(sent + skipped, 4);
                uint256 delivered;
                for (uint256 i; i < 4; i++) if (t.ownerOf(i + 1) == to[i]) delivered++;
                assertEq(delivered, sent, "sent must equal what really moved");
                assertEq(t.balanceOf(me), skipped);
                assertEq(t.ownerOf(2), me, "the bomb is never delivered");
            } catch {
                assertEq(t.balanceOf(me), 4, "a failed batch moved nothing");
            }
            vm.stopPrank();
        }
        assertGt(succeeded, 0, "the sweep must actually reach the succeeding range");
    }

    /// Array-length agreement on the 1155 amounts array and empty batches on 1155/20, which the
    /// existing suite only covers for 721.
    function test_probe_lengthAndEmptyChecksOn1155And20() public {
        OZ1155 m = new OZ1155(); OZ20 e = new OZ20();
        address[] memory two = _to(2, 1000);
        address[] memory none = new address[](0);

        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop1155(address(m), two, _fill(2, 1), _fill(1, 1), true);      // amounts short
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop1155(address(m), two, _fill(1, 1), _fill(2, 1), true);      // ids short
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop20(address(e), two, _fill(1, 1), true);

        vm.expectRevert(BulkSend.EmptyBatch.selector);
        bulk.airdrop1155(address(m), none, new uint256[](0), new uint256[](0), true);
        vm.expectRevert(BulkSend.EmptyBatch.selector);
        bulk.airdrop20(address(e), none, new uint256[](0), true);

        // LengthMismatch is checked before the token is, so a bad shape never calls out
        vm.expectRevert(BulkSend.LengthMismatch.selector);
        bulk.airdrop20(address(0xDEAD), two, _fill(1, 1), true);
    }

    /// A gas hog at the floor and the ceiling of the caller-chosen stipend: the reserve must still be
    /// enough to record the outcome, and the rest of the batch must still be delivered.
    function test_probe_gasHogAtMinAndMaxStipendStillRecordsHonestly() public {
        uint256[2] memory stipends = [uint256(100_000), 5_000_000];
        for (uint256 k; k < 2; k++) {
            OZ721 t = new OZ721(); t.mintMany(me, 1, 3);
            address[] memory to = new address[](3);
            to[0] = bob; to[1] = address(new GasHog()); to[2] = address(new Accepts());
            vm.startPrank(me);
            t.setApprovalForAll(address(bulk), true);
            (uint256 sent, uint256 skipped) =
                bulk.airdrop721WithGas{gas: 25_000_000}(address(t), to, _range(1, 3), true, true, stipends[k]);
            vm.stopPrank();
            assertEq(sent, 2); assertEq(skipped, 1);
            assertEq(t.ownerOf(1), bob); assertEq(t.ownerOf(2), me); assertEq(t.ownerOf(3), to[2]);
        }
    }

    /// Duplicate recipients with an allowance that covers only the first: the second must be skipped,
    /// and the balance must show one payment, not two.
    function test_probe_duplicateRecipientsWithExactAllowance() public {
        OZ20 t = new OZ20(); t.mint(me, 100e18);
        address[] memory to = new address[](3); to[0] = bob; to[1] = bob; to[2] = bob;
        vm.startPrank(me);
        t.approve(address(bulk), 2e18);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(3, 1e18), true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 1);
        assertEq(t.balanceOf(bob), 2e18, "paid exactly twice");
        assertEq(t.allowance(me, address(bulk)), 0);
    }

    /// The acknowledged boundary, in the LENIENT paths the existing suite does not cover
    /// (test_aContractThatAcceptsAndMovesNothingIsCountedAsSent only runs strict 721).
    function test_probe_politeNoOpIsCountedAsDeliveredInEveryLenientPath() public {
        PolitelyDoesNothing fake = new PolitelyDoesNothing();
        address[] memory to = _to(2, 1100);
        vm.startPrank(me);
        (uint256 s721,) = bulk.airdrop721(address(fake), to, _range(1, 2), false, true);
        (uint256 s1155,) = bulk.airdrop1155(address(fake), to, _fill(2, 1), _fill(2, 1), true);
        (uint256 s20,) = bulk.airdrop20(address(fake), to, _fill(2, 1), true);
        vm.stopPrank();
        assertEq(s721, 2); assertEq(s1155, 2); assertEq(s20, 2);
        // Nothing on chain contradicts this. It is the documented limit, not a bug, but it is the
        // reason a counter is not a receipt.
    }

    /// Fee-on-transfer through the LENIENT path (the suite only covers strict).
    function test_probe_feeOnTransferInLenientModeAlsoOverstatesDelivery() public {
        Fee20 t = new Fee20(); t.mint(me, 1000e18);
        address[] memory to = _to(2, 1200);
        vm.startPrank(me);
        t.approve(address(bulk), type(uint256).max);
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(t), to, _fill(2, 100e18), true);
        vm.stopPrank();
        assertEq(sent, 2); assertEq(skipped, 0);
        assertEq(t.balanceOf(to[0]), 98e18, "counted whole, paid 98%");
    }

    /// No owner, no upgrade path, no state, no ether: re-checked directly rather than assumed.
    function test_probe_noAdminSurfaceAndNoStorageWritten() public {
        for (uint256 s; s < 4; s++) assertEq(vm.load(address(bulk), bytes32(s)), bytes32(0));

        OZ721 t = new OZ721(); t.mintMany(me, 1, 2);
        vm.startPrank(me);
        t.setApprovalForAll(address(bulk), true);
        bulk.airdrop721(address(t), _to(2, 1300), _range(1, 2), false, false);
        vm.stopPrank();
        for (uint256 s; s < 4; s++) assertEq(vm.load(address(bulk), bytes32(s)), bytes32(0), "no persistent state after a batch");
        assertEq(vm.load(address(bulk), bytes32(uint256(0x79981972fbb1dd6496d9a6ffdb7f04a877acc052e10223665ed2fec026626fca))), bytes32(0));

        (bool ok,) = address(bulk).call{value: 1 ether}("");
        assertFalse(ok);
        (bool ok2,) = address(bulk).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok2);
        (bool ok3,) = address(bulk).call(abi.encodeWithSignature("upgradeTo(address)", address(1)));
        assertFalse(ok3);
    }

    /// A third party can never spend someone else's approval through this contract, in either mode,
    /// for any of the three standards.
    function test_probe_noThirdPartyCanSpendAnotherWalletsApproval() public {
        OZ721 n = new OZ721(); n.mint(me, 1);
        OZ20 e = new OZ20(); e.mint(me, 100e18);
        OZ1155 m = new OZ1155(); m.mint(me, 1, 10);
        vm.startPrank(me);
        n.setApprovalForAll(address(bulk), true);
        e.approve(address(bulk), type(uint256).max);
        m.setApprovalForAll(address(bulk), true);
        vm.stopPrank();

        address[] memory to = new address[](1); to[0] = address(0xE711);
        vm.startPrank(address(0xE711));
        (uint256 a,) = bulk.airdrop721(address(n), to, _fill(1, 1), false, true);
        (uint256 b,) = bulk.airdrop20(address(e), to, _fill(1, 1e18), true);
        (uint256 c,) = bulk.airdrop1155(address(m), to, _fill(1, 1), _fill(1, 1), true);
        vm.stopPrank();

        assertEq(a, 0); assertEq(b, 0); assertEq(c, 0);
        assertEq(n.ownerOf(1), me); assertEq(e.balanceOf(me), 100e18); assertEq(m.balanceOf(me, 1), 10);
    }

    /// The lenient loop never resets the free memory pointer: every iteration allocates fresh calldata
    /// and a fresh returndata buffer, so memory grows linearly with the batch and its cost grows
    /// quadratically. Measured here so the scaling is a number rather than a worry.
    function test_probe_lenientGasPerRecipientAcrossBatchSizes() public {
        uint256[3] memory sizes = [uint256(50), 200, 400];
        for (uint256 k; k < 3; k++) {
            uint256 n = sizes[k];
            OZ721 t = new OZ721(); t.mintMany(me, 1, n);
            address[] memory to = _to(n, 2000 + k);
            vm.startPrank(me); t.setApprovalForAll(address(bulk), true);
            uint256 g0 = gasleft();
            (uint256 sent,) = bulk.airdrop721(address(t), to, _range(1, n), false, true);
            uint256 used = g0 - gasleft();
            vm.stopPrank();
            assertEq(sent, n);
            emit log_named_uint("lenient n", n);
            emit log_named_uint("  gas per recipient", used / n);
        }
    }

    /// Skipped carries no row index, while every revert error does. Two identical rows that both fail
    /// produce two byte-identical events, so a client must COUNT them, not merely look one up by address.
    function test_probe_skippedEventsForIdenticalRowsAreIndistinguishable() public {
        OZ1155 t = new OZ1155(); t.mint(me, 1, 10);
        address deaf = address(new Deaf());
        address[] memory to = new address[](3); to[0] = deaf; to[1] = deaf; to[2] = bob;

        vm.startPrank(me);
        t.setApprovalForAll(address(bulk), true);
        vm.recordLogs();
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(t), to, _fill(3, 1), _fill(3, 2), true);
        vm.stopPrank();
        assertEq(sent, 1); assertEq(skipped, 2);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 first; bytes32 second; uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(bulk)) continue;
            if (logs[i].topics[0] != keccak256("Skipped(address,address,uint256,uint256,bytes)")) continue;
            bytes32 h = keccak256(abi.encode(logs[i].topics[1], logs[i].topics[2], logs[i].data));
            if (seen == 0) first = h; else second = h;
            seen++;
        }
        assertEq(seen, 2);
        assertEq(first, second, "the two Skipped events are byte-identical: no row can be told from the other");
    }
}
