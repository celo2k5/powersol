const SOCKET_URL = 'wss://marcelo-admin.up.railway.app';
const TOKENS_PER_BALL = 500_000;
const MAX_BALLS = 80;

const state = {
  socket: null,
  retryMs: 1_000,
  retryTimer: null,
  data: null,
  holders: [],
  connectedWallet: '',
  selection: {
    timer: null,
    running: false,
  },
  powerData: {
    cycle: null,
    prizePool: null,
    winningNumber: null,
    history: [],
    ticketEntries: new Map(),
  },
};

const elements = {
  socketStatus: document.getElementById('socketStatus'),
  cycleLabel: document.getElementById('cycleLabel'),
  drawState: document.getElementById('drawState'),
  prizePool: document.getElementById('prizePool'),
  countdown: document.getElementById('countdown'),
  drawPlayers: document.getElementById('drawPlayers'),
  totalEntries: document.getElementById('totalEntries'),
  winningBall: document.getElementById('winningBall'),
  drawMessage: document.getElementById('drawMessage'),
  drawCard: document.getElementById('drawCard'),
  distributionPanel: document.getElementById('distributionPanel'),
  distributionWinning: document.getElementById('distributionWinning'),
  distributionRows: document.getElementById('distributionRows'),
  closeDistribution: document.getElementById('closeDistribution'),
  ticketWallet: document.getElementById('ticketWallet'),
  ticketState: document.getElementById('ticketState'),
  tokensHeld: document.getElementById('tokensHeld'),
  eligibleBalls: document.getElementById('eligibleBalls'),
  ticketCycle: document.getElementById('ticketCycle'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressBar: document.getElementById('progressBar'),
  ticketNumbers: document.getElementById('ticketNumbers'),
  ticketLookup: document.getElementById('ticketLookup'),
  walletAddressInput: document.getElementById('walletAddressInput'),
  walletLookupMessage: document.getElementById('walletLookupMessage'),
  tokenMint: document.getElementById('tokenMint'),
  walletSearch: document.getElementById('walletSearch'),
  playerCount: document.getElementById('playerCount'),
  playerRows: document.getElementById('playerRows'),
  winnerHistory: document.getElementById('winnerHistory'),
  ticketHistory: document.getElementById('ticketHistory'),
};

function shorten(value) {
  return value && value.length > 10 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value || '--';
}

function formatAmount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function isWallet(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '');
}

function createBall(number, purple = false, mini = false) {
  const ball = document.createElement('span');
  ball.className = `number-ball${purple ? ' purple' : ''}`;
  if (mini) ball.classList.add('mini-ball');
  ball.textContent = number;
  return ball;
}

function estimatedBallCount(balance) {
  return Math.min(MAX_BALLS, Math.floor((Number(balance) || 0) / TOKENS_PER_BALL));
}

function assignedEntries(wallet) {
  return state.powerData.ticketEntries.get(wallet) || [];
}

function currentTokenMint() {
  const config = state.data?.config || {};
  return config.tokenMint || config.mainTokenMint || state.data?.tokenMint || state.data?.mainTokenMint || '';
}

function renderTokenMint() {
  const mint = currentTokenMint();
  elements.tokenMint.textContent = mint || 'Awaiting backend token configuration';
  elements.tokenMint.title = mint;
}

function updateConnection(status) {
  elements.socketStatus.classList.toggle('live', status === 'live');
  elements.socketStatus.lastChild.textContent = status === 'live' ? ' Live data' : status === 'reconnecting' ? ' Reconnecting' : ' Connecting';
}

