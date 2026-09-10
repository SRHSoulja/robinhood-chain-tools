// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {NoReturn20, False20} from "./RealTokens.sol";

/// Does the returndata check actually close the id-as-amount confusion, or only the half of it that answers?
contract IdAmountProbe is Test {
    BulkSend bulk;
    address me = address(0xA11CE);

    function setUp() public { bulk = new BulkSend(); }

    function _to(uint256 n) internal pure returns (address[] memory a) {
        a = new address[](n);
        for (uint256 i; i < n; i++) a[i] = address(uint160(0xB0B + i));
    }

    /// A token that returns `false` is refused too, and refused earlier: on the shape of the contract, before
    /// a transfer is attempted at all, rather than on the answer to one that already ran.
    function test_false20ThroughThe721EntryPointIsRefused() public {
        False20 t = new False20();
        t.mint(me, 1000e18);
        address[] memory to = _to(1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 100e18;
        vm.prank(me);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(t)));
        bulk.airdrop721(address(t), to, ids, false, true);
    }

    /// A token that returns NOTHING is the shape a conforming ERC-721 transfer also has. USDT is this shape.
    /// It has to be refused on the shape of the contract, because the transfer itself is indistinguishable.
    function test_noReturn20ThroughThe721EntryPointIsRefused() public {
        NoReturn20 t = new NoReturn20();
        t.mint(me, 1000e18);
        address[] memory to = _to(1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 100e18;              // an "id" that is really 100 tokens
        vm.startPrank(me);
        t.approve(address(bulk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(t)));
        bulk.airdrop721(address(t), to, ids, false, true);
        vm.stopPrank();
        assertEq(t.balanceOf(to[0]), 0);        // nothing moved
        assertEq(t.balanceOf(me), 1000e18);
    }
}
