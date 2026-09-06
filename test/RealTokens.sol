// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Real-world token implementations the airdrop must work against, plus the awkward ones it must survive.
/// These are the same base contracts collections actually deploy (OpenZeppelin v5, ERC721A), not hand-rolled mocks.

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721Pausable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

contract OZ721 is ERC721 {
    constructor() ERC721("Rehearsal 721", "R721") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
    function mintMany(address to, uint256 from, uint256 count) external { for (uint256 i; i < count; i++) _mint(to, from + i); }
}

contract OZ721Enum is ERC721Enumerable {
    constructor() ERC721("Rehearsal 721 Enumerable", "R721E") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract OZ721Pausable is ERC721Pausable {
    constructor() ERC721("Rehearsal 721 Pausable", "R721P") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
    function pause() external { _pause(); }
    function unpause() external { _unpause(); }
}

contract A721 is ERC721A {
    constructor() ERC721A("Rehearsal 721A", "R721A") {}
    function mint(address to, uint256 qty) external { _mint(to, qty); }
    function _startTokenId() internal pure override returns (uint256) { return 1; }
}

contract OZ1155 is ERC1155 {
    constructor() ERC1155("ipfs://rehearsal/{id}.json") {}
    function mint(address to, uint256 id, uint256 amount) external { _mint(to, id, amount, ""); }
}

contract OZ20 is ERC20 {
    constructor() ERC20("Rehearsal 20", "R20") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// USDT-style: transferFrom returns nothing at all.
contract NoReturn20 {
    string public name = "NoReturn 20"; string public symbol = "NR20"; uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external { allowance[msg.sender][s] = a; }
    function transferFrom(address f, address t, uint256 a) external {
        require(allowance[f][msg.sender] >= a, "allowance"); require(balanceOf[f] >= a, "balance");
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        balanceOf[f] -= a; balanceOf[t] += a; emit Transfer(f, t, a);
    }
}

/// Returns false instead of reverting on failure.
contract False20 {
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (allowance[f][msg.sender] < a || balanceOf[f] < a) return false;
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// Takes 2% on every transfer: the recipient gets less than sent. The airdrop must not misreport this.
contract Fee20 is ERC20 {
    constructor() ERC20("Fee 20", "F20") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) { uint256 fee = value / 50; super._update(from, address(0xFEE), fee); value -= fee; }
        super._update(from, to, value);
    }
}

/// Blacklists a recipient: transfers to it revert with a custom error.
contract Blacklist20 is ERC20 {
    error Blocked(address who);
    mapping(address => bool) public blocked;
    constructor() ERC20("Blacklist 20", "B20") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function block_(address who, bool v) external { blocked[who] = v; }
    function _update(address from, address to, uint256 value) internal override { if (blocked[to]) revert Blocked(to); super._update(from, to, value); }
}

/// Recipient that accepts everything.
contract Accepts is IERC721Receiver, IERC1155Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return IERC721Receiver.onERC721Received.selector; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return IERC1155Receiver.onERC1155Received.selector; }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) { return IERC1155Receiver.onERC1155BatchReceived.selector; }
    function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IERC721Receiver).interfaceId || id == type(IERC1155Receiver).interfaceId; }
}

/// Recipient with no hooks at all: safe transfers to it must fail.
contract Deaf {}

/// Recipient that returns the wrong magic value.
contract WrongMagic {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return 0xdeadbeef; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return 0xdeadbeef; }
}

/// Recipient that reverts inside the hook with a reason string.
contract Rejects {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { revert("no thanks"); }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert("no thanks"); }
}

interface IBulk { function airdrop721(address, address[] calldata, uint256[] calldata, bool, bool) external returns (uint256, uint256); }

/// Recipient that tries to re-enter BulkSend from inside the receive hook. BulkSend has no state to corrupt,
/// and the re-entered call runs as msg.sender = this contract, which owns nothing, so it must fail harmlessly.
contract Reenter is IERC721Receiver {
    address public bulk; address public token; bool public reentered; bool public innerOk;
    constructor(address b, address t) { bulk = b; token = t; }
    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        if (!reentered) { reentered = true; address[] memory to = new address[](1); to[0] = address(0xB0B); uint256[] memory ids = new uint256[](1); ids[0] = id;
            try IBulk(bulk).airdrop721(token, to, ids, false, false) { innerOk = true; } catch { innerOk = false; } }
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// Recipient that burns all the gas it is given inside the hook (a gas-griefing recipient).
contract GasHog {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { uint256 x; while (true) { x++; } }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { uint256 x; while (true) { x++; } }
}

/// Recipient that reverts with a huge payload (a return-bomb) to inflate the caller's memory cost.
contract Bomb {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { bytes memory big = new bytes(200_000); assembly { revert(add(big, 32), mload(big)) } }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { bytes memory big = new bytes(200_000); assembly { revert(add(big, 32), mload(big)) } }
}

/// ERC-20 that answers transferFrom with odd return data: 16 bytes, or a full word holding 2. Neither is a success.
contract Weird20 {
    uint8 public mode;   // 0 = normal true, 1 = return 16 bytes, 2 = return the word 2
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function setMode(uint8 m) external { mode = m; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a && balanceOf[f] >= a, "nope");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
        if (mode == 1) { assembly { mstore(0, 1) return(0, 16) } }
        if (mode == 2) { assembly { mstore(0, 2) return(0, 32) } }
        return true;
    }
}

/// ERC-20 that notifies the recipient (ERC-1363 / ERC-777 shaped). A hostile recipient can burn the caller's
/// gas through it, which is how a gas-griefing attack reaches an ERC-20 airdrop.
contract Callback20 {
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a && balanceOf[f] >= a, "nope");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
        if (t.code.length != 0) { (bool ok,) = t.call(abi.encodeWithSignature("onTokenTransfer(address,uint256)", f, a)); require(ok, "hook failed"); }
        return true;
    }
}

/// A recipient that burns every drop of gas it is handed, through the ERC-20 callback path.
contract Erc20GasHog {
    function onTokenTransfer(address, uint256) external pure { uint256 x; while (true) { x++; } }
}

/// Moves the balance and then answers something other than `true`. The dangerous shape: the call succeeds, so
/// the recipient really was paid, and any report of "skipped" would invite a second payment.
contract PaysThenLies20 {
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode;   // 0 = returns false, 1 = returns 16 bytes, 2 = returns the word 2
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function setMode(uint8 m) external { mode = m; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a && balanceOf[f] >= a, "nope");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;   // the money really moved
        if (mode == 1) { assembly { mstore(0, 1) return(0, 16) } }
        if (mode == 2) { assembly { mstore(0, 2) return(0, 32) } }
        return false;
    }
}

/// Reverts with a reason longer than the lenient cap, to prove strict mode hands it back whole.
contract LongReason20 {
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("this rejection reason is deliberately far longer than one hundred and twenty eight bytes so that any truncation would leave behind something that no longer decodes as an Error(string) at all");
    }
}

/// Returns 64 bytes whose first word is 1. A caller reading only the first word calls this a success.
contract TwoWord20 {
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a && balanceOf[f] >= a, "nope");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
        assembly { mstore(0, 1) mstore(32, 2) return(0, 64) }
    }
}

/// Accepts every call, returns success, and moves nothing. Nothing on chain can tell a caller otherwise:
/// this is the boundary of what a batch sender can promise.
contract PolitelyDoesNothing {
    fallback() external { assembly { mstore(0, 1) return(0, 32) } }
}
