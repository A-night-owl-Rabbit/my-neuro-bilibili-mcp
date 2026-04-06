# -*- coding: utf-8 -*-
"""
使用 bilibili-api-python 获取 B 站字幕（与 astrbot_plugin_biliread / BiliRead 相同方案）。
用法: python subtitle_fetch_biliapi.py <BV号> [cid]
stdout: JSON { "success", "text", "lang", "is_ai" } 或 { "success": false, "error" }
"""
import asyncio
import json
import os
import sys
from typing import Optional

import aiohttp

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def _load_config():
    path = os.path.join(os.path.dirname(__file__), "bili_config.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def _fetch_subtitle_json(session: aiohttp.ClientSession, url: str, referer: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": referer,
    }
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            raise RuntimeError(f"下载字幕失败 HTTP {resp.status}")
        return await resp.json()


async def run(bvid: str, cid_override: Optional[int]) -> dict:
    from bilibili_api import Credential, video

    cfg = _load_config()
    if not cfg or not cfg.get("SESSDATA") or not cfg.get("bili_jct"):
        return {"success": False, "error": "bili_config.json 缺少 SESSDATA 或 bili_jct"}

    dede = cfg.get("DedeUserID")
    credential = Credential(
        sessdata=cfg["SESSDATA"],
        bili_jct=cfg["bili_jct"],
        dedeuserid=str(dede) if dede is not None else None,
        buvid3=cfg.get("buvid3"),
        buvid4=cfg.get("buvid4"),
    )

    referer = f"https://www.bilibili.com/video/{bvid}"
    v = video.Video(bvid=bvid, credential=credential)

    await v.get_info()

    if cid_override is not None and cid_override > 0:
        cid = cid_override
    else:
        cid = await v.get_cid(0)

    subtitle_info = await v.get_subtitle(cid)
    if not subtitle_info or not subtitle_info.get("subtitles"):
        return {"success": False, "error": "该视频没有可用字幕"}

    target = None
    for sub in subtitle_info["subtitles"]:
        lan = sub.get("lan") or ""
        if lan.startswith("zh"):
            target = sub
            break
    if not target:
        target = subtitle_info["subtitles"][0]

    subtitle_url = target.get("subtitle_url") or ""
    if not subtitle_url:
        return {"success": False, "error": "字幕元数据中缺少 subtitle_url"}

    if not subtitle_url.startswith("http"):
        subtitle_url = "https:" + subtitle_url if subtitle_url.startswith("//") else "https://" + subtitle_url.lstrip("/")

    log_url = subtitle_url.split("?")[0]
    print(f"[字幕] bilibili-api-python 拉取: {log_url}", file=sys.stderr, flush=True)

    async with aiohttp.ClientSession() as session:
        sub_json = await _fetch_subtitle_json(session, subtitle_url, referer)

    body = sub_json.get("body") or []
    lines = []
    for item in body:
        c = (item.get("content") or "").strip()
        if c:
            lines.append(c)
    raw_text = "\n".join(lines)

    if not raw_text.strip():
        return {"success": False, "error": "字幕内容为空"}

    lan = target.get("lan") or ""
    is_ai = lan.startswith("ai-")
    lang_label = target.get("lan_doc") or lan or "unknown"

    return {
        "success": True,
        "text": raw_text,
        "lang": lang_label,
        "is_ai": is_ai,
    }


async def main_async():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "未提供 BV 号"}, ensure_ascii=False), flush=True)
        return
    bvid = sys.argv[1].strip()
    cid_override = None
    if len(sys.argv) >= 3 and sys.argv[2].strip().isdigit():
        cid_override = int(sys.argv[2].strip())

    try:
        result = await run(bvid, cid_override)
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main_async())
