import { Injectable } from '@nestjs/common';

export interface EmbedBranding {
  slug: string;
  name: string;
  primaryColor: string;
}

/** Builds the self-contained inquiry widget HTML (no external resources, so CSP stays tight). */
@Injectable()
export class EmbedService {
  render(b: EmbedBranding): string {
    const color = /^#[0-9a-fA-F]{3,8}$/.test(b.primaryColor) ? b.primaryColor : '#ff9500';
    const name = this.escapeHtml(b.name);
    const slug = this.escapeJs(b.slug);
    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>استعلام پرونده — ${name}</title>
<style>
  :root { --brand: ${color}; }
  * { box-sizing: border-box; }
  body { font-family: Vazirmatn, Tahoma, system-ui, sans-serif; margin: 0; padding: 16px; color: #1a1a1a; background: transparent; }
  .card { max-width: 420px; margin: 0 auto; border: 1px solid #e5e5e5; border-radius: 14px; padding: 20px; background: #fff; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p.sub { font-size: 12px; color: #777; margin: 0 0 16px; }
  label { display: block; font-size: 13px; margin: 12px 0 4px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; font-family: inherit; }
  input.otp { text-align: center; letter-spacing: 0.4em; font-size: 18px; }
  button { width: 100%; margin-top: 16px; padding: 11px; border: 0; border-radius: 10px; background: var(--brand); color: #fff; font-size: 15px; font-family: inherit; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .msg { font-size: 13px; padding: 10px 12px; border-radius: 10px; margin-top: 12px; }
  .msg.err { background: #fdecec; color: #b42318; }
  .msg.ok { background: #e9f8ef; color: #067647; }
  .row { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  .row b { font-weight: 600; }
  .ghost { background: none; color: var(--brand); border: 1px solid #eee; }
  ul { margin: 6px 0 0; padding-inline-start: 18px; font-size: 13px; color: #b42318; }
</style>
</head>
<body>
<div class="card">
  <h1>استعلام وضعیت پرونده خسارت</h1>
  <p class="sub">${name}</p>
  <div id="app"></div>
</div>
<script>
(function(){
  var SLUG = "${slug}";
  var BASE = location.origin + "/api/v1";
  var app = document.getElementById('app');
  var nid="", phone="", token="";
  var STATUS = { DRAFT:"پیش‌نویس", SUBMITTED:"ثبت‌شده", UNDER_REVIEW:"در حال بررسی", RETURNED_INCOMPLETE:"نقص مدارک", APPROVED:"تاییدشده", REJECTED:"ردشده", PAID:"پرداخت‌شده" };
  var CTYPE = { DEATH_ILLNESS:"فوت ناشی از بیماری", DEATH_ACCIDENT:"فوت ناشی از حادثه", DISABILITY_ACCIDENT:"نقص عضو/ازکارافتادگی" };

  function api(path, body, auth){
    var h = { "Content-Type":"application/json", "x-tenant-slug": SLUG };
    if (auth) h["Authorization"] = "Bearer " + token;
    return fetch(BASE+path, { method: body?"POST":"GET", headers: h, body: body?JSON.stringify(body):undefined })
      .then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error((d&&d.message)||("خطا "+r.status)); return d; }); });
  }
  function msg(t, cls){ return '<div class="msg '+cls+'">'+t+'</div>'; }
  function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }

  function stepId(err){
    app.innerHTML =
      '<label>کد ملی</label><input id="nid" inputmode="numeric" value="'+esc(nid)+'">'+
      '<label>شماره موبایل ثبت‌شده</label><input id="phone" inputmode="numeric" placeholder="۰۹۱۲…" value="'+esc(phone)+'">'+
      '<button id="go">دریافت کد تایید</button>'+ (err?msg(err,'err'):'');
    document.getElementById('go').onclick = function(){
      nid = document.getElementById('nid').value.trim();
      phone = document.getElementById('phone').value.trim();
      if(!nid||!phone){ return stepId('کد ملی و موبایل را وارد کنید'); }
      this.disabled = true;
      api('/customer/login/request-otp', { nationalCode: nid, phone: phone })
        .then(function(){ stepOtp(); })
        .catch(function(e){ stepId(e.message); });
    };
  }
  function stepOtp(err){
    app.innerHTML =
      '<label>کد تایید پیامک‌شده</label><input id="code" class="otp" inputmode="numeric" placeholder="––––––">'+
      '<button id="v">ورود و مشاهده پرونده‌ها</button>'+
      '<button id="back" class="ghost" style="margin-top:8px">بازگشت</button>'+ (err?msg(err,'err'):'');
    document.getElementById('back').onclick = function(){ stepId(); };
    document.getElementById('v').onclick = function(){
      var code = document.getElementById('code').value.trim();
      if(code.length<4){ return stepOtp('کد تایید را کامل وارد کنید'); }
      this.disabled = true;
      api('/customer/login/verify-otp', { nationalCode: nid, phone: phone, code: code })
        .then(function(d){ token = d.token; return api('/customer/claims', null, true); })
        .then(function(list){ stepResult(list||[]); })
        .catch(function(e){ stepOtp(e.message); });
    };
  }
  function stepResult(list){
    var html = msg('ورود موفق بود.', 'ok');
    if (!list.length) html += '<p class="sub" style="margin-top:12px">پرونده‌ای برای شما ثبت نشده است.</p>';
    list.forEach(function(c){
      html += '<div style="border:1px solid #eee;border-radius:10px;padding:10px;margin-top:10px">'+
        '<div class="row"><span>شماره پرونده</span><b>'+esc(c.claimNumber)+'</b></div>'+
        '<div class="row"><span>نوع</span><b>'+esc(CTYPE[c.claimType]||c.claimType)+'</b></div>'+
        '<div class="row"><span>وضعیت</span><b>'+esc(STATUS[c.status]||c.status)+'</b></div>'+
        (c.needsAction?msg('نیازمند اقدام شماست (رفع نقص/تکمیل مدارک).','err'):'')+
        '</div>';
    });
    html += '<button id="again" class="ghost" style="margin-top:14px">خروج و استعلام مجدد</button>';
    app.innerHTML = html;
    document.getElementById('again').onclick = function(){ token=""; nid=""; phone=""; stepId(); };
  }
  stepId();
})();
</script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }
  private escapeJs(s: string): string {
    return (s || '').replace(/[^a-zA-Z0-9_-]/g, '');
  }
}
