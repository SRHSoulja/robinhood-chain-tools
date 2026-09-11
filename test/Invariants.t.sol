// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {OZ721, OZ1155, OZ20} from "./RealTokens.sol";

/// The properties the example tests assert one case at a time, asserted over random sequences instead.
/// A handler drives all three paths with valid-shaped input from one sender against a fixed pool of fresh
/// recipients, and after every call these must still hold:
///
///   1. every row is accounted for: sent + skipped == rows, per standard
///   2. "sent" means it moved: the count of ids/units/wei that left the sender equals what was reported sent
///   3. nothing moves after approval is withdrawn
///   4. BulkSend holds nothing, ever
///
/// fail_on_revert is on, so a handler call that reverts unexpectedly is itself a finding.
contract Handler is Test {
    BulkSend public bulk;
    OZ721 public nft;
    OZ1155 public multi;
    OZ20 public tok;
    address public sender = address(0xA11CE);
    address[] public pool;

    uint256 public rows721; uint256 public sent721; uint256 public skipped721;
    uint256 public rows1155; uint256 public sent1155; uint256 public skipped1155;
    uint256 public rows20; uint256 public sent20; uint256 public skipped20;
    uint256 public units1155Sent;   // editions reported delivered
    uint256 public wei20Sent;       // wei reported delivered
    uint256 public nextId = 1;      // 721 ids minted so far
    uint256 public minted1155;
    uint256 public minted20;
    bool public approved721 = true; bool public approved1155 = true; bool public approved20 = true;

    constructor() {
        bulk = new BulkSend(); nft = new OZ721(); multi = new OZ1155(); tok = new OZ20();
        for (uint256 i; i < 16; i++) pool.push(address(uint160(0x51E0000 + i)));
        vm.startPrank(sender);
        nft.setApprovalForAll(address(bulk), true);
        multi.setApprovalForAll(address(bulk), true);
        tok.approve(address(bulk), type(uint256).max);
        vm.stopPrank();
    }

    function _recipients(uint256 n, uint256 seed, bool withZero) internal view returns (address[] memory to) {
        to = new address[](n);
        uint256 start = seed % pool.length;                    // reduce first: seed is a full-width fuzz value
        for (uint256 i; i < n; i++) to[i] = pool[(start + i) % pool.length];
        if (withZero && n > 1) to[seed % n] = address(0);
    }

    function drop721(uint8 nRaw, bool lenient, uint256 seed, bool withZero) external {
        uint256 n = bound(nRaw, 1, 12);
        withZero = withZero && lenient;                        // strict refuses a zero recipient by design
        uint256[] memory ids = new uint256[](n);
        for (uint256 i; i < n; i++) { ids[i] = nextId++; nft.mint(sender, ids[i]); }
        address[] memory to = _recipients(n, seed, withZero);
        vm.prank(sender);
        if (!approved721) {
            if (!lenient) { vm.expectRevert(); bulk.airdrop721(address(nft), to, ids, false, false); return; }
            (uint256 s, uint256 k) = bulk.airdrop721(address(nft), to, ids, false, true);
            assertEq(s, 0, "unapproved: nothing may be reported sent"); assertEq(k, n);
            rows721 += n; skipped721 += k; return;
        }
        (uint256 sent, uint256 skipped) = bulk.airdrop721(address(nft), to, ids, false, lenient);
        rows721 += n; sent721 += sent; skipped721 += skipped;
    }

    function drop1155(uint8 nRaw, bool lenient, uint256 seed, bool withZero) external {
        uint256 n = bound(nRaw, 1, 12);
        withZero = withZero && lenient;
        uint256[] memory ids = new uint256[](n); uint256[] memory amts = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) { ids[i] = 1; amts[i] = 1 + ((seed >> (i * 4)) & 3); total += amts[i]; }
        multi.mint(sender, 1, total); minted1155 += total;
        address[] memory to = _recipients(n, seed, withZero);
        vm.prank(sender);
        if (!approved1155) {
            if (!lenient) { vm.expectRevert(); bulk.airdrop1155(address(multi), to, ids, amts, false); return; }
            (uint256 s, uint256 k) = bulk.airdrop1155(address(multi), to, ids, amts, true);
            assertEq(s, 0, "unapproved: nothing may be reported sent"); assertEq(k, n);
            rows1155 += n; skipped1155 += k; return;
        }
        (uint256 sent, uint256 skipped) = bulk.airdrop1155(address(multi), to, ids, amts, lenient);
        rows1155 += n; sent1155 += sent; skipped1155 += skipped;
        for (uint256 i; i < n; i++) if (to[i] != address(0)) units1155Sent += amts[i];
    }

    function drop20(uint8 nRaw, bool lenient, uint256 seed, bool withZero) external {
        uint256 n = bound(nRaw, 1, 12);
        withZero = withZero && lenient;
        uint256[] memory amts = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) { amts[i] = 1e15 * (1 + ((seed >> (i * 4)) & 7)); total += amts[i]; }
        tok.mint(sender, total); minted20 += total;
        address[] memory to = _recipients(n, seed, withZero);
        vm.prank(sender);
        if (!approved20) {
            if (!lenient) { vm.expectRevert(); bulk.airdrop20(address(tok), to, amts, false); return; }
            (uint256 s, uint256 k) = bulk.airdrop20(address(tok), to, amts, true);
            assertEq(s, 0, "unapproved: nothing may be reported sent"); assertEq(k, n);
            rows20 += n; skipped20 += k; return;
        }
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(tok), to, amts, lenient);
        rows20 += n; sent20 += sent; skipped20 += skipped;
        for (uint256 i; i < n; i++) if (to[i] != address(0)) wei20Sent += amts[i];
    }

    function setApproval(bool on721, bool on1155, bool on20) external {
        vm.startPrank(sender);
        nft.setApprovalForAll(address(bulk), on721); approved721 = on721;
        multi.setApprovalForAll(address(bulk), on1155); approved1155 = on1155;
        tok.approve(address(bulk), on20 ? type(uint256).max : 0); approved20 = on20;
        vm.stopPrank();
    }

    function poolSize() external view returns (uint256) { return pool.length; }
}

