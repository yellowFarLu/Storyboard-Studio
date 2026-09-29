/* 分镜工坊 - 前端逻辑 */
(function () {
  "use strict";

  /* ===== 状态 ===== */
  var state = {
    outline: null,
    board: [],
    isMock: false,
    model: "未连接",
    generating: false,
  };

  /* ===== DOM ===== */
  var $ = function (id) { return document.getElementById(id); };
  var ideaInput = $("idea-input");
  var btnOutline = $("btn-outline");
  var outlineSection = $("outline-section");
  var boardSection = $("board-section");
  var outlineLoading = $("outline-loading");
  var outlineBody = $("outline-body");
  var boardLoading = $("board-loading");
  var boardBody = $("board-body");
  var toastEl = $("toast");

  /* ===== 示例点子 ===== */
  var EXAMPLES = [
    "被裁的程序员继承了一家濒临倒闭的影视公司，必须在30天内做出爆款短剧",
    "菜市场卖鱼的姑娘，其实是十年前隐退的顶级大厨，前东家上门踢馆",
    "两个在写字楼加班的陌生人，每天靠同一部电梯里的便利贴互相打气，突然有一天便利贴断了",
    "AI 秘书发现自己老板的公司正在被上司暗中掏空，决定帮老板扳回一局",
  ];
  var chipsEl = $("idea-chips");
  EXAMPLES.forEach(function (idea) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.title = idea;
    chip.textContent = idea;
    chip.addEventListener("click", function () {
      ideaInput.value = idea;
      toast("已填入示例点子，点击「生成三幕大纲」开始");
    });
    chipsEl.appendChild(chip);
  });

  /* ===== Toast ===== */
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isError ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, 3200);
  }

  /* ===== 步骤条 ===== */
  function setStep(activeIdx) {
    var steps = document.querySelectorAll(".step");
    steps.forEach(function (el, i) {
      el.classList.toggle("active", i === activeIdx);
      el.classList.toggle("done", i < activeIdx);
    });
  }

  /* ===== 加载分步文案 ===== */
  var OUTLINE_PHASES = ["正在构思世界观…", "正在设计主角与冲突…", "正在搭建三幕结构…"];
  var BOARD_PHASES = ["正在分析大纲…", "正在设计镜头语言…", "正在打磨台词与字幕…"];
  function runPhases(el, phases) {
    var i = 0;
    el.textContent = phases[0];
    return setInterval(function () {
      i = (i + 1) % phases.length;
      el.textContent = phases[i];
    }, 1600);
  }

  /* ===== API 调用 ===== */
  async function callGenerate(payload) {
    var resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    var result;
    try { result = await resp.json(); } catch (_) { result = { ok: false, error: "服务返回异常" }; }
    if (!resp.ok || !result.ok) {
      throw new Error(result.error || "生成失败，请稍后重试");
    }
    return result;
  }

  /* ===== 生成三幕大纲 ===== */
  async function generateOutline() {
    if (state.generating) return;
    var idea = ideaInput.value.trim();
    if (idea.length < 4) {
      toast("请先输入至少 4 个字的故事点子", true);
      ideaInput.focus();
      return;
    }

    state.generating = true;
    btnOutline.disabled = true;
    outlineSection.classList.remove("section-hidden");
    outlineBody.classList.add("section-hidden");
    outlineLoading.classList.remove("section-hidden");
    setStep(1);
    var phaseTimer = runPhases($("outline-loading-text"), OUTLINE_PHASES);

    try {
      var result = await callGenerate({ type: "outline", idea: idea });
      state.outline = result.data;
      state.isMock = !!result.isMock;
      state.model = result.model || "未知";
      renderOutline(result.isMock);
      setStep(2);
      $("btn-storyboard").focus();
      toast(result.isMock ? "当前为演示数据（未配置模型 Key）" : "三幕大纲已生成");
    } catch (e) {
      toast(e.message, true);
      setStep(0);
    } finally {
      clearInterval(phaseTimer);
      outlineLoading.classList.add("section-hidden");
      btnOutline.disabled = false;
      state.generating = false;
      updateModelInfo();
    }
  }

  function renderOutline(isMock) {
    var o = state.outline;
    $("outline-logline").textContent = o.logline || "（未生成梗概）";
    $("outline-worldview").textContent = o.worldview || "—";
    $("outline-protagonist").textContent = (o.protagonist.name || "—") + (o.protagonist.desc ? "，" + o.protagonist.desc : "");
    $("outline-conflict").textContent = o.conflict || "—";

    var actsEl = $("outline-acts");
    actsEl.innerHTML = "";
    (o.acts || []).forEach(function (act) {
      var card = document.createElement("div");
      card.className = "act-card";
      var title = document.createElement("div");
      title.className = "act-title";
      title.textContent = act.title || "幕";
      card.appendChild(title);
      var ul = document.createElement("ul");
      ul.className = "act-beats";
      (act.beats || []).forEach(function (beat) {
        var li = document.createElement("li");
        li.textContent = beat;
        ul.appendChild(li);
      });
      card.appendChild(ul);
      actsEl.appendChild(card);
    });

    setBadge($("outline-mode-badge"), isMock);
    outlineBody.classList.remove("section-hidden");
  }

  /* ===== 生成分镜 ===== */
  async function generateBoard() {
    if (state.generating || !state.outline) return;
    state.generating = true;
    var btn = $("btn-storyboard");
    btn.disabled = true;
    boardSection.classList.remove("section-hidden");
    boardBody.classList.add("section-hidden");
    boardLoading.classList.remove("section-hidden");
    setStep(2);
    var phaseTimer = runPhases($("board-loading-text"), BOARD_PHASES);

    try {
      var result = await callGenerate({ type: "storyboard", outline: state.outline });
      state.board = result.data;
      state.isMock = !!result.isMock;
      state.model = result.model || "未知";
      renderBoard(result.isMock);
      setStep(3);
      toast(result.isMock ? "当前为演示数据（未配置模型 Key）" : "第一幕分镜脚本已生成");
    } catch (e) {
      toast(e.message, true);
    } finally {
      clearInterval(phaseTimer);
      boardLoading.classList.add("section-hidden");
      btn.disabled = false;
      state.generating = false;
      updateModelInfo();
    }
  }

  /* ===== 渲染分镜表 ===== */
  function renderBoard(isMock) {
    var tbody = $("board-tbody");
    tbody.innerHTML = "";
    state.board.forEach(function (row, i) {
      tbody.appendChild(renderRow(row, i));
    });
    setBadge($("board-mode-badge"), isMock);
    updateTotalDuration();
    boardBody.classList.remove("section-hidden");
  }

  function renderRow(row, idx) {
    var tr = document.createElement("tr");
    var cells = [
      { cls: "col-idx", text: String(idx + 1), editable: false },
      { cls: "col-scene", text: row.scene, editable: true },
      { cls: "col-scale", text: row.scale, editable: true },
      { cls: "col-action", text: row.action, editable: true },
      { cls: "col-dialogue", text: row.dialogue, editable: true },
      { cls: "col-caption", text: row.caption, editable: true },
      { cls: "col-duration", text: String(row.duration), editable: true },
    ];
    cells.forEach(function (c) {
      var td = document.createElement("td");
      td.className = c.cls;
      td.textContent = c.text;
      if (c.editable) {
        td.contentEditable = "true";
        td.spellcheck = false;
        td.addEventListener("blur", function () {
          if (c.cls === "col-duration") {
            var v = parseInt(td.textContent, 10);
            if (isNaN(v) || v < 1 || v > 10) {
              td.textContent = String(row.duration);
              toast("时长需为 1-10 秒的整数", true);
              return;
            }
            row.duration = v;
            updateTotalDuration();
          } else if (c.cls === "col-scale") {
            var ALLOWED = ["远景", "全景", "中景", "近景", "特写"];
            var sv = td.textContent.trim();
            if (ALLOWED.indexOf(sv) === -1) {
              td.textContent = row.scale;
              toast("景别需为：远景/全景/中景/近景/特写", true);
              return;
            }
            row.scale = sv;
          } else {
            row[c.cls === "col-scene" ? "scene" : c.cls === "col-action" ? "action" : c.cls === "col-dialogue" ? "dialogue" : "caption"] = td.textContent.trim();
          }
        });
      }
      tr.appendChild(td);
    });

    var delTd = document.createElement("td");
    delTd.className = "col-del";
    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "删除该镜头";
    delBtn.innerHTML = "✕";
    delBtn.addEventListener("click", function () {
      state.board.splice(idx, 1);
      renderBoard(state.isMock);
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  function updateTotalDuration() {
    var total = state.board.reduce(function (sum, r) { return sum + (Number(r.duration) || 0); }, 0);
    $("board-total-duration").textContent = String(total);
  }

  function setBadge(el, isMock) {
    el.textContent = isMock ? "演示数据" : "AI 生成";
    el.className = "badge " + (isMock ? "badge-mock" : "badge-ai");
  }

  /* ===== 导出 ===== */
  function boardMarkdown() {
    var lines = ["# 第一幕分镜脚本", ""];
    if (state.outline && state.outline.logline) lines.push("> " + state.outline.logline + "\n");
    lines.push("| # | 场景 | 景别 | 画面动作 | 台词 | 字幕建议 | 时长(s) |");
    lines.push("|---|------|------|----------|------|----------|--------|");
    state.board.forEach(function (r, i) {
      var esc = function (s) { return String(s).replace(/\|/g, "\\|").replace(/\n/g, " "); };
      lines.push("| " + (i + 1) + " | " + esc(r.scene) + " | " + esc(r.scale) + " | " + esc(r.action) + " | " + esc(r.dialogue) + " | " + esc(r.caption) + " | " + r.duration + " |");
    });
    lines.push("");
    lines.push("> 由「分镜工坊」生成 · 共 " + state.board.length + " 个镜头 · 总时长 " + $("board-total-duration").textContent + " 秒");
    return lines.join("\n");
  }

  function copyBoard() {
    if (!state.board.length) { toast("请先生成分镜脚本", true); return; }
    var md = boardMarkdown();
    function done(ok) { toast(ok ? "已复制到剪贴板" : "复制失败，请手动选择复制", ok ? false : true); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function exportBoard() {
    if (!state.board.length) { toast("请先生成分镜脚本", true); return; }
    var blob = new Blob([boardMarkdown()], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "分镜脚本-第一幕.md";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
    toast("已导出 Markdown 文件");
  }

  function addRow() {
    if (!state.board.length) { toast("请先生成分镜脚本", true); return; }
    state.board.push({ id: state.board.length + 1, scene: "新场景", scale: "中景", action: "输入画面动作…", dialogue: "", caption: "", duration: 5 });
    renderBoard(state.isMock);
  }

  /* ===== 模型信息 ===== */
  function updateModelInfo() {
    $("model-info").textContent = "模型：" + state.model + (state.isMock ? "（演示数据）" : "");
  }

  /* ===== 事件绑定 ===== */
  btnOutline.addEventListener("click", generateOutline);
  $("btn-regen-outline").addEventListener("click", generateOutline);
  $("btn-storyboard").addEventListener("click", generateBoard);
  $("btn-copy").addEventListener("click", copyBoard);
  $("btn-export").addEventListener("click", exportBoard);
  $("btn-add-row").addEventListener("click", addRow);
  ideaInput.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generateOutline();
    }
  });
  // 自动调整 textarea 高度
  ideaInput.addEventListener("input", function () {
    ideaInput.style.height = "auto";
    ideaInput.style.height = Math.min(160, Math.max(84, ideaInput.scrollHeight)) + "px";
  });
})();
