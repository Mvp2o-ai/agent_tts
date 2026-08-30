import type { JSX } from "react";
import { StyleSheet, View } from "react-native";

export interface IconProps {
  size?: number;
  color?: string;
}

const DEFAULT_SIZE = 20;
const DEFAULT_COLOR = "#e8edf5";
const COS45 = 0.70710678118;

function strokeOf(size: number): number {
  return Math.max(1.5, size * 0.09);
}

function box(size: number) {
  return [styles.box, { width: size, height: size }];
}

export function BrandIcon({
  size = 28,
  color = "#6C8CFF",
}: IconProps): JSX.Element {
  const barWidth = Math.max(1.5, size * 0.075);
  const barHeights = [0.28, 0.52, 0.76, 0.52, 0.28];
  const gap = size * 0.075;
  const waveformWidth =
    barHeights.length * barWidth + (barHeights.length - 1) * gap;
  const waveformLeft = (size - waveformWidth) / 2;

  return (
    <View
      style={[
        box(size),
        {
          borderRadius: size * 0.28,
          borderWidth: 1,
          borderColor: color,
          backgroundColor: "rgba(108, 140, 255, 0.14)",
        },
      ]}
    >
      {barHeights.map((height, index) => (
        <View
          key={index}
          style={{
            position: "absolute",
            left: waveformLeft + index * (barWidth + gap),
            top: size * (0.5 - height / 2),
            width: barWidth,
            height: size * height,
            borderRadius: barWidth,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

function Slash({
  size,
  color,
  stroke,
}: {
  size: number;
  color: string;
  stroke: number;
}): JSX.Element {
  const length = size * 0.9;
  return (
    <View
      style={{
        position: "absolute",
        left: (size - length) / 2,
        top: (size - stroke) / 2,
        width: length,
        height: stroke,
        borderRadius: stroke / 2,
        backgroundColor: color,
        transform: [{ rotate: "-45deg" }],
      }}
    />
  );
}

function ShelfArrow({
  size,
  color,
  stroke,
  direction,
}: {
  size: number;
  color: string;
  stroke: number;
  direction: "up" | "down";
}): JSX.Element {
  const up = direction === "up";
  const headLen = size * 0.28;
  const shaftH = size * 0.4;
  const tipY = up ? size * 0.14 : size * 0.62;
  const headAlong = (headLen / 2) * COS45;
  const leftCx = size / 2 - headAlong;
  const rightCx = size / 2 + headAlong;
  const headCy = up ? tipY + headAlong : tipY - headAlong;
  const shaftTop = up ? tipY + stroke * 0.35 : tipY - shaftH + stroke * 0.35;
  const shelfW = size * 0.62;
  const shelfTop = size * 0.8;

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: leftCx - headLen / 2,
          top: headCy - stroke / 2,
          width: headLen,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          transform: [{ rotate: up ? "-45deg" : "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: rightCx - headLen / 2,
          top: headCy - stroke / 2,
          width: headLen,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          transform: [{ rotate: up ? "45deg" : "-45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - stroke) / 2,
          top: shaftTop,
          width: stroke,
          height: shaftH,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - shelfW) / 2,
          top: shelfTop,
          width: shelfW,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
    </>
  );
}

export function MicIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const bodyW = size * 0.28;
  const bodyH = size * 0.42;
  const uW = size * 0.54;
  const uH = size * 0.4;
  const uTop = size * 0.3;
  const stemH = size * 0.14;
  const stemTop = uTop + uH - stroke * 0.4;
  const baseW = size * 0.4;
  const baseTop = Math.min(size - stroke * 1.2, stemTop + stemH);

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: (size - bodyW) / 2,
          top: size * 0.08,
          width: bodyW,
          height: bodyH,
          borderRadius: bodyW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - uW) / 2,
          top: uTop,
          width: uW,
          height: uH,
          borderWidth: stroke,
          borderColor: color,
          borderTopWidth: 0,
          borderBottomLeftRadius: uW / 2,
          borderBottomRightRadius: uW / 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - stroke) / 2,
          top: stemTop,
          width: stroke,
          height: stemH,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - baseW) / 2,
          top: baseTop,
          width: baseW,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function MicOffIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  return (
    <View style={box(size)}>
      <MicIcon size={size} color={color} />
      <Slash size={size} color={color} stroke={strokeOf(size)} />
    </View>
  );
}

export function GearIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const ring = size * 0.5;
  const toothW = size * 0.2;
  const toothH = size * 0.16;
  const toothTop = (size - ring) / 2 - toothH * 0.5;

  return (
    <View style={box(size)}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            width: size,
            height: size,
            alignItems: "center",
            transform: [{ rotate: `${i * 60}deg` }],
          }}
        >
          <View
            style={{
              marginTop: toothTop,
              width: toothW,
              height: toothH,
              borderRadius: toothW * 0.28,
              backgroundColor: color,
            }}
          />
        </View>
      ))}
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: stroke * 1.15,
          borderColor: color,
          backgroundColor: "transparent",
        }}
      />
    </View>
  );
}