contract BulkSendInvariants is StdInvariant, Test {
    Handler h;

    function setUp() public {
        h = new Handler();
        targetContract(address(h));
    }

    function test_erc20ApprovalWithdrawalIsActuallyExercised() public {
        h.setApproval(true, true, false);
        h.drop20(3, true, 17, false);
        assertEq(h.rows20(), 3, "the withdrawn-allowance rows were exercised");
        assertEq(h.sent20(), 0, "withdrawn allowance moved tokens");
        assertEq(h.skipped20(), 3, "lenient withdrawal did not account for every row");
        h.drop20(2, false, 19, false); // the handler expects and consumes the strict-path revert
        assertEq(h.rows20(), 3, "a reverted strict batch must not enter the accounting totals");
    }

    function invariant_everyRowIsAccountedFor() public view {
        assertEq(h.sent721() + h.skipped721(), h.rows721(), "721: sent + skipped != rows");
        assertEq(h.sent1155() + h.skipped1155(), h.rows1155(), "1155: sent + skipped != rows");
        assertEq(h.sent20() + h.skipped20(), h.rows20(), "20: sent + skipped != rows");
    }

    function invariant_sentMeansItMoved() public view {
        // 721: ids no longer held by the sender are exactly the ids reported sent (recipients never send back)
        uint256 minted = h.nextId() - 1;
        assertEq(minted - h.nft().balanceOf(h.sender()), h.sent721(), "721: reported sent != ids that left");
        // 1155 and 20: what the pool holds is exactly what was reported delivered to it
        uint256 held1155; uint256 held20;
        for (uint256 i; i < h.poolSize(); i++) {
            held1155 += h.multi().balanceOf(h.pool(i), 1);
            held20 += h.tok().balanceOf(h.pool(i));
        }
        assertEq(held1155, h.units1155Sent(), "1155: pool holds != units reported delivered");
        assertEq(held20, h.wei20Sent(), "20: pool holds != wei reported delivered");
        // and conservation: sender + pool == minted, for both
        assertEq(held1155 + h.multi().balanceOf(h.sender(), 1), h.minted1155(), "1155: supply not conserved");
        assertEq(held20 + h.tok().balanceOf(h.sender()), h.minted20(), "20: supply not conserved");
    }

    function invariant_bulkHoldsNothing() public view {
        assertEq(h.nft().balanceOf(address(h.bulk())), 0, "BulkSend holds an NFT");
        assertEq(h.multi().balanceOf(address(h.bulk()), 1), 0, "BulkSend holds an edition");
        assertEq(h.tok().balanceOf(address(h.bulk())), 0, "BulkSend holds tokens");
        assertEq(address(h.bulk()).balance, 0, "BulkSend holds ETH");
    }
}
