# TubeEQ — YouTube Equalizer

A reliable 10-band equalizer for YouTube. Free forever, open source, no ads, no paywall, no data collected.

**TubeEQ — EQ 10 band cho YouTube.** Miễn phí vĩnh viễn, mã nguồn mở, không quảng cáo, không thu thập dữ liệu.

## Features / Tính năng

- **10-band EQ** (31 Hz – 16 kHz) with genre presets: Rock, Pop, Jazz, Classical, Electronic, Lofi + community presets (V-Pop, EDM…). Hover any band for a plain-language explanation.
- **In-player floating button**: a red TubeEQ button floats on the video player (top-right) — one click opens a mini panel to switch presets or toggle power without leaving the video. Full controls stay in the toolbar popup.
- **FxSound-style effects**: Clarity (harmonic exciter), Ambience (room reverb), Surround (stereo widener), Dynamic Boost (smart compression), **Lossless Restore** (transient restorer — brings back the snap that lossy codecs smear)
- **Smart EQ**: auto-suggests a preset based on video type (music, podcast, gaming…)
- **Smart EQ**: auto-suggests a preset based on video type (music, podcast, gaming…)
- **Per-channel memory**: remembers your preset for each YouTube channel
- **Volume boost** up to 200% + **volume leveling** across videos (no more loudness jumps)
- **Clip indicator** + **A/B compare** button
- **Preset sharing**: copy a short code, friends paste it to get your exact EQ
- **Visualizer**: live proof the EQ is actually processing your audio
- English / Tiếng Việt interface
- Minimal permissions: only `youtube.com`. No `tabCapture`, no all-sites access.

## Install / Cài đặt

1. Open `chrome://extensions`, enable **Developer mode**
2. Click **Load unpacked**, select this folder
3. Open a YouTube video, click the TubeEQ icon

## Share a preset / Chia sẻ preset

Click **Share** to copy your preset code (looks like `TQ1.xxxxx`), send it to a friend — they click **Nhập mã / Import**, paste, Apply. Done.

## Privacy / Quyền riêng tư

TubeEQ does not collect, transmit, or store any personal data. Settings stay in your browser (`chrome.storage`).
TubeEQ không thu thập hay gửi đi bất kỳ dữ liệu nào. Cài đặt chỉ lưu trong trình duyệt của bạn.

## Notes / Lưu ý

- Built on the Web Audio API: `MediaElementSource → Gain → 10× BiquadFilter → Compressor → Analyser → destination`
- Each `<video>` element allows exactly one audio source: after **updating/reloading the extension**, **reload open YouTube tabs**
- YouTube is a SPA (no reload between videos): the extension re-attaches on `yt-navigate-finish` + URL polling

## License

MIT — see [LICENSE](LICENSE).
