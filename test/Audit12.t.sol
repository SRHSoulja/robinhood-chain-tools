// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Twelfth-round reviewer probes for src/BulkSend.sol. Same convention as test/AuditProbe.t.sol: each test
// asserts the behaviour a FINDING describes, so a test that PASSES is a finding that reproduces.
//
//   forge test --match-path test/Audit12.t.sol -vv

import {Test} from "forge-std/Test.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {MockERC721, MockERC20} from "./Mocks.sol";
import {OZ721, A721, OZ20, NoReturn20} from "./RealTokens.sol";

/// An ERC-721 whose ownerOf refuses an unminted id with a bare `require`, which reverts with EMPTY
/// returndata. This is the Vyper reference ERC-721 shape (`assert owner != empty(address)`) and the shape of
/// any Solidity collection written `require(_owners[id] != address(0));` with no reason string.
contract BareRequire721 {
    mapping(uint256 => address) internal _owner;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    function mint(address to, uint256 id) external { _owner[id] = to; }
    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }
    function ownerOf(uint256 id) external view returns (address o) { o = _owner[id]; require(o != address(0)); }
    function transferFrom(address from, address to, uint256 id) public {
        require(from == _owner[id]);
        require(msg.sender == from || isApprovedForAll[from][msg.sender]);
        _owner[id] = to;
    }
    function safeTransferFrom(address from, address to, uint256 id) external { transferFrom(from, to, id); }
}

/// An ERC-20 that answers `false` for one chosen recipient and moves nothing for it, which is what a
/// return-false blocklist does. Every other recipient is paid normally.
contract FalseForOne20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public refused;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function refuse(address who) external { refused = who; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (t == refused) return false;                       // nothing moved, and it said so
        require(allowance[f][msg.sender] >= a && balanceOf[f] >= a, "nope");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
        return true;
    }
}

/// A 721 whose transferFrom calls something else that returns data, and then returns nothing itself.
/// Proves whose returndata the strict path's RETURNDATASIZE is reading.
contract Chatty721 {
    Talker public talker = new Talker();
    mapping(uint256 => address) internal _owner;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    function mint(address to, uint256 id) external { _owner[id] = to; }
    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }
    function ownerOf(uint256 id) external view returns (address) { return _owner[id]; }
    function transferFrom(address from, address to, uint256 id) public {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "auth");
        talker.speak();                                        // 64 bytes of returndata, in the token's frame
        _owner[id] = to;
    }
    function safeTransferFrom(address from, address to, uint256 id) external { transferFrom(from, to, id); }
}
contract Talker { function speak() external pure returns (uint256, uint256) { return (7, 9); } }

/// A hybrid in the ERC-404 shape: it answers ownerOf, and its transferFrom returns a bool.
contract Hybrid404 {
    mapping(uint256 => address) internal _owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    function mint(address to, uint256 id) external { _owner[id] = to; balanceOf[to] += 1; }
    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }
    function ownerOf(uint256 id) external view returns (address) { return _owner[id]; }
    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        if (v < 1e18) { balanceOf[from] -= v; balanceOf[to] += v; return true; }   // read as an amount
        _owner[v] = to; return true;
    }
}

