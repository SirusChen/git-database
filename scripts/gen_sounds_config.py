"""
整理 sound-assets 音源，生成本地分包模式的声音配置 sounds.js。

本小程序采用「本地分包」方案：音频打包进 miniprogram/subpackages/audioN，
无需 CDN / 域名 / 备案。每个音源映射到 emoji + 中文标签 + 分类 + 所属分包(pkg)，
url 直接写本地绝对路径 /subpackages/<pkg>/<category>/<file>.mp3。

注意：
- 文件的实际落盘与体积均衡分包由 scripts/build_local_subpackages.js 完成，
  本脚本只负责根据 PKG 映射重新生成 sounds.js（二者 PKG 必须保持一致）。
- 运行：
  C:/Users/siruschen/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/gen_sounds_config.py
"""
import os
import json

# (文件名去后缀, emoji, 中文标签, 分类目录)
SOURCES = [
    # animals 动物
    ("cat-meow", "🐱", "喵喵", "animals"),
    ("cow-moo", "🐮", "哞哞", "animals"),
    ("dog-bark", "🐶", "汪汪", "animals"),
    ("duck", "🦆", "嘎嘎", "animals"),
    ("frog", "🐸", "呱呱", "animals"),
    ("horse", "🐴", "咴咴", "animals"),
    ("pig", "🐷", "哼哼", "animals"),
    ("rooster", "🐓", "喔喔", "animals"),
    ("sheep", "🐑", "咩咩", "animals"),

    # funny 搞怪
    ("boing", "🔵", "弹跳", "funny"),
    ("bruh", "🤨", "布鲁", "funny"),
    ("cartoon-fall", "💥", "摔倒", "funny"),
    ("evil-laugh", "😈", "坏笑", "funny"),
    ("fart-long", "💨", "长屁", "funny"),
    ("fart-short", "💨", "短屁", "funny"),
    ("laugh", "😂", "大笑", "funny"),
    ("pop", "🫧", "啵", "funny"),
    ("scream", "😱", "尖叫", "funny"),
    ("trombone", "🎺", "长号", "funny"),
    ("whistle", "📢", "口哨", "funny"),
    ("wow", "😲", "哇哦", "funny"),

    # game 游戏
    ("cashier", "💰", "收银", "game"),
    ("coin", "🪙", "金币", "game"),
    ("notification", "🔔", "通知", "game"),
    ("tap", "👆", "点击", "game"),
    ("victory", "🏆", "胜利", "game"),

    # happy 欢快
    ("air-horn", "📣", "汽笛", "happy"),
    ("applause", "👏", "鼓掌", "happy"),
    ("drum-roll", "🥁", "鼓点", "happy"),
    ("hallelujah", "🎉", "欢呼", "happy"),
    ("winning", "🏅", "夺冠", "happy"),
    ("yeah", "🙌", "耶", "happy"),
    ("yeet", "🚀", "起飞", "happy"),

    # instruments 乐器
    ("bass", "🎸", "贝斯", "instruments"),
    ("drum", "🥁", "鼓", "instruments"),
    ("guitar", "🎸", "吉他", "instruments"),
    ("harp", "🎵", "竖琴", "instruments"),
    ("piano", "🎹", "钢琴", "instruments"),

    # nature 自然
    ("birds", "🐦", "鸟鸣", "nature"),
    ("ocean", "🌊", "海浪", "nature"),
    ("rain", "🌧️", "雨声", "nature"),
    ("thunder", "⚡", "雷声", "nature"),
    ("wind", "💨", "风声", "nature"),

    # weird 奇怪
    ("baby-cry", "👶", "婴儿哭", "weird"),
    ("buzzer", "🔔", "蜂鸣", "weird"),
    ("confused", "😕", "懵了", "weird"),
    ("crickets", "🦗", "蟋蟀", "weird"),
    ("nope", "🙅", "拒绝", "weird"),
    ("shock", "😲", "震惊", "weird"),
    ("toilet", "🚽", "冲水", "weird"),
]

CATEGORIES = [
    {"id": "animals", "name": "动物", "emoji": "🐾"},
    {"id": "funny", "name": "搞怪", "emoji": "🎭"},
    {"id": "game", "name": "游戏", "emoji": "🎮"},
    {"id": "happy", "name": "欢快", "emoji": "🎉"},
    {"id": "instruments", "name": "乐器", "emoji": "🎵"},
    {"id": "nature", "name": "自然", "emoji": "🌿"},
    {"id": "weird", "name": "奇怪", "emoji": "👻"},
]

COLORS = ["pink", "teal", "amber", "purple", "blue", "green", "red"]

# 每个声音归属哪个音频分包（须与 scripts/build_local_subpackages.js 保持一致）
PKG = {
    "ocean": "audio1", "thunder": "audio1",
    "wind": "audio2", "rain": "audio2", "drum": "audio2", "drum-roll": "audio2",
    "evil-laugh": "audio2", "piano": "audio2", "air-horn": "audio2",
}


def main():
    sounds = []
    for i, (fid, emoji, label, cat) in enumerate(SOURCES):
        pkg = PKG.get(fid, "audio3")
        sounds.append({
            "id": fid,
            "emoji": emoji,
            "label": label,
            "category": cat,
            "url": f"/subpackages/{pkg}/{cat}/{fid}.mp3",
            "pkg": pkg,
            "color": COLORS[i % len(COLORS)],
        })

    data = {
        "version": "1.0.0",
        "source": "本地分包 (miniprogram/subpackages/audioN)",
        "categories": CATEGORIES,
        "sounds": sounds,
    }

    cfg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "miniprogram", "config"))

    # 本地模块：小程序 require 不支持直接 require .json，
    # 故本地兜底配置用 .js 模块（module.exports），首页 require 它
    js_path = os.path.join(cfg_dir, "sounds.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("// 本地声音配置（由 scripts/gen_sounds_config.py 生成，请勿手改）\n")
        f.write("module.exports = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")

    # CDN 热更新清单：远程 wx.request 拉取的是纯 JSON（sounds.json）
    json_path = os.path.join(cfg_dir, "sounds.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"已生成 {len(sounds)} 个声音（本地分包模式）→ {js_path} (本地) / {json_path} (本地)")
    print("分类数:", len(CATEGORIES))


if __name__ == "__main__":
    main()
