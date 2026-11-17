#!/usr/bin/env node
'use strict';

/**
 * 素材上传清单生成器（REMOTE_ART 配套）
 * ------------------------------------------------------------------
 * 用途：当 REMOTE_ART 开启、图片改走网络加载时，用本脚本把
 * preview/thumbs/ 下的素材整理成一份「上传清单 + 目录结构」，
 * 供人工或部署脚本按原层级传到 CDN / 对象存储。
 *
 * 为什么只生成清单、不直接上传：
 *   本项目没有固定 CDN 账号与凭据，写死任何上传目标都是猜测。
 *   清单保证「本地路径 ↔ 远端路径」一一对应，避免传错层级后
 *   线上 404（art.wxss 里的 URL 由 art.js 按同一规则拼出）。
 *
 * 用法：
 *   node preview/upload-manifest.js                 # 输出清单到 stdout
 *   node preview/upload-manifest.js --out list.txt  # 写入文件
 *   node preview/upload-manifest.js --check <baseUrl>  # 逐个 HEAD 校验远端是否已就位
 */

const fs = require('fs');
const path = require('path');

const THUMBS = path.join(__dirname, 'thumbs');
const args = process.argv.slice(2);

function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (name) {
    if (name.startsWith('.')) return;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

if (!fs.existsSync(THUMBS)) {
  console.error('FATAL 缺少 preview/thumbs，无法生成清单');
  process.exit(1);
}

const files = walk(THUMBS, []).sort();
const rows = files.map(function (full) {
  const rel = path.relative(THUMBS, full).split(path.sep).join('/');
  return { rel: rel, bytes: fs.statSync(full).size };
});

const total = rows.reduce(function (a, r) { return a + r.bytes; }, 0);

const outIdx = args.indexOf('--out');
if (outIdx >= 0) {
  const target = args[outIdx + 1];
  if (!target) { console.error('FATAL --out 需要文件路径'); process.exit(1); }
  const body = rows.map(function (r) { return r.rel + '\t' + r.bytes; }).join('\n') + '\n';
  fs.writeFileSync(target, body, 'utf8');
  console.log('已写入 ' + target + '（' + rows.length + ' 个文件，' + (total / 1024).toFixed(1) + 'KB）');
} else {
  rows.forEach(function (r) { console.log(r.rel + '\t' + r.bytes); });
  console.log('---');
  console.log('合计 ' + rows.length + ' 个文件，' + (total / 1024).toFixed(1) + 'KB');
  console.log('上传要求：保持上面的相对路径层级，落盘到 REMOTE_ART 基址下（如 ' +
    'https://cdn.example.com/splendor/cards/c0_00.webp）。');
}

const checkIdx = args.indexOf('--check');
if (checkIdx >= 0) {
  const base = (args[checkIdx + 1] || '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) { console.error('FATAL --check 需要 https 基址'); process.exit(1); }
  (async function () {
    let bad = 0;
    for (const r of rows) {
      const url = base + '/' + r.rel;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) { console.error('MISS ' + res.status + ' ' + url); bad += 1; }
      } catch (e) {
        console.error('ERR  ' + url + ' ' + (e && e.message));
        bad += 1;
      }
    }
    console.log(bad === 0 ? 'OK 全部 ' + rows.length + ' 个素材已就位' : 'FAIL ' + bad + ' 个素材缺失/不可达');
    process.exit(bad === 0 ? 0 : 1);
  })();
}
