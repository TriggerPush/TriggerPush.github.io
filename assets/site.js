(function () {
  // Same random background as the loading screen (files live in /bg)
  var backgrounds = ["bg/1.jpg", "bg/2.jpg", "bg/3.jpg"];
  var bg = document.getElementById("bg");
  if (bg && backgrounds.length) {
    var pick = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    bg.style.backgroundImage = "url('../" + pick + "')";
  }

  var esc = function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  // Local paths are stored relative to the site root; pages live one folder deep
  var asset = function (p) { return /^https?:/.test(p) ? p : "../" + p; };

  function fmtTime(ts, style) {
    var d = new Date(ts * 1000);
    if (style === "R") {
      var s = Math.round((d - Date.now()) / 1000), a = Math.abs(s);
      var u = a < 60 ? [s, "second"] : a < 3600 ? [s / 60, "minute"] : a < 86400 ? [s / 3600, "hour"] : [s / 86400, "day"];
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(u[0]), u[1]);
    }
    var o = { t: { timeStyle: "short" }, T: { timeStyle: "medium" }, d: { dateStyle: "short" }, D: { dateStyle: "long" },
              f: { dateStyle: "long", timeStyle: "short" }, F: { dateStyle: "full", timeStyle: "short" } }[style || "f"];
    return d.toLocaleString(undefined, o);
  }

  // Discord markdown -> safe HTML
  function md(text, data) {
    var stash = [];
    var keep = function (h) { return "\u0000" + (stash.push(h) - 1) + "\u0000"; };
    var lookup = (data && data.lookup) || { roles: {}, channels: {} };
    var users = (data && data.mentions) || {};
    var t = text || "";

    t = t.replace(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/gi, function (m, c) { return keep("<pre><code>" + esc(c.replace(/\n$/, "")) + "</code></pre>"); });
    t = t.replace(/`([^`\n]+)`/g, function (m, c) { return keep("<code>" + esc(c) + "</code>"); });
    t = t.replace(/<(a?):(\w+):(\d+)>/g, function (m, an, name, id) {
      return keep('<img class="emoji" src="https://cdn.discordapp.com/emojis/' + id + (an ? ".gif" : ".webp") + '?size=48" alt=":' + esc(name) + ':">');
    });
    t = t.replace(/<@!?(\d+)>/g, function (m, id) { return keep('<span class="mention">@' + esc(users[id] || "user") + "</span>"); });
    t = t.replace(/<@&(\d+)>/g, function (m, id) { var r = lookup.roles[id]; return keep('<span class="mention">@' + esc(r ? r.name : "role") + "</span>"); });
    t = t.replace(/<#(\d+)>/g, function (m, id) { return keep('<span class="mention">#' + esc(lookup.channels[id] || "channel") + "</span>"); });
    t = t.replace(/<t:(-?\d+)(?::([tTdDfFR]))?>/g, function (m, ts, st) { return keep("<time>" + esc(fmtTime(+ts, st)) + "</time>"); });
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, txt, url) {
      return keep('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + "</a>");
    });

    t = esc(t);
    t = t.replace(/https?:\/\/[^\s<>"]+/g, function (m) {
      var url = m, tail = "";
      var x = url.match(/(&gt;|&quot;|[.,!?;:*_~|)])+$/);
      if (x) { tail = x[0]; url = url.slice(0, -tail.length); }
      return keep('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>") + tail;
    });

    function inline(s) {
      return s
        .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>')
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<u>$1</u>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, "$1<em>$2</em>")
        .replace(/~~(.+?)~~/g, "<s>$1</s>");
    }

    var html = t.split("\n").map(function (l) {
      var m;
      if ((m = l.match(/^&gt; ?(.*)$/))) return "<blockquote>" + inline(m[1]) + "</blockquote>";
      if ((m = l.match(/^(#{1,3}) (.+)$/))) return "<h" + (m[1].length + 2) + ' class="md-h">' + inline(m[2]) + "</h" + (m[1].length + 2) + ">";
      if ((m = l.match(/^-# (.+)$/))) return '<div class="sub">' + inline(m[1]) + "</div>";
      if ((m = l.match(/^\s*[-*] (.+)$/))) return "\u2022 " + inline(m[1]);
      return inline(l);
    }).join("<br>").replace(/<\/(blockquote|h\d|div)><br>/g, "</$1>");

    for (var i = 0; i < 3; i++) html = html.replace(/\u0000(\d+)\u0000/g, function (m, n) { return stash[n]; });
    return html;
  }

  function mediaEl(a) {
    var src = asset(a.url), type = a.type || "";
    if (/^image\//.test(type)) return '<a href="' + esc(src) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(src) + '" alt="' + esc(a.name) + '"></a>';
    if (/^video\//.test(type)) return '<video controls preload="metadata" src="' + esc(src) + '"></video>';
    if (/^audio\//.test(type)) return '<audio controls src="' + esc(src) + '"></audio>';
    return '<a class="file" href="' + esc(src) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a>";
  }

  function embedEl(e, data) {
    var color = e.color != null ? "#" + e.color.toString(16).padStart(6, "0") : "#444";
    var h = '<div class="embed" style="border-left-color:' + color + '">';
    if (e.thumbnail) h += '<img class="embed-thumb" loading="lazy" src="' + esc(asset(e.thumbnail)) + '" alt="">';
    if (e.author) h += '<div class="embed-author">' + esc(e.author) + "</div>";
    if (e.title) h += '<div class="embed-title">' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + "</a>" : esc(e.title)) + "</div>";
    if (e.description) h += "<div>" + md(e.description, data) + "</div>";
    if (e.fields && e.fields.length) {
      h += '<div class="embed-fields">' + e.fields.map(function (f) { return "<div><b>" + esc(f.name) + "</b>" + md(f.value, data) + "</div>"; }).join("") + "</div>";
    }
    if (e.image) h += '<img class="embed-img" loading="lazy" src="' + esc(asset(e.image)) + '" alt="">';
    if (e.footer) h += '<div class="embed-footer">' + esc(e.footer) + "</div>";
    return h + "</div>";
  }

  function messageEl(m, data) {
    var el = document.createElement("article");
    el.className = "msg";
    var when = new Date(m.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    var h = '<div class="msg-head"><img src="' + esc(m.author.avatar) + '" alt="" loading="lazy">' +
      '<span class="msg-author">' + esc(m.author.name) + '</span><span class="msg-time">' + esc(when) + (m.edited ? " (edited)" : "") + "</span></div>";
    if (m.content) h += '<div class="msg-body">' + md(m.content, { lookup: data.lookup, mentions: m.mentions }) + "</div>";
    if (m.attachments && m.attachments.length) h += '<div class="msg-media">' + m.attachments.map(mediaEl).join("") + "</div>";
    (m.embeds || []).forEach(function (e) { h += embedEl(e, { lookup: data.lookup, mentions: m.mentions }); });
    el.innerHTML = h;
    return el;
  }

  document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("spoiler")) e.target.classList.toggle("revealed");
  });

  window.Feed = {
    init: function (opts) {
      var feed = document.getElementById("feed"), more = document.getElementById("more"), PAGE = 20, shown = 0, data;
      function render() {
        var list = data.messages.slice(shown, shown + PAGE);
        list.forEach(function (m) { feed.appendChild(messageEl(m, data)); });
        shown += list.length;
        more.hidden = shown >= data.messages.length;
      }
      fetch("../data/" + opts.file + ".json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          data = d; feed.innerHTML = "";
          if (!d.messages.length) { feed.innerHTML = '<div class="status">Nothing posted yet. Check back soon.</div>'; return; }
          render();
        })
        .catch(function () { feed.innerHTML = '<div class="status">Could not load messages. Try refreshing the page.</div>'; });
      more.addEventListener("click", render);
    }
  };

  window.Gallery = {
    init: function () {
      var g = document.getElementById("gallery"), box = document.getElementById("lightbox");
      fetch("manifest.json", { cache: "no-cache" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.images.length) { g.innerHTML = '<div class="status">No artwork yet. Add images to the art folder.</div>'; return; }
          g.innerHTML = d.images.map(function (i) {
            return '<figure><img loading="lazy" src="' + esc(asset(i.src)) + '" alt="' + esc(i.name) + '"><figcaption>' + esc(i.name) + "</figcaption></figure>";
          }).join("");
        })
        .catch(function () { g.innerHTML = '<div class="status">Could not load the gallery. Try refreshing the page.</div>'; });
      g.addEventListener("click", function (e) {
        if (e.target.tagName === "IMG") { box.querySelector("img").src = e.target.src; box.classList.add("open"); }
      });
      box.addEventListener("click", function () { box.classList.remove("open"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") box.classList.remove("open"); });
    }
  };
})();
