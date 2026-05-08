# sound-assets

微信小程序「声音板」音效资源库，通过 jsDelivr CDN 分发。

## 目录结构

```
sound-assets/
├── animals/       # 动物音效 (8个)
├── funny/         # 搞笑音效 (5个)
├── game/          # 游戏音效 (4个)
├── instruments/   # 乐器音效 (5个)
└── nature/        # 自然音效 (5个)
```

## CDN 访问

发布 Release tag 后，通过 jsDelivr 访问：

```
https://cdn.jsdelivr.net/gh/chensiyu3/sound-assets@v1.0.0/<category>/<soundId>.mp3
```

示例：
```
https://cdn.jsdelivr.net/gh/chensiyu3/sound-assets@v1.0.0/animals/cat-meow.mp3
```

## 音效来源与许可

| 分类 | 来源 | 许可证 |
|------|------|--------|
| animals (cat-meow, dog-bark, frog, birds, rain, wind) | [AntumMT/mod-sounds](https://github.com/AntumMT/mod-sounds) | CC BY 3.0 |
| animals (cow-moo, horse, pig, sheep, rooster) | [DJWoodZ/Animal-Sounds](https://github.com/DJWoodZ/Animal-Sounds) | CC0 1.0 |
| funny, game, instruments | [rse/soundfx](https://github.com/rse/soundfx) | CC0 / CC BY 3.0 |
| nature (thunder, ocean) | [Abhrankan-Chakrabarti/SoundScape](https://github.com/Abhrankan-Chakrabarti/SoundScape) | MIT |

**归因 (CC BY 3.0)**：部分音效由 AntumMT/mod-sounds 提供，原始来源为 freesound.org 社区贡献者。
