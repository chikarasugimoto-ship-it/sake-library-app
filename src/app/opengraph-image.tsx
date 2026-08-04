import { ImageResponse } from "next/og";

// SNSにURLを貼った時のリッチカード画像（深緑×金箔のブランドOG）。
// 日本語フォントを同梱しないため、文字化けを避けて欧文のみで構成する
// （og:title/description の日本語コピーは各SNSが自前フォントでテキスト表示する）。
export const runtime = "edge";
export const alt = "酒コレ（酒神コレクション）";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg, #14342a 0%, #0f241b 60%, #0a1a13 100%)",
          color: "#f4efe4",
          position: "relative",
        }}
      >
        {/* 金の二重フレーム */}
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 36,
            right: 36,
            bottom: 36,
            border: "2px solid #c9a44c",
            borderRadius: 18,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 46,
            left: 46,
            right: 46,
            bottom: 46,
            border: "1px solid rgba(201,164,76,0.4)",
            borderRadius: 14,
          }}
        />

        {/* 杉玉モチーフ */}
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: "50%",
            border: "3px solid #c9a44c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 30,
          }}
        >
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(201,164,76,0.22)" }} />
        </div>

        <div style={{ fontSize: 26, letterSpacing: 14, color: "#c9a44c", display: "flex" }}>SUGIDAMA</div>
        <div style={{ fontSize: 62, fontWeight: 700, letterSpacing: 6, marginTop: 6, display: "flex" }}>
          SAKE COLLECTION
        </div>
        <div style={{ fontSize: 27, color: "#d7cfbd", marginTop: 26, display: "flex" }}>
          Every cup becomes a page in your collection.
        </div>
        <div style={{ fontSize: 20, letterSpacing: 4, color: "#9fb1a3", marginTop: 40, display: "flex" }}>
          TOKYO · TOKIWABASHI
        </div>
      </div>
    ),
    { ...size }
  );
}
