// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal, standards-shaped test tokens. Not for production; they exist so the airdrop tests
/// exercise the real approval and transfer paths without pulling a dependency.

contract MockERC721 {
    string public name = "Mock721";
    string public symbol = "M721";
    mapping(uint256 => address) internal _owner;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);

    function ownerOf(uint256 id) public view returns (address o) { o = _owner[id]; require(o != address(0), "NOT_MINTED"); }
    function mint(address to, uint256 id) external { require(_owner[id] == address(0), "MINTED"); _owner[id] = to; balanceOf[to]++; emit Transfer(address(0), to, id); }
    function setPaused(bool p) external { paused = p; }
    function approve(address to, uint256 id) external { require(msg.sender == _owner[id], "NOT_OWNER"); getApproved[id] = to; }
    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }

    function transferFrom(address from, address to, uint256 id) public {
        require(!paused, "PAUSED");
        require(from == _owner[id], "WRONG_FROM");
        require(to != address(0), "ZERO_TO");
        require(msg.sender == from || isApprovedForAll[from][msg.sender] || msg.sender == getApproved[id], "NOT_AUTHORIZED");
        balanceOf[from]--; balanceOf[to]++; _owner[id] = to; delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        if (to.code.length != 0) {
            (bool ok, bytes memory ret) = to.call(abi.encodeWithSelector(0x150b7a02, msg.sender, from, id, ""));
            require(ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == bytes4(0x150b7a02), "UNSAFE_RECIPIENT");
        }
    }
}

contract MockERC1155 {
    mapping(uint256 => mapping(address => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount);

    function mint(address to, uint256 id, uint256 amount) external { balanceOf[id][to] += amount; emit TransferSingle(msg.sender, address(0), to, id, amount); }
    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "NOT_AUTHORIZED");
        require(to != address(0), "ZERO_TO");
        balanceOf[id][from] -= amount; balanceOf[id][to] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
        if (to.code.length != 0) {
            (bool ok, bytes memory ret) = to.call(abi.encodeWithSelector(0xf23a6e61, msg.sender, from, id, amount, data));
            require(ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == bytes4(0xf23a6e61), "UNSAFE_RECIPIENT");
        }
    }
}

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public returnsNothing;   // some old tokens (USDT-style) return no bool

    event Transfer(address indexed from, address indexed to, uint256 amount);

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function setReturnsNothing(bool v) external { returnsNothing = v; }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "ALLOWANCE");
        require(balanceOf[from] >= amount, "BALANCE");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount; balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        if (returnsNothing) { assembly { return(0, 0) } }
        return true;
    }
}

/// A recipient contract that accepts nothing (no receiver hooks): safe transfers to it must fail.
contract DeafRecipient {}

/// A recipient contract that accepts 721 and 1155.
contract GoodRecipient {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return 0x150b7a02; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return 0xf23a6e61; }
}