function updateCurrentDraw() {
  const cycle = state.powerData.cycle;
  const currentCycle = cycle?.round || cycle?.id || state.data?.currentCycle?.round;
  const nextTime = cycle?.nextDrawTime || state.data?.nextDistributionTime;
  const winner = state.powerData.winningNumber;
  const estimatedEntries = state.holders.reduce((total, holder) => total + estimatedBallCount(holder.balance), 0);

  elements.cycleLabel.textContent = currentCycle ? `Cycle #${currentCycle}` : 'Cycle unavailable';
  elements.prizePool.textContent = state.powerData.prizePool == null ? '--' : formatAmount(state.powerData.prizePool);
  elements.drawPlayers.textContent = String(state.holders.length);
  elements.totalEntries.textContent = String(estimatedEntries);
  elements.ticketCycle.textContent = currentCycle ? `#${currentCycle}` : '--';

  if (!state.selection.running) {
    if (winner != null) {
      elements.winningBall.textContent = winner;
      elements.drawState.textContent = 'Winning number';
      elements.drawMessage.textContent = 'The current cycle has settled. Verified winners and settlement amounts appear in draw history.';
    } else {
      elements.winningBall.textContent = '?';
      elements.drawState.textContent = nextTime ? 'Draw pending' : 'Awaiting draw data';
      elements.drawMessage.textContent = nextTime
        ? 'Cycle time is live. The winning number will be displayed when it is received from the backend.'
        : 'The existing backend does not currently provide Powerball cycle or draw events.';
    }
  }

  if (!nextTime) {
    elements.countdown.textContent = '--:--:--';
    return;
  }

  const remaining = Math.max(0, new Date(nextTime).getTime() - Date.now());
  elements.countdown.textContent = `${String(Math.floor(remaining / 3_600_000)).padStart(2, '0')}:${String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, '0')}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, '0')}`;
}

function winningNumberFrom(data) {
  const value = typeof data === 'object' && data
    ? data.winningNumber ?? data.number ?? data.winningBall ?? data.winner?.number ?? data.result?.winningNumber ?? data.result?.number
    : data;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 1_000 ? number : null;
}

function isWinnerSelectionEvent(type, data) {
  const eventType = String(type || '').toLowerCase();
  return [
    'power_draw',
    'powersol_draw',
    'powerball_draw',
    'test_event',
    'test_draw',
    'winner_selection',
    'winner_selected',
    'draw_start',
    'draw_started',
  ].includes(eventType) || eventType.includes('test') || winningNumberFrom(data) != null;
}

function distributionEntriesFrom(data) {
  const sources = [
    data?.winners,
    data?.distributions,
    data?.payouts,
    data?.result?.winners,
    data?.result?.distributions,
    data?.result?.payouts,
    data?.history?.[0]?.winners,
  ];
  const entries = sources.find((source) => Array.isArray(source) || (source && typeof source === 'object'));
  if (!entries) return [];
  if (Array.isArray(entries)) {
    return entries.map((entry) => ({
      wallet: entry.wallet || entry.address || entry.owner || entry.recipient || 'Winner',
      amount: entry.amount ?? entry.payout ?? entry.reward ?? entry.value,
    }));
  }
  return Object.entries(entries).map(([wallet, amount]) => ({ wallet, amount }));
}

function closeDistributionPanel() {
  elements.distributionPanel.classList.remove('is-open');
  elements.distributionPanel.setAttribute('aria-hidden', 'true');
}

function openDistributionPanel(winningNumber, data) {
  const entries = distributionEntriesFrom(data);
  elements.distributionWinning.textContent = String(winningNumber);
  elements.distributionRows.replaceChildren();

  if (!entries.length) {
    const message = document.createElement('p');
    message.className = 'distribution-empty';
    message.textContent = 'Winner selection is verified. Waiting for payout distribution records from the backend.';
    elements.distributionRows.append(message);
  } else {
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'distribution-row';
      const wallet = document.createElement('span');
      wallet.textContent = shorten(String(entry.wallet));
      wallet.title = String(entry.wallet);
      const amount = document.createElement('strong');
      amount.textContent = entry.amount == null ? 'Amount pending' : formatAmount(entry.amount);
      row.append(wallet, amount);
      elements.distributionRows.append(row);
    });
  }

  elements.distributionPanel.classList.add('is-open');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
}

function animateWinnerSelection(data) {
  const winningNumber = winningNumberFrom(data);
  const drawData = data?.result && typeof data.result === 'object' ? { ...data, ...data.result } : data;
  const frames = 30;
  let frame = 0;

  clearTimeout(state.selection.timer);
  state.selection.running = true;
  closeDistributionPanel();
  elements.drawCard.classList.add('is-selecting');
  elements.drawState.textContent = 'Selecting winner';
  elements.drawMessage.textContent = 'The PowerSol balls are in motion. Waiting for the verified draw result.';

  function spin() {
    frame += 1;
    elements.winningBall.textContent = String(Math.floor(Math.random() * 1_000) + 1);

    if (frame < frames) {
      const delay = 65 + Math.round((frame / frames) ** 2 * 190);
      state.selection.timer = setTimeout(spin, delay);
      return;
    }

    state.selection.timer = null;
    state.selection.running = false;
    elements.drawCard.classList.remove('is-selecting');

    if (winningNumber == null) {
      elements.winningBall.textContent = '?';
      elements.drawState.textContent = 'Draw received';
      elements.drawMessage.textContent = 'The selection event arrived without a winning number. Awaiting the verified result.';
      return;
    }

    mergePowerData(drawData);
    state.powerData.winningNumber = winningNumber;
    updateCurrentDraw();
    renderHistory();
    openDistributionPanel(winningNumber, drawData);
  }

  state.selection.timer = setTimeout(spin, 160);
}

