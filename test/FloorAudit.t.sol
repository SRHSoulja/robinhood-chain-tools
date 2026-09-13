// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Isolated 2026-09-13 audit regressions. No production modifications.
import "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {OZ20, OZ721, OZ1155} from "./RealTokens.sol";

contract ForceAuditEth {
    constructor(address payable to) payable { selfdestruct(to); }
}
contract HostileAuditProbe {
    // A token-shaped target can exhaust gas before the capped transfer loop.
    fallback() external { while (true) {} }
}
contract FloorAuditTest is Test {
    BulkSend bulk;
    address sender = address(0xA11CE);
    function setUp() public { bulk = new BulkSend(); }

    function testDirectDepositsCanBeStuckDespiteNormalPathBeingNoncustodial() public {
        OZ20 e = new OZ20(); OZ721 n = new OZ721();
        e.mint(sender, 10); n.mint(sender, 1);
        vm.startPrank(sender);
        e.transfer(address(bulk), 10);
        n.transferFrom(sender, address(bulk), 1);
        vm.stopPrank();
        assertEq(e.balanceOf(address(bulk)), 10);
        assertEq(n.ownerOf(1), address(bulk));
        vm.deal(address(this), 1 ether);
        new ForceAuditEth{value: 1 ether}(payable(address(bulk)));
        assertEq(address(bulk).balance, 1 ether);
        // There is no rescue entry point; ordinary ETH sends are rejected.
        (bool ok,) = address(bulk).call(""); assertFalse(ok);
    }

    function testNonpayableEntryRejectsAttachedEth() public {
        OZ20 e = new OZ20(); e.mint(sender, 10);
        address[] memory to = new address[](1); to[0] = address(0xB0B);
        uint256[] memory a = new uint256[](1); a[0] = 1;
        vm.deal(sender, 1 ether); vm.startPrank(sender); e.approve(address(bulk), 10);
        (bool ok,) = address(bulk).call{value: 1}(abi.encodeCall(bulk.airdrop20,(address(e),to,a,false)));
        vm.stopPrank(); assertFalse(ok); assertEq(e.balanceOf(sender),10); assertEq(address(bulk).balance,0);
    }

    function testLateSelfRecipientRevertsEvenEarlierLenientSuccess() public {
        OZ20 e = new OZ20(); e.mint(sender, 10);
        address[] memory to = new address[](2); to[0] = address(0xB0B); to[1] = address(bulk);
        uint256[] memory a = new uint256[](2); a[0] = 1; a[1] = 1;
        vm.startPrank(sender); e.approve(address(bulk), 10);
        vm.expectRevert(abi.encodeWithSelector(BulkSend.SelfRecipient.selector,1));
        bulk.airdrop20(address(e),to,a,true); vm.stopPrank();
        assertEq(e.balanceOf(to[0]),0); assertEq(e.balanceOf(sender),10); assertEq(e.allowance(sender,address(bulk)),10);
    }

    function testLenientDoesNotBoundMaliciousClassificationCalls() public {
        HostileAuditProbe token = new HostileAuditProbe();
        address[] memory to = new address[](1); to[0] = address(0xB0B);
        uint256[] memory a = new uint256[](1); a[0] = 1;
        (bool ok,) = address(bulk).call{gas: 700_000}(abi.encodeCall(bulk.airdrop20,(address(token),to,a,true)));
        assertFalse(ok); // Caller-local griefing, not access to another user's funds.
    }

    function testFuzzMixed1155PreservesEveryRecipientIdPair(uint256 seed, uint8 rawN) public {
        uint256 n = bound(rawN,1,40); OZ1155 t = new OZ1155();
        for (uint256 id=1;id<=7;id++) t.mint(sender,id,10000);
        address[] memory to = new address[](n); uint256[] memory ids = new uint256[](n); uint256[] memory amounts = new uint256[](n);
        uint256[7][5] memory expected;
        for(uint256 i;i<n;i++) {
            uint256 h = uint256(keccak256(abi.encode(seed,i)));
            uint256 r = h%5; uint256 id = (h>>8)%7; uint256 amount = 1+(h>>16)%100;
            to[i]=address(uint160(0xB000+r)); ids[i]=id+1; amounts[i]=amount; expected[r][id]+=amount;
        }
        vm.startPrank(sender);t.setApprovalForAll(address(bulk),true);
        (uint256 sent,uint256 skipped)=bulk.airdrop1155(address(t),to,ids,amounts,false);vm.stopPrank();
        assertEq(sent,n);assertEq(skipped,0);
        for(uint256 id;id<7;id++) {
            uint256 total;
            for(uint256 r;r<5;r++) { assertEq(t.balanceOf(address(uint160(0xB000+r)),id+1),expected[r][id]);total+=expected[r][id]; }
            assertEq(t.balanceOf(sender,id+1),10000-total);assertEq(t.balanceOf(address(bulk),id+1),0);
        }
    }
}
