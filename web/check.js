(() => {
  const $ = (id) => document.getElementById(id);

  // Read-only on both networks: this page never signs, never sends, and never writes anything anywhere.
  const CHAINS = {
    4663:  { name: 'Robinhood Chain',         rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
    46630: { name: 'Robinhood Chain Testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  };
  const chainId = () => Number($('net').value);
  const cfg = () => CHAINS[chainId()];
  const api = (path) => cfg().explorer + '/api/v2' + path;
  const rp = () => new ethers.JsonRpcProvider(cfg().rpc);
  let ethUsd = null;

  // ---------- building the page: text nodes only ----------
  // Names, symbols, revert strings and error messages all come from contracts nobody here controls. They are
  // written as text and never as markup, so a token called "<img onerror=…>" is a silly name and nothing more.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'href') { el.href = v; el.target = '_blank'; el.rel = 'noopener'; }
      else if (k === 'onclick') el.addEventListener('click', v);
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) { if (kid === null || kid === undefined || kid === false) continue; el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); }
    return el;
  }
  const card = (title, ...kids) => h('div', { class: 'card' }, title ? h('h2', { text: title }) : null, ...kids);
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, typeof v === 'string' ? document.createTextNode(v) : v)]));
  const note = (cls, title, body) => h('div', { class: 'note ' + cls }, h('b', { text: title }), typeof body === 'string' ? document.createTextNode(body) : body);
  const mono = (t) => h('span', { class: 'mono', text: t });
  // Every plain-English sentence on this page is a reading of an interface, not a statement about what the
  // code does. That belongs directly under the sentence: by the time a reader reaches the contract card
  // further down, they have already decided what the transaction means.
  const readingCaption = (target) => h('p', { class: 'mut', style: 'font-size:12.5px;margin:-6px 0 10px', text:
    'That is what this function name and these arguments conventionally mean. It is not a statement about what this contract does with them, which only reading its code can tell you'
    + (target && target.verified === false ? ', and this one has published none.' : '.') });
  const link = (addrOrHash, label, kind) => h('a', { class: 'mono', href: cfg().explorer + '/' + (kind || 'address') + '/' + addrOrHash, text: label || addrOrHash });
  const short = (a) => (a && a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-6) : a || '');
  const say = (m, cls) => { const el = $('msg'); el.textContent = m || ''; el.className = 'msg' + (cls ? ' ' + cls : ''); };

  // ---------- what a call means, when nobody has published an ABI ----------
  // Every one of these is a signature the chain sees constantly. Knowing them by heart is the difference
  // between "0x095ea7b3…" and "you are about to let a stranger spend your entire balance".
  const SIGS = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 idOrAmount) returns (bool)',
    'function approve(address spender, uint256 idOrAmount) returns (bool)',
    'function increaseAllowance(address spender, uint256 added) returns (bool)',
    'function decreaseAllowance(address spender, uint256 removed) returns (bool)',
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
    'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
    'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
    'function setApprovalForAll(address operator, bool approved)',
    'function mint(address to, uint256 amountOrId)',
    'function mint(uint256 quantity)',
    'function mint()',
    'function safeMint(address to, uint256 tokenId)',
    'function publicMint(uint256 quantity)',
    'function burn(uint256 amountOrId)',
    'function burnFrom(address from, uint256 amount)',
    'function transferOwnership(address newOwner)',
    'function renounceOwnership()',
    'function acceptOwnership()',
    'function grantRole(bytes32 role, address account)',
    'function revokeRole(bytes32 role, address account)',
    'function pause()',
    'function unpause()',
    'function setPaused(bool paused)',
    'function upgradeTo(address implementation)',
    'function upgradeToAndCall(address implementation, bytes data)',
    'function setTransferValidator(address validator)',
    'function withdraw()',
    'function withdraw(uint256 amount)',
    'function deposit()',
    'function multicall(bytes[] data) returns (bytes[])',
    'function execute(address target, uint256 value, bytes data) returns (bytes)',
    'function setBaseURI(string uri)',
    'function airdrop721(address token, address[] to, uint256[] ids, bool safe, bool lenient) returns (uint256,uint256)',
    'function airdrop1155(address token, address[] to, uint256[] ids, uint256[] amounts, bool lenient) returns (uint256,uint256)',
    'function airdrop20(address token, address[] to, uint256[] amounts, bool lenient) returns (uint256,uint256)',
    'function airdrop721WithGas(address token, address[] to, uint256[] ids, bool safe, bool lenient, uint256 gasPerTransfer) returns (uint256,uint256)',
    'function airdrop1155WithGas(address token, address[] to, uint256[] ids, uint256[] amounts, bool lenient, uint256 gasPerTransfer) returns (uint256,uint256)',
    'function airdrop20WithGas(address token, address[] to, uint256[] amounts, bool lenient, uint256 gasPerTransfer) returns (uint256,uint256)',
  ];
  const KNOWN_IFACE = new ethers.Interface(SIGS);

  // Read-only signatures worth spotting in bytecode, though nobody needs them translated.
  const EXTRA_SELECTORS = {};
  for (const s of [
    'name()', 'symbol()', 'decimals()', 'totalSupply()', 'balanceOf(address)', 'ownerOf(uint256)', 'owner()',
    'paused()', 'getTransferValidator()', 'supportsInterface(bytes4)', 'allowance(address,address)',
    'isApprovedForAll(address,address)', 'tokenURI(uint256)', 'implementation()', 'proxiableUUID()',
    'blacklist(address)', 'setBlacklist(address,bool)', 'isBlacklisted(address)', 'setFee(uint256)',
    'setFees(uint256,uint256)', 'setTaxRate(uint256)', 'setMaxTransaction(uint256)', 'setMaxWallet(uint256)',
    'freeze(address)', 'unfreeze(address)', 'setTradingEnabled(bool)', 'enableTrading()', 'setLimits(bool)',
    'rescueTokens(address,uint256)', 'sweep(address)', 'emergencyWithdraw()', 'setRoyalties(address,uint96)',
  ]) EXTRA_SELECTORS[ethers.id(s).slice(0, 10)] = s;

  // What a contract can do to the people holding its tokens. Names are a convention rather than a standard,
  // so this matches on the shape of the name and always says which function it saw.
  const POWERS = [
    [/^(mint|safeMint|airdropMint|issue|publicMint|ownerMint)/i, 'create new tokens out of nothing', 'warn'],
    [/^(burnFrom|burnFor|adminBurn|forceBurn)/i, 'destroy tokens held by someone else', 'bad'],
    [/^(pause|unpause|setPaused|setTradingEnabled|enableTrading|setLimits)/i, 'stop everyone from transferring', 'bad'],
    [/(blacklist|blocklist|denylist|banned?|freeze|frozen)/i, 'block a chosen wallet from transferring', 'bad'],
    [/^(setFee|setFees|setTax|setTaxRate|setRoyalt|setMarketing|setBuyTax|setSellTax)/i, 'change the fee taken out of transfers', 'warn'],
    [/^(upgradeTo|setImplementation|upgrade)/i, 'replace this contract’s code entirely', 'bad'],
    [/^(transferOwnership|setOwner|setAdmin|grantRole|renounceOwnership)/i, 'hand these powers to another address', 'warn'],
    [/^(withdraw|sweep|rescue|claimTokens|emergencyWithdraw|drain)/i, 'move funds out of the contract', 'warn'],
    [/^(setTransferValidator|setOperatorFilter|setApprovalRestriction)/i, 'restrict who is allowed to move tokens', 'warn'],
    [/^(setBaseURI|setTokenURI|setContractURI)/i, 'change what the token shows as its art or metadata', 'mut'],
    [/^(setMaxTransaction|setMaxWallet|setMax)/i, 'cap how much anyone may hold or move', 'warn'],
  ];

  // ---------- events, so a receipt says what moved rather than which topics it had ----------
  const EV = {};
  for (const sig of [
    'Transfer(address,address,uint256)', 'TransferSingle(address,address,address,uint256,uint256)',
    'TransferBatch(address,address,address,uint256[],uint256[])', 'Approval(address,address,uint256)',
    'ApprovalForAll(address,address,bool)', 'OwnershipTransferred(address,address)', 'Paused(address)',
    'Unpaused(address)', 'Upgraded(address)', 'RoleGranted(bytes32,address,address)',
  ]) EV[ethers.id(sig)] = sig;

  // ---------- revert reasons in words ----------
  // Kept as signatures rather than bare selectors, so a refusal can say "that token id does not exist (12345)"
  // instead of "reverted with 0x7e273289".
  const ERR_SIGS = [
    ['error ERC721NonexistentToken(uint256 tokenId)', 'that token id does not exist'],
    ['error ERC721InsufficientApproval(address operator, uint256 tokenId)', 'that wallet has not approved this operator for the token'],
    ['error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)', 'the token is not owned by the address it is being sent from'],
    ['error ERC721InvalidReceiver(address receiver)', 'the recipient is a contract that cannot receive NFTs'],
    ['error ERC721InvalidSender(address sender)', 'that sender cannot send this token'],
    ['error ERC721InvalidOperator(address operator)', 'that operator is not allowed'],
    ['error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)', 'the allowance is too low for this amount'],
    ['error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)', 'the balance is too low for this amount'],
    ['error ERC20InvalidReceiver(address receiver)', 'the recipient is not a valid address for this token'],
    ['error ERC1155InsufficientBalance(address sender, uint256 balance, uint256 needed, uint256 id)', 'the balance of that id is too low'],
    ['error ERC1155InvalidReceiver(address receiver)', 'the recipient is a contract that cannot receive ERC-1155'],
    ['error OwnableUnauthorizedAccount(address account)', 'only the owner of the contract may do this'],
    ['error EnforcedPause()', 'the token contract is paused'],
    ['error TransferCallerNotOwnerNorApproved()', 'the caller is not the owner and has not been approved'],
    ['error ApprovalCallerNotOwnerNorApproved()', 'the caller is not the owner and has not been approved'],
    ['error TransferFromIncorrectOwner()', 'that id is not owned by the address it is being sent from'],
    ['error TransferToNonERC721ReceiverImplementer()', 'the recipient is a contract that cannot receive NFTs'],
    ['error OwnerQueryForNonexistentToken()', 'that token id does not exist'],
    ['error TransferToZeroAddress()', 'the recipient is the zero address'],
    ['error Unauthorized()', 'the caller is not authorised'],
    ['error FailedCall()', 'a call inside this transaction failed'],
    ['error LengthMismatch()', 'BulkSend: the lists are different lengths'],
    ['error EmptyBatch()', 'BulkSend: the batch is empty'],
    ['error NotAContract(address token)', 'BulkSend: that token address is not a contract'],
    ['error DelegatedWallet(address token)', 'BulkSend: that address is a wallet running delegated code, not a token'],
    ['error SelfRecipient(uint256 index)', 'BulkSend: one of the recipients is BulkSend itself, which could never give it back'],
    ['error ZeroAmount(uint256 index)', 'BulkSend: one of the amounts is zero, which would deliver nothing'],
    ['error AmbiguousResult(address to, uint256 index)', 'BulkSend: the token gave an answer that cannot be read as success or failure, so the whole batch was undone'],
    ['error ZeroRecipient(uint256 index)', 'BulkSend: one of the recipients is the zero address'],
    ['error OutOfGasForBatch(uint256 index)', 'BulkSend: this transaction cannot afford to give every recipient its gas allowance'],
    ['error GasOutOfRange(uint256 given, uint256 min, uint256 max)', 'BulkSend: the gas allowance is outside the range the contract accepts'],
    ['error GasIsForLenientOnly()', 'BulkSend: a gas allowance only applies when skipping is allowed'],
    ['error TransferFailed(address to, uint256 id)', 'BulkSend: a transfer failed and the batch was refused'],
  ];
  const ERR_IFACE = new ethers.Interface(ERR_SIGS.map((e) => e[0]));
  const ERR_WORDS = {};
  for (const [sig, words] of ERR_SIGS) ERR_WORDS[sig.slice(6).split('(')[0]] = words;
  // Selectors seen in the wild whose signature is not worth carrying.
  const ERR_BY_SELECTOR = {
    '0x1de5204e': 'this collection only allows transfers through operators its creator approved',
    '0xe6c4247b': 'an address given to the contract is not valid',
    '0x82b42900': 'the caller is not authorised',
    '0x5274afe7': 'a transfer inside this call failed',
  };

  function decodeRevert(data, iface) {
    if (!data || data === '0x') return 'no reason given';
    const sel = data.slice(0, 10).toLowerCase();
    try {
      if (sel === '0x08c379a0') {
        const reason = String(ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))[0]);
        return '\u201c' + (reason.length > 300 ? reason.slice(0, 300) + '\u2026 (' + reason.length + ' characters, cut here)' : reason) + '\u201d';
      }
      if (sel === '0x4e487b71') {
        const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + data.slice(10))[0];
        const panics = { 1: 'an assertion inside the contract failed', 17: 'a number overflowed', 18: 'a division by zero', 33: 'an invalid enum value', 50: 'an array index out of bounds' };
        return panics[Number(code)] || ('a panic inside the contract (code ' + code + ')');
      }
    } catch (e) {}
    const withArgs = (parsedErr, words) => {
      const args = parsedErr.args.map((v) => String(v)).filter((v) => v !== '');
      return words + (args.length ? ' (' + args.join(', ') + ')' : '');
    };
    try { const e = ERR_IFACE.parseError(data); if (e) return withArgs(e, ERR_WORDS[e.name] || e.name); } catch (err) {}
    if (iface) { try { const e = iface.parseError(data); if (e) return withArgs(e, e.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()); } catch (err) {} }
    return ERR_BY_SELECTOR[sel] || ('the contract refused with ' + sel + ', which is a custom error this page does not know');
  }

  // ---------- reading a contract ----------
  const SLOTS = {
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc': 'implementation (EIP-1967)',
    '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103': 'admin (EIP-1967)',
    '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50': 'beacon (EIP-1967)',
    '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3': 'implementation (OpenZeppelin, older)',
  };
  const ERC165 = { '0x80ac58cd': 'ERC-721', '0xd9b67a26': 'ERC-1155', '0x5b5e139f': 'ERC-721 metadata', '0x780e9d63': 'ERC-721 enumerable', '0x2a55205a': 'ERC-2981 royalties' };

  // The testnet explorer allows a browser to read it directly. The mainnet one does not send the header that
  // permits that, so where this page is served by its own worker there is a read-only passthrough at /x/<chain>.
  // Try direct, then the passthrough, and remember which one answered.
  let explorerRoute = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Three outcomes, and the difference matters: it answered, it answered "no such thing", or it would not
  // answer at all. Reporting the third as the second would tell someone a contract has no published source
  // when the truth is that nobody could check.
  async function explorerJson(path) {
    let missing = false, reached = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const route of (explorerRoute ? [explorerRoute] : ['direct', 'proxy'])) {
        const url = route === 'direct' ? api(path) : '/x/' + chainId() + path;
        try {
          const r = await fetch(url, { headers: { accept: 'application/json' } });
          if (r.status === 404) { explorerRoute = route; missing = true; reached = true; continue; }
          if (!r.ok) continue;                       // 5xx: the explorer is up but unwell, try again
          const ct = String(r.headers.get('content-type') || '');
          if (!ct.includes('json')) continue;
          const j = await r.json();
          if (j && j.error === 'upstream') {
            explorerRoute = route; reached = true;
            if (Number(j.status) === 404) { missing = true; continue; }   // really not there
            continue;                                                     // reached, but it would not answer
          }
          explorerRoute = route; reached = true;
          return { ok: true, data: j };
        } catch (e) { continue; }
      }
      if (missing) return { ok: true, data: null };
      await wait(400 * (attempt + 1));
    }
    return { ok: reached, data: null };
  }

  // Everything worth knowing about one address, from the chain first and the explorer second. The chain
  // always answers; the explorer sometimes does not, and a page that falls over when it does not is useless.
  async function readAddress(addr) {
    const p = rp();
    const out = { address: ethers.getAddress(addr), code: '0x', verified: false, abi: null, name: null, proxy: null, token: null, standard: null, delegated: null };
    // A network error is not an answer. Treating one as "no code here" turns a live contract into "an
    // ordinary wallet" and, on a call, into "this does nothing at all": a false all-clear built out of a
    // timeout. Three states, and the unreadable one never becomes a conclusion.
    out.code = await p.getCode(out.address).then((c) => c, () => null);
    out.codeUnreadable = out.code === null;
    if (out.codeUnreadable) out.code = '0x';
    out.isContract = !out.codeUnreadable && out.code !== '0x';
    out.balance = await p.getBalance(out.address).catch(() => null);
    out.nonce = await p.getTransactionCount(out.address).catch(() => null);

    // An EIP-7702 wallet has code, but it is a wallet: 0xef0100 followed by the address it runs.
    if (out.code.length === 2 + 23 * 2 && out.code.slice(0, 8).toLowerCase() === '0xef0100') {
      out.delegated = ethers.getAddress('0x' + out.code.slice(8));
      out.isContract = false;
    }
    if (!out.isContract) return out;

    // A minimal proxy carries the address it forwards to in its own bytecode.
    const m = out.code.toLowerCase().match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/);
    if (m) out.proxy = { kind: 'minimal proxy (EIP-1167)', target: ethers.getAddress('0x' + m[1]) };
    if (!out.proxy) {
      for (const [slot, kind] of Object.entries(SLOTS)) {
        const v = await p.getStorage(out.address, slot).catch(() => null);
        if (v && /[1-9a-f]/.test(v.slice(26))) {
          const target = ethers.getAddress('0x' + v.slice(26));
          if (kind.startsWith('implementation') || kind.startsWith('beacon')) out.proxy = { kind, target };
          else out.admin = target;
        }
      }
    }

    const scRes = await explorerJson('/smart-contracts/' + out.address);
    const sc = scRes.data;
    if (!scRes.ok) { out.verified = null; out.explorerDown = true; }
    else if (!sc) { out.verified = false; }
    if (sc) {
      out.verified = !!sc.is_verified;
      out.name = sc.name || null;
      out.abi = sc.abi || null;
      out.compiler = sc.compiler_version || null;
      out.optimized = sc.optimization_enabled;
      out.evm = sc.evm_version || null;
      out.verifiedAt = sc.verified_at || null;
      out.partial = !!sc.is_partially_verified;
      if (!out.proxy && sc.proxy_type && sc.implementations && sc.implementations.length) {
        try {
          out.proxy = { kind: String(sc.proxy_type).replace(/_/g, ' '), target: ethers.getAddress(sc.implementations[0].address_hash || sc.implementations[0].address) };
        } catch (e) { /* an explorer answering with something that is not an address costs the proxy line, not the page */ }
      }
    }

    // Behind a proxy, the ABI that matters belongs to the code being run, not to the forwarder.
    if (out.proxy && out.proxy.target) {
      // A beacon is not the code either: it names the implementation, so follow one more step.
      if (String(out.proxy.kind).startsWith('beacon')) {
        let impl = null;
        try { impl = await new ethers.Contract(out.proxy.target, ['function implementation() view returns (address)'], p).implementation(); } catch (e) {}
        if (impl && impl !== ethers.ZeroAddress) { out.proxy.beacon = out.proxy.target; out.proxy.target = ethers.getAddress(impl); }
        else {
          // The beacon is a pointer, not the application code. Reading it as though it were would decode calls
          // against the wrong contract and call the beacon's own source "the code it runs".
          out.proxy.beacon = out.proxy.target; out.proxy.target = null;
          out.proxy.beaconUnread = true; out.proxy.verified = null;
          out.abi = null; out.implUnknown = true;
        }
      }
      // The forwarder's ABI describes the forwarder. Once this is known to be a proxy, that ABI is set aside
      // rather than left in place as a fallback: decoding a call against code that does not run it, and
      // labelling the result "the contract's published source", is worse than saying nothing.
      out.proxyOwnAbi = out.abi; out.abi = null;
      if (!out.proxy.target) { out.proxy.code = '0x'; }
      const res = out.proxy.target ? await explorerJson('/smart-contracts/' + out.proxy.target) : { ok: false, data: null };
      const impl = res.data;
      out.proxy.verified = res.ok ? !!(impl && impl.is_verified) : null;
      if (impl) {
        out.proxy.name = impl.name || null;
        // The forwarder's own ABI describes the forwarder. Everything this page says about what the contract
        // can do, and every piece of calldata it decodes, has to come from the code that actually runs.
        if (impl.abi && impl.abi.length) { out.abi = impl.abi; out.abiFrom = 'implementation'; }
      }
      if (out.proxy.target) {
        out.proxy.code = await p.getCode(out.proxy.target).then((c) => c, () => null);
        if (out.proxy.code === null) { out.proxy.codeUnreadable = true; out.proxy.code = '0x'; }
      }
      if (!out.abi) out.implUnknown = true;   // nothing to decode against but conventions
    }

    // What standard it claims, and its token facts, read from the contract rather than from a label.
    const c = new ethers.Contract(out.address, [
      'function supportsInterface(bytes4) view returns (bool)', 'function name() view returns (string)',
      'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)', 'function owner() view returns (address)',
      'function paused() view returns (bool)', 'function getTransferValidator() view returns (address)',
    ], p);
    for (const [id, label] of Object.entries(ERC165)) {
      if (id !== '0x80ac58cd' && id !== '0xd9b67a26') continue;
      try { if (await c.supportsInterface(id)) out.standard = label; } catch (e) {}
    }
    const [nm, sym, dec, sup, own, paused, validator] = await Promise.all([
      c.name().catch(() => null), c.symbol().catch(() => null), c.decimals().catch(() => null),
      c.totalSupply().catch(() => null), c.owner().catch(() => null), c.paused().catch(() => null),
      c.getTransferValidator().catch(() => null),
    ]);
    if (!out.standard && dec !== null) out.standard = 'ERC-20';
    out.token = { name: nm, symbol: sym, decimals: dec === null ? null : Number(dec), supply: sup };
    out.owner = own; out.paused = paused;
    out.validator = validator && validator !== ethers.ZeroAddress ? validator : null;
    return out;
  }

  // Every 4-byte selector the bytecode compares against. Not proof a function exists, but nothing a contract
  // can do is invisible here: unverified code still has to dispatch on the selectors it accepts.
  function selectorsIn(code) {
    const out = new Set();
    const hex = code.slice(2).toLowerCase();
    for (let i = 0; i + 10 <= hex.length; i += 2) {
      if (hex.slice(i, i + 2) === '63') out.add('0x' + hex.slice(i + 2, i + 10));
    }
    return out;
  }
  function knownFunctions(o) {
    const found = [];
    if (Array.isArray(o.abi) && o.abi.length) {
      for (const f of o.abi) {
        if (f.type !== 'function') continue;
        const sig = f.name + '(' + (f.inputs || []).map((i) => i.type).join(',') + ')';
        found.push({ sig, name: f.name, mutating: f.stateMutability !== 'view' && f.stateMutability !== 'pure' });
      }
      return { list: found, source: 'the published source', long: 'the published source', complete: true };
    }
    // No usable ABI: read the selectors the code itself dispatches on. A floor, never a ceiling.
    const sels = selectorsIn((o.proxy && o.proxy.code && o.proxy.code !== '0x') ? o.proxy.code : o.code);
    for (const s of sels) {
      const extra = EXTRA_SELECTORS[s];
      if (extra) { found.push({ sig: extra, name: extra.split('(')[0], mutating: true, guessed: true }); continue; }
      let frag = null; try { frag = KNOWN_IFACE.getFunction(s); } catch (e) {}
      if (frag) found.push({ sig: frag.format('sighash'), name: frag.name, mutating: frag.stateMutability !== 'view' && frag.stateMutability !== 'pure', guessed: true });
    }
    return { list: found, source: 'its bytecode', long: 'the contract’s own bytecode', complete: false };
  }
  function powersOf(fns) {
    const out = [];
    for (const f of fns) {
      if (!f.mutating) continue;
      for (const [re, what, cls] of POWERS) {
        if (re.test(f.name)) { out.push({ what, cls, sig: f.sig }); break; }
      }
    }
    const seen = new Set();
    return out.filter((p) => { const k = p.what + p.sig; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- saying what a call does, in a sentence ----------
  // 2^200 was a threshold picked to catch 2^256-1, and it catches almost nothing else: an approval of 2^199
  // is unlimited against every token that has ever existed and used to get no warning at all. Where the
  // supply is known, that is the honest comparison; where it is not, 2^128 is still far beyond any real one
  // (a token with eighteen decimals and a trillion units is about 2^100) while being reachable by an
  // approval meant to be forever.
  const UNLIMITED = (v) => { try { const n = BigInt(v); return n >= (1n << 200n); } catch (e) { return false; } };
  const BEYOND_ANY_SUPPLY = 1n << 128n;
  function unlimitedFor(v, token) {
    try {
      const n = BigInt(v);
      if (n <= 0n) return false;
      const sup = token && token.supply !== undefined && token.supply !== null ? BigInt(token.supply) : null;
      if (sup && sup > 0n) return n >= sup;
      return n >= BEYOND_ANY_SUPPLY;
    } catch (e) { return false; }
  }
  // Every shape that grants a standing allowance, and where the spender and the amount sit in each. Warning
  // on the selector meant `increaseAllowance` -- the standard route on tokens that make a bare approve
  // awkward -- and `permit` -- how an allowance is granted from a signature, with no transaction to inspect
  // beforehand -- both rendered as ordinary grey prose. The two most dangerous shapes had the weakest
  // treatment because the check was written for the one that is easiest to name.
  const APPROVAL_SHAPES = {
    'approve(address,uint256)': { spender: 0, amount: 1, how: '' },
    'increaseAllowance(address,uint256)': { spender: 0, amount: 1,
      how: 'It is granted through increaseAllowance rather than approve, which is the usual route on tokens that make a bare approve awkward, and it is the same standing permission. ' },
    'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)': { spender: 1, amount: 2,
      how: 'It is granted from a signature, so there is no separate approval transaction of your own to find afterwards. ' },
  };
  const unlimitedApproval = (p, token) => {
    const sh = p && p.signature ? APPROVAL_SHAPES[p.signature] : null;
    if (!sh || !p.args) return null;
    return unlimitedFor(p.args[sh.amount], token) ? { spender: p.args[sh.spender], how: sh.how } : null;
  };
  function fmtAmount(v, token) {
    if (UNLIMITED(v)) return 'an unlimited amount';
    if (token && token.decimals !== null && token.decimals !== undefined) {
      return ethers.formatUnits(v, token.decimals) + (token.symbol ? ' ' + token.symbol : '');
    }
    return String(v);
  }
  // ERC-20 and ERC-721 share transferFrom and approve. The number means completely different things in each,
  // so the standard has to be settled before the sentence is written.
  function describeCall(parsed, ctx) {
    const t = ctx.target || {};
    const nft = t.standard === 'ERC-721' || t.standard === 'ERC-1155';
    // Three states, not two. `standard` is null whenever supportsInterface and decimals() both went
    // unanswered, which covers plenty of unverified NFTs and covers everything when a node is flaky. Folding
    // null in with "not an NFT" wrote the ERC-20 sentence for a contract nobody had established was one,
    // while the argument labels three functions away correctly said "token id or amount". The page already
    // knew that it did not know; only the sentence a reader actually reads was pretending otherwise.
    const unsure = !t.standard;
    const eitherWay = ' This contract has not said which standard it follows, so that number is a token id '
      + 'or amount and this page cannot tell you which. One is a single item, the other is a quantity of '
      + 'them, and it will not guess between them.';
    const cut = (v, n) => { const x = String(v == null ? '' : v); return x.length > n ? x.slice(0, n) + '\u2026' : x; };
    const what = t.token && t.token.name ? cut(t.token.name, 60) : (t.name ? cut(t.name, 60) : 'this contract');
    const who = (a) => short(a);
    const amt = (v) => fmtAmount(v, t.token);
    const a = parsed.args;
    switch (parsed.signature) {
      case 'transfer(address,uint256)': return 'Send ' + amt(a[1]) + ' to ' + who(a[0]) + '.';
      case 'transferFrom(address,address,uint256)':
        return unsure ? 'Move ' + String(a[2]) + ' of ' + what + ' from ' + who(a[0]) + ' to ' + who(a[1]) + '.' + eitherWay
             : nft ? 'Move ' + what + ' #' + a[2] + ' from ' + who(a[0]) + ' to ' + who(a[1]) + '.'
                   : 'Move ' + amt(a[2]) + ' from ' + who(a[0]) + ' to ' + who(a[1]) + '.';
      case 'approve(address,uint256)':
        return unsure ? 'Let ' + who(a[0]) + ' take ' + String(a[1]) + ' of your ' + what + ', now and at any time in the future, until you take it back.' + eitherWay
             : nft ? 'Let ' + who(a[0]) + ' move ' + what + ' #' + a[1] + '. It stays allowed until you take it back.'
                   : 'Let ' + who(a[0]) + ' spend ' + amt(a[1]) + ' of your ' + what + ', now and at any time in the future, until you take it back.';
      case 'increaseAllowance(address,uint256)': return 'Let ' + who(a[0]) + ' spend ' + amt(a[1]) + ' more of your ' + what + '.';
      case 'decreaseAllowance(address,uint256)': return 'Reduce what ' + who(a[0]) + ' may spend of your ' + what + ' by ' + amt(a[1]) + '.';
      case 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)':
        return 'Use a signature from ' + who(a[0]) + ' to let ' + who(a[1]) + ' spend ' + amt(a[2]) + ' of their ' + what + '.';
      case 'safeTransferFrom(address,address,uint256)':
      case 'safeTransferFrom(address,address,uint256,bytes)':
        return 'Move ' + what + ' #' + a[2] + ' from ' + who(a[0]) + ' to ' + who(a[1]) + ', refusing if the recipient cannot hold it.';
      case 'safeTransferFrom(address,address,uint256,uint256,bytes)':
        return 'Move ' + a[3] + ' of ' + what + ' id ' + a[2] + ' from ' + who(a[0]) + ' to ' + who(a[1]) + '.';
      case 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)':
        return 'Move ' + a[2].length + ' different ids of ' + what + ' from ' + who(a[0]) + ' to ' + who(a[1]) + '.';
      case 'setApprovalForAll(address,bool)':
        return a[1] ? 'Let ' + who(a[0]) + ' move every ' + what + ' you own, including any you buy later, until you take it back.'
                    : 'Stop ' + who(a[0]) + ' from moving your ' + what + '.';
      case 'mint(address,uint256)': return nft ? 'Create ' + what + ' #' + a[1] + ' and give it to ' + who(a[0]) + '.' : 'Create ' + amt(a[1]) + ' and give it to ' + who(a[0]) + '.';
      case 'mint(uint256)': case 'publicMint(uint256)': return 'Mint ' + a[0] + ' of ' + what + '.';
      case 'mint()': return 'Mint one of ' + what + '.';
      case 'safeMint(address,uint256)': return 'Create ' + what + ' #' + a[1] + ' for ' + who(a[0]) + '.';
      case 'burn(uint256)': return nft ? 'Destroy ' + what + ' #' + a[0] + ' for good.' : 'Destroy ' + amt(a[0]) + ' for good.';
      case 'burnFrom(address,uint256)': return 'Destroy ' + amt(a[1]) + ' held by ' + who(a[0]) + '.';
      case 'transferOwnership(address)': return 'Hand control of ' + what + ' to ' + who(a[0]) + '.';
      case 'renounceOwnership()': return 'Give up control of ' + what + ', permanently and with no way back.';
      case 'grantRole(bytes32,address)': return 'Give ' + who(a[1]) + ' a privileged role on ' + what + '.';
      case 'revokeRole(bytes32,address)': return 'Take a privileged role away from ' + who(a[1]) + '.';
      case 'pause()': return 'Stop all transfers of ' + what + '.';
      case 'unpause()': return 'Allow transfers of ' + what + ' again.';
      case 'setPaused(bool)': return (a[0] ? 'Stop' : 'Allow') + ' transfers of ' + what + '.';
      case 'upgradeTo(address)': case 'upgradeToAndCall(address,bytes)':
        return 'Replace the code behind ' + what + ' with the code at ' + who(a[0]) + '.';
      case 'setTransferValidator(address)': return 'Change who is allowed to move ' + what + ' to the rules at ' + who(a[0]) + '.';
      case 'withdraw()': return 'Take the contract’s balance out.';
      case 'withdraw(uint256)': return 'Take ' + ethers.formatEther(a[0]) + ' ETH out of the contract.';
      case 'deposit()': return 'Put ETH into the contract.';
      case 'multicall(bytes[])': return 'Run ' + a[0].length + ' separate calls on ' + what + ' in one transaction.';
      case 'execute(address,uint256,bytes)': return 'Have ' + what + ' call ' + who(a[0]) + ' with ' + ethers.formatEther(a[1]) + ' ETH attached.';
      case 'setBaseURI(string)': return 'Change where the art and metadata for ' + what + ' is served from.';
      default: break;
    }
    if (parsed.name && parsed.name.startsWith('airdrop')) {
      const n = Array.isArray(a[1]) ? a[1].length : 0;
      const moved = (ctx.moved && (ctx.moved.name || ctx.moved.symbol)) || short(a[0]);
      return 'Send ' + n + ' transfer' + (n === 1 ? '' : 's') + ' of ' + moved + ' to ' + n + ' address' + (n === 1 ? '' : 'es') + ' in one transaction.';
    }
    return null;
  }

  // ---------- decoding a piece of calldata against whatever ABI we can get ----------
  function parseData(data, abi) {
    if (!data || data === '0x') return { empty: true };
    const tryWith = (iface, source) => {
      try {
        const tx = iface.parseTransaction({ data });
        if (!tx) return null;
        // Decoding ignores anything after the arguments it expected. A contract reading msg.data directly
        // does not, so bytes nobody is shown are bytes that can carry meaning.
        let extra = 0;
        try {
          const canonical = iface.encodeFunctionData(tx.fragment, tx.args);
          if (data.length > canonical.length) extra = (data.length - canonical.length) / 2;
        } catch (e) {}
        return { name: tx.name, signature: tx.fragment.format('sighash'), args: tx.args, fragment: tx.fragment, source, extra };
      } catch (e) {}
      return null;
    };
    if (abi) { const r = tryWith(new ethers.Interface(abi), 'the interface this contract publishes'); if (r) return r; }
    const r = tryWith(KNOWN_IFACE, 'the shape of a standard this page recognises');
    if (r) return r;
    return { unknown: true, selector: data.slice(0, 10), rest: data.slice(10) };
  }

  // ---------- calls carried inside other calls ----------
  // multicall, execute and upgradeToAndCall carry whole calls in a bytes argument. Rendering that argument as
  // a hex blob under a card titled "everything it is asking for" is how an unlimited approval travels
  // unremarked. Decoded to a bounded depth, with the outer target carried down where the standard implies it.
  function innerCalls(parsed, target) {
    if (!parsed || !parsed.args) return [];
    const out = [];
    const push = (to, data, value) => { if (typeof data === 'string' && data.length >= 10) out.push({ to, data, value: value || 0n }); };
    if (parsed.signature === 'multicall(bytes[])') for (const d of parsed.args[0]) push(target, d);
    if (parsed.signature === 'execute(address,uint256,bytes)') push(parsed.args[0], parsed.args[2], parsed.args[1]);
    if (parsed.signature === 'upgradeToAndCall(address,bytes)') push(target, parsed.args[1]);
    return out;
  }
  // Renders each nested call the way the outer one is described, so a warning cannot hide one level down.
  const MAX_INNER_DEPTH = 6;
  async function renderInner(parsed, target, depth) {
    const d = depth || 0;
    const inner = innerCalls(parsed, target && target.address);
    if (!inner.length) return null;
    // A limit has to exist, and it has to be visible. Returning null at the cutoff is how an approval five
    // levels down disappears from a page that has just said the carried calls are all listed.
    if (d >= MAX_INNER_DEPTH) {
      return note('bad', inner.length + ' more call' + (inner.length === 1 ? '' : 's') + ' below this point are NOT shown',
        'They are nested deeper than this page will follow. Nothing above accounts for what they do, so treat this transaction as unexplained. The raw calldata is at the bottom of the page and contains all of it.');
    }
    const rows = [];
    for (const c of inner) {
      const t = ethers.isAddress(String(c.to || '')) ? await readAddress(c.to).catch(() => null) : null;
      const p = parseData(c.data, t && t.abi);
      const sentence = p.unknown || p.empty ? null : describeCall(p, { target: t });
      rows.push(h('div', { class: 'move' }, [
        h('div', { text: sentence || (p.unknown ? 'A call this page cannot name: ' + p.selector : p.signature) }),
        h('div', { class: 'mut mono', text: 'to ' + short(String(c.to || '?')) + (c.value ? '  with ' + ethers.formatEther(c.value) + ' ETH' : '') }),
        unlimitedApproval(p, t && t.token)
          ? h('div', { class: 'bad', text: 'This inner call is an unlimited approval.' }) : null,
        (p.signature === 'setApprovalForAll(address,bool)' && p.args[1])
          ? h('div', { class: 'bad', text: 'This inner call hands over a whole collection.' }) : null,
        p.extra ? h('div', { class: 'bad', text: 'This inner call carries ' + p.extra + ' bytes beyond its arguments, which nothing here can account for.' }) : null,
        t && t.codeUnreadable ? h('div', { class: 'bad', text: 'The code at that address could not be read, so nothing about this call is settled.' }) : null,
        h('details', {}, [h('summary', { class: 'mut', text: 'raw bytes' }), h('pre', { text: (String(c.data).slice(2).match(/.{1,64}/g) || []).join('\n') })]),
        await renderInner(p, t, d + 1),
      ]));
    }
    return card('Calls carried inside this one', rows);
  }

  // ---------- what a receipt or a simulation actually moved ----------
  async function movements(logs, ctx) {
    const out = [];
    const cache = ctx.tokenCache || (ctx.tokenCache = new Map());
    const tokenOf = async (addr) => {
      const key = addr.toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const c = new ethers.Contract(addr, ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'], rp());
      const [name, symbol, decimals] = await Promise.all([c.name().catch(() => null), c.symbol().catch(() => null), c.decimals().catch(() => null)]);
      const t = { name, symbol, decimals: decimals === null ? null : Number(decimals) };
      cache.set(key, t); return t;
    };
    const addr20 = (topic) => ethers.getAddress('0x' + String(topic).slice(26));
    for (const l of logs) {
      const t0 = (l.topics && l.topics[0]) || '';
      const sig = EV[t0];
      if (!sig) continue;
      const where = ethers.getAddress(l.address);
      // With traceTransfers on, plain ETH movements arrive as Transfer logs from the zero address.
      const isEth = where === ethers.ZeroAddress;
      const token = isEth ? { name: 'ETH', symbol: 'ETH', decimals: 18 } : await tokenOf(where);
      if (sig.startsWith('Transfer(')) {
        // Three indexed topics means a token id; two means an amount.
        const nft = l.topics.length === 4;
        const from = addr20(l.topics[1]), to = addr20(l.topics[2]);
        const v = nft ? BigInt(l.topics[3]) : BigInt(l.data || '0x0');
        out.push({ kind: nft ? 'nft' : 'amount', where, isEth, token, from, to, value: v });
      } else if (sig.startsWith('TransferSingle')) {
        const [, from, to] = [l.topics[1], l.topics[2], l.topics[3]];
        const [id, amount] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], l.data);
        out.push({ kind: 'edition', where, token, from: addr20(from), to: addr20(to), id, value: amount });
      } else if (sig.startsWith('TransferBatch')) {
        const [ids, amounts] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256[]'], l.data);
        for (let i = 0; i < ids.length; i++) out.push({ kind: 'edition', where, token, from: addr20(l.topics[2]), to: addr20(l.topics[3]), id: ids[i], value: amounts[i] });
      } else if (sig.startsWith('Approval(')) {
        const nft = l.topics.length === 4;
        out.push({ kind: 'approval', where, token, from: addr20(l.topics[1]), to: addr20(l.topics[2]), value: nft ? BigInt(l.topics[3]) : BigInt(l.data || '0x0'), nft });
      } else if (sig.startsWith('ApprovalForAll')) {
        const on = BigInt(l.data || '0x0') !== 0n;
        out.push({ kind: 'approvalAll', where, token, from: addr20(l.topics[1]), to: addr20(l.topics[2]), on });
      } else {
        out.push({ kind: 'event', where, token, sig: sig.split('(')[0] });
      }
    }
    return out;
  }

  // Every line here comes from an event the contract chose to emit. An honest token emits one for each real
  // movement, which is why this is worth reading; a dishonest one can emit a transfer that never happened, or
  // move balances and emit nothing at all. So this section reports what was announced, and never concludes
  // from silence that nothing happened.
  function renderMovements(moves, me, senderLabel, unknown) {
    if (unknown) return h('p', { class: 'warn', text: unknown });
    if (!moves.length) return h('p', { class: 'mut', text: 'No standard transfer or approval events were emitted. Most tokens emit one for every movement, so usually that means nothing moved \u2014 but a token that moves balances without announcing it would look exactly like this too.' });
    const mine = (a) => me && a && a.toLowerCase() === me.toLowerCase();
    const outWords = senderLabel ? '  — out of ' + senderLabel : '  — out of your wallet';
    const inWords = senderLabel ? '  — into ' + senderLabel : '  — into your wallet';
    return h('div', {}, moves.map((m) => {
      const name = m.token.symbol || m.token.name || short(m.where);
      let line;
      if (m.kind === 'nft') line = name + ' #' + m.value + ' goes from ' + short(m.from) + ' to ' + short(m.to);
      else if (m.kind === 'edition') line = String(m.value) + ' × ' + name + ' id ' + m.id + ' goes from ' + short(m.from) + ' to ' + short(m.to);
      else if (m.kind === 'amount') line = fmtAmount(m.value, m.token) + (m.isEth ? '' : ' ' + (m.token.symbol ? '' : name)) + ' goes from ' + short(m.from) + ' to ' + short(m.to);
      else if (m.kind === 'approval') line = short(m.from) + ' lets ' + short(m.to) + (m.nft ? ' move ' + name + ' #' + m.value : ' spend ' + fmtAmount(m.value, m.token) + ' of ' + name);
      else if (m.kind === 'approvalAll') line = short(m.from) + (m.on ? ' lets ' : ' stops ') + short(m.to) + (m.on ? ' move every ' + name + ' they own' : ' moving their ' + name);
      else line = name + ' emits ' + m.sig;
      // Three indexed arguments is the ERC-721 shape and two is the ERC-20 shape, but the emitter chooses its
      // own topics, so this is a reading of the event rather than a fact about the token.
      const dir = mine(m.from) ? 'out' : mine(m.to) ? 'in' : '';
      return h('div', { class: 'move ' + dir }, document.createTextNode(line + (mine(m.from) ? outWords : mine(m.to) ? inWords : '')));
    }));
  }

  // ---------- simulating a call that has not been sent ----------
  // eth_simulateV1 runs the call against the current state and hands back the logs it would emit, so a preview
  // can say what would actually move rather than what the function is named.
  const oneResult = (r) => {
    // A revert's reason arrives under error.data; returnData is empty for a failed call.
    const reason = (r.error && r.error.data) || r.returnData || '0x';
    return { ok: r.status === '0x1', gasUsed: BigInt(r.gasUsed || 0), logs: r.logs || [], returnData: r.returnData || '0x', reason, error: r.error || null };
  };
  const asCall = (c) => ({
    from: c.from || ethers.ZeroAddress,
    to: c.to,
    data: c.data || '0x',
    value: c.value ? ethers.toBeHex(BigInt(c.value)) : '0x0',
  });
  async function simulate(call) {
    const res = await rp().send('eth_simulateV1', [{ blockStateCalls: [{ calls: [asCall(call)] }], traceTransfers: true, validation: false }, 'latest']);
    const r = res && res[0] && res[0].calls && res[0].calls[0];
    if (!r) throw new Error('the node returned nothing to read');
    return oneResult(r);
  }
  // A batch executes in order, and each call sees what the ones before it did. Simulating them separately
  // against the same starting state can say every one succeeds when the real batch reverts on the second,
  // which is the exact question someone pastes a batch here to answer.
  async function simulateInOrder(calls) {
    const res = await rp().send('eth_simulateV1', [{
      blockStateCalls: [{ calls: calls.map(asCall) }], traceTransfers: true, validation: false,
    }, 'latest']);
    const rs = (res && res[0] && res[0].calls) || [];
    if (rs.length !== calls.length) throw new Error('the node did not answer for every call');
    return rs.map(oneResult);
  }

  // ---------- the three things this page can be asked ----------
  const out = (...kids) => { const o = $('out'); o.textContent = ''; for (const k of kids) if (k) o.appendChild(k); };
  // Renders only if this is still the question being asked. `seq` is captured when the lookup starts.
  const outIf = (seq, ...kids) => { if (seq !== activeLookup) return; out(...kids); };

  async function showTransaction(hash, viewer, seq) {
    say('Reading that transaction…');
    const p = rp();
    const [tx, rc] = await Promise.all([p.getTransaction(hash).catch(() => null), p.getTransactionReceipt(hash).catch(() => null)]);
    if (stale(seq)) return;
    if (!tx && !rc) { say('No transaction with that hash on ' + cfg().name + '. It may be on the other network, or not mined yet.', 'bad'); out(); return; }
    const target = tx && tx.to ? await readAddress(tx.to) : null;
    // `empty` is this page's word for "this transaction really carried no calldata". Using it for "I could
    // not read the calldata" says the opposite of the truth, and the renderer cannot tell them apart: a node
    // that returns the receipt but not the body (ethers batches both into one HTTP request, and a pruning
    // node drops the body while keeping the receipt) produced "A plain transfer of ETH, with no contract
    // call" printed directly above a movements list showing an unlimited approval. A false all-clear built
    // out of a missing answer is the one thing this page exists to not do.
    const parsed = tx ? parseData(tx.data, target && target.abi) : { bodyMissing: true };
    const ctx = { target };
    // An airdrop moves a different contract than the one it calls, so read that one for its name.
    if (parsed && parsed.args && parsed.name && parsed.name.startsWith('airdrop') && ethers.isAddress(String(parsed.args[0] || ''))) {
      const moved = await readAddress(parsed.args[0]).catch(() => null);
      if (moved) ctx.moved = moved.token && (moved.token.name || moved.token.symbol) ? moved.token : null;
    }
    const sentence = parsed && !parsed.unknown && !parsed.empty ? describeCall(parsed, ctx) : null;
    const moves = rc ? await movements(rc.logs, ctx) : [];
    const failed = rc && rc.status === 0;

    // A receipt says a transaction failed but not why. Running it again against today's state usually does.
    let why = null;
    if (failed) {
      const ex = (await explorerJson('/transactions/' + hash)).data;
      if (ex && ex.revert_reason) why = typeof ex.revert_reason === 'string' ? ex.revert_reason : decodeRevert(ex.revert_reason.raw || '0x', target && target.abi ? new ethers.Interface(target.abi) : null);
      if (!why) {
        try { const s = await simulate({ from: tx.from, to: tx.to, data: tx.data, value: tx.value }); if (!s.ok) why = decodeRevert(s.reason, target && target.abi ? new ethers.Interface(target.abi) : null); }
        catch (e) {}
      }
    }
    const fee = rc ? rc.gasUsed * (rc.gasPrice ?? 0n) : null;
    if (stale(seq)) return;
    say('');
    out(
      card(null,
        h('p', { class: 'lede', text: sentence || (parsed.bodyMissing ? 'This node returned the receipt for that transaction but not the transaction itself, so what it was asked to do cannot be read.' : parsed.empty ? 'A plain transfer of ETH, with no contract call.' : parsed.unknown ? 'A call this page cannot name: the contract has published no source and the function is not a standard one.' : parsed.signature) }),
        sentence ? readingCaption(target) : null,
        parsed.bodyMissing ? note('warn', 'What is below is only what the receipt says',
          'The receipt is real and so is everything it announced moving, which is shown below. What is missing is the '
          + 'call itself: which contract was asked, which function, and with what arguments. Do not read the absence of '
          + 'that as "nothing was called". Try another node, or the explorer, before concluding anything.') : null,
        h('div', {}, [
          h('span', { class: 'pill ' + (failed ? 'bad' : (parsed.bodyMissing ? '' : 'ok')),
                       text: failed ? 'failed' : rc ? (parsed.bodyMissing ? 'executed without reverting' : 'succeeded') : 'not mined yet' }),
          tx && tx.value > 0n ? h('span', { class: 'pill warn', text: ethers.formatEther(tx.value) + ' ETH attached' }) : null,
          parsed.source ? h('span', { class: 'pill', text: 'read against ' + parsed.source }) : null,
        ]),
        failed && why ? note('bad', 'Why it failed', why) : null,
        kv([
          ['From', link(tx ? tx.from : rc.from, short(tx ? tx.from : rc.from))],
          // "a new contract" is what an absent `to` means on a transaction that was read. On one that was not
          // read it means nothing at all, and saying it invents a third false statement for the headline.
          ['To', tx && tx.to ? h('span', {}, link(tx.to, short(tx.to)), document.createTextNode(' '), h('span', { class: 'mut', text: (target && (target.token && target.token.name || target.name)) || (target && target.isContract ? 'a contract' : 'a wallet') }))
                : parsed.bodyMissing ? 'not known: this node did not return the transaction' : 'a new contract'],
          tx ? ['Function', mono(parsed.signature || (parsed.empty ? 'none' : parsed.selector))] : null,
          rc ? ['Gas paid', ethers.formatEther(fee) + ' ETH' + (ethUsd ? '  (about $' + (Number(ethers.formatEther(fee)) * ethUsd).toFixed(4) + ')' : '')] : null,
          rc ? ['Block', String(rc.blockNumber)] : null,
          ['Hash', link(hash, short(hash), 'tx')],
        ]),
      ),
      card(rc ? 'What it announced moving' : 'What moved',
        renderMovements(moves, viewer || (tx && tx.from), viewer ? null : 'the sender\u2019s wallet',
          rc ? null : 'This transaction has not been mined, so there is no receipt to read and no way to say what it moved. It may still be waiting, and it may still do everything it was asked to do.')),
      parsed && parsed.args && parsed.args.length ? card('The arguments it was given', renderArgs(parsed, target)) : null,
      await renderInner(parsed, target, 0),
      target ? contractCard(target, 'The contract it called') : null,
    );
  }

  function renderArgs(parsed, target) {
    const names = (parsed.fragment && parsed.fragment.inputs) || [];
    const std = target && target.standard;
    const relabel = (n) => n !== 'idOrAmount' ? n : (std === 'ERC-721' ? 'token id' : std === 'ERC-20' ? 'amount' : 'token id or amount');
    return h('dl', { class: 'kv' }, parsed.args.flatMap((v, i) => {
      const label = relabel((names[i] && names[i].name) || ('argument ' + (i + 1)));
      const type = (names[i] && names[i].type) || '';
      let shown;
      if (Array.isArray(v)) shown = v.length > 12 ? v.slice(0, 12).map(String).join(', ') + ' … and ' + (v.length - 12) + ' more' : v.map(String).join(', ');
      else if (type === 'bool') shown = v ? 'yes' : 'no';
      else if (UNLIMITED(v) && type.startsWith('uint')) shown = String(v) + '  (effectively unlimited)';
      else shown = String(v);
      return [h('dt', { text: label + (type ? ' · ' + type : '') }), h('dd', { class: 'mono', text: shown })];
    }));
  }

  function contractCard(o, title) {
    if (o.codeUnreadable) {
      return card(title || 'This address', [
        h('div', {}, h('span', { class: 'pill bad', text: 'the chain would not say' })),
        note('bad', 'This page could not read the code at this address',
          'The node did not answer, so there is no way to tell from here whether this is a wallet, a contract, or an upgraded wallet, and nothing below could be worked out without that. This is not evidence that the address is empty. Try again in a moment.'),
        kv([['Address', link(o.address, o.address)]]),
      ]);
    }
    if (!o.isContract) {
      return card(title || 'This address', kv([
        ['What it is', o.delegated ? 'a wallet running delegated code (EIP-7702)' : 'an ordinary wallet, with no code'],
        o.delegated ? ['Runs the code at', link(o.delegated, short(o.delegated))] : null,
        ['Balance', o.balance === null ? 'unknown' : ethers.formatEther(o.balance) + ' ETH'],
        ['Transactions sent', o.nonce === null ? 'unknown' : String(o.nonce)],
        ['Address', link(o.address, o.address)],
      ]));
    }
    const fns = knownFunctions(o);
    const powers = powersOf(fns.list);
    return card(title || 'The contract', [
      h('div', {}, [
        // For a proxy this describes the implementation, because that is the code that runs. A verified
        // forwarder in front of unverified code is not a verified contract.
        h('span', { class: 'pill ' + (o.proxy
              ? (o.proxy.verified ? 'ok' : o.proxy.verified === null ? 'warn' : 'bad')
              : (o.verified ? 'ok' : o.verified === null ? 'warn' : 'bad')),
          text: o.proxy
            ? (o.proxy.verified ? 'the code it runs has published source'
              : o.proxy.verified === null ? 'could not check the code it runs'
              : 'the code it runs has published no source')
            : (o.verified ? (o.partial ? 'source published, partly matched' : 'source published and matched')
              : o.verified === null ? 'could not check for a published source' : 'no source published') }),
        o.standard ? h('span', { class: 'pill', text: o.standard }) : null,
        o.proxy ? h('span', { class: 'pill warn', text: 'proxy: the code can be swapped' }) : null,
        o.paused === true ? h('span', { class: 'pill bad', text: 'transfers are paused right now' }) : null,
        o.validator ? h('span', { class: 'pill warn', text: 'transfers are gated by a validator' }) : null,
        o.explorerDown ? h('span', { class: 'pill warn', text: 'the explorer would not answer' }) : null,
      ]),
      kv([
        ['Name', (o.token && o.token.name) || o.name || 'not published'],
        o.token && o.token.symbol ? ['Symbol', o.token.symbol] : null,
        o.token && o.token.decimals !== null && o.token.decimals !== undefined ? ['Decimals', String(o.token.decimals)] : null,
        o.token && o.token.supply !== null && o.token.supply !== undefined ? ['Total supply', o.token.decimals !== null && o.standard === 'ERC-20' ? ethers.formatUnits(o.token.supply, o.token.decimals) : String(o.token.supply)] : null,
        o.owner ? ['Owner', o.owner === ethers.ZeroAddress
          ? 'nobody. That often means ownership was given up, but plenty of contracts gate privileged functions on roles or their own rules instead, so on its own it does not mean nobody can use them.'
          : link(o.owner, short(o.owner))] : null,
        o.proxy ? ['Proxy', h('span', {},
          document.createTextNode(o.proxy.kind + (o.proxy.beacon ? ' via beacon ' + short(o.proxy.beacon) : '') + ' \u2192 '),
          o.proxy.target ? link(o.proxy.target, short(o.proxy.target)) : h('span', { class: 'bad', text: 'unknown: the beacon would not name the code it points at' }),
          document.createTextNode(o.proxy.verified === false ? '  (the code it runs has no published source)'
            : o.proxy.verified === null ? '  (could not check whether that code has published source)' : ''),
          o.proxy.beaconUnread ? document.createTextNode('  (the beacon would not say which implementation it points at)') : null)] : null,
        o.abiFrom === 'implementation' ? ['Read from', 'the implementation\u2019s published source, not the forwarder\u2019s'] : null,
        o.admin ? ['Proxy admin', link(o.admin, short(o.admin))] : null,
        o.validator ? ['Transfer validator', link(o.validator, short(o.validator))] : null,
        o.verified ? ['Compiled with', (o.compiler || '') + (o.optimized ? ', optimizer on' : '') + (o.evm ? ', ' + o.evm : '')] : null,
        ['Code size', String((o.code.length - 2) / 2) + ' bytes'],
        ['Address', link(o.address, o.address)],
      ]),
      o.validator ? note('warn', 'This collection controls who may move it',
        'A creator transfer validator is set, so transfers only go through operators the creator has allowed. Marketplaces and bulk senders that are not on that list will be refused, and there is nothing a holder can do about it from their side.') : null,
      // This page matches function NAMES against a list of names that usually mean something. A name is not
      // a behaviour: a back door called `rebalance` matches nothing here, and a function called `mint` might
      // do nothing at all. So a match is worth showing, and the absence of a match proves nothing whatsoever.
      // Saying otherwise would be the most dangerous sentence on the page.
      powers.length
        ? h('div', {}, [
            h('p', { class: 'mut', text: 'Function names in ' + fns.long + ' that usually mean the people behind a contract can do this:' }),
            h('ul', { class: 'plain' }, powers.map((p) => h('li', { class: p.cls === 'mut' ? '' : p.cls }, document.createTextNode(p.what + ' '), h('span', { class: 'mut mono', text: '(' + p.sig + ')' })))),
            o.owner && o.owner !== ethers.ZeroAddress ? h('p', { class: 'mut', text: 'A function called owner() answers ' + short(o.owner) + '. Whether that address is the one allowed to call the functions above depends on code this page has not read.' }) : null,
            null,   // the zero-owner hedge now travels with the Owner row itself, so it renders in both branches
          ])
        : h('p', { class: 'mut', text: 'No function name in ' + fns.long + ' matched the short list of names this page recognises.' }),
      h('div', { class: 'note warn' }, [
        h('b', { text: 'What this section is, and is not' }),
        document.createTextNode(fns.complete
          ? 'It matches function names against a list. It cannot tell you what those functions do, and a function that can take your tokens does not have to be called anything in particular. Nothing matching above means nothing matched, not that there is nothing to find. To know what this contract does, read it: '
          : (o.verified === false
              ? 'No source has been published, so this is the set of 4-byte selectors the bytecode dispatches on, matched against names this page knows. '
              : 'This page had no source to read, so this is the set of 4-byte selectors the bytecode dispatches on, matched against names it knows. ')
            + 'It is a floor and never a ceiling: whatever else the contract can do is in there too, unnamed. '),
        fns.complete ? link(o.address, 'the verified source on the explorer') : null,
        o.partial ? document.createTextNode('  This contract is only partially verified, so even the published source may not be all of the code that runs.') : null,
      ]),
      o.verified === false ? note('warn', 'No source has been published',
        'The bytecode is public and this page has read it, but nobody has shown which source code produced it. Nobody outside the people who deployed it knows what this contract does.') : null,
      o.verified === null ? note('warn', 'Whether the source is published is unknown',
        'The block explorer did not answer, so this page could not ask. Everything above was read from the chain itself, which always answers, but it cannot tell you whether the source code behind this contract has been published. Try again in a minute.') : null,
    ]);
  }

  async function showAddress(addr, seq) {
    say('Reading that address…');
    const o = await readAddress(addr);
    if (stale(seq)) return;
    say('');
    out(contractCard(o, o.isContract ? 'This contract' : 'This address'));
  }

  // Everything worth saying about one call, in one place, so the single-call view, a call inside a pasted
  // batch and a call carried inside another all say the same things about the same bytes.
  function callWarnings(parsed, target, sim, from) {
    const w = [];
    const unl = unlimitedApproval(parsed, target && target.token);
    if (unl)
      w.push(['bad', 'This is an unlimited approval', 'It lets ' + short(unl.spender)
        + ' take that token out of your wallet at any point in the future, in any amount, without asking again. '
        + unl.how + 'Approving only what you are spending right now costs the same gas.']);
    if (parsed.signature === 'setApprovalForAll(address,bool)' && parsed.args[1])
      w.push(['bad', 'This hands over the whole collection', 'Not one NFT: every one you hold now and every one you ever hold in this collection, until you revoke it.']);
    if (parsed.signature && /^(transferOwnership|renounceOwnership|upgradeTo)/.test(parsed.signature))
      w.push(['warn', 'This changes who controls the contract', 'Read the address it is being handed to before signing.']);
    if (parsed.extra)
      w.push(['bad', 'This call carries ' + parsed.extra + ' bytes nobody is shown', 'The arguments account for all of it except those bytes. A contract that reads its own calldata directly can act on them, and no wallet or explorer will show them to you.']);
    if (parsed.signature === 'multicall(bytes[])' || parsed.signature === 'execute(address,uint256,bytes)')
      w.push(['warn', 'This call carries other calls inside it', 'They are listed below, decoded the same way. Read those, not just this one.']);
    if (target && target.codeUnreadable)
      w.push(['bad', 'The code at that address could not be read', 'The node did not answer, so nothing on this page can tell you what is there. Try again in a moment rather than acting on this.']);
    else if (target && !target.isContract && !target.delegated)
      w.push(['bad', 'There is no contract at that address', 'A call to an address with no code does nothing at all and still costs gas. Check the address.']);
    if (target && target.isContract && target.verified === false)
      w.push(['warn', 'The contract you are calling has published no source', 'You can still see what it did in the simulation, but not what it will do under other conditions.']);
    if (target && target.isContract && target.verified === null)
      w.push(['warn', 'Nobody could check whether this contract\u2019s source is published', 'The block explorer did not answer.']);
    if (target && target.proxy)
      w.push(['warn', 'This contract can be replaced', target.proxy.target
        ? 'It forwards to ' + short(target.proxy.target) + ', and whoever controls it can point it somewhere else after you sign.'
        : 'It forwards to code this page could not identify, so what it would run is unknown.']);
    if (target && target.implUnknown)
      w.push(['warn', 'The code behind this proxy published nothing to read against', 'The sentence above is a reading of conventions, not of the code that would run.']);
    if (sim && !sim.ok)
      w.push(['bad', 'This would fail right now', decodeRevert(sim.reason, target && target.abi ? new ethers.Interface(target.abi) : null)]);
    if (!from)
      w.push(['warn', 'Nobody was named as the sender', 'The preview ran as the zero address, so anything that depends on who is asking may come out differently for you. Put your address in the box above.']);
    return w;
  }

  async function showCall(to, data, from, value, seq) {
    say('Working out what that would do…');
    const target = await readAddress(to);
    const parsed = parseData(data, target.abi);
    const ctx = { target };
    const sentence = parsed.unknown || parsed.empty ? null : describeCall(parsed, ctx);
    let sim = null, simErr = null;
    try { sim = await simulate({ to, data, from, value }); } catch (e) { simErr = String(e.message || e).slice(0, 160); }
    const moves = sim ? await movements(sim.logs, ctx) : [];
    const warnings = callWarnings(parsed, target, sim, from);
    if (stale(seq)) return;
    say('');
    out(
      card(null,
        h('p', { class: 'lede', text: sentence || (parsed.unknown ? 'A call this page cannot name: the contract has published no source and the function is not a standard one.' : parsed.empty ? 'No calldata: this is a plain transfer of ETH.' : parsed.signature) }),
        sentence ? readingCaption(target) : null,
        h('div', {}, [
          sim ? h('span', { class: 'pill ' + (sim.ok ? 'ok' : 'bad'), text: sim.ok ? 'would succeed' : 'would fail' }) : h('span', { class: 'pill', text: 'could not be simulated' }),
          value && BigInt(value) > 0n ? h('span', { class: 'pill warn', text: ethers.formatEther(BigInt(value)) + ' ETH attached' }) : null,
          sim ? h('span', { class: 'pill', text: 'about ' + sim.gasUsed.toString() + ' gas' }) : null,
          parsed.source ? h('span', { class: 'pill', text: 'read against ' + parsed.source }) : null,
          target && target.implUnknown ? h('span', { class: 'pill warn', text: 'the code behind this proxy published nothing to read against' }) : null,
        ]),
        simErr ? note('warn', 'The node would not run the preview', simErr) : null,
        warnings.map(([cls, title, body]) => note(cls, title, body)),
      ),
      sim ? card('What it would announce moving', renderMovements(moves, from)) : null,
      parsed.args && parsed.args.length ? card('The arguments it is asking for', renderArgs(parsed, target)) : null,
      await renderInner(parsed, target, 0),
      // Always available, decoded or not: a friendly sentence is a reading of the bytes, not a replacement.
      card('The raw call, exactly as it would be sent', [
        kv([
          ['To', link(to, to)],
          ['Selector', mono(String(data).slice(0, 10))],
          ['Length', String(Math.max(0, (String(data).length - 2) / 2)) + ' bytes'],
          parsed.extra ? ['Not accounted for', String(parsed.extra) + ' bytes beyond the arguments shown above'] : null,
        ]),
        h('pre', { text: (String(data).slice(2).match(/.{1,64}/g) || []).join('\n') }),
      ]),
      contractCard(target, 'The contract you would be calling'),
    );
  }


  // ---------- reading a pasted request ----------
  // The method decides the schema. Guessing it from the shape of the parameters is how an
  // `eth_sendTransaction` carrying a stray `calls` array had its real destination and calldata thrown away in
  // favour of the harmless thing inside it, and how fields that no wallet would honour (`from` on a 5792
  // call, `input` where `data` belongs) came to be simulated as though they would run.
  const HEX = /^0x([0-9a-fA-F]{2})*$/;
  const CALL_FIELDS = new Set(['to', 'data', 'value', 'capabilities']);
  const HEX_QTY = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;
  const TX_FIELDS = new Set(['from', 'to', 'data', 'input', 'value', 'gas', 'gasPrice', 'maxFeePerGas',
    'maxPriorityFeePerGas', 'nonce', 'chainId', 'type', 'accessList']);

  // EIP-5792 says what a request looks like, and a wallet is entitled to refuse anything that does not match.
  // Coercing a near-miss into a clean answer is worse than saying it is a near-miss: the page would be
  // describing something no conforming wallet has to run, in the confident voice it uses for things that will.
  const isHexQuantity = (v) => typeof v === 'string' && /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v);
  const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : typeof v === 'string' ? 'the text ' + JSON.stringify(String(v)).slice(0, 24) : String(v));

  function readEnvelope(o, note, opts) {
    // EIP-5792: {version, chainId, from?, atomicRequired, calls:[{to, data?, value?, capabilities?}]}
    const loose = !!(opts && opts.loose);   // a bare list of calls, not a request claiming to be one
    const schema = [];
    const calls = [];
    let conflicting = 0, invalid = 0;
    if (!loose) {
      // Every field the specification makes normative, not a subset. A field left unchecked is a field this
      // page has not read, and a request with unread fields must not be summed up as though it had been.
      if (o.version === undefined) schema.push('It names no version. The specification requires one, so a wallet may refuse this request as it stands.');
      if (o.id !== undefined && typeof o.id !== 'string') schema.push('Its id is ' + typeName(o.id) + ' rather than a string.');
      if (o.capabilities !== undefined && (typeof o.capabilities !== 'object' || o.capabilities === null || Array.isArray(o.capabilities)))
        schema.push('Its capabilities is ' + typeName(o.capabilities) + ' rather than an object, so what it asks a wallet to do differently cannot be read.');
      if (o.chainId === undefined) schema.push('It names no chainId. A wallet_sendCalls request has to say which chain it is for.');
      else if (!isHexQuantity(o.chainId)) schema.push(
        (typeof o.chainId === 'string' && /^0x0[0-9a-fA-F]+$/.test(o.chainId))
          ? 'Its chainId is "' + o.chainId + '", which names chain ' + Number(BigInt(o.chainId)) + ' written with a leading zero. '
            + 'The specification does not permit that, so a wallet may refuse the request, even though what was meant is not in doubt. '
            + '(EIP-5792\u2019s own example request is written the same way, so this is a place the specification and its example disagree.)'
          : 'Its chainId is ' + typeName(o.chainId) + '. This field has to be a hex string such as "0xb626", so a wallet may refuse the request outright.');
      if (o.atomicRequired === undefined) schema.push('It does not say whether it must be atomic. That field is required, and its absence is not the same as saying no.');
      else if (typeof o.atomicRequired !== 'boolean') schema.push('Its atomicRequired is ' + typeName(o.atomicRequired) + ' rather than true or false. It has not been read as either.');
      if (o.version !== undefined && typeof o.version !== 'string') schema.push('Its version is ' + typeName(o.version) + ' rather than a string.');
      if (o.from !== undefined && !(typeof o.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(o.from))) schema.push('Its from is ' + typeName(o.from) + ' rather than an address.');
    }
    for (let i = 0; i < o.calls.length; i++) {
      const raw = o.calls[i];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        // Kept at its own index rather than skipped. A list read as though the broken member were not there
        // looks complete, and the answer given for it would be an answer about a different request.
        invalid++;
        calls.push({ to: null, data: '0x', from: null, value: undefined,
                     invalid: 'Entry ' + (i + 1) + ' is ' + typeName(raw) + ', not a call.' });
        continue;
      }
      const c = raw;
      for (const k of Object.keys(c)) {
        if (CALL_FIELDS.has(k)) continue;
        if (k === 'from') {
          if (c.from) conflicting++;
          if (!o.from) note.push('Call ' + (i + 1) + ' carries a `from`. A call in this kind of request has no sender of its own: the request\u2019s sender sends all of them, so no wallet would use this. It has been ignored.');
        }
        else if (k === 'input') note.push('Call ' + (i + 1) + ' carries `input` where this kind of request uses `data`. A wallet would either ignore it and send empty calldata, or refuse the request. It has NOT been read as calldata here.');
        else note.push('Call ' + (i + 1) + ' carries an unrecognised field `' + String(k).slice(0, 24) + '`, which has been ignored.');
      }
      const data = typeof c.data === 'string' ? c.data : '0x';
      let bad = null;
      if (c.data !== undefined && !HEX.test(String(c.data))) bad = 'Entry ' + (i + 1) + ' has calldata that is not whole bytes of hex, so what it would run cannot be read.';
      // Calldata was carried in a field this shape does not use, so it has been dropped. Describing what is
      // left as a plain transfer of ETH states that the dropped bytes were never there.
      if (c.data === undefined && typeof c.input === 'string' && c.input !== '0x')
        bad = 'Entry ' + (i + 1) + ' carries its calldata in `input`, which this kind of request does not use, so it has been dropped. '
            + 'What a wallet would send is either nothing or those bytes, and this page will not pick between them.';
      if (c.to !== undefined && !(typeof c.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c.to))) bad = 'Entry ' + (i + 1) + ' has a destination that is not an address: ' + typeName(c.to) + '.';
      // "1" is not one wei here. This field is a hex quantity, and a decimal that looks like a small number
      // is exactly the shape something else would read as a very different amount.
      if (c.value !== undefined && !HEX_QTY.test(String(c.value)))
        schema.push('Call ' + (i + 1) + ' has a value of ' + typeName(c.value) + '. This field is a hex quantity such as "0x1", so what it would send has not been read.');
      if (c.capabilities !== undefined && (typeof c.capabilities !== 'object' || c.capabilities === null || Array.isArray(c.capabilities)))
        schema.push('Call ' + (i + 1) + ' has capabilities that are ' + typeName(c.capabilities) + ' rather than an object.');
      if (bad) invalid++;
      calls.push({ to: (typeof c.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c.to)) ? c.to : null,
                   data: HEX.test(data) ? data : '0x', from: null,
                   value: (c.value !== undefined && HEX_QTY.test(String(c.value))) ? c.value : undefined,
                   capabilities: c.capabilities, invalid: bad });
    }
    return {
      envelope: {
        // The raw value is kept even when it is unusable. Dropping it would turn "names a chain nobody can
        // read" into "names no chain", and the second is answered against whatever this page is set to.
        chainId: o.chainId === undefined ? null : o.chainId,
        chainIdOk: isHexQuantity(o.chainId),
        // Three states, not two: asked for, explicitly not asked for, and not said at all. The third used to
        // read as the second, which turns a missing required field into a promise about what a wallet will do.
        atomicRequired: typeof o.atomicRequired === 'boolean' ? o.atomicRequired : null,
        from: (typeof o.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(o.from)) ? o.from : null,
      },
      calls, notes: note, kindName: 'wallet_sendCalls',
      conflictingSenders: (o.from && conflicting) ? conflicting : 0,
      schemaProblems: schema, invalidMembers: invalid,
      // Kept, not dropped. Capabilities are how a wallet is permitted to change what a request means, so one
      // this page does not understand is exactly a reason to stop short of a verdict about the whole thing.
      capabilities: o.capabilities, requestId: o.id,
    };
  }

  function readTransaction(o, note) {
    for (const k of Object.keys(o || {})) {
      if (TX_FIELDS.has(k)) continue;
      if (k === 'calls') note.push('This transaction carries a `calls` array. That belongs to wallet_sendCalls, not to sending a transaction, so a wallet would either ignore it or refuse the request. What is described below is the transaction itself, not what is inside that array.');
      else note.push('Unrecognised field `' + String(k).slice(0, 24) + '` on this transaction, ignored.');
    }
    if (o.value !== undefined && !HEX_QTY.test(String(o.value)))
      note.push('This transaction\u2019s `value` is ' + JSON.stringify(String(o.value)).slice(0, 24) + ', which is not the hex quantity '
        + 'this field has to carry. No ETH amount is shown below, because what a wallet would make of it is not one answer: '
        + 'it may refuse the request, or read it as a very different amount than it looks like.');
    // `0x` is what a transaction with no calldata carries. It is not what a transaction whose calldata could
    // not be read carries, and substituting one for the other turns "I cannot read this" into "there is
    // nothing here": an unlimited approve that lost its 0x on the way through a chat window was being
    // answered with "No calldata: this is a plain transfer of ETH" and a green verdict, about bytes that
    // were never in the box. The reader thirty lines above this one already refuses that input by name.
    const given = typeof o.data === 'string' ? o.data : (typeof o.input === 'string' ? o.input : undefined);
    const bothDisagree = typeof o.data === 'string' && typeof o.input === 'string' && o.data !== o.input;
    if (bothDisagree)
      note.push('This transaction carries both `data` and `input`, and they are not the same bytes. '
        + 'go-ethereum refuses a transaction like that outright and other clients differ, so which of the two '
        + 'would run is not something this page can tell you. Nothing below has been read from either.');
    const readable = !bothDisagree && (given === undefined || HEX.test(String(given)));
    return {
      envelope: null,
      calls: [{
        to: o.to || null,
        data: readable && given !== undefined ? given : '0x',
        from: o.from || null,
        // A hex quantity per JSON-RPC, and the reader forty lines below already refuses a decimal here with
        // the comment that explains why: "1" is not one wei, and a decimal that looks like a small number is
        // exactly the shape something else reads as a very different amount. This path took it as given and
        // stated an exact ETH figure from it. What a wallet would do with such a value is genuinely
        // ambiguous, which is the reason to report it rather than to pick a reading.
        value: (o.value === undefined || HEX_QTY.test(String(o.value))) ? o.value : undefined,
        // The chain a request names is part of what it means. It used to be listed as a field this page
        // knows and then read by nobody, so a request for another chain was answered, in full and in green,
        // about whichever chain this page happened to be set to.
        chainId: o.chainId === undefined ? null : o.chainId,
        invalid: readable ? null : (bothDisagree
          ? 'It carries `data` and `input` with different bytes in them, and which of the two a wallet would run is not one answer. '
            + 'go-ethereum refuses such a transaction; others pick one. Nothing has been simulated, because simulating either would '
            + 'describe a transaction that might not be the one that runs.'
          : 'Its calldata is not whole bytes of hex, so what it would run cannot be read. '
          + 'Nothing has been simulated and nothing is described below: reading it as empty calldata would '
          + 'describe a plain transfer of ETH, which is not what is in the box. A hex string that lost its '
          + '"0x", or that is one character short, does this.'),
      }],
      notes: note, kindName: 'eth_sendTransaction',
      invalidMembers: readable ? 0 : 1,
    };
  }

  function readJsonRequests(j) {
    const top = Array.isArray(j) ? j : [j];
    const requests = [];
    const refused = [];
    // A bare array whose members are all call-shaped, with no method and no sender of their own, is what a
    // wallet_sendCalls `calls` array looks like when someone copies just that part. Read as one list, and
    // said out loud, because the alternative reading (several separate transactions) would describe an
    // ordering and atomicity nobody asked for.
    const allCallShaped = Array.isArray(j) && j.length > 1
      && j.every((o) => o && typeof o === 'object' && !o.method && !o.from && !Array.isArray(o.calls) && (o.to || o.data || o.input));
    if (allCallShaped) {
      const note = ['Read as one list of calls, the way a wallet_sendCalls request carries them. If these were meant as separate transactions, paste them as separate requests: nothing here says which order a wallet would use, or whether it would run them together.'];
      const r = readEnvelope({ calls: j }, note, { loose: true });
      r.envelope = null;
      return { kind: 'batch', requests: [r], refused: [] };
    }
    for (const entry of top) {
      if (!entry || typeof entry !== 'object') { refused.push('Entry ' + (top.indexOf(entry) + 1) + ' of that JSON is ' + typeName(entry) + ', not a request. Nothing has been read for it, and what follows is therefore not the whole of what was pasted.'); continue; }
      const note = [];
      const method = typeof entry.method === 'string' ? entry.method : null;
      if (method) {
        const params = Array.isArray(entry.params) ? entry.params : [];
        const p0 = params[0];
        if (method === 'wallet_sendCalls') {
          if (!p0 || !Array.isArray(p0.calls)) { refused.push('A wallet_sendCalls request with no calls array.'); continue; }
          requests.push(readEnvelope(p0, note));
        } else if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
          if (!p0 || typeof p0 !== 'object') { refused.push('An ' + method + ' request with no transaction object.'); continue; }
          requests.push(readTransaction(p0, note));
        } else {
          // Refused by name rather than guessed at. A method this page does not understand is a method whose
          // parameters it cannot claim to have read.
          refused.push('`' + method.slice(0, 40) + '` is a method this page does not read. Nothing from it is shown below.');
        }
        continue;
      }
      // No method named: accept the two shapes someone actually pastes, and nothing else.
      if (Array.isArray(entry.calls)) { requests.push(readEnvelope(entry, note)); continue; }
      if (entry.to || entry.data || entry.input) { requests.push(readTransaction(entry, note)); continue; }
      refused.push('An entry in that JSON is neither a request, a transaction, nor a call.');
    }
    if (!requests.length) return { kind: 'bad', why: refused.join('  ') || 'That JSON has no calls in it.' };
    if (requests.length === 1 && requests[0].calls.length === 1 && requests[0].calls[0].to
        && !requests[0].envelope && !requests[0].notes.length && !refused.length
        && !(requests[0].schemaProblems || []).length && !requests[0].invalidMembers)
      return Object.assign({ kind: 'call' }, requests[0].calls[0]);
    return { kind: 'batch', requests, refused };
  }

  // ---------- working out what was pasted ----------
  // People paste what they have: a hash from a wallet, an address from a tweet, or the whole JSON blob a
  // wallet shows under "raw data". All three should just work.
  function readInput(raw) {
    const s = (raw || '').trim();
    if (!s) return { kind: 'empty' };
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        const j = JSON.parse(s);
        return readJsonRequests(j);
      } catch (e) { return { kind: 'bad', why: 'That looks like JSON but it will not parse.' }; }
    }
    const url = s.match(/(?:tx|address|token)\/(0x[0-9a-fA-F]{40,64})/);
    const body = url ? url[1] : s.replace(/\s+/g, '');
    if (/^0x[0-9a-fA-F]{64}$/.test(body)) return { kind: 'tx', hash: body };
    if (/^0x[0-9a-fA-F]{40}$/.test(body)) return { kind: 'address', address: ethers.getAddress(body) };
    if (/^0x[0-9a-fA-F]{8,}$/.test(body) && body.length % 2 === 0) return { kind: 'data', data: body };
    return { kind: 'bad', why: 'That is not a transaction hash, an address, or calldata. Paste one of those.' };
  }

  // Each lookup gets a number and a frozen copy of the network it was asked on. Anything that finishes after
  // a newer question has been asked is dropped, so the answer on screen always belongs to the box above it.
  let lookupSeq = 0, activeLookup = 0;
  const stale = (n) => n !== activeLookup;
  async function go() {
    const parsedInput = readInput($('input').value);
    const fromRaw = $('from').value.trim();
    const from = ethers.isAddress(fromRaw) ? ethers.getAddress(fromRaw) : null;
    if (fromRaw && !from) { say('That sender address is not a valid address.', 'bad'); out(); return; }
    const seq = ++lookupSeq; activeLookup = seq;
    const askedOn = chainId();
    $('go').disabled = true; $('net').disabled = true;
    for (const b of document.querySelectorAll('.ex')) b.disabled = true;
    try {
      if (parsedInput.kind === 'empty') { say('Paste something first.', 'warn'); out(); return; }
      if (parsedInput.kind === 'bad') { say(parsedInput.why, 'bad'); out(); return; }
      if (parsedInput.kind === 'tx') return await showTransaction(parsedInput.hash, from, seq);
      if (parsedInput.kind === 'address') return await showAddress(parsedInput.address, seq);
      if (parsedInput.kind === 'batch') {
        const reqs = parsedInput.requests;
        const many = reqs.length > 1;
        const cards = [];
        for (const r of (parsedInput.refused || [])) cards.push(note('bad', 'Part of that request was not read', r));
        if (many) cards.push(note('warn', 'This is ' + reqs.length + ' separate requests',
          'They are not one batch. Each carries its own network, sender and atomicity rules, and each is read below on its own terms.'));
        for (let ri = 0; ri < reqs.length; ri++) {
          const env = reqs[ri].envelope;
          // B-03: one canonical list, built before anything is simulated, so the sender that is simulated is
          // the sender that is described. A request that names its own sender is authoritative; the box fills
          // in only where a call names none.
          const label = many ? 'Request ' + (ri + 1) + ' of ' + reqs.length + ': ' : '';
          const envSender = env && env.from ? ethers.getAddress(env.from) : null;
          const uiSender = from;
          // The reader has already discarded anything a wallet would not honour. What is left is the
          // request's own sender, or, where it named none, the address in the box, said out loud as such.
          const envFrom = env && env.from ? env.from : null;
          const chosenSender = envFrom || reqs[ri].calls[0].from || uiSender || null;
          const calls = reqs[ri].calls.map((c) => Object.assign({}, c, { from: chosenSender }));
          for (const n of (reqs[ri].notes || [])) cards.push(note('warn', label + 'something in this request was ignored', n));
          const schemaProblems = reqs[ri].schemaProblems || [];
          if (schemaProblems.length) cards.push(note('bad', label + 'this is not a valid wallet_sendCalls request',
            schemaProblems.join('  ') + '  A wallet is entitled to refuse it rather than run it, so treat everything below as a reading of what was pasted, not as what will happen.'));
          // A capability is how a wallet is allowed to do something other than the default. This page does not
          // implement any of them, so naming them and standing back is the only honest thing available: a
          // verdict about the whole request would be a claim about behaviour nobody here has read.
          const caps = [];
          const capNames = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v) : [];
          for (const n of capNames(reqs[ri].capabilities)) caps.push(n);
          reqs[ri].calls.forEach((c, i) => { for (const n of capNames(c.capabilities)) caps.push('call ' + (i + 1) + ': ' + n); });
          if (caps.length) cards.push(note('bad', label + 'this request asks for capabilities this page does not read',
            caps.map((c) => '\u201c' + String(c).slice(0, 40) + '\u201d').join(', ')
            + '.  A capability is how a wallet is permitted to do something other than the ordinary thing \u2014 pay the '
            + 'gas differently, run the calls differently, add conditions. What is described below is the ordinary '
            + 'reading, and no verdict is given for the request as a whole, because these could change it.'));
          // A note means a field was dropped or ignored, and an unread field is as much a reason to withhold
          // the green all-calls verdict as an unread capability is. Without this, a request whose second call
          // carried `input` instead of `data` was described as a plain transfer of ETH and still earned an
          // unqualified "run in order, every call succeeds".
          reqs[ri].unread = caps.length > 0 || schemaProblems.length > 0
            || (reqs[ri].notes || []).length > 0 || !!reqs[ri].invalidMembers;
          if (reqs[ri].invalidMembers) cards.push(note('bad', label + reqs[ri].invalidMembers + ' of its ' + reqs[ri].calls.length + ' entries could not be read as calls',
            'They are kept in place below rather than dropped, because a list with a member missing is not the list that was pasted. No verdict is given for the sequence as a whole.'));
          if (!chosenSender) {
            cards.push(note('bad', label + 'nobody is named as the sender',
              'This request does not say who sends it, and the box above is empty. Who is asking decides what most contracts do, so there is nothing here worth simulating until you put an address in. Nothing below has been checked.'));
            continue;
          }
          if (!envFrom && !reqs[ri].calls[0].from) {
            cards.push(note('warn', label + 'the sender is the one you typed, not one the request names',
              'This request leaves the sender to the wallet. Everything below was worked out as ' + short(chosenSender) + ' because that is what is in the box.'));
          }
          // B-02: each request is judged against the chain it names, not against whatever the page is set to.
          if (env && env.chainId !== null && env.chainId !== undefined) {
            let want = null;
            if (env.chainIdOk) { try { want = Number(BigInt(env.chainId)); } catch (e) { want = null; } }
            const leadingZero = typeof env.chainId === 'string' && /^0x0[0-9a-fA-F]+$/.test(env.chainId);
            if (leadingZero) {
              let n = null; try { n = Number(BigInt(env.chainId)); } catch (e) {}
              cards.push(note('bad', label + 'this request writes its network in a form the specification does not allow',
                'Its chainId is "' + env.chainId + '"' + (n !== null ? ', which names chain ' + n : '') + ', written with a leading zero. '
                + 'A hex quantity may not carry one, so a wallet may refuse this request outright. Nothing in it has been checked here, '
                + 'because a request a wallet might refuse is not one to describe as though it would run. What was meant is not in doubt: '
                + 'write it without the leading zero.'));
              continue;
            }
            if (want === null || !Number.isSafeInteger(want)) {
              // A chain id that will not parse is not the same as a request that named no chain. Reading it
              // against whatever this page happens to be set to is how a malformed field becomes an answer
              // about the wrong network.
              cards.push(note('bad', label + 'this request names a network that cannot be read',
                'Its chainId is ' + JSON.stringify(String(env.chainId)).slice(0, 40) + ', which is not the hex string this kind of request has to carry. '
                + 'Nothing in it has been checked: an unreadable network is not the same as no network, and guessing would mean answering about the wrong chain.'));
              continue;
            }
            if (want !== chainId()) {
              cards.push(note('bad', label + 'this request is for a different network',
                'Its chainId is ' + String(env.chainId) + ', which is chain ' + want + (CHAINS[want] ? ' (' + CHAINS[want].name + ')' : '') + ', and this page is set to '
                + chainId() + ' (' + cfg().name + '). Nothing in it has been checked: the same address is a different contract on a different chain, and an answer from the wrong one is worse than none.'));
              continue;
            }
          }
          if (reqs[ri].conflictingSenders) {
            cards.push(note('bad', label + 'this request contradicts itself about who sends it',
              reqs[ri].conflictingSenders + ' of its calls name a different sender than the request does. A call in a '
              + 'wallet_sendCalls request has no sender of its own: the request\u2019s sender sends all of them. '
              + short(envSender) + ' is what has been used here, and a wallet given this would either do the same or refuse it outright. '
              + 'Treat a request that says two different things about who is signing as one to look at closely.'));
          }
          if (envSender && uiSender && envSender.toLowerCase() !== uiSender.toLowerCase()) {
            cards.push(note('warn', label + 'the request names a different sender than the box',
              'The request says ' + short(envSender) + ' and the box says ' + short(uiSender) + '. The request wins, because that is who would actually send it.'));
          }
          if (calls.length > 1) cards.push(note('warn', label + calls.length + ' calls, not one',
            'A batch is only as safe as its most dangerous call, and that is rarely the first one.'));
          if (env) cards.push(env.atomicRequired === null
            ? note('bad', label + 'it does not say whether this is all-or-nothing',
                'That field is required and is missing or unreadable, so there is no way to tell whether one failure would undo the rest. A wallet may refuse the request, run them together, or run them one at a time.')
            : note(env.atomicRequired ? 'warn' : '', label + (env.atomicRequired ? 'all of it, or none of it' : 'not required to be atomic'),
                env.atomicRequired
                  ? 'The request asks for these to happen together, so one failure means none of them happen.'
                  : 'The request does not ask for these to happen together, so some may land and others may not.'));

          // B-04: only a list where every call can be simulated may earn an all-calls verdict.
          const simulatable = calls.every((c) => ethers.isAddress(String(c.to || '')));
          let ordered = null, orderedErr = null;
          if (simulatable) {
            try { ordered = await simulateInOrder(calls); }
            catch (e) { orderedErr = String(e.message || e).slice(0, 140); }
            if (stale(seq)) return;
          }
          if (!simulatable) {
            cards.push(note('bad', label + 'this cannot be checked as a sequence',
              'At least one entry has no destination this page can simulate, such as a contract being created. Running the others in order would leave that one out, and a verdict with a member missing is not a verdict.'));
          } else if (ordered) {
            const bad = ordered.findIndex((r) => !r.ok);
            if (bad >= 0) cards.push(note('bad', label + 'run in order, call ' + (bad + 1) + ' fails',
              decodeRevert(ordered[bad].reason, null) + (env && env.atomicRequired === true
                ? '  Because this request asks for all or nothing, none of it would happen.'
                : '  What happens to the calls before it is not settled: a wallet may run them and stop here, '
                  + 'leaving those done; it may run the whole thing atomically anyway and leave none done; or it may '
                  + 'refuse the request outright once it sees this. Not being required to be atomic is not a promise '
                  + 'that the earlier ones survive.')));
            else if (reqs[ri].unread) cards.push(note('warn', label + 'run in order, every call succeeds \u2014 as read here',
              'Simulated as one sequence, as ' + short(calls[0].from || ethers.ZeroAddress) + ', against the chain as it is now. '
              + 'This is not a verdict on the request: parts of it were not read, and what is above says which.'));
            else cards.push(note('ok', label + 'run in order, every call succeeds',
              'Simulated as one sequence, as ' + short(calls[0].from || ethers.ZeroAddress) + ', against the chain as it is now.'));
          } else {
            cards.push(note('warn', label + 'these could not be run in order', (orderedErr || 'the node would not do it')
              + '. Each call below was checked on its own instead, which misses anything that only fails because of what an earlier call did.'));
          }

          for (let i = 0; i < calls.length && i < 20; i++) {
            const c = calls[i];
            const title = label + 'call ' + (i + 1) + ' of ' + calls.length;
            // Before the address is looked at. An entry with a perfectly good `to` and calldata that cannot
            // be read still cannot be described, and describing it anyway is how empty calldata gets reported
            // as a fact about a transaction that carried some.
            const noTo = !ethers.isAddress(String(c.to || ''));
            if (c.invalid || noTo) {
              cards.push(card(title, [
                c.invalid ? note('bad', 'This could not be read as a call', c.invalid
                  + ' It is shown here at its own position so the list you see is the list you pasted.') : null,
                noTo ? note('bad', 'This call has no destination this page can read',
                  'An entry with no `to` is usually a contract being created, and this page cannot tell you what that contract would do.') : null,
                kv([['Destination', String(c.to || '(none given)')], ['Value', c.value ? String(c.value) : '0'], ['Length', String(Math.max(0, (String(c.data).length - 2) / 2)) + ' bytes']]),
                h('pre', { text: (String(c.data).slice(2).match(/.{1,64}/g) || []).join('\n') }),
              ]));
              continue;
            }
            const t = await readAddress(c.to).catch(() => null);
            if (stale(seq)) return;
            const p = parseData(c.data, t && t.abi);
            let sim = ordered ? ordered[i] : null, simErr = null;
            if (!sim) { try { sim = await simulate(c); } catch (e) { simErr = String(e.message || e).slice(0, 140); } }
            if (stale(seq)) return;
            const sentence = p.unknown || p.empty ? null : describeCall(p, { target: t });
            cards.push(card(title, [
              h('p', { class: 'lede', text: sentence || (p.empty ? 'A plain transfer of ETH.' : p.unknown ? 'A call this page cannot name: ' + p.selector : p.signature) }),
              sentence ? readingCaption(t) : null,
              h('div', {}, [
                sim ? h('span', { class: 'pill ' + (sim.ok ? 'ok' : 'bad'), text: sim.ok ? 'would succeed' : 'would fail' }) : null,
                h('span', { class: 'pill', text: 'to ' + short(String(c.to)) }),
                h('span', { class: 'pill', text: 'as ' + short(c.from || ethers.ZeroAddress) }),
                c.value && BigInt(c.value) > 0n ? h('span', { class: 'pill warn', text: ethers.formatEther(BigInt(c.value)) + ' ETH attached' }) : null,
              ]),
              simErr ? note('warn', 'This call could not be simulated', simErr) : null,
              ...callWarnings(p, t, sim, c.from).map(([cls, ttl, body]) => note(cls, ttl, body)),
              t ? kv([
                ['Destination', h('span', {}, link(String(c.to), short(String(c.to))), document.createTextNode('  '),
                  h('span', { class: 'mut', text: t.codeUnreadable ? 'code unreadable' : t.isContract ? (t.proxy ? 'a proxy' : 'a contract') : t.delegated ? 'an upgraded wallet' : 'a wallet' }))],
                t.isContract ? ['Source', t.proxy
                  ? (t.proxy.verified ? 'the code it runs has published source' : t.proxy.verified === null ? 'could not check the code it runs' : 'the code it runs has published no source')
                  : (t.verified ? 'published' : t.verified === null ? 'could not check' : 'none published')] : null,
              ]) : note('bad', 'Nothing could be read about this destination', 'The chain would not answer, so nothing here is settled.'),
              await renderInner(p, t, 0),
              h('details', {}, [h('summary', { class: 'mut', text: 'raw call' }), h('pre', { text: (String(c.data).slice(2).match(/.{1,64}/g) || []).join('\n') })]),
            ]));
          }
          if (calls.length > 20) cards.push(note('warn', label + 'only the first 20 calls are shown', 'There are ' + calls.length + ' in total.'));
        }
        if (stale(seq)) return;
        say('');
        out(...cards);
        return;
      }
      if (parsedInput.kind === 'call') {
        // A single call skips the batch renderer, so the check that lives there has to live here too.
        const cid = parsedInput.chainId;
        if (cid !== null && cid !== undefined) {
          let want = null;
          if (HEX_QTY.test(String(cid))) { try { want = Number(BigInt(cid)); } catch (e) { want = null; } }
          if (want === null || !Number.isSafeInteger(want)) {
            say('');
            out(note('bad', 'That request names a network this page cannot read',
              'Its chainId is ' + JSON.stringify(String(cid)).slice(0, 40) + ', which is not the hex string this kind '
              + 'of request has to carry. Nothing in it has been checked: an unreadable network is not the same as no '
              + 'network, and guessing which one was meant would mean answering about the wrong chain.'));
            return;
          }
          if (want !== chainId()) {
            say('');
            out(note('bad', 'That request is for a different network',
              'Its chainId is ' + String(cid) + ', which is chain ' + want + (CHAINS[want] ? ' (' + CHAINS[want].name + ')' : '')
              + ', and this page is set to ' + chainId() + ' (' + cfg().name + '). Nothing in it has been checked: the '
              + 'same address is a different contract on a different chain, and an answer from the wrong one is worse '
              + 'than none. Switch the network above and ask again to check it.'));
            return;
          }
        }
        if (!ethers.isAddress(parsedInput.to || '')) { say('That call has no valid "to" address in it.', 'bad'); out(); return; }
        return await showCall(ethers.getAddress(parsedInput.to), parsedInput.data, from || (ethers.isAddress(parsedInput.from || '') ? ethers.getAddress(parsedInput.from) : null), parsedInput.value, seq);
      }
      if (parsedInput.kind === 'data') {
        // Calldata alone says what is being asked for but not of whom, and the answer depends on both.
        const to = prompt('Which contract is that call going to? Paste its address.\n\nThe same calldata means different things at different contracts.');
        if (!to || !ethers.isAddress(to.trim())) { say('A preview needs the contract the call is going to. Paste it into the box as {"to":"0x…","data":"0x…"} if it is easier.', 'warn'); out(); return; }
        return await showCall(ethers.getAddress(to.trim()), parsedInput.data, from, null, seq);
      }
    } catch (e) {
      if (stale(seq) || askedOn !== chainId()) return;
      say('That did not work: ' + String(e && (e.shortMessage || e.message) || e).slice(0, 180), 'bad');
    } finally {
      if (!stale(seq)) { $('go').disabled = false; $('net').disabled = false; for (const b of document.querySelectorAll('.ex')) b.disabled = false; }
    }
  }

  // ---------- the page ----------
  $('go').addEventListener('click', go);
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
  $('net').addEventListener('change', () => { activeLookup = ++lookupSeq; $('netPill').textContent = cfg().name; $('out').textContent = ''; say(''); refreshFoot(); });
  $('useWallet').addEventListener('click', async () => {
    const eth = window.ethereum;
    if (!eth) { say('No wallet in this browser. Type or paste the address instead.', 'warn'); return; }
    try {
      const accts = await eth.request({ method: 'eth_requestAccounts' });
      if (accts && accts[0]) { $('from').value = ethers.getAddress(accts[0]); say('Using ' + short(accts[0]) + '. Nothing is signed on this page.', 'ok'); }
    } catch (e) { say('Your wallet did not share an address.', 'warn'); }
  });

  const EXAMPLES = {
    tx: { 46630: '0x7861330adb005302c036e832029348fe259adebb88e9a7abd54fe771fdbf63bf', 4663: '' },
    addr: { 46630: '0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74', 4663: '0xA000027A9B2802E1ddf7000061001e5c005A0000' },
  };
  for (const b of document.querySelectorAll('.ex')) {
    b.addEventListener('click', () => {
      const which = b.getAttribute('data-ex');
      if (which === 'approve') {
        const spender = '0x1111111111111111111111111111111111111111';
        const data = new ethers.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [spender, ethers.MaxUint256]);
        const token = chainId() === 46630 ? '0x3aea4d7cd57a1fc47bf42bfedf2ab3bdd00157b0' : '';
        if (!token) { say('That example is on the testnet. Switch the network to try it.', 'warn'); return; }
        $('input').value = JSON.stringify({ to: token, data });
      } else {
        const v = (EXAMPLES[which] || {})[chainId()];
        if (!v) { say('That example is on the testnet. Switch the network to try it.', 'warn'); return; }
        $('input').value = v;
      }
      go();
    });
  }

  function refreshFoot() {
    const f = $('foot'); f.textContent = '';
    f.appendChild(document.createTextNode(' Reading ' + cfg().name + ' at '));
    f.appendChild(h('span', { class: 'mono', text: cfg().rpc.replace('https://', '') }));
    f.appendChild(document.createTextNode('. '));
    f.appendChild(h('a', { href: 'https://rhairdrop.gmgnrepeat.com/', text: 'The airdrop tool is over here' }));
    f.appendChild(document.createTextNode('.'));
  }
  $('netPill').textContent = cfg().name;
  refreshFoot();
  (async () => { try { const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot'); ethUsd = Number((await r.json()).data.amount) || null; } catch (e) {} })();
  // Deep link: /?q=0x… so a link can carry the thing to look at.
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('net') && CHAINS[Number(q.get('net'))]) $('net').value = q.get('net');
    if (q.get('from')) $('from').value = q.get('from');
    if (q.get('q')) { $('input').value = q.get('q'); $('netPill').textContent = cfg().name; go(); }
  } catch (e) {}
  window.__check = { readInput, parseData, describeCall, decodeRevert, selectorsIn, powersOf, knownFunctions, innerCalls };
  window.ethers = window.ethers || ethers;
})();
