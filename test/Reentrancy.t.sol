// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {OZ1155} from "./RealTokens.sol";

/// A token that always reverts, so a nested lenient batch against it emits a real `Skipped` event.
contract AlwaysReverts {
    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external pure { revert("no"); }
}

/// The receiver accepts the edition it is being sent, and while doing so calls BulkSend again against a
/// reverting token, naming ITSELF, the same id and the same amount. That nested call emits genuine BulkSend
/// events from the genuine BulkSend address, describing a row that looks exactly like the outer one.
contract EventPolluter {
    BulkSend public bulk; address public reverting; uint256 public id; uint256 public amount; bool done;
    bool public tried;
    constructor(BulkSend b, address r) { bulk = b; reverting = r; }
    function arm(uint256 i, uint256 a) external { id = i; amount = a; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (!done) {
            done = true; tried = true;
            address[] memory to = new address[](1); to[0] = address(this);
            uint256[] memory ids = new uint256[](1); ids[0] = id;
            uint256[] memory amts = new uint256[](1); amts[0] = amount;
            // The smallest stipend the contract accepts, so the nested call fits inside the gas the
            // outer batch forwarded to this hook.
            try bulk.airdrop1155WithGas(reverting, to, ids, amts, true, 100_000) {} catch {}
        }
        return 0xf23a6e61;
    }
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
}

contract ReentrancyTest is Test {
    BulkSend bulk; OZ1155 token; address me = address(0xA11CE);

    function setUp() public { bulk = new BulkSend(); token = new OZ1155(); }

    /// What the browser sees is the receipt. Before the lock, a recipient could put convincing events into
    /// it: a real `Skipped` naming its own row, emitted by the real BulkSend, while the transfer to it
    /// succeeded. The client would then record that row as skipped, offer it for retry, and pay twice.
    /// Reproduced before the fix: 1 injected Skipped event and 2 summaries in a one-row batch.
    function test_hostileReceiverCannotPolluteTheEventStream() public {
        AlwaysReverts rev = new AlwaysReverts();
        EventPolluter bad = new EventPolluter(bulk, address(rev));
        bad.arm(7, 3);
        token.mint(me, 7, 10);

        address[] memory to = new address[](1); to[0] = address(bad);
        uint256[] memory ids = new uint256[](1); ids[0] = 7;
        uint256[] memory amts = new uint256[](1); amts[0] = 3;

        vm.startPrank(me);
        token.setApprovalForAll(address(bulk), true);
        vm.recordLogs();
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(token), to, ids, amts, true);
        vm.stopPrank();

        assertEq(sent, 1); assertEq(skipped, 0);
        assertEq(token.balanceOf(address(bad), 7), 3, "the receiver was paid");
        assertTrue(bad.tried(), "the receiver did attempt the nested call");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 skippedEvents; uint256 summaries;
        bytes32 SKIPPED = keccak256("Skipped(address,address,uint256,uint256,bytes)");
        bytes32 SUMMARY = keccak256("Airdrop1155(address,address,uint256,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(bulk)) continue;
            if (logs[i].topics[0] == SKIPPED) skippedEvents++;
            if (logs[i].topics[0] == SUMMARY) summaries++;
        }
        assertEq(skippedEvents, 0, "no injected Skipped event");
        assertEq(summaries, 1, "exactly one summary, from the batch the sender signed");
    }

    /// And the lock is what does it, said plainly. Strict mode, so the recipient's own revert reaches the
    /// caller instead of being absorbed as a skip.
    function test_reentryIsRefusedWithItsOwnError() public {
        Reenterer r = new Reenterer(bulk);
        token.mint(address(r), 1, 10);
        r.approve(address(token));
        vm.expectRevert(BulkSend.Reentered.selector);
        r.go(address(token));
    }

    /// In lenient mode the same recipient is simply skipped, which is the right outcome: the batch keeps
    /// going and the recipient that tried to interfere gets nothing.
    function test_reentryInLenientModeIsJustASkip() public {
        Reenterer r = new Reenterer(bulk);
        token.mint(address(r), 1, 10);
        r.approve(address(token));
        (uint256 sent, uint256 skipped) = r.goLenient(address(token));
        assertEq(sent, 0); assertEq(skipped, 1);
    }

    /// The lock is transient, so two separate batches in one transaction are still fine: it only stops a
    /// batch running inside another batch.
    function test_backToBackBatchesInOneTransactionStillWork() public {
        token.mint(me, 1, 10);
        address[] memory to = new address[](1); to[0] = address(0xB0B);
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        uint256[] memory amts = new uint256[](1); amts[0] = 2;
        vm.startPrank(me);
        token.setApprovalForAll(address(bulk), true);
        bulk.airdrop1155(address(token), to, ids, amts, false);
        bulk.airdrop1155(address(token), to, ids, amts, false);
        vm.stopPrank();
        assertEq(token.balanceOf(address(0xB0B), 1), 4);
    }
}

/// Calls BulkSend from inside a BulkSend call, the simplest possible way.
contract Reenterer {
    BulkSend public bulk;
    constructor(BulkSend b) { bulk = b; }
    function approve(address token) external { OZ1155(token).setApprovalForAll(address(bulk), true); }
    function go(address token) external {
        (address[] memory to, uint256[] memory ids, uint256[] memory amts) = _one();
        bulk.airdrop1155(token, to, ids, amts, false);   // strict: the revert reaches the caller
    }
    function goLenient(address token) external returns (uint256, uint256) {
        (address[] memory to, uint256[] memory ids, uint256[] memory amts) = _one();
        return bulk.airdrop1155(token, to, ids, amts, true);
    }
    function _one() internal view returns (address[] memory to, uint256[] memory ids, uint256[] memory amts) {
        to = new address[](1); to[0] = address(this);
        ids = new uint256[](1); ids[0] = 1;
        amts = new uint256[](1); amts[0] = 1;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        address[] memory to = new address[](1); to[0] = address(this);
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        uint256[] memory amts = new uint256[](1); amts[0] = 1;
        bulk.airdrop1155WithGas(msg.sender, to, ids, amts, true, 100_000);   // reverts: Reentered
        return 0xf23a6e61;
    }
}
