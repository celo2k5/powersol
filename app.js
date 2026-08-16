const SOCKET_URL = 'wss://marcelo-admin.up.railway.app';
const TOKENS_PER_BALL = 500_000;
const MAX_BALLS = 80;

const state = {
  socket: null,
  retryMs: 1_000,
  retryTimer: null,
  data: null,
  holders: [],
  holderMint: '',
  connectedWallet: '',
  selection: {
    timer: null,
    running: false,
  },
  lucky: {
    seenTransfers: new Set(),
    transactionFeed: [],
    totalSolDeployed: 0,
    lastCycleLog: '',
    failureMessage: '',
    lastWinner: '',
    rosterHolders: [],
    winnerRevealed: false,
    closeTimer: null,
    stageTimer: null,
    pendingWinner: null,
    cycleEnded: false,
    selectionStartedAt: 0,
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
  distributionKicker: document.getElementById('distributionKicker'),
  distributionTitle: document.getElementById('distributionTitle'),
  distributionResultLabel: document.getElementById('distributionResultLabel'),
  distributionWinning: document.getElementById('distributionWinning'),
  distributionRows: document.getElementById('distributionRows'),
  closeDistribution: document.getElementById('closeDistribution'),
  machinePhase: document.getElementById('machinePhase'),
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
  holderTokenMint: document.getElementById('holderTokenMint'),
  walletSearch: document.getElementById('walletSearch'),
  playerCount: document.getElementById('playerCount'),
  playerRows: document.getElementById('playerRows'),
  ballRoster: document.getElementById('ballRoster'),
  rosterSummary: document.getElementById('rosterSummary'),
  rosterStatus: document.getElementById('rosterStatus'),
  winnerHistory: document.getElementById('winnerHistory'),
  ticketHistory: document.getElementById('ticketHistory'),
  activityFeed: document.getElementById('activityFeed'),
  totalSolDeployed: document.getElementById('totalSolDeployed'),
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

function currentHolderSnapshot() {
  const mint = currentTokenMint();
  if (state.holderMint && mint && state.holderMint !== mint) {
    state.lucky.rosterHolders = [];
    return [];
  }
  return state.holders;
}

function isLuckyV1() {
  return state.data?.config?.robinhoodMode === 'luckyv1';
}

function isNativeLuckyTransfer(data) {
  return Boolean(
    data
      && typeof data.wallet === 'string'
      && data.wallet
      && data.tokenMint === 'native'
      && data.tokenSymbol === 'SOL'
      && data.tokenMetadata == null
  );
}

function getTransferKey(data) {
  return data?.signature || `${data?.wallet || 'unknown'}:${data?.timestamp || ''}:${data?.amount ?? ''}`;
}

function eventKey(type, data) {
  const signature = typeof data?.signature === 'string' ? data.signature : '';
  return signature ? `${type}:${signature}` : `${type}:${data?.timestamp || ''}:${data?.wallet || ''}:${data?.amount ?? ''}`;
}

function addActivityEvent(type, data, render = true) {
  if (!type || !data || typeof data !== 'object') return;
  const key = eventKey(type, data);
  state.lucky.transactionFeed = state.lucky.transactionFeed.filter((event) => eventKey(event.type, event.data) !== key);
  state.lucky.transactionFeed.unshift({ type, data });
  state.lucky.transactionFeed = state.lucky.transactionFeed.slice(0, 20);
  if (render) renderActivityFeed();
}

function renderActivityFeed() {
  elements.activityFeed.replaceChildren();
  if (!state.lucky.transactionFeed.length) {
    const message = document.createElement('p');
    message.className = 'empty-message';
    message.textContent = 'Waiting for live draw and transfer events.';
    elements.activityFeed.append(message);
    return;
  }

  state.lucky.transactionFeed.slice(0, 12).forEach((event) => {
    const data = event.data || {};
    const row = document.createElement('div');
    row.className = 'activity-row';
    const icon = createBall(event.type === 'transfer' ? 'SOL' : event.type === 'fee_claim' ? 'FEE' : 'SWAP', event.type === 'transfer');
    icon.classList.add('activity-icon');
    const details = document.createElement('div');
    details.className = 'activity-details';
    const title = document.createElement('strong');
    const description = event.type === 'transfer'
      ? `SOL payout · ${shorten(data.wallet)} · ${formatSol(data.amount)}`
      : event.type === 'fee_claim'
        ? `Fee claim · ${data.status || 'pending'}`
        : `Token swap · ${data.tokenSymbol || 'token'} · ${data.status || 'pending'}`;
    title.textContent = description;
    const timestamp = document.createElement('span');
    timestamp.textContent = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Live event';
    details.append(title, timestamp);
    const right = document.createElement('div');
    right.className = 'activity-meta';
    const status = document.createElement('span');
    status.textContent = String(data.status || 'event');
    right.append(status);
    if (typeof data.signature === 'string' && data.signature) {
      const link = document.createElement('a');
      link.href = `https://solscan.io/tx/${encodeURIComponent(data.signature)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Solscan';
      right.append(link);
    }
    row.append(icon, details, right);
    elements.activityFeed.append(row);
  });
}

function setRosterPhase(phase) {
  if (!elements.ballRoster) return;
  const normalized = String(phase || 'idle').replace(/_/g, '-');
  elements.ballRoster.dataset.phase = normalized;
  elements.ballRoster.classList.toggle('is-selecting', normalized === 'scanning' || normalized === 'selecting');
  elements.ballRoster.classList.toggle('is-locking', normalized === 'locking');
  elements.ballRoster.classList.toggle('is-winner', normalized === 'winner');

  if (normalized === 'idle' || normalized === 'scanning' || normalized === 'selecting') {
    elements.ballRoster.querySelectorAll('.roster-card').forEach((card) => {
      card.classList.remove('is-dimmed', 'is-locked', 'is-winner');
    });
    if (elements.rosterStatus) {
      elements.rosterStatus.textContent = elements.ballRoster.querySelector('.roster-card')
        ? 'Every ball has equal odds'
        : 'Awaiting holder snapshot';
    }
  }
}

function highlightWinningRoster(wallet, phase = 'locking') {
  if (!elements.ballRoster || !wallet) return;
  const cards = [...elements.ballRoster.querySelectorAll('.roster-card')];
  const selected = cards.find((card) => card.dataset.wallet === wallet);
  cards.forEach((card) => {
    card.classList.remove('is-locked', 'is-winner');
    card.classList.toggle('is-dimmed', Boolean(selected && card !== selected));
  });

  if (!selected) {
    if (elements.rosterStatus) elements.rosterStatus.textContent = `${shorten(wallet)} selected outside the current snapshot`;
    return;
  }

  selected.classList.remove('is-dimmed');
  selected.classList.add(phase === 'winner' ? 'is-winner' : 'is-locked');
  const ballLabel = selected.querySelector('.roster-ball-label')?.textContent || 'draw ball';
  if (elements.rosterStatus) {
    elements.rosterStatus.textContent = phase === 'winner'
      ? `${ballLabel} won by ${shorten(wallet)}`
      : `${ballLabel} locked - reveal incoming`;
  }
}

function renderBallRoster() {
  if (!elements.ballRoster) return;
  const presentationActive = state.selection.running || Boolean(state.lucky.pendingWinner) || state.lucky.winnerRevealed;
  const liveHolders = currentHolderSnapshot();
  if (liveHolders.length) state.lucky.rosterHolders = liveHolders.slice();
  const holders = presentationActive && state.lucky.rosterHolders.length
    ? state.lucky.rosterHolders
    : liveHolders;
  const count = holders.length;
  elements.rosterSummary.textContent = `${count} holder${count === 1 ? '' : 's'} / ${count} ball${count === 1 ? '' : 's'}`;
  elements.ballRoster.replaceChildren();

  if (!count) {
    const message = document.createElement('p');
    message.className = 'empty-message';
    message.textContent = 'The qualifying holder snapshot will populate the ball registry.';
    elements.ballRoster.append(message);
    setRosterPhase('idle');
    return;
  }

  holders.forEach((holder, index) => {
    const ballNumber = String(index + 1).padStart(2, '0');
    const card = document.createElement('article');
    card.className = 'roster-card';
    card.dataset.wallet = holder.wallet;
    card.style.setProperty('--ball-delay', `${(index % 17) * 0.055}s`);

    const ball = createBall(ballNumber, false, true);
    ball.classList.add('roster-ball');
    const copy = document.createElement('div');
    copy.className = 'roster-card-copy';
    const label = document.createElement('span');
    label.className = 'roster-ball-label';
    label.textContent = `Draw ball ${ballNumber}`;
    const wallet = document.createElement('strong');
    wallet.className = 'roster-wallet';
    wallet.textContent = shorten(holder.wallet);
    wallet.title = holder.wallet;
    const balance = document.createElement('span');
    balance.className = 'roster-balance';
    balance.textContent = `${formatAmount(holder.balance)} tokens`;
    copy.append(label, wallet, balance);
    card.append(ball, copy);
    elements.ballRoster.append(card);
  });

  const pendingWallet = state.lucky.pendingWinner?.wallet;
  if (pendingWallet) {
    highlightWinningRoster(pendingWallet, 'locking');
  } else if (state.lucky.winnerRevealed && state.lucky.lastWinner) {
    highlightWinningRoster(state.lucky.lastWinner, 'winner');
  } else {
    setRosterPhase(elements.ballRoster.dataset.phase || 'idle');
  }
}

function minimumHolding() {
  return Number(state.data?.config?.minHolding) || 0;
}

function formatSol(value) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(Number(value) || 0)} SOL`;
}

function renderTokenMint() {
  const mint = currentTokenMint();
  const label = mint || 'Awaiting backend token configuration';
  elements.tokenMint.textContent = label;
  elements.tokenMint.title = mint;
  if (elements.holderTokenMint) {
    elements.holderTokenMint.textContent = label;
    elements.holderTokenMint.title = mint;
  }
}

function updateConnection(status) {
  elements.socketStatus.classList.toggle('live', status === 'live');
  elements.socketStatus.lastChild.textContent = status === 'live' ? ' Live data' : status === 'reconnecting' ? ' Reconnecting' : ' Connecting';
}

function setPresentationPhase(phase) {
  const normalized = String(phase || 'idle').replace(/_/g, '-');
  elements.drawCard.dataset.phase = normalized;
  elements.distributionPanel.dataset.phase = normalized;
  setRosterPhase(normalized);
  if (elements.machinePhase) {
    const labels = {
      idle: 'STANDBY',
      scanning: 'SCANNING HOLDERS',
      selecting: 'ROLLING SELECTION',
      locking: 'FINALIZING DRAW',
      winner: 'WINNER CONFIRMED',
    };
    elements.machinePhase.textContent = labels[normalized] || normalized.toUpperCase();
  }
}

function updateCurrentDraw() {
  if (isLuckyV1()) {
    updateLuckyDraw();
    return;
  }

  const cycle = state.powerData.cycle;
  const currentCycle = cycle?.round || cycle?.id || state.data?.currentCycle?.round;
  const nextTime = cycle?.nextDrawTime || state.data?.nextDistributionTime;
  const winner = state.powerData.winningNumber;
  const liveHolders = currentHolderSnapshot();
  const estimatedEntries = liveHolders.reduce((total, holder) => total + estimatedBallCount(holder.balance), 0);

  elements.cycleLabel.textContent = currentCycle ? `Cycle #${currentCycle}` : 'Cycle unavailable';
  elements.prizePool.textContent = state.powerData.prizePool == null ? '--' : formatAmount(state.powerData.prizePool);
  elements.drawPlayers.textContent = String(liveHolders.length);
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

function updateLuckyDraw() {
  const cycle = state.data?.currentCycle || {};
  const nextTime = state.data?.nextDistributionTime;
  const phase = cycle.phase || 'idle';
  const active = Boolean(cycle.active);

  elements.cycleLabel.textContent = active ? `Draw / ${phase.replace(/_/g, ' ')}` : 'Next draw';
  elements.prizePool.textContent = cycle.solUsable > 0 ? formatSol(cycle.solUsable) : '-- SOL';
  elements.drawPlayers.textContent = String(currentHolderSnapshot().length);
  elements.totalEntries.textContent = active
    ? Number(cycle.transfersCompleted) > 0 ? '1 ball paid' : 'Selecting'
    : '1 per holder';
  elements.ticketCycle.textContent = active ? phase.replace(/_/g, ' ') : 'Next draw';
  elements.totalSolDeployed.textContent = state.lucky.totalSolDeployed > 0 ? formatSol(state.lucky.totalSolDeployed) : '--';

  if (!state.selection.running) {
    if (state.lucky.winnerRevealed) {
      elements.winningBall.textContent = 'SOL';
      elements.drawState.textContent = 'Winner confirmed';
    } else if (state.lucky.failureMessage) {
      elements.winningBall.textContent = '?';
      elements.drawState.textContent = 'Draw failed';
      elements.drawMessage.textContent = state.lucky.failureMessage;
    } else {
      setPresentationPhase('idle');
      elements.winningBall.textContent = '?';
      elements.drawState.textContent = active ? phase.replace(/_/g, ' ') : nextTime ? 'Draw pending' : 'Awaiting draw data';
      elements.drawMessage.textContent = active
        ? 'One draw ball maps to each qualifying holder. The winning wallet appears only after the native SOL transfer.'
        : nextTime
          ? 'Every qualifying holder gets one draw ball when the next draw begins.'
          : 'Awaiting scheduler data from the backend.';
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
  elements.distributionPanel.classList.remove('is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'true');
}

function openLuckySelectionPanel(phase) {
  const phaseLabel = String(phase || 'fetching_holders').replace(/_/g, ' ');
  elements.distributionKicker.textContent = '$POWERSOL live draw';
  elements.distributionTitle.textContent = phase === 'distributing' ? 'Selecting ball' : 'Scanning holders';
  elements.distributionResultLabel.textContent = 'Eligible balls';
  elements.distributionWinning.textContent = String(currentHolderSnapshot().length);
  elements.distributionRows.replaceChildren();
  const message = document.createElement('p');
  message.className = 'distribution-empty';
  message.textContent = `Phase: ${phaseLabel}. Each qualifying holder is represented by one draw ball; the winner stays hidden until the native SOL transfer arrives.`;
  elements.distributionRows.append(message);
  elements.distributionPanel.classList.add('is-open', 'is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
}

function startLuckyPresentation(cycle) {
  const wasSelecting = state.selection.running;
  if (!wasSelecting) clearTimeout(state.selection.timer);
  clearTimeout(state.lucky.closeTimer);
  clearTimeout(state.lucky.stageTimer);
  if (!wasSelecting) state.lucky.selectionStartedAt = Date.now();
  state.selection.running = true;
  state.lucky.winnerRevealed = false;
  state.lucky.failureMessage = '';
  if (!wasSelecting) {
    state.lucky.cycleEnded = false;
    state.lucky.lastWinner = '';
    state.lucky.rosterHolders = [];
    if (elements.ballRoster) {
      elements.ballRoster.replaceChildren();
      elements.rosterSummary.textContent = '0 holders / 0 balls';
      elements.rosterStatus.textContent = 'Scanning for qualifying holders';
    }
  }
  setPresentationPhase(cycle.phase === 'distributing' ? 'selecting' : 'scanning');
  elements.drawCard.classList.add('is-selecting');
  elements.winningBall.textContent = '?';
  elements.drawState.textContent = cycle.phase === 'distributing' ? 'Selecting winner' : 'Scanning holders';
  elements.drawMessage.textContent = cycle.phase === 'distributing'
    ? 'The draw field is converging on one ball from the backend-qualified holder set.'
    : 'The draw is converting the backend-qualified holder snapshot into one ball per holder.';
  openLuckySelectionPanel(cycle.phase || 'fetching_holders');
}

function scheduleLuckyOverlayClose() {
  clearTimeout(state.lucky.closeTimer);
  clearTimeout(state.lucky.stageTimer);
  state.lucky.closeTimer = setTimeout(() => {
    closeDistributionPanel();
    setPresentationPhase('idle');
    state.lucky.winnerRevealed = false;
    state.lucky.failureMessage = '';
    state.lucky.lastWinner = '';
    state.lucky.rosterHolders = [];
    renderBallRoster();
    updateCurrentDraw();
  }, 8_000);
}

function showLuckyWinner(transfer) {
  state.lucky.pendingWinner = null;
  clearTimeout(state.selection.timer);
  clearTimeout(state.lucky.stageTimer);
  state.selection.running = false;
  state.lucky.winnerRevealed = true;
  state.lucky.failureMessage = '';
  state.lucky.lastWinner = transfer.wallet;
  setPresentationPhase('winner');
  highlightWinningRoster(transfer.wallet, 'winner');
  elements.drawCard.classList.remove('is-selecting');
  elements.winningBall.textContent = 'SOL';
  elements.drawState.textContent = 'Winner confirmed';
  elements.drawMessage.textContent = `${shorten(transfer.wallet)} is the selected ball and receives ${formatSol(transfer.amount)}.`;
  elements.distributionKicker.textContent = '$POWERSOL winner';
  elements.distributionTitle.textContent = 'Winning ball selected';
  elements.distributionResultLabel.textContent = 'Winning holder';
  elements.distributionWinning.textContent = shorten(transfer.wallet);
  elements.distributionRows.replaceChildren();

  const payout = document.createElement('div');
  payout.className = 'distribution-row';
  const wallet = document.createElement('span');
  wallet.textContent = shorten(transfer.wallet);
  wallet.title = transfer.wallet;
  const amount = document.createElement('strong');
  amount.textContent = formatSol(transfer.amount);
  payout.append(wallet, amount);
  elements.distributionRows.append(payout);

  if (typeof transfer.signature === 'string' && transfer.signature) {
    const link = document.createElement('a');
    link.href = `https://solscan.io/tx/${encodeURIComponent(transfer.signature)}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = 'distribution-solscan';
    link.textContent = 'View transaction on Solscan';
    elements.distributionRows.append(link);
  }

  elements.distributionPanel.classList.add('is-open');
  elements.distributionPanel.classList.remove('is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
  if (state.lucky.cycleEnded) scheduleLuckyOverlayClose();
}

function revealLuckyWinner(transfer) {
  const key = getTransferKey(transfer);
  if (state.lucky.seenTransfers.has(key)) return;
  state.lucky.seenTransfers.add(key);

  if (!state.selection.running) startLuckyPresentation({ phase: 'distributing' });

  state.lucky.pendingWinner = transfer;
  const minimumSuspenseMs = 7_000;
  const elapsed = Date.now() - state.lucky.selectionStartedAt;
  const revealDelay = Math.max(0, minimumSuspenseMs - elapsed);

  clearTimeout(state.lucky.stageTimer);
  setPresentationPhase('locking');
  highlightWinningRoster(transfer.wallet, 'locking');
  elements.drawState.textContent = 'Winner locked';
  elements.drawMessage.textContent = 'The transfer signal is secured. Finalizing the draw before the public reveal.';
  elements.distributionKicker.textContent = 'Final verification';
  elements.distributionTitle.textContent = 'Winner locked';
  elements.distributionResultLabel.textContent = 'Reveal incoming';
  elements.distributionWinning.textContent = 'SOL';
  elements.distributionRows.replaceChildren();
  const message = document.createElement('p');
  message.className = 'distribution-empty';
  message.textContent = 'The native SOL transfer is received. Holding the reveal while the final draw beat completes.';
  elements.distributionRows.append(message);

  if (revealDelay > 0) {
    const finalizingDelay = Math.min(Math.round(revealDelay * .46), 2_400);
    state.lucky.stageTimer = setTimeout(() => {
      if (state.lucky.pendingWinner !== transfer) return;
      elements.distributionKicker.textContent = 'Draw calibration';
      elements.distributionTitle.textContent = 'Signal converging';
      elements.distributionResultLabel.textContent = 'Finalizing';
      if (elements.distributionRows.firstElementChild) {
        elements.distributionRows.firstElementChild.textContent = 'One final power-field pass. The selected ball stays hidden until the reveal beat completes.';
      }
      elements.drawState.textContent = 'Finalizing draw';
      elements.drawMessage.textContent = 'Power field stabilized. Preparing the native SOL distribution reveal.';
    }, finalizingDelay);
  }

  clearTimeout(state.selection.timer);
  state.selection.timer = setTimeout(() => showLuckyWinner(transfer), revealDelay);
}

function showLuckyFailure(error) {
  clearTimeout(state.selection.timer);
  clearTimeout(state.lucky.stageTimer);
  state.selection.running = false;
  state.lucky.pendingWinner = null;
  state.lucky.winnerRevealed = false;
  state.lucky.failureMessage = error || 'The backend ended this draw without a native SOL transfer.';
  state.lucky.lastWinner = '';
  setPresentationPhase('idle');
  elements.drawCard.classList.remove('is-selecting');
  elements.winningBall.textContent = '?';
  elements.drawState.textContent = 'Draw failed';
  elements.drawMessage.textContent = error || 'No winner was selected because the backend could not complete the draw.';
  elements.distributionKicker.textContent = '$POWERSOL draw';
  elements.distributionTitle.textContent = 'No winner selected';
  elements.distributionResultLabel.textContent = 'Status';
  elements.distributionWinning.textContent = 'FAILED';
  elements.distributionRows.replaceChildren();
  const message = document.createElement('p');
  message.className = 'distribution-empty';
  message.textContent = state.lucky.failureMessage;
  elements.distributionRows.append(message);
  elements.distributionPanel.classList.add('is-open');
  elements.distributionPanel.classList.remove('is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
  scheduleLuckyOverlayClose();
}

function completeLuckyCycle(data) {
  if (state.data) {
    state.data.currentCycle = data?.cycle || { active: false, phase: 'completed' };
    state.data.history = Array.isArray(data?.history) ? data.history : state.data.history;
  }
  state.powerData.history = Array.isArray(data?.history) ? data.history : state.powerData.history;
  if (data?.totalSolDeployed != null) state.lucky.totalSolDeployed = Number(data.totalSolDeployed) || 0;
  renderHistory();
  state.lucky.cycleEnded = true;

  const latest = Array.isArray(data?.history) ? data.history[0] : null;
  const failed = data?.cycle?.phase === 'failed' || latest?.status === 'failed';
  if (failed) {
    showLuckyFailure(latest?.error || 'The backend ended this draw without a native SOL transfer.');
    updateCurrentDraw();
    return;
  }

  if (state.lucky.pendingWinner) {
    updateCurrentDraw();
    return;
  }

  state.selection.running = false;
  elements.drawCard.classList.remove('is-selecting');
  if (state.lucky.winnerRevealed) {
    scheduleLuckyOverlayClose();
  } else {
    closeDistributionPanel();
    setPresentationPhase('idle');
  }

  updateCurrentDraw();
}

function openWinnerSelectionPanel() {
  elements.distributionKicker.textContent = 'Power chamber active';
  elements.distributionTitle.textContent = 'Selecting winner';
  elements.distributionWinning.textContent = '?';
  elements.distributionRows.replaceChildren();
  const message = document.createElement('p');
  message.className = 'distribution-empty';
  message.textContent = 'A verified PowerSol ball is being selected. The final winner and payout distribution will appear here.';
  elements.distributionRows.append(message);
  elements.distributionPanel.classList.add('is-open', 'is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
}

function openDistributionPanel(winningNumber, data) {
  const entries = distributionEntriesFrom(data);
  elements.distributionKicker.textContent = 'Draw complete';
  elements.distributionTitle.textContent = 'Distribution';
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
  elements.distributionPanel.classList.remove('is-selecting');
  elements.distributionPanel.setAttribute('aria-hidden', 'false');
}

function animateWinnerSelection(data) {
  const winningNumber = winningNumberFrom(data);
  const drawData = data?.result && typeof data.result === 'object' ? { ...data, ...data.result } : data;
  const frames = 30;
  let frame = 0;

  clearTimeout(state.selection.timer);
  state.selection.running = true;
  openWinnerSelectionPanel();
  elements.drawCard.classList.add('is-selecting');
  elements.drawState.textContent = 'Selecting winner';
  elements.drawMessage.textContent = 'The PowerSol balls are in motion. Waiting for the verified draw result.';

  function spin() {
    frame += 1;
    const displayNumber = String(Math.floor(Math.random() * 1_000) + 1);
    elements.winningBall.textContent = displayNumber;
    elements.distributionWinning.textContent = displayNumber;

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
      elements.distributionKicker.textContent = 'Result pending';
      elements.distributionTitle.textContent = 'Awaiting winner';
      elements.distributionWinning.textContent = '?';
      elements.distributionPanel.classList.remove('is-selecting');
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
  const holder = currentHolderSnapshot().find((item) => item.wallet === wallet);
  const balance = holder?.balance || 0;

  if (isLuckyV1()) {
    const minimum = minimumHolding();
    const qualifies = Boolean(holder) && (minimum === 0 || balance >= minimum);
    const progress = minimum > 0 ? Math.min(100, (balance / minimum) * 100) : qualifies ? 100 : 0;

    elements.ticketWallet.textContent = wallet || 'No wallet address selected';
    elements.ticketState.textContent = wallet ? (qualifies ? 'Qualifying holder' : 'Not currently eligible') : 'Address required';
    elements.tokensHeld.textContent = wallet ? formatAmount(balance) : '--';
    elements.eligibleBalls.textContent = wallet ? (qualifies ? '1 ball' : '0 balls') : 'Not checked';
    elements.progressPercent.textContent = wallet ? `${Math.round(progress)}%` : '0%';
    elements.progressBar.style.width = `${wallet ? progress : 0}%`;
    elements.progressLabel.textContent = wallet
      ? minimum > 0
        ? `${formatAmount(balance)} / ${formatAmount(minimum)} required to qualify`
        : qualifies ? 'This holder maps to exactly one draw ball.' : 'Waiting for the current qualifying-holder snapshot.'
      : 'Enter a wallet address to check draw eligibility';

    elements.ticketNumbers.replaceChildren();
    elements.ticketNumbers.classList.add('empty');
    elements.ticketNumbers.textContent = wallet
      ? qualifies
        ? 'This qualifying holder receives exactly one draw ball.'
        : 'This wallet is not in the current backend-qualified holder snapshot.'
      : 'Enter a wallet address above to check draw eligibility.';
    return;
  }

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
  renderBallRoster();
  const filter = elements.walletSearch.value.trim().toLowerCase();
  const liveHolders = currentHolderSnapshot();
  const holders = liveHolders.filter((holder) => holder.wallet.toLowerCase().includes(filter));
  elements.playerCount.textContent = String(liveHolders.length);
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
    const balls = document.createElement('div');
    balls.className = 'mini-balls';

    let countText;
    if (isLuckyV1()) {
      const ball = createBall('1', false, true);
      ball.title = 'One draw ball assigned to this qualifying holder';
      balls.append(ball);
      countText = '1 ball';
    } else {
      const entries = assignedEntries(holder.wallet);
      const estimate = estimatedBallCount(holder.balance);
      if (entries.length) {
        entries.slice(0, MAX_BALLS).forEach((number) => balls.append(createBall(number, false, true)));
      } else {
        balls.textContent = estimate ? `${estimate} eligible - awaiting assigned ticket numbers` : 'No eligible balls';
        balls.classList.add('holder-balance');
      }
      countText = entries.length ? String(entries.length) : `${estimate}*`;
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
    count.textContent = countText;
    row.append(wallet, balance, count, balls);
    elements.playerRows.append(row);
  });
}

function renderHistory() {
  elements.winnerHistory.replaceChildren();
  if (!state.powerData.history.length) {
    elements.winnerHistory.innerHTML = `<p class="empty-message">No authoritative ${isLuckyV1() ? '$POWERSOL' : 'POWER'} draw history has been received.</p>`;
  } else {
    state.powerData.history.forEach((round) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      if (isLuckyV1()) {
        const winner = luckyWinnerFromRecord(round);
        const ball = createBall(winner ? 'WIN' : round.status === 'failed' ? '!' : 'SOL', true);
        const details = document.createElement('span');
        details.textContent = winner
          ? `Cycle #${round.round ?? '--'} · ${shorten(winner)} · ${round.holdersCount ?? 1} ball selected`
          : `Cycle #${round.round ?? '--'} · ${round.status || 'completed'}${round.error ? ` · ${round.error}` : ''}`;
        if (winner) details.title = winner;
        const amount = document.createElement('strong');
        amount.textContent = round.solSpent != null ? formatSol(round.solSpent) : '-- SOL';
        row.append(ball, details, amount);
        elements.winnerHistory.append(row);
        return;
      }
      row.append(
        createBall(round.winningNumber, true),
        Object.assign(document.createElement('span'), { textContent: `Cycle #${round.cycle} - ${round.winners?.length || 0} winner(s)` }),
        Object.assign(document.createElement('strong'), { textContent: round.prizePool ? formatAmount(round.prizePool) : '--' })
      );
      elements.winnerHistory.append(row);
    });
  }
  elements.ticketHistory.innerHTML = state.connectedWallet
    ? `<p class="empty-message">Previous wallet ${isLuckyV1() ? 'draws' : 'tickets'} require authoritative history events from the backend.</p>`
    : `<p class="empty-message">Look up a wallet address to view previous ${isLuckyV1() ? '$POWERSOL draws' : 'POWER tickets'}.</p>`;
}

function hydrateFromState(data) {
  const previousMint = state.holderMint;
  state.data = data;
  state.holders = Array.isArray(data.holders) ? data.holders : [];
  state.holderMint = currentTokenMint();
  if (previousMint && state.holderMint && previousMint !== state.holderMint) {
    state.lucky.rosterHolders = [];
  }
  state.powerData.history = Array.isArray(data.history) ? data.history : state.powerData.history;
  if (data.totalSolDeployed != null) state.lucky.totalSolDeployed = Number(data.totalSolDeployed) || 0;
  renderTokenMint();
  if (isLuckyV1() && data.currentCycle?.active) startLuckyPresentation(data.currentCycle);
  updateCurrentDraw();
  renderTicket();
  renderPlayerBoard();
  renderHistory();
  renderActivityFeed();
}

function luckyWinnerFromRecord(record) {
  if (!record || typeof record !== 'object') return '';
  if (typeof record.publicWinner === 'string' && record.publicWinner) return record.publicWinner;
  if (Array.isArray(record.transfers)) {
    const transfer = record.transfers.find((item) => item && typeof item.wallet === 'string' && item.wallet);
    return transfer?.wallet || '';
  }
  return '';
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
    case 'tx_history':
      state.lucky.transactionFeed = [];
      (Array.isArray(data) ? data : []).forEach((event) => {
        addActivityEvent(event?.type, event?.data, false);
        if (event?.type === 'transfer' && isNativeLuckyTransfer(event.data)) {
          state.lucky.seenTransfers.add(getTransferKey(event.data));
        }
      });
      renderActivityFeed();
      break;
    case 'fee_claim':
    case 'token_swap':
      addActivityEvent(type, data);
      break;
    case 'holders_update':
      state.holders = Array.isArray(data) ? data : [];
      state.holderMint = currentTokenMint();
      if (isLuckyV1() && state.selection.running) openLuckySelectionPanel(state.data?.currentCycle?.phase || 'fetching_holders');
      renderTicket();
      renderPlayerBoard();
      updateCurrentDraw();
      break;
    case 'holder_pnl_update':
    case 'holder_sent_update': {
      const holder = currentHolderSnapshot().find((item) => item.wallet === data?.wallet);
      if (holder) Object.assign(holder, data);
      renderTicket();
      renderPlayerBoard();
      break;
    }
    case 'tick':
    case 'scheduler_state':
      if (state.data) {
        if (data?.nextDistributionTime !== undefined) {
          state.data.nextDistributionTime = data.nextDistributionTime;
        }
        if (data?.schedulerRunning != null) state.data.schedulerRunning = data.schedulerRunning;
      }
      updateCurrentDraw();
      break;
    case 'cycle_log':
      if (isLuckyV1()) {
        state.lucky.lastCycleLog = typeof data === 'string' ? data : '';
        if (state.selection.running && !state.lucky.pendingWinner && state.lucky.lastCycleLog) {
          elements.drawMessage.textContent = state.lucky.lastCycleLog;
        }
      }
      break;
    case 'cycle_start':
      if (isLuckyV1()) {
        if (state.data) state.data.currentCycle = data || {};
        startLuckyPresentation(data || {});
        updateCurrentDraw();
        break;
      }
      break;
    case 'cycle_update':
      if (isLuckyV1()) {
        if (state.data) state.data.currentCycle = data || {};
        if (data?.active) startLuckyPresentation(data);
        updateCurrentDraw();
        break;
      }
      break;
    case 'transfer':
      addActivityEvent(type, data);
      if (isLuckyV1() && isNativeLuckyTransfer(data) && !['failed', 'skipped'].includes(data.status)) {
        if (state.data?.currentCycle) {
          state.data.currentCycle.transfersCompleted = Math.max(Number(state.data.currentCycle.transfersCompleted) || 0, 1);
        }
        updateCurrentDraw();
        revealLuckyWinner(data);
      }
      break;
    case 'cycle_end':
      if (isLuckyV1()) {
        completeLuckyCycle(data);
        break;
      }
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
window.addEventListener('powersol:message', (event) => {
  if (event.detail?.type) handleMessage(event.detail);
});
setInterval(updateCurrentDraw, 1_000);
connectSocket();