export function WaveIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const barW = size * 0.1;
  const gap = size * 0.065;
  const heights = [0.34, 0.58, 0.88, 0.58, 0.34];
  const totalW = heights.length * barW + (heights.length - 1) * gap;
  const origin = (size - totalW) / 2;

  return (
    <View style={box(size)}>
      {heights.map((h, i) => {
        const height = size * h;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: origin + i * (barW + gap),
              top: (size - height) / 2,
              width: barW,
              height,
              borderRadius: Math.max(barW / 2, stroke / 2),
              backgroundColor: color,
            }}
          />
        );
      })}
    </View>
  );
}

export function PowerIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const ring = size * 0.72;
  const barH = ring * 0.52;
  const barTop = size / 2 - barH;

  return (
    <View style={box(size)}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: stroke,
          borderColor: color,
          // Transparent side is rotated so the gap sits at the top.
          borderBottomColor: "transparent",
          transform: [{ rotate: "180deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - stroke) / 2,
          top: barTop,
          width: stroke,
          height: barH,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function StopIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const d = size * 0.7;
  return (
    <View style={box(size)}>
      <View
        style={{
          width: d,
          height: d,
          borderRadius: d * 0.18,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function TrashIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const handleW = size * 0.18;
  const handleH = size * 0.08;
  const lidW = size * 0.7;
  const bodyW = size * 0.52;
  const bodyH = size * 0.5;
  const lidTop = size * 0.18;
  const bodyTop = lidTop + stroke * 1.35;

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: (size - handleW) / 2,
          top: size * 0.08,
          width: handleW,
          height: handleH,
          borderRadius: handleH / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - lidW) / 2,
          top: lidTop,
          width: lidW,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - bodyW) / 2,
          top: bodyTop,
          width: bodyW,
          height: bodyH,
          borderRadius: size * 0.07,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function CheckIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const shortLen = size * 0.32;
  const longLen = size * 0.56;
  const joinX = size * 0.34;
  const joinY = size * 0.62;
  const shortCx = joinX - COS45 * (shortLen / 2);
  const shortCy = joinY - COS45 * (shortLen / 2);
  const longCx = joinX + COS45 * (longLen / 2);
  const longCy = joinY - COS45 * (longLen / 2);

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: shortCx - shortLen / 2,
          top: shortCy - stroke / 2,
          width: shortLen,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: longCx - longLen / 2,
          top: longCy - stroke / 2,
          width: longLen,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
        }}
      />
    </View>
  );
}

export function AlertIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const barW = Math.max(stroke, size * 0.12);
  const barH = size * 0.5;
  const dot = size * 0.16;
  const gap = size * 0.08;
  const groupH = barH + gap + dot;
  const groupTop = (size - groupH) / 2;

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: (size - barW) / 2,
          top: groupTop,
          width: barW,
          height: barH,
          borderRadius: barW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: (size - dot) / 2,
          top: groupTop + barH + gap,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function EyeIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const eyeW = size * 0.86;
  const eyeH = size * 0.48;
  const pupil = size * 0.22;

  return (
    <View style={box(size)}>
      <View
        style={{
          width: eyeW,
          height: eyeH,
          borderRadius: eyeH / 2,
          borderWidth: stroke,
          borderColor: color,
          backgroundColor: "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: pupil,
            height: pupil,
            borderRadius: pupil / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export function EyeOffIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  return (
    <View style={box(size)}>
      <EyeIcon size={size} color={color} />
      <Slash size={size} color={color} stroke={strokeOf(size)} />
    </View>
  );
}

export function UploadIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  return (
    <View style={box(size)}>
      <ShelfArrow
        size={size}
        color={color}
        stroke={strokeOf(size)}
        direction="up"
      />
    </View>
  );
}

export function DownloadIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  return (
    <View style={box(size)}>
      <ShelfArrow
        size={size}
        color={color}
        stroke={strokeOf(size)}
        direction="down"
      />
    </View>
  );
}

export function LinkIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const linkW = size * 0.46;
  const linkH = size * 0.28;

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: size * 0.1,
          top: size * 0.22,
          width: linkW,
          height: linkH,
          borderRadius: linkH / 2,
          borderWidth: stroke,
          borderColor: color,
          backgroundColor: "transparent",
          transform: [{ rotate: "-40deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.42,
          top: size * 0.44,
          width: linkW,
          height: linkH,
          borderRadius: linkH / 2,
          borderWidth: stroke,
          borderColor: color,
          backgroundColor: "transparent",
          transform: [{ rotate: "-40deg" }],
        }}
      />
    </View>
  );
}

export function PencilIcon({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
}: IconProps): JSX.Element {
  const stroke = strokeOf(size);
  const length = size * 0.76;
  const height = Math.max(stroke * 1.8, size * 0.16);
  const tip = height * 0.72;
  const body = length - tip;

  return (
    <View style={box(size)}>
      <View
        style={{
          position: "absolute",
          left: (size - length) / 2,
          top: (size - height) / 2,
          width: length,
          height,
          transform: [{ rotate: "-45deg" }],
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: tip,
            height,
            backgroundColor: color,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <View
          style={{
            position: "absolute",
            left: tip * 0.7,
            top: 0,
            width: body,
            height,
            borderRadius: height * 0.25,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            right: height * 0.15,
            top: height * 0.18,
            width: stroke,
            height: height * 0.64,
            borderRadius: stroke / 2,
            backgroundColor: "rgba(10, 11, 15, 0.42)",
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
});
