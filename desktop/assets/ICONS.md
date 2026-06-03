# Tray icon assets

Place the following files in this directory before building:

| File | Size | Platform | Notes |
|---|---|---|---|
| `trayTemplate.png` | 22×22 px | macOS | **White monochrome** on transparent background. macOS auto-inverts for dark/light menu bar. Suffix `Template` is required. |
| `trayTemplate@2x.png` | 44×44 px | macOS Retina | Same as above, 2× |
| `tray.ico` | 16/32/48 px | Windows | Multi-size .ico |
| `tray.png` | 22×22 px | Linux | Colored PNG (will show in system tray) |
| `icon.icns` | — | macOS app icon | Used by electron-builder for the .dmg |
| `icon.ico` | — | Windows app icon | Used by electron-builder for the .exe |
| `icon.png` | 512×512 px | Linux app icon | Used by electron-builder |

## Quick generation

If you have ImageMagick installed:

```bash
# macOS tray (white hexagon on transparent)
convert -size 22x22 xc:none -fill white -draw "polygon 11,1 19,6 19,16 11,21 3,16 3,6" trayTemplate.png

# Linux/Windows tray (colored)
convert -size 22x22 xc:none -fill "#6d5efc" -draw "polygon 11,1 19,6 19,16 11,21 3,16 3,6" tray.png

# App icon (all platforms — scale as needed)
convert -size 512x512 xc:none -fill "#6d5efc" -draw "polygon 256,10 450,128 450,384 256,502 62,384 62,128" icon.png
```

Or use any design tool — the hexagon (⬡) is the enzo-ai brand mark.
