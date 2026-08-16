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
  walletButton: document.getElementById('walletButton'),
  cycleLabel: document.getElementById('cycleLabel'),
  drawState: document.getElementById('drawState'),
  prizePool: document.getElementById('prizePool'),
  countdown: document.getElementById('countdown'),
  drawPlayers: document.getElementById('drawPlayers'),
  totalEntries: document.getElementById('totalEntries'),
  winningBall: document.getElementById('winningBall'),
  drawMessage: document.getElementById('drawMessage'),
  ticketWallet: document.getElementById('ticketWallet'),
  ticketState: document.getElementById('ticketState'),
  tokensHeld: document.getElementById('tokensHeld'),
  eligibleBalls: document.getElementById('eligibleBalls'),
  ticketCycle: document.getElementById('ticketCycle'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressBar: document.getElementById('progressBar'),
  ticketNumbers: document.getElementById('ticketNumbers'),
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

  if (!nextTime) {
    elements.countdown.textContent = '--:--:--';
    return;
  }
  const remaining = Math.max(0, new Date(nextTime).getTime() - Date.now());
  elements.countdown.textContent = `${String(Math.floor(remaining / 3_600_000)).padStart(2, '0')}:${String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, '0')}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, '0')}`;
}

function renderTicket() {
  const wallet = state.connectedWallet;
  const holder = state.holders.find((item) => item.wallet === wallet);
  const balance = holder?.balance || 0;
  const eligible = estimatedBallCount(balance);
  const assigned = assignedEntries(wallet);
  const carried = Math.min(balance % TOKENS_PER_BALL, TOKENS_PER_BALL);

  elements.ticketWallet.textContent = wallet || 'Connect a wallet to load your ticket';
  elements.ticketState.textContent = wallet ? 'Wallet connected' : 'Wallet not connected';
  elements.tokensHeld.textContent = wallet ? formatAmount(balance) : '--';
  elements.eligibleBalls.textContent = `${eligible} / ${MAX_BALLS}`;
  elements.progressPercent.textContent = wallet ? `${Math.round((carried / TOKENS_PER_BALL) * 100)}%` : '0%';
  elements.progressBar.style.width = `${wallet ? (carried / TOKENS_PER_BALL) * 100 : 0}%`;
  elements.progressLabel.textContent = wallet
    ? `${formatAmount(carried)} / ${formatAmount(TOKENS_PER_BALL)} until your next ball`
    : '500,000 tokens are required for your first ball';

  elements.ticketNumbers.replaceChildren();
  if (!wallet || !assigned.length) {
    elements.ticketNumbers.classList.add('empty');
    elements.ticketNumbers.textContent = wallet
      ? 'Ticket numbers will appear when the Powerball backend provides assigned entries.'
      : 'Connect a wallet to view your ticket.';
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
    : '<p class="empty-message">Connect a wallet to view previous POWER tickets.</p>';
}

function hydrateFromState(data) {
  state.data = data;
  state.holders = Array.isArray(data.holders) ? data.holders : [];
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
      mergePowerData({ ...data, winningNumber: data?.winningNumber ?? data?.number });
      updateCurrentDraw();
      renderHistory();
      break;
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

async function connectWallet() {
  const provider = window.solana;
  if (!provider?.connect) {
    elements.walletButton.textContent = 'Wallet provider required';
    return;
  }
  try {
    const response = await provider.connect();
    state.connectedWallet = response.publicKey.toString();
    elements.walletButton.textContent = shorten(state.connectedWallet);
    renderTicket();
    renderHistory();
  } catch {
    elements.walletButton.textContent = 'Connect wallet';
  }
}

elements.walletButton.addEventListener('click', connectWallet);
elements.walletSearch.addEventListener('input', renderPlayerBoard);
setInterval(updateCurrentDraw, 1_000);
connectSocket();
