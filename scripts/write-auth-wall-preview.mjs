import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const markModule = readFileSync(join(root, 'functions/lib/qrMarkDataUrl.ts'), 'utf8')
const start = markModule.indexOf("export const QR_MARK_DATA_URL = '")
if (start < 0) throw new Error('QR_MARK_DATA_URL not found')
const from = start + "export const QR_MARK_DATA_URL = '".length
const end = markModule.indexOf("'", from)
const mark = markModule.slice(from, end)

const APP_TITLE = 'QR-Industrial_East_Database'
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview · Sign in · ${APP_TITLE}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --qr-blue:#4974FF; --qr-midnight:#173073; --qr-blue1:#132049; --qr-blue3:#2947A3;
    --qr-light:#B7C9FF; --bg:#132049; --text:#fff; --muted:#B7C9FF;
    --display:"Playfair Display",Georgia,"Times New Roman",serif;
    --sans:Arial,Helvetica,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{
    display:flex;align-items:center;justify-content:center;
    background-color:var(--bg);
    background-image:
      linear-gradient(180deg, rgba(19,32,73,.72) 0%, rgba(19,32,73,.82) 100%),
      url('/brand/60-birmingham-background.jpg');
    background-size:cover;
    background-position:center;
    background-repeat:no-repeat;
    color:var(--text);font-family:var(--sans);
  }
  .card{
    width:min(480px,92vw);padding:40px 36px 32px;
    border:1px solid var(--qr-blue3);border-radius:14px;
    background:rgba(23,48,115,.92);box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .qr-mark{display:block;width:min(196px,72%);height:auto;margin:0 auto 22px}
  h1{
    margin:0 0 6px;font-family:var(--display);font-size:28px;font-weight:600;
    letter-spacing:-.02em;text-align:center;line-height:1.2;word-break:break-word;
  }
  .sub{margin:0 0 22px;color:var(--muted);font-size:14px;line-height:1.45;text-align:center}
  label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px;letter-spacing:.02em}
  input{
    width:100%;padding:12px 14px;border-radius:8px;border:1px solid var(--qr-blue3);
    background:rgba(19,32,73,.65);color:var(--text);font-size:16px;outline:none;
  }
  button.primary{
    width:100%;margin-top:14px;padding:12px 16px;border:none;border-radius:8px;
    background:var(--qr-blue);color:#fff;font-size:15px;font-weight:600;cursor:pointer;
  }
  .hint{margin-top:10px;font-size:11px;color:rgba(183,201,255,.65);text-align:center}
  .preview-badge{
    position:fixed;top:12px;left:12px;padding:6px 10px;border-radius:6px;
    background:rgba(0,0,0,.45);border:1px solid rgba(183,201,255,.35);
    font-size:11px;color:var(--muted);z-index:10;
  }
</style>
</head>
<body>
  <div class="preview-badge">Preview only — layout matches live login wall</div>
  <div class="card">
    <img class="qr-mark" src="${mark}" alt="QuadReal">
    <h1>${APP_TITLE}</h1>
    <p class="sub">Sign in with your work email</p>
    <form onsubmit="return false">
      <label for="email">Email</label>
      <input id="email" type="email" placeholder="you@quadreal.com" value="">
      <button class="primary" type="button">Send code</button>
    </form>
    <p class="hint">Access is limited to people added by an admin.</p>
  </div>
</body>
</html>
`

const out = join(root, 'public', 'auth-wall-preview.html')
writeFileSync(out, html)
console.log('wrote', out, 'markLen', mark.length)