function renderTicket() {
  const wallet = state.connectedWallet;
  const holder = state.holders.find((item) => item.wallet === wallet);
  const balance = holder?.balance || 0;
  const eligible = estimatedBallCount(balance);
  const assigned = assignedEntries(wallet);
  const carried = Math.min(balance % TOKENS_PER_BALL, TOKENS_PER_BALL);

  elements.ticketWallet.textContent = wallet || 'No wallet address selected';
  elements.ticketState.textContent = wallet ? (holder ? 'Holder found' : 'Address checked') : 'Address required';
  elements.tokensHeld.textContent = wallet ? formatAmount(balance) : '--';
  elements.eligibleBalls.textContent = `${eligible} / ${MAX_BALLS}`;
  elements.progressPercent.textContent = wallet ? `${Math.round((carried / TOKENS_PER_BALL) * 100)}%` : '0%';
  elements.progressBar.style.width = `${wallet ? (carried / TOKENS_PER_BALL) * 100 : 0}%`;
  elements.progressLabel.textContent = wallet
    ? `${formatAmount(carried)} / ${formatAmount(TOKENS_PER_BALL)} until your next ball`
    : '500,000 tokens are required for the first ball';

  elements.ticketNumbers.replaceChildren();
  if (!wallet || !assigned.length) {
    elements.ticketNumbers.classList.add('empty');
    elements.ticketNumbers.textContent = wallet
      ? 'Ticket numbers will appear when the Powerball backend provides assigned entries.'
      : 'Enter a wallet address above to view a ticket.';
    return;
  }
  elements.ticketNumbers.classList.remove('empty');
  assigned.forEach((number) => elements.ticketNumbers.append(createBall(number)));
}

function renderPlayerBoard() {
  const filter = elements.walletSearch.value.trim().toLowerCase();
  const holders = state.holders.filter((holder) => holder.wallet.toLowerCase().includes(filter));
  elements.playerCount.textContent = String(state.holders.length);
  elements.playerRows.replaceChildren();

  if (!holders.length) {
    const message = document.createElement('p');
    message.className = 'empty-message';
    message.textContent = filter ? 'No wallet matches this search.' : 'No live holders received.';
    elements.playerRows.append(message);
    return;
  }

  holders.slice(0, 100).forEach((holder) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const entries = assignedEntries(holder.wallet);
    const estimate = estimatedBallCount(holder.balance);
    const balls = document.createElement('div');
    balls.className = 'mini-balls';

    if (entries.length) {
      entries.slice(0, MAX_BALLS).forEach((number) => balls.append(createBall(number, false, true)));
    } else {
      balls.textContent = estimate ? `${estimate} eligible - awaiting assigned ticket numbers` : 'No eligible balls';
      balls.classList.add('holder-balance');
    }

    const wallet = document.createElement('span');
    wallet.className = 'wallet-short';
    wallet.title = holder.wallet;
    wallet.textContent = shorten(holder.wallet);
    const balance = document.createElement('span');
    balance.className = 'holder-balance';
    balance.textContent = formatAmount(holder.balance);
    const count = document.createElement('span');
    count.className = 'entry-count';
    count.textContent = entries.length ? String(entries.length) : `${estimate}*`;
    row.append(wallet, balance, count, balls);
    elements.playerRows.append(row);
  });
}

