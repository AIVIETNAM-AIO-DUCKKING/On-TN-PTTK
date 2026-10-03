/* Mini Quiz PTTKHT — JavaScript thuần, không phụ thuộc thư viện.
 *
 * Cấu trúc:
 *  1. Lõi xử lý dữ liệu (không đụng DOM, có thể kiểm thử bằng Node):
 *     xáo trộn, chuẩn hóa/kiểm tra ngân hàng câu hỏi, dựng lượt làm bài, chấm điểm.
 *  2. Giao diện (DOM): màn hình bắt đầu, làm bài, kết quả.
 */
(function (root) {
  'use strict';

  var DATA_URL = 'questions.json';
  var STORAGE_KEY = 'pttk_quiz_last_option_order_v1';
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* ======================================================================
   * 1. LÕI XỬ LÝ
   * ==================================================================== */

  // Số nguyên ngẫu nhiên trong [0, n) — ưu tiên crypto, loại bỏ lệch phân phối bằng rejection sampling.
  function randomInt(n) {
    var c = root.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      var limit = Math.floor(0x100000000 / n) * n;
      var buf = new Uint32Array(1);
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // Fisher–Yates: trả về bản sao đã xáo trộn, không sửa mảng gốc.
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randomInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var PREFIX_RE = /^\s*([A-Za-z])\s*[.)]\s*/;

  // Chuẩn hóa phương án về dạng [{key, text}]. Chấp nhận:
  //  - object  {"A": "...", "B": "..."}
  //  - mảng chuỗi ["A. ...", "B. ..."]  (định dạng của file pttk.json)
  // Phương án rỗng (ví dụ "C. ") bị bỏ qua vì không có nội dung để hiển thị.
  // Trả về { options } hoặc { error }.
  function normalizeOptions(raw) {
    var list = [];
    var i;
    if (Array.isArray(raw)) {
      for (i = 0; i < raw.length; i++) {
        if (typeof raw[i] !== 'string') return { error: 'phương án thứ ' + (i + 1) + ' không phải chuỗi' };
        var m = PREFIX_RE.exec(raw[i]);
        if (m) list.push({ key: m[1].toUpperCase(), text: raw[i].slice(m[0].length).trim() });
        else list.push({ key: LETTERS[i] || String(i + 1), text: raw[i].trim() });
      }
    } else if (raw && typeof raw === 'object') {
      var keys = Object.keys(raw);
      for (i = 0; i < keys.length; i++) {
        if (typeof raw[keys[i]] !== 'string') return { error: 'phương án "' + keys[i] + '" không phải chuỗi' };
        list.push({ key: keys[i], text: raw[keys[i]].trim() });
      }
    } else {
      return { error: 'thiếu danh sách phương án' };
    }

    var seen = {};
    var options = [];
    for (i = 0; i < list.length; i++) {
      if (seen[list[i].key.toUpperCase()]) return { error: 'khóa phương án "' + list[i].key + '" bị trùng' };
      seen[list[i].key.toUpperCase()] = true;
      if (list[i].text) options.push(list[i]);
    }
    if (options.length < 2) return { error: 'có ít hơn 2 phương án có nội dung' };
    return { options: options };
  }

  // Kiểm tra toàn bộ ngân hàng. Chỉ câu hợp lệ mới được đưa vào đề.
  function validateBank(data) {
    if (!Array.isArray(data)) throw new Error('Dữ liệu gốc phải là một mảng (danh sách) các câu hỏi.');
    var questions = [];
    var invalid = [];
    var ids = {};

    data.forEach(function (raw, idx) {
      var label = (raw && (typeof raw.id === 'number' || typeof raw.id === 'string') && raw.id !== '')
        ? String(raw.id) : '(vị trí ' + (idx + 1) + ')';
      function bad(reason) { invalid.push({ id: label, reason: reason }); }

      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('mục dữ liệu không phải đối tượng');
      if (!((typeof raw.id === 'number' && isFinite(raw.id)) || (typeof raw.id === 'string' && raw.id !== ''))) return bad('thiếu ID');
      if (ids[String(raw.id)]) return bad('ID bị trùng với câu trước đó');
      if (typeof raw.cau_hoi !== 'string' || !raw.cau_hoi.trim()) return bad('thiếu nội dung câu hỏi');

      var norm = normalizeOptions(raw.options);
      if (norm.error) return bad(norm.error);

      if (typeof raw.dap_an_dung !== 'string' || !raw.dap_an_dung.trim()) return bad('thiếu đáp án đúng');
      var want = raw.dap_an_dung.trim().toUpperCase();
      var answerKey = null;
      norm.options.forEach(function (o) { if (o.key.toUpperCase() === want) answerKey = o.key; });
      if (answerKey === null) return bad('đáp án đúng "' + raw.dap_an_dung + '" không khớp phương án nào có nội dung');

      ids[String(raw.id)] = true;
      questions.push({ id: raw.id, text: raw.cau_hoi, options: norm.options, answerKey: answerKey });
    });

    return { questions: questions, invalid: invalid };
  }

  // Chữ ký thứ tự phương án, ví dụ "C|A|D|B" (dùng khóa gốc, không phụ thuộc vị trí hiển thị).
  function orderSig(options) {
    return options.map(function (o) { return o.key; }).join('|');
  }

  // Xáo trộn phương án; nếu có thứ tự lượt trước (prevSig) thì cố tạo thứ tự khác.
  function shuffleOptions(options, prevSig) {
    var res = shuffle(options);
    if (options.length >= 2 && prevSig) {
      var tries = 0;
      while (orderSig(res) === prevSig && tries < 30) { res = shuffle(options); tries++; }
      if (orderSig(res) === prevSig) res = res.slice(1).concat(res[0]); // đảm bảo khác khi n >= 2
    }
    return res;
  }

  // Dựng một lượt: xáo thứ tự câu hỏi + xáo phương án từng câu.
  // `memory` là { [id]: chữ ký thứ tự lượt trước } — được cập nhật tại chỗ.
  function buildRound(questions, memory) {
    memory = memory || {};
    return shuffle(questions).map(function (q) {
      var options = shuffleOptions(q.options, memory[String(q.id)]);
      memory[String(q.id)] = orderSig(options);
      return { q: q, options: options };
    });
  }

  // Chấm điểm. Đáp án đúng xác định bằng khóa gốc (answerKey), không dựa vào vị trí hiển thị.
  function gradeRound(items, answers) {
    var correct = 0, wrong = 0, unanswered = 0;
    var details = items.map(function (item, index) {
      var id = String(item.q.id);
      var chosen = answers.has(id) ? answers.get(id) : null;
      var status;
      if (chosen === null) { status = 'unanswered'; unanswered++; }
      else if (chosen === item.q.answerKey) { status = 'correct'; correct++; }
      else { status = 'wrong'; wrong++; }
      return { item: item, index: index, chosen: chosen, status: status };
    });
    var total = items.length;
    var score = total ? Math.round(correct * 1000 / total) / 100 : 0; // (đúng / tổng) × 10, 2 chữ số thập phân
    return { total: total, correct: correct, wrong: wrong, unanswered: unanswered, score: score, details: details };
  }

  var Core = {
    shuffle: shuffle,
    normalizeOptions: normalizeOptions,
    validateBank: validateBank,
    shuffleOptions: shuffleOptions,
    buildRound: buildRound,
    gradeRound: gradeRound,
    orderSig: orderSig
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (!root.document) return; // chạy dưới Node: chỉ xuất phần lõi

  /* ======================================================================
   * 2. GIAO DIỆN
   * ==================================================================== */

  var doc = root.document;
  var appEl = doc.getElementById('app');

  var app = {
    bank: [],       // câu hỏi hợp lệ
    invalid: [],    // câu bị bỏ qua
    round: null     // lượt hiện tại
  };

  // ---- tiện ích DOM (luôn dùng textContent -> an toàn với ký tự đặc biệt) ----
  function h(tag, props) {
    var el = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) appendKid(el, arguments[i]);
    return el;
  }
  function appendKid(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { appendKid(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : doc.createTextNode(String(kid)));
  }

  function show(node) {
    appEl.textContent = '';
    appEl.appendChild(node);
    root.scrollTo && root.scrollTo(0, 0);
  }

  // ---- lưu thứ tự phương án gần nhất (LocalStorage, chỉ dùng cho mục đích này) ----
  function loadMemory() {
    try {
      var raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) { return {}; }
  }
  function saveMemory(mem) {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(mem)); } catch (e) { /* bỏ qua: vẫn chạy bình thường */ }
  }

  // ---- tải dữ liệu ----
  function AppError(message, detail) {
    var e = new Error(message);
    e.detail = detail || '';
    e.isAppError = true;
    return e;
  }

  function loadBank() {
    var fileHint = root.location && root.location.protocol === 'file:'
      ? 'Bạn đang mở trực tiếp file index.html từ ổ đĩa. Trình duyệt chặn đọc questions.json theo cách này; hãy mở qua GitHub Pages hoặc một máy chủ cục bộ (ví dụ: python -m http.server).'
      : '';
    return root.fetch(DATA_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw AppError('Không tải được file questions.json (mã lỗi ' + res.status + ').', 'Kiểm tra file questions.json có nằm cùng thư mục với index.html và đã được đưa lên GitHub chưa.');
      return res.text();
    }, function (err) {
      throw AppError('Không tải được file questions.json.', (fileHint || 'Kiểm tra kết nối mạng và đường dẫn file.') + '\n' + (err && err.message ? err.message : ''));
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch (e) { throw AppError('File questions.json không phải JSON hợp lệ.', e.message); }
      return data;
    });
  }

  function init() {
    show(h('div', { class: 'loading', text: 'Đang tải ngân hàng câu hỏi…' }));
    loadBank().then(function (data) {
      var v = validateBank(data);
      if (!v.questions.length) {
        throw AppError('Ngân hàng câu hỏi không có câu hợp lệ nào.', summarizeInvalid(v.invalid));
      }
      app.bank = v.questions;
      app.invalid = v.invalid;
      renderStart();
    }).catch(function (err) {
      renderError(err);
    });
  }

  function summarizeInvalid(list) {
    return list.slice(0, 50).map(function (x) { return 'Câu ' + x.id + ': ' + x.reason; }).join('\n') +
      (list.length > 50 ? '\n… và ' + (list.length - 50) + ' mục khác' : '');
  }

  // ---- màn hình lỗi ----
  function renderError(err) {
    var msg = err && err.isAppError ? err.message : 'Đã xảy ra lỗi không mong muốn khi khởi động ứng dụng.';
    var detail = err && err.isAppError ? err.detail : (err && err.message) || '';
    show(h('div', { class: 'start' },
      h('div', { class: 'card notice notice-error', role: 'alert' },
        h('strong', { text: msg }),
        detail ? h('details', { open: true }, h('summary', { text: 'Chi tiết' }), h('pre', { text: detail })) : null),
      h('div', null, h('button', { class: 'btn btn-primary', type: 'button', text: 'Thử tải lại', onclick: init }))
    ));
  }

  // ---- màn hình bắt đầu ----
  function renderStart() {
    var total = app.bank.length;
    var warn = null;
    if (app.invalid.length) {
      warn = h('div', { class: 'card notice notice-warn' },
        h('strong', { text: 'Đã bỏ qua ' + app.invalid.length + ' mục dữ liệu không hợp lệ.' }),
        h('details', null, h('summary', { text: 'Xem chi tiết' }), h('pre', { text: summarizeInvalid(app.invalid) })));
    }
    show(h('div', { class: 'start' },
      h('div', { class: 'card start-card' },
        h('h1', { text: 'Mini Quiz PTTKHT' }),
        h('p', { class: 'lead', text: 'Hệ thống luyện tập trắc nghiệm môn Phân tích và Thiết kế Hệ thống Thông tin.' }),
        h('div', { class: 'start-total' }, h('strong', { text: String(total) }), h('span', { text: 'câu hỏi trong ngân hàng' })),
        h('div', null, h('button', { class: 'btn btn-primary btn-lg', type: 'button', id: 'btn-start', text: 'Bắt đầu làm bài', onclick: function () { startRound(app.bank, 'full', 0); } })),
        h('ul', { class: 'start-hints' },
          h('li', { text: 'Mỗi lượt gồm toàn bộ ' + total + ' câu, thứ tự câu hỏi và đáp án được xáo trộn.' }),
          h('li', { text: 'Sau khi nộp bài, bạn có thể luyện lại riêng các câu sai hoặc chưa trả lời.' }))),
      warn
    ));
  }

  // ---- khởi tạo lượt ----
  function startRound(questions, kind, retryNo) {
    var memory = loadMemory();
    var items = buildRound(questions, memory);
    saveMemory(memory);
    app.round = {
      items: items,
      answers: new Map(),   // id (chuỗi) -> khóa phương án gốc
      current: 0,
      submitted: false,
      result: null,
      kind: kind,
      retryNo: retryNo
    };
    renderQuiz();
  }

  function roundTitle(r) {
    return r.kind === 'full' ? 'Lượt làm bài đầy đủ' : 'Luyện lại câu sai · lần ' + r.retryNo;
  }

  // ---- màn hình làm bài ----
  function renderQuiz() {
    var r = app.round;
    var total = r.items.length;
    var ui = {};

    ui.progressText = h('span', { class: 'progress-text' });
    ui.progressFill = h('div', { class: 'progress-fill' });
    ui.progressBar = h('div', { class: 'progress-bar', role: 'progressbar', 'aria-label': 'Tiến độ trả lời', 'aria-valuemin': 0, 'aria-valuemax': total }, ui.progressFill);

    ui.card = h('section', { class: 'card question-card' });

    ui.cells = r.items.map(function (it, i) {
      return h('button', { class: 'cell', type: 'button', onclick: function () { goTo(i, true); } }, String(i + 1));
    });
    ui.navGrid = h('div', { class: 'nav-grid' }, ui.cells);
    ui.navPanel = h('aside', { class: 'card nav-panel', id: 'nav-panel' },
      h('h2', { text: 'Danh sách câu hỏi' }),
      h('div', { class: 'legend' },
        h('span', null, h('i'), 'Chưa trả lời'),
        h('span', null, h('i', { class: 'l-answered' }), 'Đã trả lời'),
        h('span', null, h('i', { class: 'l-current' }), 'Đang xem')),
      ui.navGrid);
    ui.navToggle = h('button', {
      class: 'btn nav-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nav-panel', text: 'Hiện danh sách câu hỏi',
      onclick: function () {
        var open = ui.navPanel.classList.toggle('open');
        ui.navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        ui.navToggle.textContent = open ? 'Ẩn danh sách câu hỏi' : 'Hiện danh sách câu hỏi';
        if (open) scrollCurrentCellIntoView();
      }
    });

    function answeredCount() { return r.answers.size; }

    function updateProgress() {
      var n = answeredCount();
      ui.progressText.textContent = 'Đã trả lời: ' + n + '/' + total + ' câu';
      ui.progressFill.style.width = (total ? (n / total) * 100 : 0) + '%';
      ui.progressBar.setAttribute('aria-valuenow', n);
    }

    function updateNav() {
      r.items.forEach(function (it, i) {
        var c = ui.cells[i];
        var answered = r.answers.has(String(it.q.id));
        c.classList.toggle('answered', answered);
        c.classList.toggle('current', i === r.current);
        if (i === r.current) c.setAttribute('aria-current', 'step'); else c.removeAttribute('aria-current');
        c.setAttribute('aria-label', 'Câu ' + (i + 1) + (answered ? ', đã trả lời' : ', chưa trả lời') + (i === r.current ? ', đang xem' : ''));
      });
    }

    function scrollCurrentCellIntoView() {
      var cell = ui.cells[r.current];
      var box = ui.navGrid;
      if (!cell || !box.clientHeight) return;
      var top = cell.offsetTop, bottom = top + cell.offsetHeight;
      if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
        box.scrollTop = Math.max(0, top - box.clientHeight / 2);
      }
    }

    function goTo(i, fromNav) {
      if (i < 0 || i >= total) return;
      r.current = i;
      renderQuestion();
      updateNav();
      scrollCurrentCellIntoView();
      if (fromNav && root.matchMedia && root.matchMedia('(max-width: 900px)').matches) {
        ui.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function renderQuestion() {
      var it = r.items[r.current];
      var id = String(it.q.id);
      var selected = r.answers.has(id) ? r.answers.get(id) : null;
      var labels = [];
      var clearBtn;

      function refreshSelected() {
        var cur = r.answers.has(id) ? r.answers.get(id) : null;
        labels.forEach(function (l) { l.el.classList.toggle('selected', l.key === cur); });
        clearBtn.hidden = cur === null;
      }

      function select(key) {
        r.answers.set(id, key);
        refreshSelected();
        updateProgress();
        updateNav();
      }

      var optionEls = it.options.map(function (o, idx) {
        var input = h('input', { type: 'radio', name: 'answer', value: o.key, checked: selected === o.key, onchange: function () { select(o.key); } });
        var label = h('label', { class: 'option' + (selected === o.key ? ' selected' : '') },
          input,
          h('span', { class: 'opt-letter', 'aria-hidden': 'true', text: LETTERS[idx] }),
          h('span', { class: 'opt-text', text: o.text }));
        labels.push({ key: o.key, el: label, input: input });
        return label;
      });

      clearBtn = h('button', {
        class: 'btn btn-ghost', type: 'button', text: 'Bỏ chọn câu này', hidden: selected === null,
        onclick: function () {
          r.answers.delete(id);
          labels.forEach(function (l) { l.input.checked = false; });
          refreshSelected();
          updateProgress();
          updateNav();
        }
      });

      ui.card.textContent = '';
      ui.card.appendChild(h('div', { class: 'question-head' },
        h('span', { class: 'question-no', text: 'Câu ' + (r.current + 1) + ' / ' + total }),
        h('span', { class: 'question-id', text: 'Mã câu hỏi gốc: ' + it.q.id })));
      ui.card.appendChild(h('p', { class: 'question-text', text: it.q.text }));
      ui.card.appendChild(h('fieldset', { class: 'options' },
        h('legend', { class: 'sr-only', style: 'position:absolute;left:-9999px', text: 'Các phương án trả lời' }),
        optionEls));
      ui.card.appendChild(h('div', { class: 'question-tools' }, clearBtn));
      ui.card.appendChild(h('div', { class: 'actions' },
        h('button', { class: 'btn btn-nav', type: 'button', text: '← Câu trước', disabled: r.current === 0, onclick: function () { goTo(r.current - 1); } }),
        h('button', { class: 'btn btn-nav', type: 'button', text: 'Câu tiếp theo →', disabled: r.current === total - 1, onclick: function () { goTo(r.current + 1); } }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-primary btn-submit', type: 'button', text: 'Nộp bài', onclick: openSubmitDialog })));
    }

    function openSubmitDialog() {
      if (r.submitted) return;
      var answered = answeredCount();
      var unanswered = total - answered;
      var dlg, confirmBtn;

      function close() {
        if (typeof dlg.close === 'function') { try { dlg.close(); } catch (e) { /* đã đóng */ } }
        dlg.removeAttribute('open');
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      }

      confirmBtn = h('button', {
        class: 'btn btn-primary', type: 'button', text: 'Xác nhận nộp bài',
        onclick: function () {
          if (r.submitted) return;         // chặn nộp nhiều lần
          r.submitted = true;
          confirmBtn.disabled = true;
          close();
          r.result = gradeRound(r.items, r.answers);
          renderResult();
        }
      });

      dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'dlg-title' },
        h('div', { class: 'modal-body' },
          h('h2', { id: 'dlg-title', text: 'Xác nhận nộp bài' }),
          h('div', { class: 'modal-stats' },
            h('div', { class: 'modal-stat' }, h('strong', { text: String(total) }), h('span', { text: 'Tổng số câu' })),
            h('div', { class: 'modal-stat' }, h('strong', { text: String(answered) }), h('span', { text: 'Đã trả lời' })),
            h('div', { class: 'modal-stat' + (unanswered ? ' warn' : '') }, h('strong', { text: String(unanswered) }), h('span', { text: 'Chưa trả lời' }))),
          h('p', { text: unanswered
            ? 'Còn ' + unanswered + ' câu chưa trả lời. Các câu này sẽ được tính là chưa làm. Bạn có chắc chắn muốn nộp bài?'
            : 'Bạn đã trả lời tất cả các câu. Bạn có muốn nộp bài ngay bây giờ không?' }),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', type: 'button', text: 'Quay lại làm tiếp', onclick: close }),
            confirmBtn)));

      dlg.addEventListener('close', function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
      doc.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    }

    show(h('div', null,
      h('div', { class: 'card quiz-top' },
        h('div', { class: 'quiz-top-row' }, h('span', { class: 'quiz-title', text: roundTitle(r) + ' · ' + total + ' câu' }), ui.progressText),
        ui.progressBar),
      h('div', { class: 'quiz-layout' },
        h('div', null, ui.card, h('div', { style: 'height:12px' }), ui.navToggle),
        ui.navPanel)));

    renderQuestion();
    updateNav();
    updateProgress();
  }

  // ---- màn hình kết quả ----
  var STATUS_TEXT = { correct: 'Đúng', wrong: 'Sai', unanswered: 'Chưa trả lời' };

  function renderResult() {
    var r = app.round;
    var res = r.result;
    var needRetry = res.wrong + res.unanswered;
    var perfect = needRetry === 0;

    function stat(label, value, cls) {
      return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('strong', { text: String(value) }), h('span', { text: label }));
    }

    var retryBtn = needRetry ? h('button', {
      class: 'btn btn-primary', type: 'button', id: 'btn-retry', onclick: function () {
        var qs = res.details.filter(function (d) { return d.status !== 'correct'; }).map(function (d) { return d.item.q; });
        if (qs.length) startRound(qs, 'retry', r.retryNo + 1);
      }
    }, 'Luyện lại câu sai', h('span', { class: 'btn-count', text: needRetry + ' câu' })) : null;

    var hero = h('div', { class: 'card' },
      h('div', { class: 'result-hero' },
        h('div', { class: 'score-box' },
          h('div', { class: 'score-label', text: 'Điểm số' }),
          h('div', null, h('span', { class: 'score-num', text: res.score.toFixed(2) }), h('span', { class: 'score-max', text: ' / 10' }))),
        h('div', null,
          h('h1', { text: 'Kết quả — ' + roundTitle(r) }),
          h('div', { class: 'stats' },
            stat('Tổng số câu', res.total, ''),
            stat('Câu đúng', res.correct, 'ok'),
            stat('Câu sai', res.wrong, 'bad'),
            stat('Chưa trả lời', res.unanswered, '')))),
      perfect ? h('div', { class: 'congrats', role: 'status' },
        h('strong', { text: 'Chúc mừng bạn đã hoàn thành!' }),
        h('span', { text: r.kind === 'full'
          ? 'Bạn đã trả lời đúng tất cả ' + res.total + ' câu hỏi.'
          : 'Bạn đã trả lời đúng toàn bộ các câu cần ôn lại ở lượt này.' })) : null,
      h('div', { class: 'result-actions' },
        retryBtn,
        h('button', { class: 'btn' + (perfect ? ' btn-primary' : ''), type: 'button', id: 'btn-redo', text: 'Làm lại toàn bộ đề', onclick: function () { startRound(app.bank, 'full', 0); } }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Về màn hình đầu', onclick: renderStart })));

    // Bảng tổng quan + bộ lọc + chi tiết từng câu
    var cards = [];
    var activeFilter = 'all';
    var chips = [];

    function applyFilter(f) {
      activeFilter = f;
      chips.forEach(function (c) { c.el.setAttribute('aria-pressed', c.f === f ? 'true' : 'false'); });
      cards.forEach(function (c) { c.el.hidden = !(f === 'all' || c.status === f); });
    }

    var overview = h('div', { class: 'overview' }, res.details.map(function (d) {
      return h('button', {
        class: 'cell s-' + d.status, type: 'button',
        'aria-label': 'Câu ' + (d.index + 1) + ': ' + STATUS_TEXT[d.status],
        title: 'Câu ' + (d.index + 1) + ': ' + STATUS_TEXT[d.status],
        onclick: function () {
          if (activeFilter !== 'all' && activeFilter !== d.status) applyFilter('all');
          var c = cards[d.index];
          c.el.classList.add('open');
          c.head.setAttribute('aria-expanded', 'true');
          c.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, String(d.index + 1));
    }));

    function labelOf(item, key) {
      for (var i = 0; i < item.options.length; i++) if (item.options[i].key === key) return LETTERS[i] + '. ' + item.options[i].text;
      return '';
    }

    res.details.forEach(function (d) {
      var q = d.item.q;
      var chosenLine, chosenCls;
      if (d.status === 'unanswered') { chosenLine = 'Bạn chọn: Chưa trả lời'; chosenCls = 'none'; }
      else { chosenLine = 'Bạn chọn: ' + labelOf(d.item, d.chosen); chosenCls = d.status === 'correct' ? 'chosen-ok' : 'chosen-wrong'; }

      var head = h('button', { class: 'review-head', type: 'button', 'aria-expanded': d.status === 'correct' ? 'false' : 'true' },
        h('span', { class: 'review-line1' },
          h('span', { class: 'review-no', text: 'Câu ' + (d.index + 1) }),
          h('span', { class: 'badge b-' + d.status, text: STATUS_TEXT[d.status] }),
          h('span', { class: 'review-id', text: 'Mã gốc: ' + q.id }),
          h('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' })),
        h('span', { class: 'review-q', text: q.text }),
        h('span', { class: 'review-sum' },
          h('span', { class: chosenCls, text: chosenLine }),
          h('span', { class: 'right', text: 'Đáp án đúng: ' + labelOf(d.item, q.answerKey) })));

      var body = h('div', { class: 'review-body' }, d.item.options.map(function (o, idx) {
        var isCorrect = o.key === q.answerKey;
        var isChosen = o.key === d.chosen;
        var tags = [];
        if (isChosen) tags.push('Bạn đã chọn');
        if (isCorrect) tags.push('Đáp án đúng');
        return h('div', { class: 'rv-opt' + (isCorrect ? ' is-correct' : '') + (isChosen && !isCorrect ? ' is-wrong' : '') },
          h('span', { class: 'opt-letter', text: LETTERS[idx] }),
          h('span', { class: 'opt-text', text: o.text }),
          tags.length ? h('span', { class: 'rv-tags' }, tags.map(function (t) { return h('span', { class: 'tag', text: t }); })) : null);
      }));

      var el = h('article', { class: 'card review status-' + d.status + (d.status === 'correct' ? '' : ' open'), id: 'rv-' + d.index }, head, body);
      head.addEventListener('click', function () {
        var open = el.classList.toggle('open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      cards.push({ el: el, head: head, status: d.status });
    });

    var filterDefs = [
      { f: 'all', label: 'Tất cả (' + res.total + ')' },
      { f: 'wrong', label: 'Sai (' + res.wrong + ')' },
      { f: 'unanswered', label: 'Chưa trả lời (' + res.unanswered + ')' },
      { f: 'correct', label: 'Đúng (' + res.correct + ')' }
    ];
    var filterBar = h('div', { class: 'filters', role: 'group', 'aria-label': 'Lọc câu hỏi' }, filterDefs.map(function (def) {
      var el = h('button', { class: 'chip', type: 'button', 'aria-pressed': def.f === 'all' ? 'true' : 'false', text: def.label, onclick: function () { applyFilter(def.f); } });
      chips.push({ f: def.f, el: el });
      return el;
    }));

    show(h('div', null,
      hero,
      h('h2', { class: 'section-title', text: 'Tổng quan các câu (nhấn vào số để xem chi tiết)' }),
      h('div', { class: 'card' }, overview),
      h('h2', { class: 'section-title', text: 'Chi tiết từng câu' }),
      filterBar,
      h('div', { class: 'review-list' }, cards.map(function (c) { return c.el; }))));
  }

  /* ---- khởi chạy ---- */
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : globalThis);