contract Audit12 is Test {
    BulkSend bulk;
    address me = address(0xA11CE);
    address a = address(0xAA);
    address b = address(0xBB);
    address c = address(0xCC);

    function setUp() public { bulk = new BulkSend(); }

    function _to3() internal view returns (address[] memory t) { t = new address[](3); t[0] = a; t[1] = b; t[2] = c; }

    // ---------------------------------------------------------------------------------------------------
    // S12-1  airdrop20 has no mirror of _mustBeNft. An ERC-721 put through the ERC-20 entry point has its
    //        "amounts" spent as token ids, because transferFrom(address,address,uint256) is one selector for
    //        both standards and a conforming ERC-721 returns nothing, which airdrop20 reads as USDT-style
    //        success. The counter says three tokens delivered; what moved was three NFTs.
    function test_probe_airdrop20_on_an_erc721_moves_nfts_and_calls_it_a_token_delivery() public {
        MockERC721 nft = new MockERC721();
        vm.startPrank(me);
        nft.mint(me, 1); nft.mint(me, 2); nft.mint(me, 3);
        nft.setApprovalForAll(address(bulk), true);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1; amounts[1] = 2; amounts[2] = 3;      // "1, 2 and 3 tokens"
        (uint256 sent, uint256 skipped) = bulk.airdrop20(address(nft), _to3(), amounts, false);
        vm.stopPrank();
        assertEq(sent, 3, "reported three ERC-20 deliveries");
        assertEq(skipped, 0);
        assertEq(nft.ownerOf(1), a, "NFT 1 moved");
        assertEq(nft.ownerOf(2), b, "NFT 2 moved");
        assertEq(nft.ownerOf(3), c, "NFT 3 moved");
    }

    // ---------------------------------------------------------------------------------------------------
    // S12-2  _mustBeNft refuses a real ERC-721 whose ownerOf reverts with empty returndata. `require(x)` with
    //        no reason string does exactly that, and so does Vyper's bare `assert`. The probe reads ids[0]
    //        only, so one stale id at the front of an otherwise good lenient batch takes the whole batch
    //        down with "this is not an NFT contract", which is a statement about the collection.
    function test_probe_mustBeNft_refuses_a_bare_require_721_when_the_first_id_is_not_minted() public {
        BareRequire721 nft = new BareRequire721();
        vm.startPrank(me);
        nft.mint(me, 2); nft.mint(me, 3);                      // id 1 was burned, or never minted
        nft.setApprovalForAll(address(bulk), true);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1; ids[1] = 2; ids[2] = 3;
        vm.expectRevert(abi.encodeWithSelector(BulkSend.NotAnNft.selector, address(nft)));
        bulk.airdrop721(address(nft), _to3(), ids, false, true);   // LENIENT: promised to skip and continue
        vm.stopPrank();
    }

    // The same collection works perfectly once the first id is one that exists, which is what makes the
    // refusal above a statement about the wrong thing.
    function test_probe_the_same_bare_require_721_is_accepted_when_ids0_exists() public {
        BareRequire721 nft = new BareRequire721();
        vm.startPrank(me);
        nft.mint(me, 2); nft.mint(me, 3);
        nft.setApprovalForAll(address(bulk), true);
        address[] memory t = new address[](2); t[0] = a; t[1] = b;
        uint256[] memory ids = new uint256[](2); ids[0] = 2; ids[1] = 3;
        (uint256 sent,) = bulk.airdrop721(address(nft), t, ids, false, true);
        vm.stopPrank();
        assertEq(sent, 2);
    }

    // ---------------------------------------------------------------------------------------------------
    // S12-3  A single recipient the token answers `false` for takes the whole LENIENT batch down with
    //        AmbiguousResult, so nobody is paid. Lenient mode's promise is that a recipient that cannot
    //        receive is skipped and the rest is delivered.
    function test_probe_one_false_answer_reverts_the_whole_lenient_erc20_batch() public {
        FalseForOne20 tok = new FalseForOne20();
        vm.startPrank(me);
        tok.mint(me, 300); tok.approve(address(bulk), 300);
        tok.refuse(b);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100; amounts[1] = 100; amounts[2] = 100;
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, b, uint256(1)));
        bulk.airdrop20(address(tok), _to3(), amounts, true);   // LENIENT
        vm.stopPrank();
        assertEq(tok.balanceOf(a), 0, "the recipient before the refusal keeps nothing");
        assertEq(tok.balanceOf(c), 0, "and neither does the one after it");
    }

    // ---------------------------------------------------------------------------------------------------
    // S12-4  What the strict path's RETURNDATASIZE actually reads. A token whose transferFrom calls something
    //        that answers, and then returns nothing itself, must NOT be seen as answering.
    function test_returndatasize_reads_the_transfer_call_not_a_nested_one() public {
        Chatty721 nft = new Chatty721();
        vm.startPrank(me);
        nft.mint(me, 1); nft.mint(me, 2); nft.mint(me, 3);
        nft.setApprovalForAll(address(bulk), true);
        uint256[] memory ids = new uint256[](3); ids[0] = 1; ids[1] = 2; ids[2] = 3;
        (uint256 sent,) = bulk.airdrop721(address(nft), _to3(), ids, false, false);
        vm.stopPrank();
        assertEq(sent, 3);
        assertEq(nft.ownerOf(1), a);
    }

    // And the ERC-404 shape, whose transferFrom returns a bool, is refused rather than counted.
    function test_hybrid_404_is_refused_by_the_ambiguity_check() public {
        Hybrid404 h = new Hybrid404();
        vm.startPrank(me);
        h.mint(me, 1); h.mint(me, 2); h.mint(me, 3);
        h.setApprovalForAll(address(bulk), true);
        uint256[] memory ids = new uint256[](3); ids[0] = 1; ids[1] = 2; ids[2] = 3;
        vm.expectRevert(abi.encodeWithSelector(BulkSend.AmbiguousResult.selector, a, uint256(0)));
        bulk.airdrop721(address(h), _to3(), ids, false, false);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------------------
    // Gas: what a full 400-recipient batch costs on the shapes the page will meet, against the 32,000,000
    // limit the page sizes itself against.
    function test_gas_400_recipients() public {
        _gas400_oz721(true);
        _gas400_oz721(false);
        _gas400_a721();
        _gas400_oz20();
    }

    function _gas400_oz721(bool safeMode) internal {
        OZ721 nft = new OZ721();
        vm.startPrank(me);
        nft.mintMany(me, 1, 400);
        nft.setApprovalForAll(address(bulk), true);
        address[] memory to = new address[](400);
        uint256[] memory ids = new uint256[](400);
        for (uint256 i; i < 400; i++) { to[i] = address(uint160(0x10000 + i)); ids[i] = i + 1; }
        uint256 g = gasleft();
        bulk.airdrop721(address(nft), to, ids, safeMode, false);
        uint256 used = g - gasleft();
        vm.stopPrank();
        emit log_named_uint(safeMode ? "OZ721 strict SAFE   400 recipients, gas" : "OZ721 strict plain  400 recipients, gas", used);
        assertLt(used, 30_000_000, "a 400-row batch must fit the 30,000,000 budget the page derives its cap from");
    }

    function _gas400_a721() internal {
        A721 nft = new A721();
        vm.startPrank(me);
        nft.mint(me, 400);
        nft.setApprovalForAll(address(bulk), true);
        address[] memory to = new address[](400);
        uint256[] memory ids = new uint256[](400);
        for (uint256 i; i < 400; i++) { to[i] = address(uint160(0x20000 + i)); ids[i] = i + 1; }
        uint256 g = gasleft();
        bulk.airdrop721(address(nft), to, ids, false, true);
        uint256 used = g - gasleft();
        vm.stopPrank();
        emit log_named_uint("ERC721A lenient     400 recipients, gas", used);
        assertLt(used, 30_000_000, "a 400-row batch must fit the 30,000,000 budget the page derives its cap from");
    }

    function _gas400_oz20() internal {
        OZ20 tok = new OZ20();
        vm.startPrank(me);
        tok.mint(me, 400 ether);
        tok.approve(address(bulk), 400 ether);
        address[] memory to = new address[](400);
        uint256[] memory amounts = new uint256[](400);
        for (uint256 i; i < 400; i++) { to[i] = address(uint160(0x30000 + i)); amounts[i] = 1 ether; }
        uint256 g = gasleft();
        bulk.airdrop20(address(tok), to, amounts, true);
        uint256 used = g - gasleft();
        vm.stopPrank();
        emit log_named_uint("OZ20 lenient        400 recipients, gas", used);
        assertLt(used, 30_000_000, "a 400-row batch must fit the 30,000,000 budget the page derives its cap from");
    }
}