function renderHistory() {
  elements.winnerHistory.replaceChildren();
  if (!state.powerData.history.length) {
    elements.winnerHistory.innerHTML = '<p class="empty-message">No authoritative POWER draw history has been received.</p>';
  } else {
    state.powerData.history.forEach((round) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.append(
        createBall(round.winningNumber, true),
        Object.assign(document.createElement('span'), { textContent: `Cycle #${round.cycle} - ${round.winners?.length || 0} winner(s)` }),
        Object.assign(document.createElement('strong'), { textContent: round.prizePool ? formatAmount(round.prizePool) : '--' })
      );
      elements.winnerHistory.append(row);
    });
  }
  elements.ticketHistory.innerHTML = state.connectedWallet
    ? '<p class="empty-message">Previous wallet tickets require Powerball history events from the backend.</p>'
    : '<p class="empty-message">Look up a wallet address to view previous POWER tickets.</p>';
}

function hydrateFromState(data) {
  state.data = data;
  state.holders = Array.isArray(data.holders) ? data.holders : [];
  renderTokenMint();
  updateCurrentDraw();
  renderTicket();
  renderPlayerBoard();
  renderHistory();
}

function mergePowerData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.cycle) state.powerData.cycle = data.cycle;
  if (data.prizePool != null) state.powerData.prizePool = data.prizePool;
  if (data.winningNumber != null) state.powerData.winningNumber = data.winningNumber;
  if (Array.isArray(data.history)) state.powerData.history = data.history;
  if (data.entriesByWallet && typeof data.entriesByWallet === 'object') {
    Object.entries(data.entriesByWallet).forEach(([wallet, entries]) => {
      if (Array.isArray(entries)) state.powerData.ticketEntries.set(wallet, entries);
    });
  }
}

function handleMessage(message) {
  const { type, data } = message;
  switch (type) {
    case 'state':
      hydrateFromState(data || {});
      break;
    case 'holders_update':
      state.holders = Array.isArray(data) ? data : [];
      renderTicket();
      renderPlayerBoard();
      updateCurrentDraw();
      break;
    case 'holder_pnl_update':
    case 'holder_sent_update': {
      const holder = state.holders.find((item) => item.wallet === data?.wallet);
      if (holder) Object.assign(holder, data);
      renderTicket();
      renderPlayerBoard();
      break;
    }
    case 'tick':
    case 'scheduler_state':
      if (state.data) state.data.nextDistributionTime = data?.nextDistributionTime;
      updateCurrentDraw();
      break;
    case 'power_state':
    case 'powersol_state':
    case 'powerball_state':
      mergePowerData(data);
      updateCurrentDraw();
      renderTicket();
      renderPlayerBoard();
      renderHistory();
      break;
    case 'power_draw':
    case 'powersol_draw':
    case 'powerball_draw':
    case 'test_event':
    case 'test_draw':
    case 'winner_selection':
    case 'winner_selected':
    case 'draw_start':
    case 'draw_started':
      animateWinnerSelection(data);
      break;
    default:
      if (isWinnerSelectionEvent(type, data)) animateWinnerSelection(data);
  }
}

function connectSocket() {
  updateConnection('connecting');
  const socket = new WebSocket(SOCKET_URL);
  state.socket = socket;
  socket.addEventListener('open', () => {
    state.retryMs = 1_000;
    updateConnection('live');
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message && typeof message.type === 'string') handleMessage(message);
    } catch {
      // The existing backend may send malformed data; ignore only that message.
    }
  });
  socket.addEventListener('error', () => socket.close());
  socket.addEventListener('close', () => {
    updateConnection('reconnecting');
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(connectSocket, state.retryMs);
    state.retryMs = Math.min(state.retryMs * 2, 15_000);
  });
}

function lookupWallet(event) {
  event.preventDefault();
  const wallet = elements.walletAddressInput.value.trim();
  if (!isWallet(wallet)) {
    elements.walletLookupMessage.textContent = 'Enter a valid Solana wallet address to view a ticket.';
    elements.walletLookupMessage.classList.add('error');
    return;
  }

  state.connectedWallet = wallet;
  elements.walletLookupMessage.classList.remove('error');
  elements.walletLookupMessage.textContent = state.holders.some((holder) => holder.wallet === wallet)
    ? 'Live holder record found. Ticket eligibility is updated below.'
    : 'Address checked. No current holder record was found in the live feed.';
  renderTicket();
  renderHistory();
}

elements.ticketLookup.addEventListener('submit', lookupWallet);
elements.walletSearch.addEventListener('input', renderPlayerBoard);
elements.closeDistribution.addEventListener('click', closeDistributionPanel);
window.addEventListener('powersol:draw', (event) => animateWinnerSelection(event.detail));
setInterval(updateCurrentDraw, 1_000);
connectSocket();
