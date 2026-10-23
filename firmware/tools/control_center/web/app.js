// ============================================================
// ESP32-S3 SERVO TELEMETRY & CONTROL CENTER - QUAD SERVO ENGINE
// 4 Servos • 2 FIFO Columns (Col 1: S1+S2, Col 2: S3+S4) • Active Ground Clamp
// ============================================================

(function () {
  'use strict';

  // State Management for Quad Servos
  const state = {
    connected: false,
    wsConnected: false,
    port: 'COM4',
    ip: '192.168.4.1',
    col1: { state: 'IDLE', active: false },
    col2: { state: 'IDLE', active: false },
    s1: {
      pin: 18,
      currentPwm: 90,
      targetPwm: 90,
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    },
    s2: {
      pin: 19,
      currentPwm: 90,
      targetPwm: 90,
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    },
    s3: {
      pin: 21,
      currentPwm: 90,
      targetPwm: 90,
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    },
    s4: {
      pin: 22,
      currentPwm: 90,
      targetPwm: 90,
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    },
    ir: {
      pin: 10,
      txPin: 11,
      detected: false,
      raw: 1,
      count: 0,
      blockMs: 0,
      autoTrigger: 0,
      txEnabled: true
    },
    oscilloscopeHistory: [] // [{ t, s1Pwm, s2Pwm, s3Pwm, s4Pwm }]
  };

  // DOM Elements
  const el = {
    // IR Deck
    irStatusCard: document.getElementById('ir-status-card'),
    irRadarCircle: document.getElementById('ir-radar-circle'),
    irIcon: document.getElementById('ir-icon'),
    irStatusMain: document.getElementById('ir-status-main'),
    irStatusSub: document.getElementById('ir-status-sub'),
    irTagRaw: document.getElementById('ir-tag-raw'),
    irTagBlock: document.getElementById('ir-tag-block'),
    irCounterNumber: document.getElementById('ir-counter-number'),
    irTxBadge: document.getElementById('ir-tx-badge'),
    irLastTimeText: document.getElementById('ir-last-time-text'),
    btnIrReset: document.getElementById('btn-ir-reset'),
    btnIrSimulate: document.getElementById('btn-ir-simulate'),
    btnIrToggleTx: document.getElementById('btn-ir-toggle-tx'),
    btnAutoOff: document.getElementById('btn-auto-off'),
    btnAutoS1: document.getElementById('btn-auto-s1'),
    btnAutoS2: document.getElementById('btn-auto-s2'),
    btnAutoBoth: document.getElementById('btn-auto-both'),

    // Header
    pillSerial: document.getElementById('pill-serial'),
    dotSerial: document.getElementById('dot-serial'),
    valPort: document.getElementById('val-port'),
    pillWs: document.getElementById('pill-ws'),
    dotWs: document.getElementById('dot-ws'),
    valWs: document.getElementById('val-ws'),
    valIp: document.getElementById('val-ip'),
    btnReboot: document.getElementById('btn-reboot'),
    btnEstop: document.getElementById('btn-estop'),

    // Top Action Deck
    topBtnCol1Dispense: document.getElementById('top-btn-col1-dispense'),
    topBtnCol2Dispense: document.getElementById('top-btn-col2-dispense'),
    topBtnAllOpen: document.getElementById('top-btn-all-open'),
    topBtnAllClose: document.getElementById('top-btn-all-close'),
    topBtnAllStart: document.getElementById('top-btn-all-start'),
    topBtnAllStop: document.getElementById('top-btn-all-stop'),

    topBtnS1Open: document.getElementById('top-btn-s1-open'),
    topBtnS1Close: document.getElementById('top-btn-s1-close'),
    topBtnS1Start: document.getElementById('top-btn-s1-start'),
    topBtnS1Stop: document.getElementById('top-btn-s1-stop'),
    topBtnS1TestFwd: document.getElementById('top-btn-s1-test-fwd'),
    topBtnS1TestRev: document.getElementById('top-btn-s1-test-rev'),

    topBtnS2Open: document.getElementById('top-btn-s2-open'),
    topBtnS2Close: document.getElementById('top-btn-s2-close'),
    topBtnS2Start: document.getElementById('top-btn-s2-start'),
    topBtnS2Stop: document.getElementById('top-btn-s2-stop'),
    topBtnS2TestFwd: document.getElementById('top-btn-s2-test-fwd'),
    topBtnS2TestRev: document.getElementById('top-btn-s2-test-rev'),

    topBtnS3Open: document.getElementById('top-btn-s3-open'),
    topBtnS3Close: document.getElementById('top-btn-s3-close'),
    topBtnS3Start: document.getElementById('top-btn-s3-start'),
    topBtnS3Stop: document.getElementById('top-btn-s3-stop'),
    topBtnS3TestFwd: document.getElementById('top-btn-s3-test-fwd'),
    topBtnS3TestRev: document.getElementById('top-btn-s3-test-rev'),

    topBtnS4Open: document.getElementById('top-btn-s4-open'),
    topBtnS4Close: document.getElementById('top-btn-s4-close'),
    topBtnS4Start: document.getElementById('top-btn-s4-start'),
    topBtnS4Stop: document.getElementById('top-btn-s4-stop'),
    topBtnS4TestFwd: document.getElementById('top-btn-s4-test-fwd'),
    topBtnS4TestRev: document.getElementById('top-btn-s4-test-rev'),

    // Stat Cards
    badgeS1State: document.getElementById('badge-s1-state'),
    cardS1Val: document.getElementById('card-s1-val'),
    cardS1Sub: document.getElementById('card-s1-sub'),
    barS1Cycle: document.getElementById('bar-s1-cycle'),

    badgeS2State: document.getElementById('badge-s2-state'),
    cardS2Val: document.getElementById('card-s2-val'),
    cardS2Sub: document.getElementById('card-s2-sub'),
    barS2Cycle: document.getElementById('bar-s2-cycle'),

    badgeS3State: document.getElementById('badge-s3-state'),
    cardS3Val: document.getElementById('card-s3-val'),
    cardS3Sub: document.getElementById('card-s3-sub'),
    barS3Cycle: document.getElementById('bar-s3-cycle'),

    badgeS4State: document.getElementById('badge-s4-state'),
    cardS4Val: document.getElementById('card-s4-val'),
    cardS4Sub: document.getElementById('card-s4-sub'),
    barS4Cycle: document.getElementById('bar-s4-cycle'),

    cardClamp: document.getElementById('card-clamp'),

    // Quad Gauges
    gaugeCanvas1: document.getElementById('servoGaugeCanvas1'),
    s1GaugePwmBadge: document.getElementById('s1-gauge-pwm-badge'),
    s1GaugeAngleText: document.getElementById('s1-gauge-angle-text'),
    s1GaugeStatePill: document.getElementById('s1-gauge-state-pill'),

    gaugeCanvas2: document.getElementById('servoGaugeCanvas2'),
    s2GaugePwmBadge: document.getElementById('s2-gauge-pwm-badge'),
    s2GaugeAngleText: document.getElementById('s2-gauge-angle-text'),
    s2GaugeStatePill: document.getElementById('s2-gauge-state-pill'),

    gaugeCanvas3: document.getElementById('servoGaugeCanvas3'),
    s3GaugePwmBadge: document.getElementById('s3-gauge-pwm-badge'),
    s3GaugeAngleText: document.getElementById('s3-gauge-angle-text'),
    s3GaugeStatePill: document.getElementById('s3-gauge-state-pill'),

    gaugeCanvas4: document.getElementById('servoGaugeCanvas4'),
    s4GaugePwmBadge: document.getElementById('s4-gauge-pwm-badge'),
    s4GaugeAngleText: document.getElementById('s4-gauge-angle-text'),
    s4GaugeStatePill: document.getElementById('s4-gauge-state-pill'),

    // State machine & Scope
    stateTimerDisplay: document.getElementById('state-timer-display'),
    scopeCanvas: document.getElementById('scopeCanvas'),
    stateNodes: {
      idle: document.getElementById('node-idle'),
      fwd: document.getElementById('node-fwd'),
      pause1: document.getElementById('node-pause1'),
      rev: document.getElementById('node-rev'),
      complete: document.getElementById('node-complete')
    },

    // Servo 1 Deck
    btnS1Open: document.getElementById('btn-s1-open'),
    btnS1Close: document.getElementById('btn-s1-close'),
    btnS1Start: document.getElementById('btn-s1-start'),
    btnS1Stop: document.getElementById('btn-s1-stop'),
    btnS1TestFwd: document.getElementById('btn-s1-test-fwd'),
    btnS1TestRev: document.getElementById('btn-s1-test-rev'),
    sliderStop1: document.getElementById('slider-stop-1'),
    s1CalibValDisplay: document.getElementById('s1-calib-val-display'),
    btnS1CalibTest: document.getElementById('btn-s1-calib-test'),
    btnS1CalibSave: document.getElementById('btn-s1-calib-save'),

    // Servo 2 Deck
    btnS2Open: document.getElementById('btn-s2-open'),
    btnS2Close: document.getElementById('btn-s2-close'),
    btnS2Start: document.getElementById('btn-s2-start'),
    btnS2Stop: document.getElementById('btn-s2-stop'),
    btnS2TestFwd: document.getElementById('btn-s2-test-fwd'),
    btnS2TestRev: document.getElementById('btn-s2-test-rev'),
    sliderStop2: document.getElementById('slider-stop-2'),
    s2CalibValDisplay: document.getElementById('s2-calib-val-display'),
    btnS2CalibTest: document.getElementById('btn-s2-calib-test'),
    btnS2CalibSave: document.getElementById('btn-s2-calib-save'),

    // Servo 3 Deck
    btnS3Open: document.getElementById('btn-s3-open'),
    btnS3Close: document.getElementById('btn-s3-close'),
    btnS3Start: document.getElementById('btn-s3-start'),
    btnS3Stop: document.getElementById('btn-s3-stop'),
    btnS3TestFwd: document.getElementById('btn-s3-test-fwd'),
    btnS3TestRev: document.getElementById('btn-s3-test-rev'),
    sliderStop3: document.getElementById('slider-stop-3'),
    s3CalibValDisplay: document.getElementById('s3-calib-val-display'),
    btnS3CalibTest: document.getElementById('btn-s3-calib-test'),
    btnS3CalibSave: document.getElementById('btn-s3-calib-save'),

    // Servo 4 Deck
    btnS4Open: document.getElementById('btn-s4-open'),
    btnS4Close: document.getElementById('btn-s4-close'),
    btnS4Start: document.getElementById('btn-s4-start'),
    btnS4Stop: document.getElementById('btn-s4-stop'),
    btnS4TestFwd: document.getElementById('btn-s4-test-fwd'),
    btnS4TestRev: document.getElementById('btn-s4-test-rev'),
    sliderStop4: document.getElementById('slider-stop-4'),
    s4CalibValDisplay: document.getElementById('s4-calib-val-display'),
    btnS4CalibTest: document.getElementById('btn-s4-calib-test'),
    btnS4CalibSave: document.getElementById('btn-s4-calib-save'),

    // Config Tabs & Form
    tabBtnS1: document.getElementById('tab-btn-s1'),
    tabBtnS2: document.getElementById('tab-btn-s2'),
    tabBtnS3: document.getElementById('tab-btn-s3'),
    tabBtnS4: document.getElementById('tab-btn-s4'),
    cfgPaneS1: document.getElementById('cfg-pane-s1'),
    cfgPaneS2: document.getElementById('cfg-pane-s2'),
    cfgPaneS3: document.getElementById('cfg-pane-s3'),
    cfgPaneS4: document.getElementById('cfg-pane-s4'),

    cfgFwdSpeed1: document.getElementById('cfg-fwd-speed-1'),
    cfgFwdSpeedVal1: document.getElementById('cfg-fwd-speed-val-1'),
    cfgRevSpeed1: document.getElementById('cfg-rev-speed-1'),
    cfgRevSpeedVal1: document.getElementById('cfg-rev-speed-val-1'),
    cfgFwdMs1: document.getElementById('cfg-fwd-ms-1'),
    cfgRevMs1: document.getElementById('cfg-rev-ms-1'),
    cfgPauseMs1: document.getElementById('cfg-pause-ms-1'),
    cfgCycles1: document.getElementById('cfg-cycles-1'),

    cfgFwdSpeed2: document.getElementById('cfg-fwd-speed-2'),
    cfgFwdSpeedVal2: document.getElementById('cfg-fwd-speed-val-2'),
    cfgRevSpeed2: document.getElementById('cfg-rev-speed-2'),
    cfgRevSpeedVal2: document.getElementById('cfg-rev-speed-val-2'),
    cfgFwdMs2: document.getElementById('cfg-fwd-ms-2'),
    cfgRevMs2: document.getElementById('cfg-rev-ms-2'),
    cfgPauseMs2: document.getElementById('cfg-pause-ms-2'),
    cfgCycles2: document.getElementById('cfg-cycles-2'),

    cfgFwdSpeed3: document.getElementById('cfg-fwd-speed-3'),
    cfgFwdSpeedVal3: document.getElementById('cfg-fwd-speed-val-3'),
    cfgRevSpeed3: document.getElementById('cfg-rev-speed-3'),
    cfgRevSpeedVal3: document.getElementById('cfg-rev-speed-val-3'),
    cfgFwdMs3: document.getElementById('cfg-fwd-ms-3'),
    cfgRevMs3: document.getElementById('cfg-rev-ms-3'),
    cfgPauseMs3: document.getElementById('cfg-pause-ms-3'),
    cfgCycles3: document.getElementById('cfg-cycles-3'),

    cfgFwdSpeed4: document.getElementById('cfg-fwd-speed-4'),
    cfgFwdSpeedVal4: document.getElementById('cfg-fwd-speed-val-4'),
    cfgRevSpeed4: document.getElementById('cfg-rev-speed-4'),
    cfgRevSpeedVal4: document.getElementById('cfg-rev-speed-val-4'),
    cfgFwdMs4: document.getElementById('cfg-fwd-ms-4'),
    cfgRevMs4: document.getElementById('cfg-rev-ms-4'),
    cfgPauseMs4: document.getElementById('cfg-pause-ms-4'),
    cfgCycles4: document.getElementById('cfg-cycles-4'),

    configForm: document.getElementById('config-form'),
    btnResetConfig: document.getElementById('btn-reset-config'),

    // HIL & Terminal
    btnRunHil: document.getElementById('btn-run-hil'),
    hilSummaryText: document.getElementById('hil-summary-text'),
    termBody: document.getElementById('term-body'),
    termInput: document.getElementById('term-input'),
    btnTermSend: document.getElementById('btn-term-send'),
    chkAutoscroll: document.getElementById('chk-autoscroll'),
    btnClearTerm: document.getElementById('btn-clear-term'),
    toastContainer: document.getElementById('toast-container')
  };

  // Toast Notification System
  function showToast(message, type = 'info', duration = 3000) {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ============================================================
  // WEBSOCKET COMMUNICATION
  // ============================================================
  let ws = null;
  let reconnectTimer = null;

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.wsConnected = true;
      if (el.valWs) el.valWs.textContent = 'ONLINE';
      if (el.dotWs) el.dotWs.className = 'pulse-dot green';
      addTerminalLine('[SYSTEM] WebSocket Stream Connected.', 'system');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onclose = () => {
      state.wsConnected = false;
      if (el.valWs) el.valWs.textContent = 'RECONNECTING';
      if (el.dotWs) el.dotWs.className = 'pulse-dot amber';
      if (!reconnectTimer) {
        reconnectTimer = setInterval(connectWebSocket, 2000);
      }
    };

    ws.onerror = () => {
      state.wsConnected = false;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };
  }

  function sendCommand(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'cmd', cmd: cmd }));
      addTerminalLine(`>> ${cmd}`, 'system');
    } else {
      fetch('/api/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmd })
      })
      .then(res => res.json())
      .then(res => {
        addTerminalLine(`<< ${JSON.stringify(res)}`, 'esp');
      })
      .catch(err => {
        showToast('Lỗi gửi lệnh: ' + err.message, 'error');
      });
    }
  }

  function handleWsMessage(msg) {
    if (msg.type === 'telemetry') {
      updateTelemetry(msg.data);
    } else if (msg.type === 'log') {
      let level = msg.level || 'esp';
      if (msg.line.includes('[SERVO') || msg.line.includes('[MOTION]') || msg.line.includes('[FIFO]')) level = 'system';
      if (msg.line.includes('[ERROR]') || msg.line.includes('error')) level = 'error';
      addTerminalLine(msg.line, level);
    } else if (msg.type === 'hil_event') {
      handleHilEvent(msg);
    } else if (msg.type === 'cmd_response') {
      if (msg.res && msg.res.message) {
        showToast(msg.res.message, msg.res.ok ? 'success' : 'error');
      }
    }
  }

  // ============================================================
  // TELEMETRY & UI UPDATER
  // ============================================================
  let configLoadedOnce = false;

  function updateServoCardAndBadge(sObj, cardValEl, cardSubEl, badgeEl, barCycleEl, gaugeBadgeEl, pin, ledcCh, defaultLabel) {
    if (!cardValEl || !cardSubEl || !badgeEl) return;

    if (!sObj.running) {
      sObj.targetPwm = sObj.stop;
      if (sObj.state.includes('mở') || sObj.state.includes('Đã mở')) {
        cardValEl.textContent = 'OPENED (CLAMP)';
        cardSubEl.textContent = `GPIO ${pin} • PWM Detached • Line Grounded (${sObj.stop}°)`;
      } else if (sObj.state.includes('đóng') || sObj.state.includes('Đã đóng')) {
        cardValEl.textContent = 'CLOSED (CLAMP)';
        cardSubEl.textContent = `GPIO ${pin} • PWM Detached • Line Grounded (${sObj.stop}°)`;
      } else {
        cardValEl.textContent = 'IDLE (CLAMP)';
        cardSubEl.textContent = `GPIO ${pin} • PWM Detached • Line Grounded (${sObj.stop}°)`;
      }
    } else {
      if (sObj.state.includes('thuận') || sObj.state.includes('mở')) {
        sObj.targetPwm = sObj.forward;
        cardValEl.textContent = 'QUAY THUẬN / MỞ';
        cardSubEl.textContent = `GPIO ${pin} • LEDC ${ledcCh} • ${sObj.forward}° CCW`;
      } else if (sObj.state.includes('nghịch') || sObj.state.includes('đóng')) {
        sObj.targetPwm = sObj.reverse;
        cardValEl.textContent = 'QUAY NGHỊCH / ĐÓNG';
        cardSubEl.textContent = `GPIO ${pin} • LEDC ${ledcCh} • ${sObj.reverse}° CW`;
      } else {
        sObj.targetPwm = sObj.stop;
        cardValEl.textContent = 'TẠM DỪNG';
        cardSubEl.textContent = `GPIO ${pin} • Active Ground Clamped`;
      }
    }
    badgeEl.textContent = sObj.state.toUpperCase();
    if (barCycleEl) {
      const pct = sObj.cycles > 0 ? Math.min(100, Math.round((sObj.cycle / sObj.cycles) * 100)) : 0;
      barCycleEl.style.width = `${pct}%`;
    }
    if (gaugeBadgeEl) {
      gaugeBadgeEl.textContent = `${Math.round(sObj.targetPwm)}° (${sObj.state})`;
    }
  }

  function updateTelemetry(data) {
    state.connected = data.connected !== false;
    state.port = data.port || 'COM5';
    state.ip = data.ip || '192.168.4.1';

    // Parse S1..S4 data
    const s1Data = data.s1 || {
      state: data.state || 'Sẵn sàng',
      running: !!data.running,
      cycle: data.cycle || 0,
      cycles: data.cycles || 1,
      stop: data.servoStop ?? 90,
      forward: data.servoForward ?? 110,
      reverse: data.servoReverse ?? 70,
      forwardMs: data.forwardMs || 1000,
      reverseMs: data.reverseMs || 1000,
      pauseMs: data.pauseMs || 500
    };

    const s2Data = data.s2 || {
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    };

    const s3Data = data.s3 || {
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    };

    const s4Data = data.s4 || {
      state: 'Sẵn sàng',
      running: false,
      cycle: 0,
      cycles: 1,
      stop: 90,
      forward: 110,
      reverse: 70,
      forwardMs: 1000,
      reverseMs: 1000,
      pauseMs: 500
    };

    Object.assign(state.s1, s1Data);
    Object.assign(state.s2, s2Data);
    Object.assign(state.s3, s3Data);
    Object.assign(state.s4, s4Data);

    if (data.col1) Object.assign(state.col1, data.col1);
    if (data.col2) Object.assign(state.col2, data.col2);

    // Update connection status
    if (el.valPort) el.valPort.textContent = `${state.port} (115200)`;
    if (el.valIp) el.valIp.textContent = state.ip;
    if (el.dotSerial) {
      el.dotSerial.className = state.connected ? 'pulse-dot green' : 'pulse-dot red';
    }

    // --- Update S1..S4 Cards & Target PWM ---
    updateServoCardAndBadge(state.s1, el.cardS1Val, el.cardS1Sub, el.badgeS1State, el.barS1Cycle, el.s1GaugePwmBadge, 18, 'Ch0', 'S1');
    updateServoCardAndBadge(state.s2, el.cardS2Val, el.cardS2Sub, el.badgeS2State, el.barS2Cycle, el.s2GaugePwmBadge, 19, 'Ch1', 'S2');
    updateServoCardAndBadge(state.s3, el.cardS3Val, el.cardS3Sub, el.badgeS3State, el.barS3Cycle, el.s3GaugePwmBadge, 21, 'Ch2', 'S3');
    updateServoCardAndBadge(state.s4, el.cardS4Val, el.cardS4Sub, el.badgeS4State, el.barS4Cycle, el.s4GaugePwmBadge, 22, 'Ch3', 'S4');

    // Clamp indicator
    if (el.cardClamp) {
      const anyActive = state.s1.running || state.s2.running || state.s3.running || state.s4.running;
      el.cardClamp.textContent = anyActive ? 'PWM ACTIVE' : 'QUAD ACTIVE LOW';
      el.cardClamp.className = anyActive ? 'stat-value text-amber' : 'stat-value text-emerald';
    }

    // IR Bowl Status
    if (data.ir) {
      Object.assign(state.ir, data.ir);
      if (el.irCounterNumber) el.irCounterNumber.textContent = state.ir.count;
      if (el.irTagRaw) el.irTagRaw.textContent = `RAW: ${state.ir.raw ? 'HIGH (TRỐNG)' : 'LOW (CÓ TÔ)'}`;
      if (el.irTagBlock) el.irTagBlock.textContent = `CHẮN: ${state.ir.blockMs} ms`;
      if (el.irRadarCircle) {
        el.irRadarCircle.className = state.ir.detected ? 'radar-circle detected' : 'radar-circle';
      }
      if (el.irStatusCard) {
        el.irStatusCard.className = state.ir.detected ? 'ir-visual-col detected' : 'ir-visual-col';
      }
      if (el.irStatusMain) {
        el.irStatusMain.textContent = state.ir.detected ? 'PHÁT HIỆN TÔ TRÁI CÂY' : 'KHOANG CHỜ TRỐNG';
        el.irStatusMain.style.color = state.ir.detected ? '#ef4444' : '#10b981';
      }
      if (el.irStatusSub) {
        el.irStatusSub.textContent = state.ir.detected
          ? `Tia hồng ngoại bị ngắt ${state.ir.blockMs}ms • Chuẩn bị nhả khay`
          : 'Chùm tia hồng ngoại thông suốt • Sẵn sàng đón tô rơi';
      }
    }

    // State Visualizer
    updateStateMachineVisualizer();

    // Push oscilloscope history
    state.oscilloscopeHistory.push({
      t: Date.now(),
      s1Pwm: state.s1.currentPwm,
      s2Pwm: state.s2.currentPwm,
      s3Pwm: state.s3.currentPwm,
      s4Pwm: state.s4.currentPwm
    });
    if (state.oscilloscopeHistory.length > 300) {
      state.oscilloscopeHistory.shift();
    }

    // Populate configuration form once
    if (!configLoadedOnce && (data.servoForward || (data.s1 && data.s1.forward))) {
      configLoadedOnce = true;
      // S1 Form
      if (el.sliderStop1) { el.sliderStop1.value = state.s1.stop; el.s1CalibValDisplay.textContent = `${state.s1.stop}°`; }
      if (el.cfgFwdSpeed1) { el.cfgFwdSpeed1.value = state.s1.forward; el.cfgFwdSpeedVal1.textContent = state.s1.forward; }
      if (el.cfgRevSpeed1) { el.cfgRevSpeed1.value = state.s1.reverse; el.cfgRevSpeedVal1.textContent = state.s1.reverse; }
      if (el.cfgFwdMs1) el.cfgFwdMs1.value = state.s1.forwardMs;
      if (el.cfgRevMs1) el.cfgRevMs1.value = state.s1.reverseMs;
      if (el.cfgPauseMs1) el.cfgPauseMs1.value = state.s1.pauseMs;
      if (el.cfgCycles1) el.cfgCycles1.value = state.s1.cycles;

      // S2 Form
      if (el.sliderStop2) { el.sliderStop2.value = state.s2.stop; el.s2CalibValDisplay.textContent = `${state.s2.stop}°`; }
      if (el.cfgFwdSpeed2) { el.cfgFwdSpeed2.value = state.s2.forward; el.cfgFwdSpeedVal2.textContent = state.s2.forward; }
      if (el.cfgRevSpeed2) { el.cfgRevSpeed2.value = state.s2.reverse; el.cfgRevSpeedVal2.textContent = state.s2.reverse; }
      if (el.cfgFwdMs2) el.cfgFwdMs2.value = state.s2.forwardMs;
      if (el.cfgRevMs2) el.cfgRevMs2.value = state.s2.reverseMs;
      if (el.cfgPauseMs2) el.cfgPauseMs2.value = state.s2.pauseMs;
      if (el.cfgCycles2) el.cfgCycles2.value = state.s2.cycles;

      // S3 Form
      if (el.sliderStop3) { el.sliderStop3.value = state.s3.stop; el.s3CalibValDisplay.textContent = `${state.s3.stop}°`; }
      if (el.cfgFwdSpeed3) { el.cfgFwdSpeed3.value = state.s3.forward; el.cfgFwdSpeedVal3.textContent = state.s3.forward; }
      if (el.cfgRevSpeed3) { el.cfgRevSpeed3.value = state.s3.reverse; el.cfgRevSpeedVal3.textContent = state.s3.reverse; }
      if (el.cfgFwdMs3) el.cfgFwdMs3.value = state.s3.forwardMs;
      if (el.cfgRevMs3) el.cfgRevMs3.value = state.s3.reverseMs;
      if (el.cfgPauseMs3) el.cfgPauseMs3.value = state.s3.pauseMs;
      if (el.cfgCycles3) el.cfgCycles3.value = state.s3.cycles;

      // S4 Form
      if (el.sliderStop4) { el.sliderStop4.value = state.s4.stop; el.s4CalibValDisplay.textContent = `${state.s4.stop}°`; }
      if (el.cfgFwdSpeed4) { el.cfgFwdSpeed4.value = state.s4.forward; el.cfgFwdSpeedVal4.textContent = state.s4.forward; }
      if (el.cfgRevSpeed4) { el.cfgRevSpeed4.value = state.s4.reverse; el.cfgRevSpeedVal4.textContent = state.s4.reverse; }
      if (el.cfgFwdMs4) el.cfgFwdMs4.value = state.s4.forwardMs;
      if (el.cfgRevMs4) el.cfgRevMs4.value = state.s4.reverseMs;
      if (el.cfgPauseMs4) el.cfgPauseMs4.value = state.s4.pauseMs;
      if (el.cfgCycles4) el.cfgCycles4.value = state.s4.cycles;
    }
  }

  function updateStateMachineVisualizer() {
    const nodes = el.stateNodes;
    Object.values(nodes).forEach(n => n && n.classList.remove('active'));

    const anyRunning = state.s1.running || state.s2.running || state.s3.running || state.s4.running;

    if (!anyRunning) {
      if (state.s1.state.includes('Hoàn thành') || state.s2.state.includes('Hoàn thành') || state.s3.state.includes('Hoàn thành') || state.s4.state.includes('Hoàn thành')) {
        if (nodes.complete) nodes.complete.classList.add('active');
      } else {
        if (nodes.idle) nodes.idle.classList.add('active');
      }
      return;
    }

    const activeSt = (state.s1.running ? state.s1.state : (state.s2.running ? state.s2.state : (state.s3.running ? state.s3.state : state.s4.state)));
    if (activeSt.includes('thuận') || activeSt.includes('mở')) {
      if (nodes.fwd) nodes.fwd.classList.add('active');
    } else if (activeSt.includes('nghịch') || activeSt.includes('đóng')) {
      if (nodes.rev) nodes.rev.classList.add('active');
    } else if (activeSt.includes('Tạm dừng') || activeSt.includes('dừng')) {
      if (nodes.pause1) nodes.pause1.classList.add('active');
    } else {
      if (nodes.idle) nodes.idle.classList.add('active');
    }
  }

  // ============================================================
  // QUAD GAUGE RENDER LOOPS
  // ============================================================
  const ctx1 = el.gaugeCanvas1 ? el.gaugeCanvas1.getContext('2d') : null;
  const ctx2 = el.gaugeCanvas2 ? el.gaugeCanvas2.getContext('2d') : null;
  const ctx3 = el.gaugeCanvas3 ? el.gaugeCanvas3.getContext('2d') : null;
  const ctx4 = el.gaugeCanvas4 ? el.gaugeCanvas4.getContext('2d') : null;
  const scopeCtx = el.scopeCanvas ? el.scopeCanvas.getContext('2d') : null;

  function drawSingleGauge(ctx, canvas, sObj, angleTextEl, statePillEl, primaryColor, accentColor) {
    if (!ctx || !canvas) return;

    // Smooth lerp needle
    sObj.currentPwm += (sObj.targetPwm - sObj.currentPwm) * 0.15;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.40;

    ctx.clearRect(0, 0, w, h);

    // Background track ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 10;
    ctx.stroke();

    function degToRad(pwmDeg) {
      const angle = -140 + (pwmDeg / 180) * 280;
      return (angle - 90) * (Math.PI / 180);
    }

    // Forward Zone (0 - 88°)
    ctx.beginPath();
    ctx.arc(cx, cy, r, degToRad(0), degToRad(88));
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.45)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Neutral Deadband Zone (88 - 92°)
    ctx.beginPath();
    ctx.arc(cx, cy, r, degToRad(88), degToRad(92));
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 12;
    ctx.stroke();

    // Reverse Zone (92 - 180°)
    ctx.beginPath();
    ctx.arc(cx, cy, r, degToRad(92), degToRad(180));
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Needle
    const needleRad = degToRad(sObj.currentPwm);
    const needleLen = r - 12;
    const nx = cx + needleLen * Math.cos(needleRad);
    const ny = cy + needleLen * Math.sin(needleRad);

    ctx.save();
    ctx.shadowColor = Math.abs(sObj.currentPwm - 90) < 3 ? '#10b981' : (sObj.currentPwm < 90 ? primaryColor : '#f59e0b');
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = ctx.shadowColor;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Center Hub Ring
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#0c1220';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Digital Readouts
    if (angleTextEl) angleTextEl.textContent = `${Math.round(sObj.currentPwm)}°`;
    if (statePillEl) {
      if (Math.abs(sObj.currentPwm - 90) < 3) {
        statePillEl.textContent = 'CLAMP (STOP)';
        statePillEl.style.color = '#10b981';
      } else if (sObj.currentPwm < 90) {
        const pct = Math.round(((90 - sObj.currentPwm) / 90) * 100);
        statePillEl.textContent = `QUAY THUẬN (${pct}%)`;
        statePillEl.style.color = primaryColor;
      } else {
        const pct = Math.round(((sObj.currentPwm - 90) / 90) * 100);
        statePillEl.textContent = `QUAY NGHỊCH (${pct}%)`;
        statePillEl.style.color = '#f59e0b';
      }
    }
  }

  function renderQuadGauges() {
    drawSingleGauge(ctx1, el.gaugeCanvas1, state.s1, el.s1GaugeAngleText, el.s1GaugeStatePill, '#00f2fe', '#00f2fe');
    drawSingleGauge(ctx2, el.gaugeCanvas2, state.s2, el.s2GaugeAngleText, el.s2GaugeStatePill, '#10b981', '#10b981');
    drawSingleGauge(ctx3, el.gaugeCanvas3, state.s3, el.s3GaugeAngleText, el.s3GaugeStatePill, '#f59e0b', '#f59e0b');
    drawSingleGauge(ctx4, el.gaugeCanvas4, state.s4, el.s4GaugeAngleText, el.s4GaugeStatePill, '#a855f7', '#a855f7');
    requestAnimationFrame(renderQuadGauges);
  }

  function renderOscilloscope() {
    if (!scopeCtx || !el.scopeCanvas) return;
    const w = el.scopeCanvas.width;
    const h = el.scopeCanvas.height;

    scopeCtx.fillStyle = '#03060d';
    scopeCtx.fillRect(0, 0, w, h);

    // Draw Grid lines
    scopeCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    scopeCtx.lineWidth = 1;
    for (let y = 20; y < h; y += 25) {
      scopeCtx.beginPath();
      scopeCtx.moveTo(0, y);
      scopeCtx.lineTo(w, y);
      scopeCtx.stroke();
    }
    for (let x = 30; x < w; x += 60) {
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, 0);
      scopeCtx.lineTo(x, h);
      scopeCtx.stroke();
    }

    // Neutral Center Line (90°)
    const midY = h / 2;
    scopeCtx.beginPath();
    scopeCtx.setLineDash([4, 4]);
    scopeCtx.moveTo(0, midY);
    scopeCtx.lineTo(w, midY);
    scopeCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    scopeCtx.stroke();
    scopeCtx.setLineDash([]);

    const history = state.oscilloscopeHistory;
    if (history.length > 1) {
      const step = w / 300;

      // Plot Ch1: S1 (Cyan)
      scopeCtx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const x = (300 - history.length + i) * step;
        const y = h - (pt.s1Pwm / 180) * h;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.strokeStyle = '#00f2fe';
      scopeCtx.lineWidth = 2;
      scopeCtx.stroke();

      // Plot Ch2: S2 (Emerald)
      scopeCtx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const x = (300 - history.length + i) * step;
        const y = h - (pt.s2Pwm / 180) * h;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.strokeStyle = '#10b981';
      scopeCtx.lineWidth = 2;
      scopeCtx.stroke();

      // Plot Ch3: S3 (Amber)
      scopeCtx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const x = (300 - history.length + i) * step;
        const y = h - ((pt.s3Pwm || 90) / 180) * h;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.strokeStyle = '#f59e0b';
      scopeCtx.lineWidth = 2;
      scopeCtx.stroke();

      // Plot Ch4: S4 (Purple)
      scopeCtx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const x = (300 - history.length + i) * step;
        const y = h - ((pt.s4Pwm || 90) / 180) * h;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.strokeStyle = '#a855f7';
      scopeCtx.lineWidth = 2;
      scopeCtx.stroke();
    }

    // Text labels
    scopeCtx.font = '9px "JetBrains Mono"';
    scopeCtx.fillStyle = '#64748b';
    scopeCtx.fillText('180° REV', 6, 14);
    scopeCtx.fillText('90° STOP', 6, midY - 4);
    scopeCtx.fillText('0° FWD', 6, h - 6);
  }

  setInterval(renderOscilloscope, 100);

  // ============================================================
  // HIL EVENT HANDLER
  // ============================================================
  function handleHilEvent(ev) {
    const b5 = document.getElementById('badge-p5');
    const b6 = document.getElementById('badge-p6');
    const b7 = document.getElementById('badge-p7');
    const b8 = document.getElementById('badge-p8');
    const b9 = document.getElementById('badge-p9');

    if (ev.phase === 'phase_5' && b5) {
      b5.className = 'phase-badge running';
      b5.textContent = 'RUNNING';
    } else if (ev.phase === 'phase_6' && b6) {
      if (b5) { b5.className = 'phase-badge pass'; b5.textContent = 'PASS'; }
      b6.className = 'phase-badge running';
      b6.textContent = 'RUNNING';
    } else if (ev.phase === 'phase_7' && b7) {
      if (b6) { b6.className = 'phase-badge pass'; b6.textContent = 'PASS'; }
      b7.className = 'phase-badge running';
      b7.textContent = 'RUNNING';
    } else if (ev.phase === 'phase_8' && b8) {
      if (b7) { b7.className = 'phase-badge pass'; b7.textContent = 'PASS'; }
      b8.className = 'phase-badge running';
      b8.textContent = 'RUNNING';
    } else if (ev.phase === 'phase_9' && b9) {
      if (b8) { b8.className = 'phase-badge pass'; b8.textContent = 'PASS'; }
      b9.className = 'phase-badge running';
      b9.textContent = 'RUNNING';
    } else if (ev.phase === 'complete') {
      ['p5', 'p6', 'p7', 'p8', 'p9'].forEach(p => {
        const b = document.getElementById(`badge-${p}`);
        if (b) { b.className = 'phase-badge pass'; b.textContent = 'PASS'; }
      });
      if (el.hilSummaryText) el.hilSummaryText.textContent = ev.message;
      showToast(ev.message, ev.status === 'PASS' ? 'success' : 'error', 5000);
    }
  }

  // ============================================================
  // TERMINAL HELPER
  // ============================================================
  function addTerminalLine(text, level = 'esp') {
    if (!el.termBody) return;
    const line = document.createElement('div');
    line.className = `term-line ${level}`;
    const timeStr = new Date().toLocaleTimeString();
    line.textContent = `[${timeStr}] ${text}`;
    el.termBody.appendChild(line);

    if (el.chkAutoscroll && el.chkAutoscroll.checked) {
      el.termBody.scrollTop = el.termBody.scrollHeight;
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================
  function initEventListeners() {
    // Column FIFO Triggers
    if (el.topBtnCol1Dispense) el.topBtnCol1Dispense.addEventListener('click', () => {
      sendCommand('DISPENSE 1');
      showToast('Kích hoạt xả tô FIFO Cột 1 (S1 nhả tô -> S2 nạp lại)', 'info');
    });
    if (el.topBtnCol2Dispense) el.topBtnCol2Dispense.addEventListener('click', () => {
      sendCommand('DISPENSE 2');
      showToast('Kích hoạt xả tô FIFO Cột 2 (S3 nhả tô -> S4 nạp lại)', 'info');
    });

    // Master Commands
    if (el.topBtnAllOpen) el.topBtnAllOpen.addEventListener('click', () => sendCommand('ALL_OPEN'));
    if (el.topBtnAllClose) el.topBtnAllClose.addEventListener('click', () => sendCommand('ALL_CLOSE'));
    if (el.topBtnAllStart) el.topBtnAllStart.addEventListener('click', () => sendCommand('ALL_START'));
    if (el.topBtnAllStop) el.topBtnAllStop.addEventListener('click', () => sendCommand('ALL_STOP'));
    if (el.btnEstop) el.btnEstop.addEventListener('click', () => sendCommand('ALL_STOP'));

    // Servo 1 Commands
    const s1Open = () => sendCommand('S1_OPEN');
    const s1Close = () => sendCommand('S1_CLOSE');
    const s1Start = () => sendCommand('S1_START');
    const s1Stop = () => sendCommand('S1_STOP');
    const s1TestFwd = () => sendCommand('S1_TEST_FWD');
    const s1TestRev = () => sendCommand('S1_TEST_REV');

    if (el.topBtnS1Open) el.topBtnS1Open.addEventListener('click', s1Open);
    if (el.btnS1Open) el.btnS1Open.addEventListener('click', s1Open);
    if (el.topBtnS1Close) el.topBtnS1Close.addEventListener('click', s1Close);
    if (el.btnS1Close) el.btnS1Close.addEventListener('click', s1Close);
    if (el.topBtnS1Start) el.topBtnS1Start.addEventListener('click', s1Start);
    if (el.btnS1Start) el.btnS1Start.addEventListener('click', s1Start);
    if (el.topBtnS1Stop) el.topBtnS1Stop.addEventListener('click', s1Stop);
    if (el.btnS1Stop) el.btnS1Stop.addEventListener('click', s1Stop);
    if (el.topBtnS1TestFwd) el.topBtnS1TestFwd.addEventListener('click', s1TestFwd);
    if (el.btnS1TestFwd) el.btnS1TestFwd.addEventListener('click', s1TestFwd);
    if (el.topBtnS1TestRev) el.topBtnS1TestRev.addEventListener('click', s1TestRev);
    if (el.btnS1TestRev) el.btnS1TestRev.addEventListener('click', s1TestRev);

    // Servo 2 Commands
    const s2Open = () => sendCommand('S2_OPEN');
    const s2Close = () => sendCommand('S2_CLOSE');
    const s2Start = () => sendCommand('S2_START');
    const s2Stop = () => sendCommand('S2_STOP');
    const s2TestFwd = () => sendCommand('S2_TEST_FWD');
    const s2TestRev = () => sendCommand('S2_TEST_REV');

    if (el.topBtnS2Open) el.topBtnS2Open.addEventListener('click', s2Open);
    if (el.btnS2Open) el.btnS2Open.addEventListener('click', s2Open);
    if (el.topBtnS2Close) el.topBtnS2Close.addEventListener('click', s2Close);
    if (el.btnS2Close) el.btnS2Close.addEventListener('click', s2Close);
    if (el.topBtnS2Start) el.topBtnS2Start.addEventListener('click', s2Start);
    if (el.btnS2Start) el.btnS2Start.addEventListener('click', s2Start);
    if (el.topBtnS2Stop) el.topBtnS2Stop.addEventListener('click', s2Stop);
    if (el.btnS2Stop) el.btnS2Stop.addEventListener('click', s2Stop);
    if (el.topBtnS2TestFwd) el.topBtnS2TestFwd.addEventListener('click', s2TestFwd);
    if (el.btnS2TestFwd) el.btnS2TestFwd.addEventListener('click', s2TestFwd);
    if (el.topBtnS2TestRev) el.topBtnS2TestRev.addEventListener('click', s2TestRev);
    if (el.btnS2TestRev) el.btnS2TestRev.addEventListener('click', s2TestRev);

    // Servo 3 Commands
    const s3Open = () => sendCommand('S3_OPEN');
    const s3Close = () => sendCommand('S3_CLOSE');
    const s3Start = () => sendCommand('S3_START');
    const s3Stop = () => sendCommand('S3_STOP');
    const s3TestFwd = () => sendCommand('S3_TEST_FWD');
    const s3TestRev = () => sendCommand('S3_TEST_REV');

    if (el.topBtnS3Open) el.topBtnS3Open.addEventListener('click', s3Open);
    if (el.btnS3Open) el.btnS3Open.addEventListener('click', s3Open);
    if (el.topBtnS3Close) el.topBtnS3Close.addEventListener('click', s3Close);
    if (el.btnS3Close) el.btnS3Close.addEventListener('click', s3Close);
    if (el.topBtnS3Start) el.topBtnS3Start.addEventListener('click', s3Start);
    if (el.btnS3Start) el.btnS3Start.addEventListener('click', s3Start);
    if (el.topBtnS3Stop) el.topBtnS3Stop.addEventListener('click', s3Stop);
    if (el.btnS3Stop) el.btnS3Stop.addEventListener('click', s3Stop);
    if (el.topBtnS3TestFwd) el.topBtnS3TestFwd.addEventListener('click', s3TestFwd);
    if (el.btnS3TestFwd) el.btnS3TestFwd.addEventListener('click', s3TestFwd);
    if (el.topBtnS3TestRev) el.topBtnS3TestRev.addEventListener('click', s3TestRev);
    if (el.btnS3TestRev) el.btnS3TestRev.addEventListener('click', s3TestRev);

    // Servo 4 Commands
    const s4Open = () => sendCommand('S4_OPEN');
    const s4Close = () => sendCommand('S4_CLOSE');
    const s4Start = () => sendCommand('S4_START');
    const s4Stop = () => sendCommand('S4_STOP');
    const s4TestFwd = () => sendCommand('S4_TEST_FWD');
    const s4TestRev = () => sendCommand('S4_TEST_REV');

    if (el.topBtnS4Open) el.topBtnS4Open.addEventListener('click', s4Open);
    if (el.btnS4Open) el.btnS4Open.addEventListener('click', s4Open);
    if (el.topBtnS4Close) el.topBtnS4Close.addEventListener('click', s4Close);
    if (el.btnS4Close) el.btnS4Close.addEventListener('click', s4Close);
    if (el.topBtnS4Start) el.topBtnS4Start.addEventListener('click', s4Start);
    if (el.btnS4Start) el.btnS4Start.addEventListener('click', s4Start);
    if (el.topBtnS4Stop) el.topBtnS4Stop.addEventListener('click', s4Stop);
    if (el.btnS4Stop) el.btnS4Stop.addEventListener('click', s4Stop);
    if (el.topBtnS4TestFwd) el.topBtnS4TestFwd.addEventListener('click', s4TestFwd);
    if (el.btnS4TestFwd) el.btnS4TestFwd.addEventListener('click', s4TestFwd);
    if (el.topBtnS4TestRev) el.topBtnS4TestRev.addEventListener('click', s4TestRev);
    if (el.btnS4TestRev) el.btnS4TestRev.addEventListener('click', s4TestRev);

    // IR Bowl Detection Controls
    if (el.btnIrReset) {
      el.btnIrReset.addEventListener('click', () => {
        sendCommand('IR_RESET');
        showToast('Đã đặt lại bộ đếm tô về 0', 'info');
      });
    }

    if (el.btnIrSimulate) {
      el.btnIrSimulate.addEventListener('click', () => {
        fetch('/api/ir/simulate', { method: 'POST' })
          .then(res => res.json())
          .then(() => showToast('Đang kích hoạt xung mô phỏng tô đi qua...', 'info'))
          .catch(err => showToast('Lỗi: ' + err.message, 'error'));
      });
    }

    if (el.btnIrToggleTx) {
      el.btnIrToggleTx.addEventListener('click', () => {
        const newTx = !state.ir.txEnabled;
        sendCommand(newTx ? 'IR_TX_ON' : 'IR_TX_OFF');
        showToast(`Đã chuyển TX LED sang: ${newTx ? 'BẬT' : 'TẮT'}`, 'info');
      });
    }

    // Hard Reboot
    if (el.btnReboot) {
      el.btnReboot.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn Reset phần cứng ESP32 qua DTR/RTS?')) {
          fetch('/api/reboot', { method: 'POST' });
          showToast('Đã gửi tín hiệu Hard Reset đến ESP32', 'info');
        }
      });
    }

    // Stop Slider Calibration S1
    if (el.sliderStop1) {
      el.sliderStop1.addEventListener('input', (e) => {
        if (el.s1CalibValDisplay) el.s1CalibValDisplay.textContent = `${e.target.value}°`;
      });
    }
    if (el.btnS1CalibTest) {
      el.btnS1CalibTest.addEventListener('click', () => {
        const val = el.sliderStop1.value;
        sendCommand(`S1_CALIB ${val}`);
        showToast(`Đang test điểm dừng S1: ${val}°`, 'info');
      });
    }
    if (el.btnS1CalibSave) {
      el.btnS1CalibSave.addEventListener('click', () => {
        const val = el.sliderStop1.value;
        sendCommand(`CONFIG_SET stop1=${val}`);
        showToast(`Đã lưu điểm dừng S1: ${val}° vào NVS Flash`, 'success');
      });
    }

    // Stop Slider Calibration S2
    if (el.sliderStop2) {
      el.sliderStop2.addEventListener('input', (e) => {
        if (el.s2CalibValDisplay) el.s2CalibValDisplay.textContent = `${e.target.value}°`;
      });
    }
    if (el.btnS2CalibTest) {
      el.btnS2CalibTest.addEventListener('click', () => {
        const val = el.sliderStop2.value;
        sendCommand(`S2_CALIB ${val}`);
        showToast(`Đang test điểm dừng S2: ${val}°`, 'info');
      });
    }
    if (el.btnS2CalibSave) {
      el.btnS2CalibSave.addEventListener('click', () => {
        const val = el.sliderStop2.value;
        sendCommand(`CONFIG_SET stop2=${val}`);
        showToast(`Đã lưu điểm dừng S2: ${val}° vào NVS Flash`, 'success');
      });
    }

    // Stop Slider Calibration S3
    if (el.sliderStop3) {
      el.sliderStop3.addEventListener('input', (e) => {
        if (el.s3CalibValDisplay) el.s3CalibValDisplay.textContent = `${e.target.value}°`;
      });
    }
    if (el.btnS3CalibTest) {
      el.btnS3CalibTest.addEventListener('click', () => {
        const val = el.sliderStop3.value;
        sendCommand(`S3_CALIB ${val}`);
        showToast(`Đang test điểm dừng S3: ${val}°`, 'info');
      });
    }
    if (el.btnS3CalibSave) {
      el.btnS3CalibSave.addEventListener('click', () => {
        const val = el.sliderStop3.value;
        sendCommand(`CONFIG_SET stop3=${val}`);
        showToast(`Đã lưu điểm dừng S3: ${val}° vào NVS Flash`, 'success');
      });
    }

    // Stop Slider Calibration S4
    if (el.sliderStop4) {
      el.sliderStop4.addEventListener('input', (e) => {
        if (el.s4CalibValDisplay) el.s4CalibValDisplay.textContent = `${e.target.value}°`;
      });
    }
    if (el.btnS4CalibTest) {
      el.btnS4CalibTest.addEventListener('click', () => {
        const val = el.sliderStop4.value;
        sendCommand(`S4_CALIB ${val}`);
        showToast(`Đang test điểm dừng S4: ${val}°`, 'info');
      });
    }
    if (el.btnS4CalibSave) {
      el.btnS4CalibSave.addEventListener('click', () => {
        const val = el.sliderStop4.value;
        sendCommand(`CONFIG_SET stop4=${val}`);
        showToast(`Đã lưu điểm dừng S4: ${val}° vào NVS Flash`, 'success');
      });
    }

    // Config Tab Switching
    function selectTab(idx) {
      [el.tabBtnS1, el.tabBtnS2, el.tabBtnS3, el.tabBtnS4].forEach((b, i) => {
        if (b) {
          if (i === idx) b.classList.add('active');
          else b.classList.remove('active');
        }
      });
      [el.cfgPaneS1, el.cfgPaneS2, el.cfgPaneS3, el.cfgPaneS4].forEach((p, i) => {
        if (p) p.style.display = (i === idx) ? 'block' : 'none';
      });
    }

    if (el.tabBtnS1) el.tabBtnS1.addEventListener('click', () => selectTab(0));
    if (el.tabBtnS2) el.tabBtnS2.addEventListener('click', () => selectTab(1));
    if (el.tabBtnS3) el.tabBtnS3.addEventListener('click', () => selectTab(2));
    if (el.tabBtnS4) el.tabBtnS4.addEventListener('click', () => selectTab(3));

    // Form value bubble bindings
    if (el.cfgFwdSpeed1) el.cfgFwdSpeed1.addEventListener('input', (e) => el.cfgFwdSpeedVal1.textContent = e.target.value);
    if (el.cfgRevSpeed1) el.cfgRevSpeed1.addEventListener('input', (e) => el.cfgRevSpeedVal1.textContent = e.target.value);
    if (el.cfgFwdSpeed2) el.cfgFwdSpeed2.addEventListener('input', (e) => el.cfgFwdSpeedVal2.textContent = e.target.value);
    if (el.cfgRevSpeed2) el.cfgRevSpeed2.addEventListener('input', (e) => el.cfgRevSpeedVal2.textContent = e.target.value);
    if (el.cfgFwdSpeed3) el.cfgFwdSpeed3.addEventListener('input', (e) => el.cfgFwdSpeedVal3.textContent = e.target.value);
    if (el.cfgRevSpeed3) el.cfgRevSpeed3.addEventListener('input', (e) => el.cfgRevSpeedVal3.textContent = e.target.value);
    if (el.cfgFwdSpeed4) el.cfgFwdSpeed4.addEventListener('input', (e) => el.cfgFwdSpeedVal4.textContent = e.target.value);
    if (el.cfgRevSpeed4) el.cfgRevSpeed4.addEventListener('input', (e) => el.cfgRevSpeedVal4.textContent = e.target.value);

    // Save All Config Form (S1 - S4)
    if (el.configForm) {
      el.configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const s1_stop = el.sliderStop1 ? el.sliderStop1.value : state.s1.stop;
        const s1_fwd = el.cfgFwdSpeed1 ? el.cfgFwdSpeed1.value : 110;
        const s1_rev = el.cfgRevSpeed1 ? el.cfgRevSpeed1.value : 70;
        const s1_fwdMs = el.cfgFwdMs1 ? el.cfgFwdMs1.value : 1000;
        const s1_revMs = el.cfgRevMs1 ? el.cfgRevMs1.value : 1000;
        const s1_pauseMs = el.cfgPauseMs1 ? el.cfgPauseMs1.value : 500;
        const s1_cyc = el.cfgCycles1 ? el.cfgCycles1.value : 1;

        const s2_stop = el.sliderStop2 ? el.sliderStop2.value : state.s2.stop;
        const s2_fwd = el.cfgFwdSpeed2 ? el.cfgFwdSpeed2.value : 110;
        const s2_rev = el.cfgRevSpeed2 ? el.cfgRevSpeed2.value : 70;
        const s2_fwdMs = el.cfgFwdMs2 ? el.cfgFwdMs2.value : 1000;
        const s2_revMs = el.cfgRevMs2 ? el.cfgRevMs2.value : 1000;
        const s2_pauseMs = el.cfgPauseMs2 ? el.cfgPauseMs2.value : 500;
        const s2_cyc = el.cfgCycles2 ? el.cfgCycles2.value : 1;

        const s3_stop = el.sliderStop3 ? el.sliderStop3.value : state.s3.stop;
        const s3_fwd = el.cfgFwdSpeed3 ? el.cfgFwdSpeed3.value : 110;
        const s3_rev = el.cfgRevSpeed3 ? el.cfgRevSpeed3.value : 70;
        const s3_fwdMs = el.cfgFwdMs3 ? el.cfgFwdMs3.value : 1000;
        const s3_revMs = el.cfgRevMs3 ? el.cfgRevMs3.value : 1000;
        const s3_pauseMs = el.cfgPauseMs3 ? el.cfgPauseMs3.value : 500;
        const s3_cyc = el.cfgCycles3 ? el.cfgCycles3.value : 1;

        const s4_stop = el.sliderStop4 ? el.sliderStop4.value : state.s4.stop;
        const s4_fwd = el.cfgFwdSpeed4 ? el.cfgFwdSpeed4.value : 110;
        const s4_rev = el.cfgRevSpeed4 ? el.cfgRevSpeed4.value : 70;
        const s4_fwdMs = el.cfgFwdMs4 ? el.cfgFwdMs4.value : 1000;
        const s4_revMs = el.cfgRevMs4 ? el.cfgRevMs4.value : 1000;
        const s4_pauseMs = el.cfgPauseMs4 ? el.cfgPauseMs4.value : 500;
        const s4_cyc = el.cfgCycles4 ? el.cfgCycles4.value : 1;

        const cmd = `CONFIG_SET stop1=${s1_stop} forward1=${s1_fwd} reverse1=${s1_rev} forwardMs1=${s1_fwdMs} reverseMs1=${s1_revMs} pauseMs1=${s1_pauseMs} cycles1=${s1_cyc} stop2=${s2_stop} forward2=${s2_fwd} reverse2=${s2_rev} forwardMs2=${s2_fwdMs} reverseMs2=${s2_revMs} pauseMs2=${s2_pauseMs} cycles2=${s2_cyc} stop3=${s3_stop} forward3=${s3_fwd} reverse3=${s3_rev} forwardMs3=${s3_fwdMs} reverseMs3=${s3_revMs} pauseMs3=${s3_pauseMs} cycles3=${s3_cyc} stop4=${s4_stop} forward4=${s4_fwd} reverse4=${s4_rev} forwardMs4=${s4_fwdMs} reverseMs4=${s4_revMs} pauseMs4=${s4_pauseMs} cycles4=${s4_cyc}`;
        sendCommand(cmd);
        showToast('Đã lưu toàn bộ cấu hình 4 Servo (S1 - S4) vào NVS Flash', 'success');
      });
    }

    // Reset Defaults
    if (el.btnResetConfig) {
      el.btnResetConfig.addEventListener('click', () => {
        if (confirm('Khôi phục cấu hình mặc định ban đầu cho cả 4 Servo?')) {
          sendCommand('RESET');
          showToast('Đã khôi phục cấu hình mặc định cả 4 Servo', 'info');
        }
      });
    }

    // Run HIL Suite
    if (el.btnRunHil) {
      el.btnRunHil.addEventListener('click', () => {
        fetch('/api/run-hil', { method: 'POST' })
          .then(res => res.json())
          .then(() => showToast('Đang thực thi HIL Test Suite trên COM5...', 'info'))
          .catch(err => showToast('Lỗi: ' + err.message, 'error'));
      });
    }

    // Terminal Input
    function handleTermSubmit() {
      const cmd = el.termInput.value.trim();
      if (cmd) {
        sendCommand(cmd);
        el.termInput.value = '';
      }
    }

    if (el.btnTermSend) el.btnTermSend.addEventListener('click', handleTermSubmit);
    if (el.termInput) {
      el.termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleTermSubmit();
      });
    }
    if (el.btnClearTerm) {
      el.btnClearTerm.addEventListener('click', () => {
        el.termBody.innerHTML = '<div class="term-line system">[SYSTEM] Console Cleared.</div>';
      });
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  window.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    initEventListeners();
    requestAnimationFrame(renderQuadGauges);
  });

})();
